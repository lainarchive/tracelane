use clap::{Parser, Subcommand};
use tracelane::{Result, proxy, store::Store};

#[derive(Parser)]
#[command(
    name = "tracelane",
    version,
    about = "Record and replay model requests with workspace snapshots"
)]
struct Cli {
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    Ui {
        #[arg(long, default_value_t = 7480)]
        port: u16,
    },
    Record {
        #[arg(long, default_value_t = 7474)]
        port: u16,
        #[arg(long)]
        target: Option<String>,
        #[arg(last = true, required = true)]
        command: Vec<String>,
    },
    Inspect {
        run_id: String,
        #[arg(long)]
        step: Option<u32>,
    },
    Replay {
        run_id: String,
        #[arg(long)]
        from_step: u32,
        #[arg(long, default_value_t = 7474)]
        port: u16,
        #[arg(last = true)]
        command: Vec<String>,
    },
}
#[tokio::main]
async fn main() {
    match run().await {
        Ok(code) => std::process::exit(code),
        Err(e) => {
            eprintln!("error: {e}");
            std::process::exit(1)
        }
    }
}
async fn run() -> Result<i32> {
    let root = std::env::current_dir()?;
    let store = Store::open(&root)?;
    let (command, target, port, parent) = match Cli::parse().command {
        Command::Ui { port } => {
            let server = tracelane::ui::start_ui(&root, port).await?;
            println!(
                "{}  inspector http://{}",
                tracelane::output::timestamp(),
                server.addr
            );
            tokio::signal::ctrl_c().await?;
            server.shutdown().await?;
            return Ok(0);
        }
        Command::Inspect { run_id, step } => {
            tracelane::output::inspect(&store, &run_id, step)?;
            return Ok(0);
        }
        Command::Record {
            port,
            target,
            command,
        } => (
            command,
            target
                .or_else(|| std::env::var("TRACELANE_UPSTREAM_URL").ok())
                .unwrap_or_else(|| "https://api.openai.com".into()),
            port,
            None,
        ),
        Command::Replay {
            run_id,
            from_step,
            port,
            command,
        } => {
            let steps = proxy::steps(&store, &run_id)?;
            let step = steps
                .iter()
                .find(|s| s.index == from_step)
                .ok_or("step not found")?;
            store.restore(&step.pre_snapshot_id)?;
            println!(
                "{}  Restored {run_id} before step {from_step}",
                tracelane::output::timestamp()
            );
            if command.is_empty() {
                return Ok(0);
            }
            let target: String =
                store
                    .db
                    .query_row("SELECT target FROM runs WHERE id=?1", [&run_id], |r| {
                        r.get(0)
                    })?;
            (command, target, port, Some((run_id, from_step)))
        }
    };
    let run = proxy::create_run(
        &store,
        &serde_json::to_string(&command)?,
        &target,
        parent.as_ref().map(|(id, n)| (id.as_str(), *n)),
    )?;
    let server = proxy::start_proxy(&root, &run, &target, port, parent).await?;
    println!(
        "{}  run {run}  proxy http://{}  upstream {target}",
        tracelane::output::timestamp(),
        server.addr
    );
    let status = tokio::process::Command::new(&command[0])
        .args(&command[1..])
        .env("OPENAI_BASE_URL", format!("http://{}/v1", server.addr))
        .env("ANTHROPIC_BASE_URL", format!("http://{}", server.addr))
        .status()
        .await;
    server.shutdown().await?;
    let code = match status {
        Ok(s) => s.code().unwrap_or(1),
        Err(e) => {
            proxy::finish_run(&store, &run, 127)?;
            return Err(e.into());
        }
    };
    proxy::finish_run(&store, &run, code)?;
    println!();
    println!(
        "{}  {} steps  exit {code}  tracelane inspect {run}",
        tracelane::output::timestamp(),
        proxy::steps(&store, &run)?.len()
    );
    Ok(code)
}
