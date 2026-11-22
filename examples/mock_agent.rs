use serde_json::{Value, json};
use std::{
    fs,
    path::{Component, Path},
    time::Duration,
};
use tracelane::Result;

fn reply_text(body: &str) -> Result<String> {
    if body.starts_with("data:") {
        let mut text = String::new();
        for line in body.lines().filter_map(|line| line.strip_prefix("data: ")) {
            if line == "[DONE]" {
                continue;
            }
            let chunk: Value = serde_json::from_str(line)?;
            if let Some(content) = chunk
                .pointer("/choices/0/delta/content")
                .and_then(Value::as_str)
            {
                text.push_str(content);
            }
        }
        if text.is_empty() {
            return Err("stream has no assistant content".into());
        }
        Ok(text)
    } else {
        let value: Value = serde_json::from_str(body)?;
        Ok(value
            .pointer("/choices/0/message/content")
            .and_then(Value::as_str)
            .ok_or("reply has no assistant content")?
            .to_owned())
    }
}
fn validate_path(path: &str) -> Result<()> {
    if path.is_empty()
        || Path::new(path).components().any(|c| {
            !matches!(c, Component::Normal(_))
                || [".git", ".tracelane"]
                    .iter()
                    .any(|name| c.as_os_str() == *name)
        })
    {
        return Err("unsafe file path".into());
    }
    Ok(())
}
fn apply(text: &str) -> Result<()> {
    let action: Value = serde_json::from_str(text)?;
    let path = action["path"].as_str().ok_or("missing file path")?;
    let content = action["content"].as_str().ok_or("missing file content")?;
    validate_path(path)?;
    let path = Path::new(path);
    let mut ancestor = Some(path);
    while let Some(part) = ancestor {
        if fs::symlink_metadata(part).is_ok_and(|meta| meta.file_type().is_symlink()) {
            return Err("symlink file path".into());
        }
        ancestor = part.parent();
    }
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    fs::write(path, content)?;
    Ok(())
}
#[tokio::main]
async fn main() -> Result<()> {
    let base =
        std::env::var("OPENAI_BASE_URL").unwrap_or_else(|_| "http://127.0.0.1:9900/v1".into());
    let client = reqwest::Client::new();
    let mut messages = vec![
        json!({"role":"user","content":"Write greeting and farewell functions in src/lib.rs."}),
    ];
    let mut pending: Option<String> = None;
    for step in 1..=3 {
        let request = client
            .post(format!("{}/chat/completions", base.trim_end_matches('/')))
            .json(&json!({"model":"mock-local","messages":messages,"stream":step==2}))
            .send();
        // Overlap local edits with the next request so its snapshots capture the changes.
        let edit = async {
            if let Some(text) = pending.take() {
                tokio::time::sleep(Duration::from_millis(75)).await;
                apply(&text)?;
            }
            Ok::<_, Box<dyn std::error::Error + Send + Sync>>(())
        };
        let (response, edit) = tokio::join!(request, edit);
        edit?;
        let text = reply_text(&response?.error_for_status()?.text().await?)?;
        messages.push(json!({"role":"assistant","content":text}));
        messages.push(json!({"role":"user","content":if step==1 {"Handle empty names and trim whitespace."} else {"Add tests in tests/greeting.rs."}}));
        pending = Some(text);
    }
    if let Some(text) = pending {
        apply(&text)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn decodes_json_and_streamed_reply_and_rejects_missing_content() {
        assert_eq!(
            super::reply_text(r#"{"choices":[{"message":{"content":"hello"}}]}"#).unwrap(),
            "hello"
        );
        assert_eq!(super::reply_text("data: {\"choices\":[{\"delta\":{\"content\":\"hel\"}}]}\n\ndata: {\"choices\":[{\"delta\":{\"content\":\"lo\"}}]}\n\ndata: [DONE]\n\n").unwrap(), "hello");
        assert!(super::reply_text("{}").is_err());
        assert!(super::reply_text("data: invalid\n\n").is_err());
    }
    #[test]
    fn file_actions_reject_paths_outside_workspace() {
        for path in [
            "../escape",
            "/absolute",
            "src/../../escape",
            ".tracelane/traces.db",
        ] {
            assert!(super::validate_path(path).is_err());
        }
        assert!(super::validate_path("src/lib.rs").is_ok());
    }
}
