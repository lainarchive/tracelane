use crate::{Result, inspect, proxy::Step, store::Store};
use std::io::IsTerminal;

pub fn paint(text: impl std::fmt::Display, code: &str) -> String {
    if std::io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none() {
        format!("\x1b[{code}m{text}\x1b[0m")
    } else {
        text.to_string()
    }
}
pub fn timestamp() -> String {
    paint(chrono::Local::now().format("%H:%M:%S"), "90")
}
pub fn print_step(store: &Store, step: &Step) -> Result<()> {
    let files = inspect::file_counts(store, step)?;
    println!(
        "{}  step {:>3}  {:<32}  {}  {:>6} ms  {}  +{} ~{} -{}",
        timestamp(),
        step.index,
        format!("{} {}", step.method, step.path),
        paint(
            format!("{:>3}", step.status),
            if step.status < 300 { "32" } else { "31" }
        ),
        step.latency_ms,
        paint(
            if step.cached { "cached" } else { "live  " },
            if step.cached { "33" } else { "2" }
        ),
        files.added,
        files.modified,
        files.deleted
    );
    Ok(())
}
pub fn inspect(store: &Store, run: &str, index: Option<u32>) -> Result<()> {
    let steps = crate::proxy::steps(store, run)?;
    if let Some(index) = index {
        let step = steps
            .iter()
            .find(|s| s.index == index)
            .ok_or("step not found")?;
        for file in inspect::file_diffs(store, step)? {
            if let Some(note) = file.note {
                println!("{}: {note}", file.path);
                continue;
            }
            println!("{}", paint(format!("--- a/{}", file.path), "31"));
            println!("{}", paint(format!("+++ b/{}", file.path), "32"));
            for hunk in file.hunks {
                println!("{}", paint(hunk.header, "2;36"));
                for line in hunk.lines {
                    let (prefix, color) = match line.kind {
                        "delete" => ("-", "31"),
                        "insert" => ("+", "32"),
                        _ => (" ", "0"),
                    };
                    print!("{}", paint(format!("{prefix}{}", line.text), color));
                    if !line.text.ends_with('\n') {
                        println!("\n\\ No newline at end of file");
                    }
                }
            }
        }
        let summary = inspect::summary(step);
        println!(
            "request: {}\nresponse: {}",
            summary.request, summary.response
        );
    } else {
        if steps.is_empty() {
            println!("No steps for run {run}");
        }
        for step in steps {
            print_step(store, &step)?;
        }
    }
    Ok(())
}
