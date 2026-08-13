use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{self, Receiver, TryRecvError};
use std::thread;

use anyhow::{Context, Result, bail};

use crate::protocol::{decode_request, decode_wire_message};

use super::{RuntimeClient, RuntimeDescriptor};

enum HostOutput {
    Line(String),
    ReadError(String),
    Closed,
}

pub struct ProcessRuntimeClient {
    descriptor: RuntimeDescriptor,
    child: Child,
    stdin: ChildStdin,
    stdout: Receiver<HostOutput>,
    stderr: Receiver<String>,
    stderr_tail: Vec<String>,
    exit_reported: bool,
}

impl ProcessRuntimeClient {
    /// Starts the shared TypeScript Runtime as a JSONL child process.
    ///
    /// # Errors
    ///
    /// Returns an error when the paths are invalid or the process cannot start.
    pub fn spawn(
        node: &Path,
        host: &Path,
        workspace_root: &Path,
        state_root: &Path,
    ) -> Result<Self> {
        let host = host
            .canonicalize()
            .with_context(|| format!("resolve Runtime host {}", host.display()))?;
        if !host.is_file() {
            bail!("Runtime host is not a file: {}", host.display());
        }
        let workspace_root = workspace_root
            .canonicalize()
            .with_context(|| format!("resolve workspace {}", workspace_root.display()))?;
        if !workspace_root.is_dir() {
            bail!("Workspace is not a directory: {}", workspace_root.display());
        }
        std::fs::create_dir_all(state_root)
            .with_context(|| format!("create Runtime state directory {}", state_root.display()))?;
        let state_root = state_root
            .canonicalize()
            .with_context(|| format!("resolve Runtime state directory {}", state_root.display()))?;

        let mut child = Command::new(node)
            .arg(&host)
            .current_dir(&workspace_root)
            .env("RUX_WORKSPACE_ROOT", &workspace_root)
            .env("RUX_STATE_ROOT", &state_root)
            .env("ELECTRON_RUN_AS_NODE", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .with_context(|| {
                format!(
                    "start shared Runtime with {} {}",
                    node.display(),
                    host.display()
                )
            })?;
        let stdin = child
            .stdin
            .take()
            .context("shared Runtime stdin is unavailable")?;
        let stdout = child
            .stdout
            .take()
            .context("shared Runtime stdout is unavailable")?;
        let stderr = child
            .stderr
            .take()
            .context("shared Runtime stderr is unavailable")?;

        let (stdout_sender, stdout_receiver) = mpsc::channel();
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                match line {
                    Ok(line) => {
                        if stdout_sender.send(HostOutput::Line(line)).is_err() {
                            return;
                        }
                    }
                    Err(error) => {
                        let _ = stdout_sender.send(HostOutput::ReadError(error.to_string()));
                        return;
                    }
                }
            }
            let _ = stdout_sender.send(HostOutput::Closed);
        });

        let (stderr_sender, stderr_receiver) = mpsc::channel();
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().map_while(Result::ok) {
                if stderr_sender.send(line).is_err() {
                    return;
                }
            }
        });

        Ok(Self {
            descriptor: RuntimeDescriptor::process(host.display().to_string()),
            child,
            stdin,
            stdout: stdout_receiver,
            stderr: stderr_receiver,
            stderr_tail: Vec::new(),
            exit_reported: false,
        })
    }

    fn collect_stderr(&mut self) {
        while let Ok(line) = self.stderr.try_recv() {
            self.stderr_tail.push(line);
            if self.stderr_tail.len() > 12 {
                self.stderr_tail.remove(0);
            }
        }
    }
}

impl RuntimeClient for ProcessRuntimeClient {
    fn descriptor(&self) -> RuntimeDescriptor {
        self.descriptor.clone()
    }

    fn send_line(&mut self, line: &str) -> Result<()> {
        decode_request(line).context("validate outgoing Runtime request")?;
        self.stdin
            .write_all(line.as_bytes())
            .context("write Runtime request")?;
        self.stdin
            .write_all(b"\n")
            .context("write JSONL boundary")?;
        self.stdin.flush().context("flush Runtime request")
    }

