use std::fs;
use tracelane::{proxy::create_run, store::Store, ui::start_ui};

#[tokio::test]
async fn inspector_reports_deleted_file_line_counts() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    fs::write(dir.path().join("removed.txt"), "first\nsecond\n").unwrap();
    let pre = store.snapshot().unwrap();
    fs::remove_file(dir.path().join("removed.txt")).unwrap();
    let post = store.snapshot().unwrap();
    let run = create_run(&store, "delete", "http://localhost", None).unwrap();
    store.db.execute("INSERT INTO steps VALUES (?1,1,'POST','/v1/messages','{}','{}',200,0,?2,?3,0,'now','application/json')", rusqlite::params![run,pre,post]).unwrap();
    let server = start_ui(dir.path(), 0).await.unwrap();
    let step: serde_json::Value =
        reqwest::get(format!("http://{}/api/runs/{run}/steps/1", server.addr))
            .await
            .unwrap()
            .json()
            .await
            .unwrap();
    assert_eq!(step["diffs"][0]["change"], "D");
    assert_eq!(step["diffs"][0]["added_lines"], 0);
    assert_eq!(step["diffs"][0]["deleted_lines"], 2);
    server.shutdown().await.unwrap();
}

#[tokio::test]
async fn inspector_serves_run_steps_structured_diff_and_missing_resources() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    fs::write(dir.path().join("src.txt"), "before\nkeep\n").unwrap();
    let pre = store.snapshot().unwrap();
    fs::write(dir.path().join("src.txt"), "after\nkeep\n").unwrap();
    fs::write(dir.path().join("binary"), [0, 255]).unwrap();
    let post = store.snapshot().unwrap();
    let run = create_run(&store, "fixture", "http://localhost", None).unwrap();
    let fork = create_run(&store, "fork", "http://localhost", Some((&run, 1))).unwrap();
    store
        .db
        .execute(
            "UPDATE runs SET finished_at='2026-11-22T02:00:03Z', exit_code=0 WHERE id=?1",
            [&run],
        )
        .unwrap();
    store.db.execute("INSERT INTO steps VALUES (?1,1,'POST','/v1/messages',?2,?3,200,12,?4,?5,1,'now','application/json')",rusqlite::params![run,r#"{"model":"test","messages":[{"role":"user","content":"question"}]}"#,r#"{"content":[{"text":"answer"}]}"#,pre,post]).unwrap();
    let server = start_ui(dir.path(), 0).await.unwrap();
    let client = reqwest::Client::new();
    let base = format!("http://{}", server.addr);
    let html = client.get(&base).send().await.unwrap();
    assert_eq!(html.status(), 200);
    assert!(
        html.headers()["content-type"]
            .to_str()
            .unwrap()
            .contains("text/html")
    );
    assert!(html.text().await.unwrap().contains("File Diff"));
    let list: serde_json::Value = client
        .get(format!("{base}/api/runs"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    let recorded = list
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == run)
        .unwrap();
    assert_eq!(recorded["step_count"], 1);
    assert_eq!(recorded["command"], "fixture");
    assert_eq!(recorded["display_command"], "fixture");
    assert_eq!(recorded["target"], "http://localhost");
    assert_eq!(recorded["finished_at"], "2026-11-22T02:00:03Z");
    assert_eq!(recorded["exit_code"], 0);
    let workspace: serde_json::Value = client
        .get(format!("{base}/api/workspace"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(workspace["path"], dir.path().to_str().unwrap());
    let readable = create_run(
        &store,
        r#"["cargo","run","--example","mock_agent"]"#,
        "http://localhost",
        None,
    )
    .unwrap();
    let list: serde_json::Value = client
        .get(format!("{base}/api/runs"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        list.as_array()
            .unwrap()
            .iter()
            .find(|r| r["id"] == readable)
            .unwrap()["command"],
        "cargo run --example mock_agent"
    );
    let labeled = create_run(
        &store,
        r#"["/usr/local/bin/npx","my-agent","fix auth"]"#,
        "http://localhost",
        None,
    )
    .unwrap();
    let labeled: serde_json::Value = client
        .get(format!("{base}/api/runs/{labeled}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        labeled["run"]["display_command"],
        r#"npx my-agent "fix auth""#
    );
    assert_eq!(
        labeled["run"]["command"],
        "/usr/local/bin/npx my-agent fix auth"
    );
    let child = list
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["id"] == fork)
        .unwrap();
    assert_eq!(child["parent_run_id"], run);
    assert_eq!(child["forked_from_step"], 1);
    let detail: serde_json::Value = client
        .get(format!("{base}/api/runs/{run}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(detail["run"]["id"], run);
    assert_eq!(detail["steps"][0]["endpoint"], "POST /v1/messages");
    assert_eq!(detail["steps"][0]["cached"], true);
    assert_eq!(
        detail["steps"][0]["files"],
        serde_json::json!({"added":1,"modified":1,"deleted":0})
    );
    assert_eq!(detail["steps"][0]["pre_snapshot_id"], &pre[..12]);
    let step: serde_json::Value = client
        .get(format!("{base}/api/runs/{run}/steps/1"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(step["request"]["model"], "test");
    assert_eq!(step["summary"]["response"], "answer");
    let files = step["diffs"].as_array().unwrap();
    assert_eq!(files[0]["note"], "binary file, diff skipped");
    assert_eq!(files[1]["path"], "src.txt");
    assert_eq!(files[0]["change"], "A");
    assert_eq!(files[1]["change"], "M");
    assert_eq!(files[1]["added_lines"], 1);
    assert_eq!(files[1]["deleted_lines"], 1);
    let lines = files[1]["hunks"][0]["lines"].as_array().unwrap();
    assert!(lines.iter().any(|l| l["kind"] == "delete"
        && l["old_line"] == 1
        && l["text"] == "before\n"
        && l["new_line"].is_null()));
    assert!(
        lines
            .iter()
            .any(|l| l["kind"] == "insert" && l["new_line"] == 1 && l["text"] == "after\n")
    );
    let empty: serde_json::Value = client
        .get(format!("{base}/api/runs/{fork}"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(empty["steps"], serde_json::json!([]));
    assert!(empty["run"]["finished_at"].is_null());
    for path in [
        "/api/runs/missing".to_owned(),
        format!("/api/runs/{run}/steps/99"),
    ] {
        let response = client.get(format!("{base}{path}")).send().await.unwrap();
        assert_eq!(response.status(), 404);
        assert!(response.json::<serde_json::Value>().await.unwrap()["error"].is_string());
    }
    server.shutdown().await.unwrap();
}
