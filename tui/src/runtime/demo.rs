use std::collections::{BTreeMap, VecDeque};

use anyhow::{Result, bail};
use serde_json::{Value, json};

use crate::protocol::{RuntimeWireMessage, decode_request, encode_jsonl};

use super::{RuntimeClient, RuntimeDescriptor};

pub struct DemoRuntimeClient {
    descriptor: RuntimeDescriptor,
    outbound: VecDeque<String>,
    active_run_id: Option<String>,
}

impl DemoRuntimeClient {
    /// Creates a deterministic, non-mutating demo transport.
    ///
    /// # Errors
    ///
    /// Returns an error only if the initial ready event cannot be serialized.
    pub fn new(workspace_root: impl Into<String>) -> Result<Self> {
        let workspace_root = workspace_root.into();
        let mut client = Self {
            descriptor: RuntimeDescriptor::demo(),
            outbound: VecDeque::new(),
            active_run_id: None,
        };
        client.push_event(
            "runtime.ready",
            json!({
                "status": {
                    "pid": std::process::id(),
                    "protocolVersion": crate::protocol::PROTOCOL_VERSION,
                    "platform": std::env::consts::OS,
                    "workspaceRoot": workspace_root,
                    "startedAt": "demo"
                }
            }),
        )?;
        Ok(client)
    }

    fn push(&mut self, message: &RuntimeWireMessage) -> Result<()> {
        self.outbound.push_back(encode_jsonl(message)?);
        Ok(())
    }

    fn push_event(&mut self, event_type: &str, fields: Value) -> Result<()> {
        let Value::Object(fields) = fields else {
            bail!("demo event fields must be an object");
        };
        self.push(&RuntimeWireMessage::event(
            event_type,
            fields.into_iter().collect::<BTreeMap<_, _>>(),
        ))
    }

    fn start_run(&mut self, request_id: &str, params: &Value) -> Result<()> {
        let run_id = params
            .get("runId")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("run.start requires params.runId"))?;
        let prompt = params
            .get("prompt")
            .and_then(Value::as_str)
            .ok_or_else(|| anyhow::anyhow!("run.start requires params.prompt"))?;
        self.active_run_id = Some(run_id.to_owned());
        self.outbound.clear();
        self.push(&RuntimeWireMessage::ok(
            request_id,
            json!({ "runId": run_id, "adapter": "mock" }),
        ))?;
        self.push_event(
            "run.started",
            json!({
                "runId": run_id,
                "adapter": "mock",
                "prompt": prompt
            }),
        )?;
        self.push_event(
            "activity.started",
            json!({
                "runId": run_id,
                "activity": {
                    "id": "demo-read",
                    "kind": "read",
                    "title": "Inspect JSONL boundary",
                    "detail": "Deterministic demo only — no filesystem read occurred",
                    "state": "active"
                }
            }),
        )?;
        self.push_event(
            "activity.completed",
            json!({
                "runId": run_id,
                "activity": {
                    "id": "demo-read",
                    "kind": "read",
                    "title": "Inspect JSONL boundary",
                    "detail": "Demo event protocol rendered successfully",
                    "state": "done"
                }
            }),
        )?;
        self.push_event(
            "assistant.message",
            json!({
                "runId": run_id,
                "text": "Demo replay received your prompt. "
            }),
        )?;
        self.push_event(
            "assistant.message",
            json!({
                "runId": run_id,
                "text": "No real coding agent ran and no workspace files changed."
            }),
        )?;
        self.push_event(
            "run.completed",
            json!({
                "runId": run_id,
                "durationMs": 250,
                "turns": 1
            }),
        )?;
        Ok(())
    }

    fn cancel_run(&mut self, request_id: &str, params: &Value) -> Result<()> {
        let run_id = params
            .get("runId")
            .and_then(Value::as_str)
            .or(self.active_run_id.as_deref())
            .ok_or_else(|| anyhow::anyhow!("run.cancel requires params.runId"))?
            .to_owned();
        self.outbound.clear();
        self.push(&RuntimeWireMessage::ok(request_id, json!({ "ok": true })))?;
        self.push_event("run.cancelled", json!({ "runId": run_id }))?;
        self.active_run_id = None;
        Ok(())
    }
}

impl RuntimeClient for DemoRuntimeClient {
    fn descriptor(&self) -> RuntimeDescriptor {
        self.descriptor.clone()
    }

    fn send_line(&mut self, line: &str) -> Result<()> {
        let request = decode_request(line)?;
        match request.method.as_str() {
            "run.start" => self.start_run(&request.id, &request.params),
            "run.cancel" => self.cancel_run(&request.id, &request.params),
            method => bail!("demo runtime does not implement {method}"),
        }
    }

    fn poll_lines(&mut self) -> Result<Vec<String>> {
        Ok(self.outbound.pop_front().into_iter().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::{RuntimeRequest, decode_wire_message, encode_jsonl};

    #[test]
    fn demo_uses_the_same_jsonl_boundary_as_a_future_external_runtime() {
        let mut runtime = DemoRuntimeClient::new("/tmp/project").unwrap();
        let ready = runtime.poll_lines().unwrap();
        assert_eq!(ready.len(), 1);
        assert!(matches!(
            decode_wire_message(&ready[0]).unwrap(),
            RuntimeWireMessage::Event { .. }
        ));

        let request = RuntimeRequest::new(
            "request-1",
            "run.start",
            json!({ "runId": "run-1", "prompt": "hello" }),
        );
        runtime.send_line(&encode_jsonl(&request).unwrap()).unwrap();
        let first = runtime.poll_lines().unwrap();
        assert!(matches!(
            decode_wire_message(&first[0]).unwrap(),
            RuntimeWireMessage::Response { ok: true, .. }
        ));
    }
}
