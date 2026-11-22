use std::{fs, process::Command};
use tracelane::{proxy::create_run, store::Store};

#[test]
fn inspect_shows_file_diffs_summaries_and_missing_step_error() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    fs::write(dir.path().join("a.txt"), "before\n").unwrap();
    let pre = store.snapshot().unwrap();
    fs::write(dir.path().join("a.txt"), "after\n").unwrap();
    fs::write(dir.path().join("binary"), [0, 255]).unwrap();
    let post = store.snapshot().unwrap();
    let run = create_run(&store, "inspect", "http://localhost", None).unwrap();
    store.db.execute("INSERT INTO steps VALUES (?1,1,'POST','/v1/messages',?2,?3,200,12,?4,?5,0,'now','application/json')",rusqlite::params![run,r#"{"model":"test","messages":[{"role":"user","content":"question"}]}"#,r#"{"content":[{"text":"answer"}]}"#,pre,post]).unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_tracelane"))
        .current_dir(dir.path())
        .args(["inspect", &run, "--step", "1"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let text = String::from_utf8(output.stdout).unwrap();
    for expected in [
        "-before",
        "+after",
        "binary file, diff skipped",
        "model=\"test\"",
        "question",
        "answer",
    ] {
        assert!(text.contains(expected), "{text}");
    }
    assert!(!text.contains('\x1b'));
    let output = Command::new(env!("CARGO_BIN_EXE_tracelane"))
        .current_dir(dir.path())
        .args(["inspect", &run])
        .output()
        .unwrap();
    assert!(
        String::from_utf8(output.stdout)
            .unwrap()
            .contains("+1 ~1 -0")
    );
    let output = Command::new(env!("CARGO_BIN_EXE_tracelane"))
        .current_dir(dir.path())
        .args(["inspect", &run, "--step", "9"])
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(
        String::from_utf8(output.stderr)
            .unwrap()
            .contains("step not found")
    );
}

#[test]
fn child_exit_code_and_environment_are_recorded() {
    let dir = tempfile::tempdir().unwrap();
    let output = Command::new(env!("CARGO_BIN_EXE_tracelane"))
        .current_dir(dir.path())
        .args([
            "record",
            "--port",
            "0",
            "--target",
            "http://127.0.0.1:1",
            "--",
            "sh",
            "-c",
            "printf '%s %s' \"$OPENAI_BASE_URL\" \"$ANTHROPIC_BASE_URL\"; exit 7",
        ])
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(7));
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(text.contains("/v1 http://127.0.0.1:"), "{text}");
    assert!(text.contains("0 steps  exit 7"));
    for line in text
        .lines()
        .filter(|line| line.contains("  run ") || line.contains("0 steps  exit"))
    {
        assert!(
            line.as_bytes()[..8]
                .iter()
                .enumerate()
                .all(|(i, c)| if i == 2 || i == 5 {
                    *c == b':'
                } else {
                    c.is_ascii_digit()
                }),
            "{line}"
        );
        assert_eq!(&line[8..10], "  ");
    }
    let store = Store::open(dir.path()).unwrap();
    let code: i32 = store
        .db
        .query_row("SELECT exit_code FROM runs", [], |r| r.get(0))
        .unwrap();
    assert_eq!(code, 7);
}

#[test]
fn replay_target_overrides_parent_and_uses_record_default_when_unset() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let snapshot = store.snapshot().unwrap();
    let run = create_run(&store, "parent", "http://parent.invalid", None).unwrap();
    store.db.execute("INSERT INTO steps VALUES (?1,1,'POST','/v1/messages','{}','{}',200,0,?2,?2,0,'now','application/json')",rusqlite::params![run,snapshot]).unwrap();
    for (extra, expected) in [
        (
            vec!["--target", "http://override.invalid"],
            "http://override.invalid",
        ),
        (vec![], "http://environment.invalid"),
    ] {
        let output = Command::new(env!("CARGO_BIN_EXE_tracelane"))
            .current_dir(dir.path())
            .env("TRACELANE_UPSTREAM_URL", "http://environment.invalid")
            .args(["replay", &run, "--from-step", "1", "--port", "0"])
            .args(extra)
            .args(["--", "true"])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let target: String = store
            .db
            .query_row(
                "SELECT target FROM runs WHERE parent_run_id=?1 ORDER BY started_at DESC LIMIT 1",
                [&run],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(target, expected);
    }
}
