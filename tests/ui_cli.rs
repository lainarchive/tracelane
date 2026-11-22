use std::{process::Stdio, time::Duration};
use tokio::{
    io::{AsyncBufReadExt, BufReader},
    process::Command,
    time::timeout,
};

#[tokio::test]
async fn browser_mode_serves_without_a_display_and_stops_with_the_process() {
    let dir = tempfile::tempdir().unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_tracelane"))
        .current_dir(dir.path())
        .args(["ui", "--browser", "--port", "0"])
        .env_remove("DISPLAY")
        .env_remove("WAYLAND_DISPLAY")
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .kill_on_drop(true)
        .spawn()
        .unwrap();
    let mut lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let line = timeout(Duration::from_secs(10), lines.next_line())
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let url = format!("http://{}", line.split_once("http://").unwrap().1.trim());
    let addr: std::net::SocketAddr = url.strip_prefix("http://").unwrap().parse().unwrap();
    assert!(addr.ip().is_loopback());
    assert_ne!(addr.port(), 0);
    let workspace: serde_json::Value = reqwest::get(format!("{url}/api/workspace"))
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(workspace["path"], dir.path().to_str().unwrap());
    #[cfg(unix)]
    {
        assert!(
            Command::new("kill")
                .args(["-INT", &child.id().unwrap().to_string()])
                .status()
                .await
                .unwrap()
                .success()
        );
        assert!(
            timeout(Duration::from_secs(10), child.wait())
                .await
                .unwrap()
                .unwrap()
                .success()
        );
    }
    #[cfg(not(unix))]
    child.kill().await.unwrap();
    assert!(tokio::net::TcpStream::connect(addr).await.is_err());
}

#[tokio::test]
async fn browser_mode_reports_an_occupied_port_without_opening_a_window() {
    let dir = tempfile::tempdir().unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mut command = Command::new(env!("CARGO_BIN_EXE_tracelane"));
    command
        .current_dir(dir.path())
        .args([
            "ui",
            "--browser",
            "--port",
            &listener.local_addr().unwrap().port().to_string(),
        ])
        .env_remove("DISPLAY")
        .env_remove("WAYLAND_DISPLAY")
        .kill_on_drop(true);
    let output = timeout(Duration::from_secs(10), command.output())
        .await
        .unwrap()
        .unwrap();
    assert!(!output.status.success());
    assert!(String::from_utf8_lossy(&output.stderr).contains("error:"));
}
