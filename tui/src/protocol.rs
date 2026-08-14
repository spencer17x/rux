use std::collections::BTreeMap;

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const PROTOCOL_VERSION: u8 = 6;

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RequestKind {
    Request,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RuntimeRequest {
    pub kind: RequestKind,
    pub id: String,
    pub method: String,
    pub params: Value,
}

impl RuntimeRequest {
    #[must_use]
    pub fn new(id: impl Into<String>, method: impl Into<String>, params: Value) -> Self {
        Self {
            kind: RequestKind::Request,
            id: id.into(),
            method: method.into(),
            params,
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RuntimeEvent {
    #[serde(rename = "type")]
    pub event_type: String,
    #[serde(flatten)]
    pub fields: BTreeMap<String, Value>,
}

impl RuntimeEvent {
    #[must_use]
    pub fn new(event_type: impl Into<String>, fields: BTreeMap<String, Value>) -> Self {
        Self {
            event_type: event_type.into(),
            fields,
        }
    }

    #[must_use]
    pub fn string(&self, key: &str) -> Option<&str> {
        self.fields.get(key).and_then(Value::as_str)
    }

    #[must_use]
    pub fn number(&self, key: &str) -> Option<u64> {
        self.fields.get(key).and_then(Value::as_u64)
    }

    #[must_use]
    pub fn object(&self, key: &str) -> Option<&serde_json::Map<String, Value>> {
        self.fields.get(key).and_then(Value::as_object)
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum RuntimeWireMessage {
    Response {
        id: String,
        ok: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        result: Option<Value>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        error: Option<RuntimeError>,
    },
    Event {
        event: RuntimeEvent,
    },
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct RuntimeError {
    pub code: String,
    pub message: String,
}

impl RuntimeWireMessage {
    #[must_use]
    pub fn event(event_type: impl Into<String>, fields: BTreeMap<String, Value>) -> Self {
        Self::Event {
            event: RuntimeEvent::new(event_type, fields),
        }
    }

    #[must_use]
    pub fn ok(id: impl Into<String>, result: Value) -> Self {
        Self::Response {
            id: id.into(),
            ok: true,
            result: Some(result),
            error: None,
        }
    }
}

/// Encodes one message without a trailing newline.
///
/// # Errors
///
/// Returns an error when the value cannot be serialized as JSON.
pub fn encode_jsonl<T: Serialize>(value: &T) -> Result<String> {
    let line = serde_json::to_string(value).context("serialize Rux JSONL message")?;
    debug_assert!(!line.contains('\n'));
    Ok(line)
}

/// Decodes exactly one JSONL request record.
///
/// # Errors
///
/// Returns an error for empty, multi-line, or schema-invalid input.
pub fn decode_request(line: &str) -> Result<RuntimeRequest> {
    validate_single_line(line)?;
    serde_json::from_str(line).context("decode Rux JSONL request")
}

/// Decodes exactly one JSONL response or event record.
///
/// # Errors
///
/// Returns an error for empty, multi-line, or schema-invalid input.
pub fn decode_wire_message(line: &str) -> Result<RuntimeWireMessage> {
    validate_single_line(line)?;
    serde_json::from_str(line).context("decode Rux JSONL runtime message")
}

fn validate_single_line(line: &str) -> Result<()> {
    if line.is_empty() {
        bail!("JSONL message must not be empty");
    }
    if line.contains(['\n', '\r']) {
        bail!("JSONL boundary accepts exactly one JSON object per line");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn request_round_trips_as_one_language_neutral_json_line() {
        let request = RuntimeRequest::new(
            "request-1",
            "run.start",
            json!({ "runId": "run-1", "prompt": "hello" }),
        );
        let line = encode_jsonl(&request).unwrap();
        assert!(!line.contains('\n'));
        assert_eq!(decode_request(&line).unwrap(), request);
        assert_eq!(
            serde_json::from_str::<Value>(&line).unwrap()["kind"],
            "request"
        );
    }

    #[test]
    fn rejects_multiple_jsonl_records_at_the_boundary() {
        let error = decode_wire_message("{}\n{}").unwrap_err();
        assert!(error.to_string().contains("exactly one"));
    }
}
