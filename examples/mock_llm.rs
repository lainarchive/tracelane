use axum::{
    Json, Router,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::{get, post},
};
use serde_json::{Value, json};
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
use tracelane::Result;

fn instruction(messages: usize) -> Option<Value> {
    let (path, content) = match messages {
        1 => (
            "src/lib.rs",
            "pub fn greeting(name: &str) -> String {\n    format!(\"Hello, {name}!\")\n}\n\npub fn farewell(name: &str) -> String {\n    format!(\"Goodbye, {name}!\")\n}\n",
        ),
        3 => (
            "src/lib.rs",
            "pub fn greeting(name: &str) -> String {\n    let name = name.trim();\n    if name.is_empty() {\n        return \"Hello, stranger!\".to_owned();\n    }\n    format!(\"Hello, {name}!\")\n}\n\npub fn farewell(name: &str) -> String {\n    format!(\"Goodbye, {}!\", name.trim())\n}\n",
        ),
        5 => (
            "tests/greeting.rs",
            "use demo_workspace::{farewell, greeting};\n\n#[test]\nfn greetings_trim_names() {\n    assert_eq!(greeting(\" Ada \"), \"Hello, Ada!\");\n    assert_eq!(greeting(\" \"), \"Hello, stranger!\");\n    assert_eq!(farewell(\" Ada \"), \"Goodbye, Ada!\");\n}\n",
        ),
        _ => return None,
    };
    Some(json!({"path":path,"content":content}))
}
async fn respond(hits: Arc<AtomicUsize>, body: Value, anthropic: bool) -> Response {
    let messages = body["messages"].as_array().map_or(0, Vec::len);
    let Some(action) = instruction(messages) else {
        return (
            StatusCode::BAD_REQUEST,
            Json(json!({"error":"expected 1, 3 or 5 messages"})),
        )
            .into_response();
    };
    let hit = hits.fetch_add(1, Ordering::SeqCst) + 1;
    println!(
        "mock_llm  hit {hit}  step {}  messages {messages}",
        messages.div_ceil(2)
    );
    tokio::time::sleep(std::time::Duration::from_millis(250)).await;
    let text = action.to_string();
    if anthropic {
        return Json(json!({"id":"msg_mock","type":"message","role":"assistant","model":"mock-local","content":[{"type":"text","text":text}],"stop_reason":"end_turn","usage":{"input_tokens":0,"output_tokens":0}})).into_response();
    }
    if body["stream"] == true {
        let chunk = json!({"id":"chatcmpl-mock","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"content":text},"finish_reason":null}]});
        return (
            [("content-type", "text/event-stream")],
            format!("data: {chunk}\n\ndata: [DONE]\n\n"),
        )
            .into_response();
    }
    Json(json!({"id":"chatcmpl-mock","object":"chat.completion","model":"mock-local","choices":[{"index":0,"message":{"role":"assistant","content":text},"finish_reason":"stop"}]})).into_response()
}
#[tokio::main]
async fn main() -> Result<()> {
    let port: u16 = std::env::args()
        .nth(1)
        .or_else(|| std::env::var("MOCK_LLM_PORT").ok())
        .unwrap_or_else(|| "9900".into())
        .parse()?;
    let app = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route(
            "/v1/chat/completions",
            post(
                |State(hits): State<Arc<AtomicUsize>>, Json(body): Json<Value>| async move {
                    respond(hits, body, false).await
                },
            ),
        )
        .route(
            "/v1/messages",
            post(
                |State(hits): State<Arc<AtomicUsize>>, Json(body): Json<Value>| async move {
                    respond(hits, body, true).await
                },
            ),
        )
        .with_state(Arc::new(AtomicUsize::new(0)));
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    println!("mock_llm  listening http://{}", listener.local_addr()?);
    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn conversation_length_selects_repeatable_file_actions() {
        let first = super::instruction(1).unwrap();
        assert_eq!(first["path"], "src/lib.rs");
        assert!(first["content"].as_str().unwrap().contains("Hello"));
        assert!(
            super::instruction(3).unwrap()["content"]
                .as_str()
                .unwrap()
                .contains("trim()")
        );
        assert_eq!(super::instruction(5).unwrap()["path"], "tests/greeting.rs");
        assert!(super::instruction(0).is_none());
    }
}
