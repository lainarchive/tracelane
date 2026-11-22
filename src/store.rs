use crate::Result;
use rusqlite::{Connection, params};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    fs,
    io::Write,
    path::{Component, Path, PathBuf},
};
use walkdir::WalkDir;

pub struct Store {
    pub root: PathBuf,
    pub db: Connection,
}
pub fn hash(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}
pub fn workspace_entries(root: &Path) -> impl Iterator<Item = walkdir::Result<walkdir::DirEntry>> {
    WalkDir::new(root).into_iter().filter_entry(|e| {
        e.depth() == 0
            || ![".git", "target", "node_modules", ".tracelane"]
                .contains(&e.file_name().to_str().unwrap_or(""))
    })
}
impl Store {
    pub fn open(root: &Path) -> Result<Self> {
        fs::create_dir_all(root.join(".tracelane/blobs"))?;
        let db = Connection::open(root.join(".tracelane/traces.db"))?;
        db.execute_batch("PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS snapshot_files(snapshot_id TEXT, path TEXT, sha TEXT, PRIMARY KEY(snapshot_id,path));
CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, parent_run_id TEXT, forked_from_step INTEGER, command TEXT NOT NULL, target TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, exit_code INTEGER);
CREATE TABLE IF NOT EXISTS steps(run_id TEXT, step_index INTEGER, method TEXT, path TEXT, request_json TEXT, response_json TEXT, status INTEGER, latency_ms INTEGER, pre_snapshot_id TEXT, post_snapshot_id TEXT, cached INTEGER NOT NULL, created_at TEXT NOT NULL, response_content_type TEXT, PRIMARY KEY(run_id,step_index));")?;
        Ok(Self {
            root: root.to_path_buf(),
            db,
        })
    }
    pub fn snapshot(&self) -> Result<String> {
        let mut files = BTreeMap::new();
        for entry in workspace_entries(&self.root) {
            let entry = entry?;
            if !entry.file_type().is_file() {
                continue;
            }
            let path = entry
                .path()
                .strip_prefix(&self.root)?
                .to_str()
                .ok_or("non-UTF8 path")?
                .to_owned();
            let bytes = fs::read(entry.path())?;
            let sha = hash(&bytes);
            match fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(self.root.join(".tracelane/blobs").join(&sha))
            {
                Ok(mut file) => file.write_all(&bytes)?,
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(e.into()),
            }
            files.insert(path, sha);
        }
        let manifest = files
            .iter()
            .map(|(p, s)| serde_json::to_string(&(p, s)))
            .collect::<std::result::Result<Vec<_>, _>>()?
            .join("\n");
        let id = hash(manifest.as_bytes());
        let tx = self.db.unchecked_transaction()?;
        tx.execute(
            "INSERT OR IGNORE INTO snapshots VALUES (?1,?2)",
            params![id, chrono::Utc::now().to_rfc3339()],
        )?;
        for (path, sha) in files {
            tx.execute(
                "INSERT OR IGNORE INTO snapshot_files VALUES (?1,?2,?3)",
                params![id, path, sha],
            )?;
        }
        tx.commit()?;
        Ok(id)
    }
    pub fn manifest(&self, id: &str) -> Result<BTreeMap<String, String>> {
        if !self.db.query_row(
            "SELECT EXISTS(SELECT 1 FROM snapshots WHERE id=?1)",
            [id],
            |r| r.get::<_, bool>(0),
        )? {
            return Err("snapshot not found".into());
        }
        let mut stmt = self
            .db
            .prepare("SELECT path,sha FROM snapshot_files WHERE snapshot_id=?1 ORDER BY path")?;
        Ok(stmt
            .query_map([id], |r| Ok((r.get(0)?, r.get(1)?)))?
            .collect::<std::result::Result<_, _>>()?)
    }
    pub fn blob(&self, sha: &str) -> Result<Vec<u8>> {
        if sha.len() != 64 || !sha.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("invalid blob hash".into());
        }
        Ok(fs::read(self.root.join(".tracelane/blobs").join(sha))?)
    }
    pub fn restore(&self, id: &str) -> Result<()> {
        let files = self.manifest(id)?;
        let mut contents = Vec::new();
        for (path, sha) in &files {
            if Path::new(path).components().any(|c| {
                !matches!(c, Component::Normal(_))
                    || [".git", "target", "node_modules", ".tracelane"]
                        .iter()
                        .any(|s| c.as_os_str() == *s)
            }) {
                return Err("unsafe snapshot path".into());
            }
            contents.push((path, self.blob(sha)?));
        }
        let mut dirs = Vec::new();
        for entry in workspace_entries(&self.root) {
            let entry = entry?;
            if entry.depth() == 0 {
                continue;
            }
            if entry.file_type().is_dir() {
                dirs.push(entry.into_path());
            } else if !files.contains_key(
                entry
                    .path()
                    .strip_prefix(&self.root)?
                    .to_str()
                    .ok_or("non-UTF8 path")?,
            ) || entry.file_type().is_symlink()
            {
                fs::remove_file(entry.path())?;
            }
        }
        dirs.sort_by_key(|p| std::cmp::Reverse(p.components().count()));
        for dir in dirs {
            if fs::read_dir(&dir)?.next().is_none() {
                fs::remove_dir(dir)?;
            }
        }
        for (path, bytes) in contents {
            let dest = self.root.join(path);
            if let Some(parent) = dest.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::write(dest, bytes)?;
        }
        Ok(())
    }
}
