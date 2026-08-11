use std::collections::VecDeque;
use std::fs;
use std::path::Path;

use anyhow::{Context, Result, bail};

use crate::protocol::{decode_request, decode_wire_message};

use super::{RuntimeClient, RuntimeDescriptor};

pub struct ReplayRuntimeClient {
    descriptor: RuntimeDescriptor,
    lines: VecDeque<String>,
}

impl ReplayRuntimeClient {
    /// Loads and validates a read-only runtime event replay.
    ///
    /// # Errors
    ///
    /// Returns an error when the file cannot be read or contains invalid JSONL.
    pub fn from_path(path: &Path) -> Result<Self> {
        let content = fs::read_to_string(path)
            .with_context(|| format!("read replay file {}", path.display()))?;
        let mut lines = VecDeque::new();
        for (index, line) in content.lines().enumerate() {
            if line.trim().is_empty() {
                continue;
            }
            decode_wire_message(line)
                .with_context(|| format!("invalid replay record on line {}", index + 1))?;
            lines.push_back(line.to_owned());
        }
        Ok(Self {
            descriptor: RuntimeDescriptor::replay(path.display().to_string()),
            lines,
        })
    }
}

impl RuntimeClient for ReplayRuntimeClient {
    fn descriptor(&self) -> RuntimeDescriptor {
        self.descriptor.clone()
    }

    fn send_line(&mut self, line: &str) -> Result<()> {
        decode_request(line)?;
        bail!("replay runtime is read-only and is not connected to an agent")
    }

    fn poll_lines(&mut self) -> Result<Vec<String>> {
        Ok(self.lines.pop_front().into_iter().collect())
    }
}

#[cfg(test)]
mod tests {
    use std::time::{SystemTime, UNIX_EPOCH};

    use serde_json::json;

    use super::*;
    use crate::protocol::{RuntimeRequest, RuntimeWireMessage, encode_jsonl};

    #[test]
    fn replay_validates_input_and_refuses_outgoing_agent_requests() {
        let nonce = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("rux-tui-replay-{nonce}.jsonl"));
        let event = RuntimeWireMessage::event("run.completed", std::collections::BTreeMap::new());
        fs::write(&path, format!("{}\n", encode_jsonl(&event).unwrap())).unwrap();

        let mut replay = ReplayRuntimeClient::from_path(&path).unwrap();
        assert!(!replay.descriptor().connected_to_real_runtime);
        assert_eq!(replay.poll_lines().unwrap().len(), 1);
        assert!(replay.poll_lines().unwrap().is_empty());

        let request = RuntimeRequest::new("request-1", "run.start", json!({}));
        let error = replay
            .send_line(&encode_jsonl(&request).unwrap())
            .unwrap_err();
        assert!(error.to_string().contains("read-only"));
        fs::remove_file(path).unwrap();
    }
}
