#![cfg(target_os = "macos")]

use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use rux_tui::protocol::PROTOCOL_VERSION;

const STEP_TIMEOUT: Duration = Duration::from_secs(8);

struct PtyHarness {
    child: Child,
    stdin: Option<ChildStdin>,
    output: Arc<Mutex<Vec<u8>>>,
    reader: Option<JoinHandle<()>>,
}

impl PtyHarness {
    fn spawn(binary: &PathBuf, host: &PathBuf, workspace: &PathBuf, state_root: &PathBuf) -> Self {
        let mut child = Command::new("/usr/bin/script")
            .arg("-q")
            .arg("/dev/null")
            .arg("/bin/sh")
            .arg("-c")
            .arg("stty cols 80 rows 24; exec \"$@\"")
            .arg("rux-tui")
            .arg(binary)
            .arg("--runtime-host")
            .arg(host)
            .arg("--node")
            .arg("node")
            .arg("--workspace")
            .arg(workspace)
            .arg("--state-root")
            .arg(state_root)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
        let mut stdout = child.stdout.take().unwrap();
        let output = Arc::new(Mutex::new(Vec::new()));
        let reader_output = Arc::clone(&output);
        let reader = thread::spawn(move || {
            let mut chunk = [0_u8; 4_096];
            loop {
                let read = stdout.read(&mut chunk).unwrap();
                if read == 0 {
                    break;
                }
                reader_output
                    .lock()
                    .unwrap()
                    .extend_from_slice(&chunk[..read]);
            }
        });
        let stdin = child.stdin.take();
        Self {
            child,
            stdin,
            output,
            reader: Some(reader),
        }
    }

    fn mark(&self) -> usize {
        self.output.lock().unwrap().len()
    }

    fn wait_for(&mut self, needle: &str) {
        self.wait_for_after(needle, 0);
    }

    fn wait_for_after(&mut self, needle: &str, offset: usize) {
        let deadline = Instant::now() + STEP_TIMEOUT;
        loop {
            let found = {
                let output = self.output.lock().unwrap();
                let offset = offset.min(output.len());
                String::from_utf8_lossy(&output[offset..]).contains(needle)
            };
            if found {
                return;
            }
            if let Some(status) = self.child.try_wait().unwrap() {
                panic!(
                    "RUX TUI exited with {status} before rendering {needle:?}\n{}",
                    self.output_text()
                );
            }
            assert!(
                Instant::now() < deadline,
                "timed out waiting for PTY output {needle:?}\n{}",
                self.output_text()
            );
            thread::sleep(Duration::from_millis(10));
        }
    }

    fn send(&mut self, bytes: &[u8]) {
        let stdin = self.stdin.as_mut().expect("PTY stdin is open");
        stdin.write_all(bytes).unwrap();
        stdin.flush().unwrap();
    }

    fn finish(mut self) -> (ExitStatus, String) {
        self.stdin.take();
        let deadline = Instant::now() + STEP_TIMEOUT;
        let status = loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                break status;
            }
            assert!(
                Instant::now() < deadline,
                "RUX TUI did not leave its PTY\n{}",
                self.output_text()
            );
            thread::sleep(Duration::from_millis(10));
        };
        if let Some(reader) = self.reader.take() {
            reader.join().unwrap();
        }
        (status, self.output_text())
    }

    fn output_text(&self) -> String {
        String::from_utf8_lossy(&self.output.lock().unwrap()).into_owned()
    }
}

impl Drop for PtyHarness {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

#[test]
fn real_pty_browses_task_history_and_expands_unknown_evidence() {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let root = std::env::temp_dir().join(format!("rux-tui-pty-{nonce}"));
    let workspace = root.join("workspace");
    let state_root = root.join("state");
    fs::create_dir_all(&workspace).unwrap();
    fs::create_dir_all(&state_root).unwrap();
    let host = root.join("host.mjs");
    let host_source = include_str!("fixtures/task-history-host.mjs")
        .replace("__PROTOCOL_VERSION__", &PROTOCOL_VERSION.to_string());
    fs::write(&host, host_source).unwrap();

    let binary = PathBuf::from(env!("CARGO_BIN_EXE_rux-tui"));
    let mut session = PtyHarness::spawn(&binary, &host, &workspace, &state_root);
    session.wait_for(&format!("LIVE JSONL · CONNECTED · v{PROTOCOL_VERSION}"));
    session.wait_for("TASK HISTORY · 2 PERSISTED");
    session.wait_for("Ctrl+T/Esc close");

    let selection_mark = session.mark();
    session.send(b"\x1b[B");
    session.wait_for_after("Older evidence task", selection_mark);
    session.send(b"\r");
    session.wait_for("Review the recorded test evidence");

    session.send(b"\x05");
    session.wait_for("EVIDENCE INSPECTOR · 1 RECORD(S)");
    session.wait_for("[UNKNOWN]");
    session.send(b"\r");
    session.wait_for("DETAILS · RECORDED FACTS");
    session.wait_for("COMMAND");

    session.send(b"\x11");
    let (status, output) = session.finish();
    assert!(status.success(), "PTY wrapper failed: {status}\n{output}");
    assert!(output.contains("TASK HISTORY · 2 PERSISTED"), "{output}");
    assert!(output.contains("Older evidence task"), "{output}");
    assert!(
        output.contains("EVIDENCE INSPECTOR · 1 RECORD(S)"),
        "{output}"
    );
    assert!(output.contains("[UNKNOWN]"), "{output}");
    assert!(output.contains("DETAILS · RECORDED FACTS"), "{output}");
    assert!(output.contains("COMMAND"), "{output}");
    assert!(output.contains("npm test"), "{output}");

    fs::remove_dir_all(root).unwrap();
}
