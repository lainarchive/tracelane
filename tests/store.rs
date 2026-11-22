use std::fs;
use tracelane::store::Store;

#[cfg(unix)]
#[test]
fn state_directories_are_private_on_creation_and_reopen() {
    use std::os::unix::fs::PermissionsExt;
    let dir = tempfile::tempdir().unwrap();
    for _ in 0..2 {
        Store::open(dir.path()).unwrap();
        for path in [".tracelane", ".tracelane/blobs"] {
            let path = dir.path().join(path);
            assert_eq!(
                fs::metadata(&path).unwrap().permissions().mode() & 0o777,
                0o700
            );
            fs::set_permissions(path, fs::Permissions::from_mode(0o755)).unwrap();
        }
    }
}

#[test]
fn snapshots_dedupe_and_restore_without_touching_ignored_directories() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    fs::write(dir.path().join("a"), "original").unwrap();
    fs::write(dir.path().join("deleted"), "back").unwrap();
    for ignored in [".git", "target", "node_modules", ".tracelane"] {
        fs::create_dir_all(dir.path().join(ignored)).unwrap();
        fs::write(dir.path().join(ignored).join("keep"), "ignored").unwrap();
    }
    let first = store.snapshot().unwrap();
    assert_eq!(first, store.snapshot().unwrap());
    assert_eq!(
        fs::read_dir(dir.path().join(".tracelane/blobs"))
            .unwrap()
            .count(),
        2
    );
    fs::write(dir.path().join("a"), "changed").unwrap();
    fs::remove_file(dir.path().join("deleted")).unwrap();
    fs::create_dir(dir.path().join("new")).unwrap();
    fs::write(dir.path().join("new/added"), "new").unwrap();
    assert_ne!(first, store.snapshot().unwrap());
    store.restore(&first).unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("a")).unwrap(),
        "original"
    );
    assert_eq!(
        fs::read_to_string(dir.path().join("deleted")).unwrap(),
        "back"
    );
    assert!(!dir.path().join("new").exists());
    for ignored in [".git", "target", "node_modules", ".tracelane"] {
        assert!(dir.path().join(ignored).join("keep").exists());
    }
    assert!(store.restore("missing").is_err());
    let reopened = Store::open(dir.path()).unwrap();
    assert_eq!(reopened.manifest(&first).unwrap().len(), 2);
}

#[test]
fn empty_snapshot_restores_empty_tree() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let empty = store.snapshot().unwrap();
    fs::write(dir.path().join("added"), "x").unwrap();
    store.restore(&empty).unwrap();
    assert!(!dir.path().join("added").exists());
}

#[test]
fn restore_handles_file_directory_replacements() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    fs::write(dir.path().join("entry"), "file").unwrap();
    let snapshot = store.snapshot().unwrap();
    fs::remove_file(dir.path().join("entry")).unwrap();
    fs::create_dir_all(dir.path().join("entry/target")).unwrap();
    fs::write(dir.path().join("entry/target/keep"), "ignored").unwrap();
    assert!(store.restore(&snapshot).is_err());
    assert_eq!(
        fs::read_to_string(dir.path().join("entry/target/keep")).unwrap(),
        "ignored"
    );
    fs::remove_dir_all(dir.path().join("entry/target")).unwrap();
    store.restore(&snapshot).unwrap();
    assert_eq!(
        fs::read_to_string(dir.path().join("entry")).unwrap(),
        "file"
    );
}
