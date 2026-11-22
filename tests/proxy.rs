use axum::{Router, routing::post};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tracelane::{
    proxy::{create_run, start_proxy, steps},
    store::Store,
};

#[tokio::test]
async fn forwarding_drops_accept_encoding_but_preserves_other_headers() {
    let dir = tempfile::tempdir().unwrap();
    let app = Router::new().route(
        "/v1/messages",
        post(|headers: axum::http::HeaderMap| async move {
            assert!(!headers.contains_key("accept-encoding"));
            assert_eq!(headers["x-request-id"], "test-request");
            "uncompressed"
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let store = Store::open(dir.path()).unwrap();
    let run = create_run(&store, "test", &target, None).unwrap();
    let proxy = start_proxy(dir.path(), &run, &target, 0, None)
        .await
        .unwrap();
    let response = reqwest::Client::new()
        .post(format!("http://{}/v1/messages", proxy.addr))
        .header("accept-encoding", "gzip, br")
        .header("x-request-id", "test-request")
        .body("{}")
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
    assert_eq!(response.text().await.unwrap(), "uncompressed");
    proxy.shutdown().await.unwrap();
    server.abort();
}

#[tokio::test]
async fn hybrid_replay_preserves_sse_and_forks_then_goes_live() {
    let dir = tempfile::tempdir().unwrap();
    let hits = Arc::new(AtomicUsize::new(0));
    let count = hits.clone();
    let app = Router::new().route(
        "/v1/messages",
        post(move || {
            let count = count.clone();
            async move {
                let n = count.fetch_add(1, Ordering::SeqCst);
                if n == 1 {
                    (
                        [("content-type", "text/event-stream")],
                        "data: {\"text\":\"hello\"}\n\ndata: [DONE]\n\n",
                    )
                } else {
                    (
                        [("content-type", "application/json")],
                        "{\"choices\":[{\"message\":{\"content\":\"ok\"}}]}",
                    )
                }
            }
        }),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = format!("http://{}", listener.local_addr().unwrap());
    let server = tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    let store = Store::open(dir.path()).unwrap();
    let run = create_run(&store, "test", &target, None).unwrap();
    let proxy = start_proxy(dir.path(), &run, &target, 0, None)
        .await
        .unwrap();
    let client = reqwest::Client::new();
    let mut bodies = Vec::new();
    for n in 1..=3 {
        std::fs::write(dir.path().join("state"), format!("{n}")).unwrap();
        bodies.push(
            client
                .post(format!("http://{}/v1/messages", proxy.addr))
                .json(&serde_json::json!({"n":n}))
                .send()
                .await
                .unwrap()
                .bytes()
                .await
                .unwrap(),
        );
    }
    proxy.shutdown().await.unwrap();
    let original = steps(&store, &run).unwrap();
    assert_eq!(original.len(), 3);
    assert_eq!(original[1].response_content_type, "text/event-stream");
    store.restore(&original[2].pre_snapshot_id).unwrap();
    assert_eq!(
        std::fs::read_to_string(dir.path().join("state")).unwrap(),
        "3"
    );
    let fork = create_run(&store, "fork", &target, Some((&run, 3))).unwrap();
    let proxy = start_proxy(dir.path(), &fork, &target, 0, Some((run.clone(), 3)))
        .await
        .unwrap();
    for n in 1..=3 {
        let body = client
            .post(format!("http://{}/v1/messages", proxy.addr))
            .json(&serde_json::json!({"n":n}))
            .send()
            .await
            .unwrap()
            .bytes()
            .await
            .unwrap();
        assert_eq!(body, bodies[n - 1]);
        assert_eq!(hits.load(Ordering::SeqCst), if n < 3 { 3 } else { 4 });
    }
    proxy.shutdown().await.unwrap();
    let fork_steps = steps(&store, &fork).unwrap();
    assert_eq!(
        fork_steps.iter().map(|s| s.cached).collect::<Vec<_>>(),
        vec![true, true, false]
    );
    let parent: String = store
        .db
        .query_row("SELECT parent_run_id FROM runs WHERE id=?1", [fork], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(parent, run);
    let mismatch = create_run(&store, "mismatch", &target, Some((&run, 3))).unwrap();
    let proxy = start_proxy(dir.path(), &mismatch, &target, 0, Some((run.clone(), 3)))
        .await
        .unwrap();
    for n in [99, 2] {
        client
            .post(format!("http://{}/v1/messages", proxy.addr))
            .json(&serde_json::json!({"n":n}))
            .send()
            .await
            .unwrap()
            .error_for_status()
            .unwrap();
    }
    proxy.shutdown().await.unwrap();
    assert_eq!(hits.load(Ordering::SeqCst), 6);
    assert!(steps(&store, &mismatch).unwrap().iter().all(|s| !s.cached));
    server.abort();
}

#[tokio::test]
async fn upstream_failure_is_persisted_and_run_can_be_finished() {
    let dir = tempfile::tempdir().unwrap();
    let store = Store::open(dir.path()).unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = format!("http://{}", listener.local_addr().unwrap());
    drop(listener);
    let run = create_run(&store, "failure", &target, None).unwrap();
    assert!(steps(&store, &run).unwrap().is_empty());
    let proxy = start_proxy(dir.path(), &run, &target, 0, None)
        .await
        .unwrap();
    let response = reqwest::Client::new()
        .get(format!("http://{}/empty?q=1", proxy.addr))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 502);
    proxy.shutdown().await.unwrap();
    tracelane::proxy::finish_run(&store, &run, 7).unwrap();
    drop(store);
    let store = Store::open(dir.path()).unwrap();
    let recorded = steps(&store, &run).unwrap();
    assert_eq!(recorded[0].status, 502);
    assert_eq!(recorded[0].path, "/empty?q=1");
    assert_eq!(recorded[0].request, serde_json::json!(""));
    let (code, finished): (i32, String) = store
        .db
        .query_row(
            "SELECT exit_code,finished_at FROM runs WHERE id=?1",
            [run],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .unwrap();
    assert_eq!(code, 7);
    assert!(!finished.is_empty());
}

#[tokio::test]
async fn replay_preserves_json_string_response_encoding() {
    let dir = tempfile::tempdir().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target = format!("http://{}", listener.local_addr().unwrap());
    let upstream = tokio::spawn(async move {
        axum::serve(
            listener,
            Router::new()
                .fallback(|| async { ([("content-type", "application/json")], "\"hello\"") }),
        )
        .await
        .unwrap()
    });
    let store = Store::open(dir.path()).unwrap();
    let run = create_run(&store, "record", &target, None).unwrap();
    let proxy = start_proxy(dir.path(), &run, &target, 0, None)
        .await
        .unwrap();
    let client = reqwest::Client::new();
    let original = client
        .get(format!("http://{}/", proxy.addr))
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    proxy.shutdown().await.unwrap();
    let fork = create_run(&store, "fork", &target, Some((&run, 2))).unwrap();
    let proxy = start_proxy(dir.path(), &fork, &target, 0, Some((run, 2)))
        .await
        .unwrap();
    let cached = client
        .get(format!("http://{}/", proxy.addr))
        .send()
        .await
        .unwrap()
        .text()
        .await
        .unwrap();
    proxy.shutdown().await.unwrap();
    assert_eq!(original, "\"hello\"");
    assert_eq!(cached, original);
    upstream.abort();
}