    fn poll_lines(&mut self) -> Result<Vec<String>> {
        self.collect_stderr();
        let mut lines = Vec::new();
        loop {
            match self.stdout.try_recv() {
                Ok(HostOutput::Line(line)) => {
                    decode_wire_message(&line).context("validate Runtime host output")?;
                    lines.push(line);
                }
                Ok(HostOutput::ReadError(error)) => {
                    bail!("Runtime stdout failed: {error}");
                }
                Ok(HostOutput::Closed) | Err(TryRecvError::Disconnected | TryRecvError::Empty) => {
                    break;
                }
            }
        }

        if let Some(status) = self.child.try_wait().context("poll Runtime host")?
            && !self.exit_reported
        {
            self.exit_reported = true;
            self.collect_stderr();
            let detail = if self.stderr_tail.is_empty() {
                String::new()
            } else {
                format!(": {}", self.stderr_tail.join(" | "))
            };
            bail!("Shared Runtime exited with {status}{detail}");
        }
        Ok(lines)
    }
}

impl Drop for ProcessRuntimeClient {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod tests {
    use std::fs;
    use std::path::PathBuf;
    use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

    use serde_json::json;

    use super::*;
    use crate::protocol::{RuntimeRequest, RuntimeWireMessage, encode_jsonl};

    fn poll_until(
        runtime: &mut ProcessRuntimeClient,
        predicate: impl Fn(&RuntimeWireMessage) -> bool,
    ) -> RuntimeWireMessage {
        let deadline = Instant::now() + Duration::from_secs(5);
        loop {
            for line in runtime.poll_lines().unwrap() {
                let message = decode_wire_message(&line).unwrap();
                if predicate(&message) {
                    return message;
                }
            }
            assert!(
                Instant::now() < deadline,
                "timed out polling process Runtime"
            );
            std::thread::sleep(Duration::from_millis(10));
        }
    }

    #[test]
    fn process_transport_exchanges_strict_jsonl_with_a_real_child() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("rux-process-runtime-{nonce}"));
        let workspace = root.join("workspace");
        let state = root.join("state");
        fs::create_dir_all(&workspace).unwrap();
        let host = root.join("host.mjs");
        fs::write(
            &host,
            r"import readline from 'node:readline';
console.log(JSON.stringify({kind:'event',event:{type:'runtime.ready',status:{protocolVersion:5,pid:process.pid,platform:process.platform,workspaceRoot:process.env.RUX_WORKSPACE_ROOT,startedAt:'test'}}}));
readline.createInterface({input:process.stdin}).on('line', line => {
  const request = JSON.parse(line);
  console.log(JSON.stringify({kind:'response',id:request.id,ok:true,result:{runId:request.params.runId,adapter:'codex'}}));
  console.log(JSON.stringify({kind:'event',event:{type:'assistant.message',runId:request.params.runId,text:request.params.prompt}}));
  console.log(JSON.stringify({kind:'event',event:{type:'run.completed',runId:request.params.runId}}));
});
",
        )
        .unwrap();
        let node =
            std::env::var_os("RUX_NODE").map_or_else(|| PathBuf::from("node"), PathBuf::from);
        let mut runtime = ProcessRuntimeClient::spawn(&node, &host, &workspace, &state).unwrap();
        assert!(runtime.descriptor().connected_to_real_runtime);
        poll_until(
            &mut runtime,
            |message| matches!(message, RuntimeWireMessage::Event { event } if event.event_type == "runtime.ready"),
        );

        let request = RuntimeRequest::new(
            "request-live",
            "run.start",
            json!({
                "runId": "run-live",
                "adapter": "codex",
                "prompt": "hello live Runtime",
                "permissionMode": "plan"
            }),
        );
        runtime.send_line(&encode_jsonl(&request).unwrap()).unwrap();
        let completed = poll_until(&mut runtime, |message| {
            matches!(message, RuntimeWireMessage::Event { event }
                if event.event_type == "run.completed" && event.string("runId") == Some("run-live"))
        });
        assert!(matches!(completed, RuntimeWireMessage::Event { .. }));
        drop(runtime);
        fs::remove_dir_all(root).unwrap();
    }
}
