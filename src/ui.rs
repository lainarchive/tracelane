use crate::{Result, inspect, proxy, store::Store};
use axum::{
    Json, Router,
    extract::{Path, State},
    http::StatusCode,
    response::Html,
    routing::get,
};
use serde::Serialize;
use serde_json::{Value, json};
use std::{net::SocketAddr, path::Path as FsPath, sync::Arc};
use tokio::sync::{Mutex, oneshot};

#[derive(Serialize)]
struct Run {
    id: String,
    parent_run_id: Option<String>,
    forked_from_step: Option<u32>,
    command: String,
    started_at: String,
    exit_code: Option<i32>,
    step_count: u32,
}
type Shared = Arc<Mutex<Store>>;
type ApiResult = std::result::Result<Json<Value>, (StatusCode, Json<Value>)>;
fn failure(error: impl std::fmt::Display) -> (StatusCode, Json<Value>) {
    (
        StatusCode::INTERNAL_SERVER_ERROR,
        Json(json!({"error":error.to_string()})),
    )
}
fn missing() -> (StatusCode, Json<Value>) {
    (
        StatusCode::NOT_FOUND,
        Json(json!({"error":"resource not found"})),
    )
}
fn runs(store: &Store) -> Result<Vec<Run>> {
    let mut stmt=store.db.prepare("SELECT id,parent_run_id,forked_from_step,command,started_at,exit_code,(SELECT count(*) FROM steps WHERE run_id=runs.id) FROM runs ORDER BY started_at DESC,id")?;
    Ok(stmt
        .query_map([], |r| {
            Ok(Run {
                id: r.get(0)?,
                parent_run_id: r.get(1)?,
                forked_from_step: r.get(2)?,
                command: {
                    let command: String = r.get(3)?;
                    serde_json::from_str::<Vec<String>>(&command)
                        .map(|args| args.join(" "))
                        .unwrap_or(command)
                },
                started_at: r.get(4)?,
                exit_code: r.get(5)?,
                step_count: r.get(6)?,
            })
        })?
        .collect::<std::result::Result<_, _>>()?)
}
async fn list(State(state): State<Shared>) -> ApiResult {
    let store = state.lock().await;
    Ok(Json(
        serde_json::to_value(runs(&store).map_err(failure)?).map_err(failure)?,
    ))
}
async fn detail(State(state): State<Shared>, Path(id): Path<String>) -> ApiResult {
    let store = state.lock().await;
    let run = runs(&store)
        .map_err(failure)?
        .into_iter()
        .find(|r| r.id == id)
        .ok_or_else(missing)?;
    let steps=proxy::steps(&store,&id).map_err(failure)?.iter().map(|s| {
        Ok(json!({"step_index":s.index,"endpoint":format!("{} {}",s.method,s.path),"status":s.status,"latency_ms":s.latency_ms,"cached":s.cached,"files":inspect::file_counts(&store,s)?,"pre_snapshot_id":s.pre_snapshot_id.chars().take(12).collect::<String>(),"post_snapshot_id":s.post_snapshot_id.chars().take(12).collect::<String>()}))
    }).collect::<Result<Vec<_>>>().map_err(failure)?;
    Ok(Json(json!({"run":run,"steps":steps})))
}
async fn step(State(state): State<Shared>, Path((id, n)): Path<(String, u32)>) -> ApiResult {
    let store = state.lock().await;
    let step = proxy::steps(&store, &id)
        .map_err(failure)?
        .into_iter()
        .find(|s| s.index == n)
        .ok_or_else(missing)?;
    Ok(Json(
        json!({"step_index":step.index,"diffs":inspect::file_diffs(&store,&step).map_err(failure)?,"summary":inspect::summary(&step),"request":step.request,"response":step.response}),
    ))
}
pub fn router(store: Store) -> Router {
    Router::new()
        .route("/", get(|| async { Html(include_str!("ui.html")) }))
        .route("/api/runs", get(list))
        .route("/api/runs/{id}", get(detail))
        .route("/api/runs/{id}/steps/{n}", get(step))
        .with_state(Arc::new(Mutex::new(store)))
}
pub struct UiServer {
    pub addr: SocketAddr,
    stop: oneshot::Sender<()>,
    task: tokio::task::JoinHandle<std::io::Result<()>>,
}
impl UiServer {
    pub async fn shutdown(self) -> Result<()> {
        let _ = self.stop.send(());
        self.task.await??;
        Ok(())
    }
}
pub async fn start_ui(root: &FsPath, port: u16) -> Result<UiServer> {
    let app = router(Store::open(root)?);
    let listener = tokio::net::TcpListener::bind((std::net::Ipv4Addr::LOCALHOST, port)).await?;
    let addr = listener.local_addr()?;
    let (stop, rx) = oneshot::channel();
    let task = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = rx.await;
            })
            .await
    });
    Ok(UiServer { addr, stop, task })
}
