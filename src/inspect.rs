use crate::{Result, proxy::Step, store::Store};
use serde::Serialize;
use similar::{ChangeTag, TextDiff};
use std::collections::BTreeSet;

#[derive(Serialize)]
pub struct FileCounts {
    pub added: usize,
    pub modified: usize,
    pub deleted: usize,
}
#[derive(Serialize)]
pub struct DiffLine {
    pub kind: &'static str,
    pub old_line: Option<usize>,
    pub new_line: Option<usize>,
    pub text: String,
}
#[derive(Serialize)]
pub struct Hunk {
    pub header: String,
    pub lines: Vec<DiffLine>,
}
#[derive(Serialize)]
pub struct FileDiff {
    pub path: String,
    pub note: Option<&'static str>,
    pub hunks: Vec<Hunk>,
}
#[derive(Serialize)]
pub struct Summary {
    pub request: String,
    pub response: String,
}

pub fn file_counts(store: &Store, step: &Step) -> Result<FileCounts> {
    let before = store.manifest(&step.pre_snapshot_id)?;
    let after = store.manifest(&step.post_snapshot_id)?;
    Ok(FileCounts {
        added: after.keys().filter(|p| !before.contains_key(*p)).count(),
        deleted: before.keys().filter(|p| !after.contains_key(*p)).count(),
        modified: after
            .iter()
            .filter(|(p, s)| before.get(*p).is_some_and(|old| old != *s))
            .count(),
    })
}
pub fn file_diffs(store: &Store, step: &Step) -> Result<Vec<FileDiff>> {
    let before = store.manifest(&step.pre_snapshot_id)?;
    let after = store.manifest(&step.post_snapshot_id)?;
    let paths: BTreeSet<_> = before.keys().chain(after.keys()).collect();
    let mut files = Vec::new();
    for path in paths {
        if before.get(path) == after.get(path) {
            continue;
        }
        let old = before
            .get(path)
            .map(|s| store.blob(s))
            .transpose()?
            .unwrap_or_default();
        let new = after
            .get(path)
            .map(|s| store.blob(s))
            .transpose()?
            .unwrap_or_default();
        let mut file = FileDiff {
            path: path.clone(),
            note: None,
            hunks: Vec::new(),
        };
        if old.contains(&0) || new.contains(&0) {
            file.note = Some("binary file, diff skipped");
        } else if let (Ok(old), Ok(new)) = (std::str::from_utf8(&old), std::str::from_utf8(&new)) {
            let diff = TextDiff::from_lines(old, new);
            for hunk in diff.unified_diff().iter_hunks() {
                let mut lines = Vec::new();
                for change in hunk.iter_changes() {
                    lines.push(DiffLine {
                        kind: match change.tag() {
                            ChangeTag::Delete => "delete",
                            ChangeTag::Insert => "insert",
                            ChangeTag::Equal => "context",
                        },
                        old_line: change.old_index().map(|n| n + 1),
                        new_line: change.new_index().map(|n| n + 1),
                        text: change.to_string(),
                    });
                }
                file.hunks.push(Hunk {
                    header: hunk.header().to_string().trim_end().to_owned(),
                    lines,
                });
            }
        } else {
            file.note = Some("non-UTF8 file, diff skipped");
        }
        files.push(file);
    }
    Ok(files)
}
pub fn summary(step: &Step) -> Summary {
    let value = &step.request;
    let request = format!(
        "model={} user={}",
        value.get("model").unwrap_or(&serde_json::Value::Null),
        value
            .get("messages")
            .and_then(|v| v.as_array())
            .and_then(|a| a.iter().rev().find(|v| v["role"] == "user"))
            .map(|v| &v["content"])
            .unwrap_or(value)
    );
    let response = step
        .response
        .pointer("/choices/0/message/content")
        .or_else(|| step.response.pointer("/content/0/text"))
        .unwrap_or(&step.response);
    Summary {
        request: request.chars().take(400).collect(),
        response: response
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| response.to_string())
            .chars()
            .take(400)
            .collect(),
    }
}
