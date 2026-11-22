use crate::{Result, proxy::Step, store::Store};
use std::{collections::BTreeSet, io::IsTerminal};

pub fn paint(text: impl std::fmt::Display, code: &str) -> String {
    if std::io::stdout().is_terminal() && std::env::var_os("NO_COLOR").is_none() {
        format!("\x1b[{code}m{text}\x1b[0m")
    } else {
        text.to_string()
    }
}
pub fn print_step(store: &Store, step: &Step) -> Result<()> {
    let before = store.manifest(&step.pre_snapshot_id)?;
    let after = store.manifest(&step.post_snapshot_id)?;
    let added = after.keys().filter(|p| !before.contains_key(*p)).count();
    let deleted = before.keys().filter(|p| !after.contains_key(*p)).count();
    let modified = after
        .iter()
        .filter(|(p, s)| before.get(*p).is_some_and(|old| old != *s))
        .count();
    println!(
        "{}  step {:>3}  {:<32}  {}  {:>6} ms  {}  +{} ~{} -{}",
        paint(chrono::Local::now().format("%H:%M:%S"), "90"),
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
        added,
        modified,
        deleted
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
        let before = store.manifest(&step.pre_snapshot_id)?;
        let after = store.manifest(&step.post_snapshot_id)?;
        let paths: BTreeSet<_> = before.keys().chain(after.keys()).collect();
        for path in paths {
            if before.get(path) == after.get(path) {
                continue;
            }
            let old = before
                .get(path)
                .map(|s| store.blob(s))
                .transpose()?
                .unwrap_or_default();
            let new = after
                .get(path)
                .map(|s| store.blob(s))
                .transpose()?
                .unwrap_or_default();
            if old.contains(&0) || new.contains(&0) {
                println!("{path}: binary file, diff skipped");
                continue;
            }
            match (std::str::from_utf8(&old), std::str::from_utf8(&new)) {
                (Ok(old), Ok(new)) => {
                    let diff = similar::TextDiff::from_lines(old, new)
                        .unified_diff()
                        .header(&format!("a/{path}"), &format!("b/{path}"))
                        .to_string();
                    for line in diff.lines() {
                        println!(
                            "{}",
                            paint(
                                line,
                                if line.starts_with('-') {
                                    "31"
                                } else if line.starts_with('+') {
                                    "32"
                                } else if line.starts_with("@@") {
                                    "2;36"
                                } else {
                                    "0"
                                }
                            )
                        );
                    }
                }
                _ => println!("{path}: non-UTF8 file, diff skipped"),
            }
        }
        for (label, value) in [("request", &step.request), ("response", &step.response)] {
            let summary = if label == "request" {
                format!(
                    "model={} user={}",
                    value.get("model").unwrap_or(&serde_json::Value::Null),
                    value
                        .get("messages")
                        .and_then(|v| v.as_array())
                        .and_then(|a| a.iter().rev().find(|v| v["role"] == "user"))
                        .map(|v| &v["content"])
                        .unwrap_or(value)
                )
            } else {
                value
                    .pointer("/choices/0/message/content")
                    .or_else(|| value.pointer("/content/0/text"))
                    .unwrap_or(value)
                    .to_string()
            };
            println!("{label}: {}", summary.chars().take(400).collect::<String>());
        }
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
