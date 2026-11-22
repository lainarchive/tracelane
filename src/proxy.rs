use crate::{
    Result, output,
    store::{Store, hash},
};
use axum::{
    Router,
    body::{Body, to_bytes},
    extract::State,
    http::{Request, Response, StatusCode},
};
use rusqlite::params;
use serde_json::Value;
use std::{net::SocketAddr, path::Path, sync::Arc, time::Instant};
use tokio::sync::{Mutex, oneshot};

#[derive(Debug, Clone)]
pub struct Step {
    pub index: u32,
    pub method: String,
    pub path: String,
    pub request: Value,
    pub response: Value,
    pub status: u16,
    pub latency_ms: u64,
    pub pre_snapshot_id: String,
    pub post_snapshot_id: String,
    pub cached: bool,
    pub response_content_type: String,
}
pub fn steps(store: &Store, run: &str) -> Result<Vec<Step>> {
    let mut stmt=store.db.prepare("SELECT step_index,method,path,request_json,response_json,status,latency_ms,pre_snapshot_id,post_snapshot_id,cached,response_content_type FROM steps WHERE run_id=?1 ORDER BY step_index")?;
    let rows = stmt.query_map([run], |r| {
        Ok((
            r.get::<_, u32>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, String>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, u16>(5)?,
            r.get::<_, u64>(6)?,
            r.get::<_, String>(7)?,
            r.get::<_, String>(8)?,
            r.get::<_, bool>(9)?,
            r.get::<_, String>(10)?,
        ))
    })?;
    rows.map(|row| {
        let (
            index,
            method,
            path,
            request,
            response,
            status,
            latency_ms,
            pre_snapshot_id,
            post_snapshot_id,
            cached,
            response_content_type,
        ) = row?;
        Ok(Step {
            index,
            method,
            path,
            request: serde_json::from_str(&request)?,
            response: serde_json::from_str(&response)?,
            status,
            latency_ms,
            pre_snapshot_id,
            post_snapshot_id,
            cached,
            response_content_type,
        })
    })
    .collect()
}
pub fn create_run(
    store: &Store,
    command: &str,
    target: &str,
    parent: Option<(&str, u32)>,
) -> Result<String> {
    let now = chrono::Utc::now().to_rfc3339();
    let id = hash(format!("{now}:{}:{command}", std::process::id()).as_bytes())[..12].to_owned();
    store.db.execute("INSERT INTO runs(id,parent_run_id,forked_from_step,command,target,started_at) VALUES (?1,?2,?3,?4,?5,?6)",params![id,parent.map(|p|p.0),parent.map(|p|p.1),command,target,now])?;
    Ok(id)
}
pub fn finish_run(store: &Store, run: &str, code: i32) -> Result<()> {
    store.db.execute(
        "UPDATE runs SET finished_at=?2,exit_code=?3 WHERE id=?1",
        params![run, chrono::Utc::now().to_rfc3339(), code],
    )?;
    Ok(())
}
struct Session {
    store: Store,
    run: String,
    target: String,
    client: reqwest::Client,
    index: u32,
    cache: Vec<Step>,
    from: u32,
    live: bool,
}
pub struct Proxy {
    pub addr: SocketAddr,
    stop: oneshot::Sender<()>,
    task: tokio::task::JoinHandle<std::io::Result<()>>,
}
impl Proxy {
    pub async fn shutdown(self) -> Result<()> {
        let _ = self.stop.send(());
        self.task.await??;
        Ok(())
    }
}
pub async fn start_proxy(
    root: &Path,
    run: &str,
    target: &str,
    port: u16,
    replay: Option<(String, u32)>,
) -> Result<Proxy> {
    let store = Store::open(root)?;
    let (cache, from) = match replay {
        Some((parent, n)) => (steps(&store, &parent)?, n),
        None => (Vec::new(), 1),
    };
    let state = Arc::new(Mutex::new(Session {
        store,
        run: run.into(),
        target: target.trim_end_matches('/').into(),
        client: reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()?,
        index: 0,
        cache,
        from,
        live: false,
    }));
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    let addr = listener.local_addr()?;
    let (stop, rx) = oneshot::channel();
    let task = tokio::spawn(async move {
        axum::serve(listener, Router::new().fallback(handle).with_state(state))
            .with_graceful_shutdown(async {
                let _ = rx.await;
            })
            .await
    });
    Ok(Proxy { addr, stop, task })
}
async fn handle(State(state): State<Arc<Mutex<Session>>>, req: Request<Body>) -> Response<Body> {
    let mut session = state.lock().await;
    match session.forward(req).await {
        Ok(r) => r,
        Err(e) => {
            eprintln!("proxy: {e}");
            Response::builder()
                .status(StatusCode::BAD_GATEWAY)
                .body(Body::from(e.to_string()))
                .unwrap()
        }
    }
}
fn json_body(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes)
        .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(bytes).into_owned()))
}
fn response_bytes(step: &Step) -> Result<Vec<u8>> {
    let media_type = step
        .response_content_type
        .split(';')
        .next()
        .unwrap_or("")
        .trim();
    if media_type == "application/json" || media_type.ends_with("+json") {
        return Ok(serde_json::to_vec(&step.response)?);
    }
    if let Value::String(body) = &step.response {
        Ok(body.as_bytes().to_vec())
    } else {
        Ok(serde_json::to_vec(&step.response)?)
    }
}
impl Session {
    async fn forward(&mut self, req: Request<Body>) -> Result<Response<Body>> {
        let (parts, body) = req.into_parts();
        let bytes = to_bytes(body, usize::MAX).await?;
        let request = json_body(&bytes);
        let path = parts
            .uri
            .path_and_query()
            .map(|p| p.as_str())
            .unwrap_or("/")
            .to_owned();
        self.index += 1;
        let pre = self.store.snapshot()?;
        let start = Instant::now();
        let cached = self
            .cache
            .iter()
            .find(|s| s.index == self.index)
            .filter(|_| !self.live && self.index < self.from)
            .cloned();
        let cached = cached.filter(|s| {
            if s.request != request || s.method != parts.method.as_str() || s.path != path {
                eprintln!(
                    "warning: cached request differs at step {}; continuing live",
                    self.index
                );
                self.live = true;
                false
            } else {
                true
            }
        });
        let (status, content_type, body, response, is_cached) = if let Some(step) = cached {
            (
                step.status,
                step.response_content_type.clone(),
                response_bytes(&step)?,
                step.response,
                true,
            )
        } else {
            let mut headers = parts.headers;
            for name in [
                "host",
                "content-length",
                "connection",
                "transfer-encoding",
                "upgrade",
                "keep-alive",
                "proxy-connection",
                "te",
                "trailer",
            ] {
                headers.remove(name);
            }
            let result = self
                .client
                .request(parts.method.clone(), format!("{}{}", self.target, path))
                .headers(headers)
                .body(bytes)
                .send()
                .await;
            match result {
                Ok(upstream) => {
                    let status = upstream.status().as_u16();
                    let content_type = upstream
                        .headers()
                        .get("content-type")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("application/octet-stream")
                        .to_owned();
                    // shortcut: buffer SSE until completion; stream when long-running responses require it.
                    let body = upstream.bytes().await?.to_vec();
                    let response = if content_type.starts_with("text/event-stream") {
                        Value::String(String::from_utf8(body.clone())?)
                    } else {
                        json_body(&body)
                    };
                    (status, content_type, body, response, false)
                }
                Err(e) => {
                    let body = e.to_string();
                    (
                        502,
                        "text/plain".into(),
                        body.as_bytes().to_vec(),
                        Value::String(body),
                        false,
                    )
                }
            }
        };
        let latency_ms = start.elapsed().as_millis() as u64;
        let post = self.store.snapshot()?;
        let step = Step {
            index: self.index,
            method: parts.method.to_string(),
            path,
            request,
            response,
            status,
            latency_ms,
            pre_snapshot_id: pre,
            post_snapshot_id: post,
            cached: is_cached,
            response_content_type: content_type,
        };
        self.store.db.execute(
            "INSERT INTO steps VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
            params![
                self.run,
                step.index,
                step.method,
                step.path,
                step.request.to_string(),
                step.response.to_string(),
                step.status,
                step.latency_ms,
                step.pre_snapshot_id,
                step.post_snapshot_id,
                step.cached,
                chrono::Utc::now().to_rfc3339(),
                step.response_content_type
            ],
        )?;
        output::print_step(&self.store, &step)?;
        Ok(Response::builder()
            .status(status)
            .header("content-type", &step.response_content_type)
            .body(Body::from(body))?)
    }
}
