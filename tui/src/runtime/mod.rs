mod demo;
mod process;
mod replay;

use anyhow::Result;

pub use demo::DemoRuntimeClient;
pub use process::ProcessRuntimeClient;
pub use replay::ReplayRuntimeClient;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RuntimeDescriptor {
    pub name: String,
    pub mode: String,
    pub connected_to_real_runtime: bool,
    pub detail: String,
}

impl RuntimeDescriptor {
    #[must_use]
    pub fn demo() -> Self {
        Self {
            name: "Rux demo runtime".into(),
            mode: "DEMO JSONL".into(),
            connected_to_real_runtime: false,
            detail: "Local deterministic events; no agent or workspace mutation".into(),
        }
    }

    #[must_use]
    pub fn replay(source: impl Into<String>) -> Self {
        Self {
            name: "Rux replay runtime".into(),
            mode: "REPLAY JSONL".into(),
            connected_to_real_runtime: false,
            detail: format!("Read-only event replay from {}", source.into()),
        }
    }

    #[must_use]
    pub fn process(host: impl Into<String>) -> Self {
        let host = host.into();
        Self {
            name: "Rux shared runtime".into(),
            mode: "LIVE JSONL".into(),
            connected_to_real_runtime: true,
            detail: format!("Rux through {host}"),
        }
    }
}

/// Language-neutral runtime seam. Both directions are exactly one JSON object
/// per line; no Rust type crosses this trait boundary.
pub trait RuntimeClient {
    fn descriptor(&self) -> RuntimeDescriptor;

    /// Sends exactly one JSON request line.
    ///
    /// # Errors
    ///
    /// Returns an error when the line is invalid or the transport cannot send it.
    fn send_line(&mut self, line: &str) -> Result<()>;

    /// Polls zero or more complete JSON response/event lines.
    ///
    /// # Errors
    ///
    /// Returns an error when the transport fails or receives an invalid record.
    fn poll_lines(&mut self) -> Result<Vec<String>>;
}
