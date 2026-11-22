use crate::Result;
use std::net::SocketAddr;
use tao::{
    dpi::LogicalSize,
    event::{Event, WindowEvent},
    event_loop::{ControlFlow, EventLoop},
    platform::run_return::EventLoopExtRunReturn,
    window::WindowBuilder,
};
use wry::WebViewBuilder;

pub fn open_window(addr: SocketAddr) -> Result<()> {
    let mut event_loop = EventLoop::new();
    let window = WindowBuilder::new()
        .with_title("Tracelane")
        .with_inner_size(LogicalSize::new(1440.0, 900.0))
        .with_min_inner_size(LogicalSize::new(1000.0, 600.0))
        .build(&event_loop)?;
    let origin = format!("http://{addr}/");
    let builder = WebViewBuilder::new()
        .with_url(&origin)
        .with_navigation_handler(move |url| url.starts_with(&origin))
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
