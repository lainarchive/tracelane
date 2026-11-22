use crate::Result;
use std::{net::SocketAddr, path::PathBuf};
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    platform::run_return::EventLoopExtRunReturn,
    window::WindowBuilder,
};
use wry::WebViewBuilder;

#[cfg(target_os = "windows")]
const ORIGIN: &str = "http://tracelane.localhost/";
#[cfg(not(target_os = "windows"))]
const ORIGIN: &str = "tracelane://localhost/";

async fn protocol_response(
    addr: SocketAddr,
    request: wry::http::Request<Vec<u8>>,
) -> wry::http::Response<Vec<u8>> {
    let origin: wry::http::Uri = ORIGIN.parse().unwrap();
    if request.uri().scheme() != origin.scheme() || request.uri().authority() != origin.authority()
    {
        return wry::http::Response::builder()
            .status(403)
            .body(Vec::new())
            .unwrap();
    }
    let result: Result<_> = async {
        let client = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .build()?;
        let path = request
            .uri()
            .path_and_query()
            .map_or("/", |path| path.as_str());
        let response = client
            .request(request.method().clone(), format!("http://{addr}{path}"))
            .body(request.into_body())
            .send()
            .await?;
        let mut builder = wry::http::Response::builder().status(response.status());
        *builder.headers_mut().unwrap() = response.headers().clone();
        Ok(builder.body(response.bytes().await?.to_vec())?)
    }
    .await;
    result.unwrap_or_else(|_| {
        wry::http::Response::builder()
            .status(502)
            .body(b"Inspector unavailable".to_vec())
            .unwrap()
    })
}

fn webview_data_dir(base: Option<PathBuf>) -> Result<PathBuf> {
    let path = base
        .ok_or("could not locate a per-user data directory")?
        .join("tracelane")
        .join("webview");
    std::fs::create_dir_all(&path)?;
    Ok(path)
}

pub fn open_window(addr: SocketAddr) -> Result<()> {
    let data_dir = webview_data_dir(dirs::data_local_dir())?;
    let mut event_loop = EventLoop::new();
    let mut context = wry::WebContext::new(Some(data_dir));
    let window = WindowBuilder::new()
        .with_title("Tracelane")
        .with_inner_size(LogicalSize::new(1440.0, 900.0))
        .with_min_inner_size(LogicalSize::new(1000.0, 600.0))
        .build(&event_loop)?;
    let runtime = tokio::runtime::Handle::current();
    let builder = WebViewBuilder::new_with_web_context(&mut context)
        .with_asynchronous_custom_protocol("tracelane".into(), move |_, request, responder| {
            runtime.spawn(async move {
                responder.respond(protocol_response(addr, request).await);
            });
        })
        .with_url(ORIGIN)
        .with_navigation_handler(|url| url.starts_with(ORIGIN))
        .with_new_window_req_handler(|_, _| wry::NewWindowResponse::Deny);
    #[cfg(any(target_os = "windows", target_os = "macos"))]
    let _webview = builder.build(&window)?;
    #[cfg(not(any(target_os = "windows", target_os = "macos")))]
    let _webview = {
        use tao::platform::unix::WindowExtUnix;
        use wry::WebViewBuilderExtUnix;
        let container = window.default_vbox().ok_or("window has no GTK container")?;
        builder.build_gtk(container)?
    };
    event_loop.run_return(|event, _, control_flow| {
        *control_flow = ControlFlow::Wait;
        if let Event::WindowEvent {
            event: WindowEvent::CloseRequested,
            ..
        } = event
        {
            *control_flow = ControlFlow::Exit;
        }
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_is_created_under_the_user_data_directory() {
        let base = tempfile::tempdir().unwrap();
        let path = webview_data_dir(Some(base.path().to_path_buf())).unwrap();
        assert_eq!(path, base.path().join("tracelane/webview"));
        assert!(path.is_dir());
    }

    #[test]
    fn profile_reports_missing_or_unwritable_data_directories() {
        assert!(webview_data_dir(None).is_err());
        let file = tempfile::NamedTempFile::new().unwrap();
        assert!(webview_data_dir(Some(file.path().to_path_buf())).is_err());
    }

    #[tokio::test]
    async fn protocol_serves_ui_and_api_from_the_same_origin() {
        let dir = tempfile::tempdir().unwrap();
        let server = crate::ui::start_ui(dir.path(), 0).await.unwrap();
        for path in ["/", "/api/runs", "/api/workspace", "/api/missing"] {
            let response = protocol_response(
                server.addr,
                wry::http::Request::builder()
                    .uri(format!("{ORIGIN}{}", &path[1..]))
                    .body(Vec::new())
                    .unwrap(),
            )
            .await;
            assert_eq!(
                response.status().as_u16(),
                if path == "/api/missing" { 404 } else { 200 }
            );
            if path == "/api/runs" {
                assert_eq!(response.body(), b"[]");
            }
            if path == "/api/workspace" {
                let data: serde_json::Value = serde_json::from_slice(response.body()).unwrap();
                assert_eq!(data["path"], dir.path().to_str().unwrap());
            }
        }
        server.shutdown().await.unwrap();
    }

    #[tokio::test]
    async fn protocol_rejects_external_origins_and_reports_a_stopped_server() {
        let dir = tempfile::tempdir().unwrap();
        let server = crate::ui::start_ui(dir.path(), 0).await.unwrap();
        let addr = server.addr;
        for uri in [
            "https://example.com/api/runs",
            "tracelane://localhost.evil/api/runs",
        ] {
            let response = protocol_response(
                addr,
                wry::http::Request::builder()
                    .uri(uri)
                    .body(Vec::new())
                    .unwrap(),
            )
            .await;
            assert_eq!(response.status(), 403);
        }
        server.shutdown().await.unwrap();
        let response = protocol_response(
            addr,
            wry::http::Request::builder()
                .uri(ORIGIN)
                .body(Vec::new())
                .unwrap(),
        )
        .await;
        assert_eq!(response.status(), 502);
    }
}
