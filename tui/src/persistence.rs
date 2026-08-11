use std::time::{SystemTime, UNIX_EPOCH};

use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::protocol::RuntimeEvent;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskSummary {
    pub id: String,
    pub title: String,
    pub status: String,
    pub updated_at: String,
    pub adapter: String,
    pub run_count: usize,
    pub pinned: bool,
    pub archived: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingPermission {
    pub id: String,
    pub run_id: String,
    pub action: String,
    pub scope_path: String,
    pub applies_to: String,
    pub impact: String,
    pub requested_at: String,
}

impl PendingPermission {
    #[must_use]
    pub fn from_value(value: &Map<String, Value>) -> Option<Self> {
        let scope = value.get("scope").and_then(Value::as_object)?;
        if string(value, "status") != Some("pending") {
            return None;
        }
        Some(Self {
            id: string(value, "id")?.to_owned(),
            run_id: string(value, "runId")?.to_owned(),
            action: string(value, "action")?.to_owned(),
            scope_path: string(scope, "path")?.to_owned(),
            applies_to: string(scope, "appliesTo")?.to_owned(),
            impact: string(value, "impact")?.to_owned(),
            requested_at: string(value, "requestedAt")?.to_owned(),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunOwnedFile {
    pub path: String,
    pub kind: String,
    pub additions: u64,
    pub deletions: u64,
    pub binary: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum EvidenceItem {
    Verification {
        id: String,
        run_id: String,
        kind: String,
        status: String,
        command: String,
        cwd: String,
        exit_code: Option<i64>,
        finished_at: String,
        log: String,
        redacted: bool,
        truncated: bool,
    },
    RunOwnedPatch {
        id: String,
        run_id: String,
        baseline_id: String,
        generated_at: String,
        before_tree_id: String,
        after_tree_id: String,
        snapshot_id: String,
        files: Vec<RunOwnedFile>,
        additions: u64,
        deletions: u64,
        binary_files: u64,
    },
}

impl EvidenceItem {
    #[must_use]
    pub fn id(&self) -> &str {
        match self {
            Self::Verification { id, .. } | Self::RunOwnedPatch { id, .. } => id,
        }
    }

    #[must_use]
    pub fn run_id(&self) -> &str {
        match self {
            Self::Verification { run_id, .. } | Self::RunOwnedPatch { run_id, .. } => run_id,
        }
    }

    #[must_use]
    pub fn from_verification(run_id: &str, value: &Map<String, Value>) -> Option<Self> {
        let id = string(value, "id")?.to_owned();
        let status = match string(value, "status") {
            Some("passed") => "passed",
            Some("failed") => "failed",
            _ => "unknown",
        };
        Some(Self::Verification {
            id,
            run_id: run_id.to_owned(),
            kind: string(value, "kind").unwrap_or("command").to_owned(),
            status: status.to_owned(),
            command: string(value, "command")
                .unwrap_or("unknown command")
                .to_owned(),
            cwd: string(value, "cwd").unwrap_or("unknown cwd").to_owned(),
            exit_code: value.get("exitCode").and_then(Value::as_i64),
            finished_at: string(value, "finishedAt")
                .unwrap_or("unknown time")
                .to_owned(),
            log: string(value, "log").unwrap_or("No captured log").to_owned(),
            redacted: value
                .get("redacted")
                .and_then(Value::as_bool)
                .unwrap_or(false),
            truncated: value
                .get("truncated")
                .and_then(Value::as_bool)
                .unwrap_or(false),
        })
    }

    #[must_use]
    pub fn from_git_patch(run_id: &str, value: &Map<String, Value>) -> Option<Self> {
        let id = string(value, "id")?.to_owned();
        let files = value
            .get("files")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|file| {
                let file = file.as_object()?;
                Some(RunOwnedFile {
                    path: string(file, "path")?.to_owned(),
                    kind: string(file, "kind").unwrap_or("modified").to_owned(),
                    additions: file
                        .get("additions")
                        .and_then(Value::as_u64)
                        .unwrap_or_default(),
                    deletions: file
                        .get("deletions")
                        .and_then(Value::as_u64)
                        .unwrap_or_default(),
                    binary: file
                        .get("isBinary")
                        .and_then(Value::as_bool)
                        .unwrap_or(false),
                })
            })
            .collect();
        let totals = value.get("totals").and_then(Value::as_object);
        Some(Self::RunOwnedPatch {
            id,
            run_id: run_id.to_owned(),
            baseline_id: string(value, "baselineId").unwrap_or("unknown").to_owned(),
            generated_at: string(value, "generatedAt")
                .unwrap_or("unknown time")
                .to_owned(),
            before_tree_id: string(value, "beforeTreeId")
                .unwrap_or("unknown")
                .to_owned(),
            after_tree_id: string(value, "afterTreeId").unwrap_or("unknown").to_owned(),
            snapshot_id: string(value, "snapshotId").unwrap_or("unknown").to_owned(),
            files,
            additions: object_u64(totals, "additions"),
            deletions: object_u64(totals, "deletions"),
            binary_files: object_u64(totals, "binaryFiles"),
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TaskRunSettings {
    pub adapter: String,
    pub model: Option<String>,
    pub permission_mode: String,
    pub profile_id: Option<String>,
    pub session_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HydratedTask {
    pub id: String,
    pub title: String,
    pub status: String,
    pub updated_at: String,
    pub messages: Vec<(String, String)>,
    pub adapter: String,
    pub model: Option<String>,
    pub permission_mode: String,
    pub profile_id: Option<String>,
    pub session_id: Option<String>,
    pub run_count: usize,
    pub evidence: Vec<EvidenceItem>,
    pub pending_permission: Option<PendingPermission>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct WorkspaceTaskState {
    version: u8,
    workspace_id: String,
    tasks: Vec<Value>,
    updated_at: String,
}

pub struct TaskPersistence {
    enabled: bool,
    state: Option<WorkspaceTaskState>,
    active_task: Option<Map<String, Value>>,
}

impl TaskPersistence {
    #[must_use]
    pub fn awaiting() -> Self {
        Self {
            enabled: true,
            state: None,
            active_task: None,
        }
    }

    #[must_use]
    pub fn disabled() -> Self {
        Self {
            enabled: false,
            state: Some(WorkspaceTaskState {
                version: 1,
                workspace_id: "demo".into(),
                tasks: Vec::new(),
                updated_at: now_iso(),
            }),
            active_task: None,
        }
    }

    #[must_use]
    pub fn is_loaded(&self) -> bool {
        self.state.is_some()
    }

    /// Loads the shared Desktop snapshot and selects its most recently updated
    /// non-archived task, falling back to archived history only when necessary.
    ///
    /// # Errors
    ///
    /// Returns an error when the Runtime returned a malformed task snapshot.
    pub fn load(&mut self, value: &Value) -> Result<Option<HydratedTask>> {
        let state: WorkspaceTaskState =
            serde_json::from_value(value.clone()).context("decode shared task state")?;
        if state.version != 1 || state.workspace_id.is_empty() {
            bail!("unsupported shared task state");
        }
        let selected = state
            .tasks
            .iter()
            .filter_map(Value::as_object)
            .filter(|task| {
                !task
                    .get("archived")
                    .and_then(Value::as_bool)
                    .unwrap_or(false)
            })
            .max_by_key(|task| {
                task.get("updatedAtIso")
                    .and_then(Value::as_str)
                    .or_else(|| task.get("createdAt").and_then(Value::as_str))
                    .unwrap_or_default()
                    .to_owned()
            })
            .or_else(|| {
                state
                    .tasks
                    .iter()
                    .filter_map(Value::as_object)
                    .max_by_key(|task| {
                        task.get("updatedAtIso")
                            .and_then(Value::as_str)
                            .or_else(|| task.get("createdAt").and_then(Value::as_str))
                            .unwrap_or_default()
                            .to_owned()
                    })
            })
            .cloned();
        self.state = Some(state);
        self.active_task = selected;
        self.hydrated_task()
    }

    #[must_use]
    pub fn active_task_id(&self) -> Option<&str> {
        self.active_task
            .as_ref()
            .and_then(|task| string(task, "id"))
    }

    #[must_use]
    pub fn task_summaries(&self) -> Vec<TaskSummary> {
        let Some(state) = &self.state else {
            return Vec::new();
        };
        let active_id = self.active_task_id();
        let mut summaries: Vec<TaskSummary> = state
            .tasks
            .iter()
            .filter_map(Value::as_object)
            .map(|task| {
                if active_id.is_some_and(|id| string(task, "id") == Some(id)) {
                    self.active_task.as_ref().unwrap_or(task)
                } else {
                    task
                }
            })
            .filter_map(task_summary)
            .collect();
        if let Some(active) = self.active_task.as_ref()
            && !summaries
                .iter()
                .any(|summary| Some(summary.id.as_str()) == active_id)
            && let Some(summary) = task_summary(active)
        {
            summaries.push(summary);
        }
        summaries.sort_by(|left, right| {
            right
                .pinned
                .cmp(&left.pinned)
                .then_with(|| left.archived.cmp(&right.archived))
                .then_with(|| right.updated_at.cmp(&left.updated_at))
                .then_with(|| left.title.cmp(&right.title))
        });
        summaries
    }

    /// Selects an existing persisted task without changing its updated time.
    ///
    /// # Errors
    ///
    /// Returns an error if the requested task does not exist or is malformed.
    pub fn select_task(&mut self, task_id: &str) -> Result<HydratedTask> {
        self.sync_active_into_state();
        let selected = self
            .state
            .as_ref()
            .and_then(|state| {
                state.tasks.iter().find_map(|task| {
                    (task.get("id").and_then(Value::as_str) == Some(task_id))
                        .then(|| task.as_object().cloned())
                        .flatten()
                })
            })
            .with_context(|| format!("persisted task not found: {task_id}"))?;
        self.active_task = Some(selected);
        self.hydrated_task()?
            .context("selected persisted task is malformed")
    }

    /// Returns the full snapshot after replacing only the active task in memory.
    ///
    /// # Errors
    ///
    /// Returns an error if serialization fails.
    pub fn snapshot_value(&mut self) -> Result<Option<Value>> {
        if !self.enabled {
            return Ok(None);
        }
        if self.state.is_none() || self.active_task.is_none() {
            return Ok(None);
        }
        self.sync_active_into_state();
        let Some(state) = self.state.as_mut() else {
            return Ok(None);
        };
        state.updated_at = now_iso();
        serde_json::to_value(state)
            .map(Some)
            .context("encode shared task state")
    }

    pub fn start_new(&mut self) {
        self.sync_active_into_state();
        self.active_task = None;
    }

    pub fn record_user(&mut self, text: &str, settings: &TaskRunSettings) {
        self.ensure_active_task(text, settings);
        let now = now_iso();
        let Some(task) = self.active_task.as_mut() else {
            return;
        };
        let messages = array_mut(task, "messages");
        messages.push(json!({
            "id": new_id("tui-message"),
            "role": "user",
            "text": text,
            "time": "现在",
            "createdAt": now,
        }));
        task.insert("status".into(), Value::String("running".into()));
        touch(task);
    }

    pub fn record_event(&mut self, event: &RuntimeEvent, settings: &TaskRunSettings) {
        if self.active_task.is_none() {
            self.ensure_active_task("TUI Agent run", settings);
        }
        let now = now_iso();
        let Some(task) = self.active_task.as_mut() else {
            return;
        };
        let Some(run_id) = event.string("runId") else {
            return;
        };

        ensure_run(task, run_id, settings, &now);
        let runs = array_mut(task, "runs");
        let Some(run) = runs
            .iter_mut()
            .find(|run| run.get("id").and_then(Value::as_str) == Some(run_id))
            .and_then(Value::as_object_mut)
        else {
            return;
        };
        let events = array_mut(run, "events");
        let sequence = events.len() + 1;
        let payload =
            serde_json::to_value(event).unwrap_or_else(|_| json!({ "type": event.event_type }));
        events.push(json!({
            "id": format!("{run_id}:{sequence}"),
            "sequence": sequence,
            "type": event.event_type,
            "occurredAt": now,
            "payload": payload,
        }));
        run.insert("updatedAt".into(), Value::String(now.clone()));
        apply_run_event(run, event, &now);
        apply_task_event(task, event, settings, &now);
        touch(task);
    }

    pub fn record_review_acceptance(&mut self, acceptance: &Value) {
        let Some(task) = self.active_task.as_mut() else {
            return;
        };
        let Some(id) = acceptance.get("id").and_then(Value::as_str) else {
            return;
        };
        let acceptances = array_mut(task, "reviewAcceptances");
        if !acceptances
            .iter()
            .any(|item| item.get("id").and_then(Value::as_str) == Some(id))
        {
            acceptances.push(acceptance.clone());
            touch(task);
        }
    }

    fn sync_active_into_state(&mut self) {
        let (Some(state), Some(active)) = (&mut self.state, &self.active_task) else {
            return;
        };
        let active_id = string(active, "id").unwrap_or_default();
        if let Some(task) = state
            .tasks
            .iter_mut()
            .find(|task| task.get("id").and_then(Value::as_str) == Some(active_id))
        {
            *task = Value::Object(active.clone());
        } else {
            state.tasks.push(Value::Object(active.clone()));
        }
    }

    fn hydrated_task(&self) -> Result<Option<HydratedTask>> {
        let Some(task) = &self.active_task else {
            return Ok(None);
        };
        let id = string(task, "id")
            .context("shared task is missing id")?
            .to_owned();
        let title = string(task, "title").unwrap_or("Untitled task").to_owned();
        let status = string(task, "status").unwrap_or("waiting").to_owned();
        let updated_at = string(task, "updatedAtIso")
            .or_else(|| string(task, "createdAt"))
            .unwrap_or("unknown time")
            .to_owned();
        let messages = task
            .get("messages")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|message| {
                Some((
                    message.get("role")?.as_str()?.to_owned(),
                    message.get("text")?.as_str()?.to_owned(),
                ))
            })
            .collect();
        let runs = task
            .get("runs")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let latest_run = runs
            .iter()
            .filter_map(Value::as_object)
            .max_by_key(|run| string(run, "updatedAt").unwrap_or_default().to_owned());
        let adapter = latest_run
            .and_then(|run| string(run, "adapter"))
            .or_else(|| string(task, "adapter"))
            .unwrap_or("codex")
            .to_owned();
        let adapter = if matches!(adapter.as_str(), "codex" | "claude-code") {
            adapter
        } else {
            "codex".into()
        };
        let model = latest_run
            .and_then(|run| string(run, "model"))
            .or_else(|| string(task, "model"))
            .filter(|model| !model.to_ascii_lowercase().contains("default"))
            .map(ToOwned::to_owned);
        let permission_mode = latest_run
            .and_then(|run| string(run, "permissionMode"))
            .or_else(|| string(task, "permissionMode"))
            .unwrap_or("plan")
            .to_owned();
        let permission_mode =
            if matches!(permission_mode.as_str(), "plan" | "acceptEdits" | "dontAsk") {
                permission_mode
            } else {
                "plan".into()
            };
        let profile_id = latest_run
            .and_then(|run| string(run, "profileId"))
            .or_else(|| string(task, "agentProfileId"))
            .map(ToOwned::to_owned);
        let session_id = latest_run
            .and_then(|run| string(run, "sessionId"))
            .map(ToOwned::to_owned);
        Ok(Some(HydratedTask {
            id,
            title,
            status,
            updated_at,
            messages,
            adapter,
            model,
            permission_mode,
            profile_id,
            session_id,
            run_count: runs.len(),
            evidence: evidence_items(&runs),
            pending_permission: pending_permission(&runs),
        }))
    }

    fn ensure_active_task(&mut self, first_prompt: &str, settings: &TaskRunSettings) {
        if self.active_task.is_some() {
            return;
        }
        let workspace_id = self
            .state
            .as_ref()
            .map_or("demo", |state| state.workspace_id.as_str());
        let now = now_iso();
        let title = truncate(first_prompt, 80);
        self.active_task = Some(Map::from_iter([
            ("id".into(), Value::String(new_id("tui-task"))),
            ("workspaceId".into(), Value::String(workspace_id.into())),
            ("title".into(), Value::String(title)),
            ("preview".into(), Value::String("TUI task".into())),
            ("status".into(), Value::String("waiting".into())),
            ("updatedAt".into(), Value::String("刚刚".into())),
            ("updatedAtIso".into(), Value::String(now.clone())),
            ("createdAt".into(), Value::String(now)),
            (
                "agent".into(),
                Value::String(agent_name(&settings.adapter).into()),
            ),
            ("adapter".into(), Value::String(settings.adapter.clone())),
            (
                "permissionMode".into(),
                Value::String(settings.permission_mode.clone()),
            ),
            (
                "model".into(),
                Value::String(settings.model.clone().unwrap_or_else(|| "Default".into())),
            ),
            ("branch".into(), Value::String("—".into())),
            ("elapsed".into(), Value::String("—".into())),
            ("tokens".into(), Value::String("—".into())),
            ("messages".into(), Value::Array(Vec::new())),
            ("plan".into(), Value::Array(Vec::new())),
            ("activity".into(), Value::Array(Vec::new())),
            ("runs".into(), Value::Array(Vec::new())),
            ("reviewAcceptances".into(), Value::Array(Vec::new())),
        ]));
        if let Some(profile_id) = &settings.profile_id {
            self.active_task
                .as_mut()
                .expect("active task exists")
                .insert("agentProfileId".into(), Value::String(profile_id.clone()));
        }
    }
}

fn task_summary(task: &Map<String, Value>) -> Option<TaskSummary> {
    let runs = task
        .get("runs")
        .and_then(Value::as_array)
        .map_or(0, Vec::len);
    Some(TaskSummary {
        id: string(task, "id")?.to_owned(),
        title: string(task, "title").unwrap_or("Untitled task").to_owned(),
        status: string(task, "status").unwrap_or("waiting").to_owned(),
        updated_at: string(task, "updatedAtIso")
            .or_else(|| string(task, "createdAt"))
            .unwrap_or("unknown time")
            .to_owned(),
        adapter: string(task, "adapter").unwrap_or("codex").to_owned(),
        run_count: runs,
        pinned: task.get("pinned").and_then(Value::as_bool).unwrap_or(false),
        archived: task
            .get("archived")
            .and_then(Value::as_bool)
            .unwrap_or(false),
    })
}

fn evidence_items(runs: &[Value]) -> Vec<EvidenceItem> {
    let mut runs: Vec<&Map<String, Value>> = runs.iter().filter_map(Value::as_object).collect();
    runs.sort_by(|left, right| {
        string(right, "updatedAt")
            .unwrap_or_default()
            .cmp(string(left, "updatedAt").unwrap_or_default())
    });
    let mut evidence = Vec::new();
    for run in runs {
        let run_id = string(run, "id").unwrap_or("unknown-run");
        if let Some(patch) = run.get("gitPatch").and_then(Value::as_object)
            && let Some(item) = EvidenceItem::from_git_patch(run_id, patch)
        {
            evidence.push(item);
        }
        evidence.extend(
            run.get("verifications")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(Value::as_object)
                .filter_map(|item| EvidenceItem::from_verification(run_id, item)),
        );
    }
    evidence
}

fn pending_permission(runs: &[Value]) -> Option<PendingPermission> {
    runs.iter()
        .filter_map(Value::as_object)
        .filter(|run| string(run, "status") == Some("waiting-permission"))
        .flat_map(|run| {
            run.get("permissionRequests")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
        })
        .filter_map(Value::as_object)
        .filter_map(PendingPermission::from_value)
        .max_by(|left, right| left.requested_at.cmp(&right.requested_at))
}

fn object_u64(object: Option<&Map<String, Value>>, key: &str) -> u64 {
    object
        .and_then(|value| value.get(key))
        .and_then(Value::as_u64)
        .unwrap_or_default()
}

fn ensure_run(task: &mut Map<String, Value>, run_id: &str, settings: &TaskRunSettings, now: &str) {
    let task_id = string(task, "id").unwrap_or("tui-task").to_owned();
    let prompt = task
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| {
            messages
                .iter()
                .rev()
                .find(|message| message.get("role") == Some(&Value::String("user".into())))
        })
        .and_then(|message| message.get("text"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_owned();
    let runs = array_mut(task, "runs");
    if runs
        .iter()
        .any(|run| run.get("id").and_then(Value::as_str) == Some(run_id))
    {
        return;
    }
    let mut run = Map::from_iter([
        ("id".into(), Value::String(run_id.into())),
        ("taskId".into(), Value::String(task_id)),
        ("adapter".into(), Value::String(settings.adapter.clone())),
        ("status".into(), Value::String("running".into())),
        ("prompt".into(), Value::String(prompt)),
        (
            "permissionMode".into(),
            Value::String(settings.permission_mode.clone()),
        ),
        ("startedAt".into(), Value::String(now.into())),
        ("updatedAt".into(), Value::String(now.into())),
        ("contextFiles".into(), Value::Array(Vec::new())),
        ("permissionRequests".into(), Value::Array(Vec::new())),
        ("permissionDecisions".into(), Value::Array(Vec::new())),
        ("verifications".into(), Value::Array(Vec::new())),
        ("events".into(), Value::Array(Vec::new())),
    ]);
    if let Some(model) = &settings.model {
        run.insert("model".into(), Value::String(model.clone()));
    }
    if let Some(profile_id) = &settings.profile_id {
        run.insert("profileId".into(), Value::String(profile_id.clone()));
    }
    if let Some(session_id) = &settings.session_id {
        run.insert("sessionId".into(), Value::String(session_id.clone()));
    }
    runs.push(Value::Object(run));
}

fn apply_run_event(run: &mut Map<String, Value>, event: &RuntimeEvent, now: &str) {
    match event.event_type.as_str() {
        "run.started" => {
            run.insert("status".into(), Value::String("running".into()));
        }
        "run.metadata" => {
            copy_string(event, run, "sessionId");
            copy_string(event, run, "model");
            copy_string(event, run, "cwd");
            copy_string(event, run, "version");
        }
        "run.agent-snapshot" => {
            if let Some(profile) = event.fields.get("profile").and_then(Value::as_object) {
                run.insert("agentSnapshot".into(), Value::Object(profile.clone()));
                if let Some(profile_id) = profile.get("id").and_then(Value::as_str) {
                    run.insert("profileId".into(), Value::String(profile_id.into()));
                }
            }
        }
        "run.context-snapshot" => {
            if let Some(snapshot) = event.fields.get("snapshot").and_then(Value::as_object) {
                run.insert("contextSnapshot".into(), Value::Object(snapshot.clone()));
            }
        }
        "run.git-baseline" => {
            if let Some(baseline) = event.fields.get("baseline").and_then(Value::as_object) {
                run.insert("gitBaseline".into(), Value::Object(baseline.clone()));
            }
        }
        "run.git-patch" => {
            if let Some(patch) = event.fields.get("patch").and_then(Value::as_object) {
                run.insert("gitPatch".into(), Value::Object(patch.clone()));
            }
        }
        "verification.recorded" => {
            let Some(verification) = event.fields.get("verification").and_then(Value::as_object)
            else {
                return;
            };
            let Some(id) = verification.get("id").and_then(Value::as_str) else {
                return;
            };
            let verifications = array_mut(run, "verifications");
            if let Some(existing) = verifications
                .iter_mut()
                .find(|item| item.get("id").and_then(Value::as_str) == Some(id))
            {
                *existing = Value::Object(verification.clone());
            } else {
                verifications.push(Value::Object(verification.clone()));
            }
        }
        "permission.requested" => {
            let Some(request) = event.fields.get("request").and_then(Value::as_object) else {
                return;
            };
            upsert_object(run, "permissionRequests", request, "id");
            run.insert("status".into(), Value::String("waiting-permission".into()));
        }
        "permission.decided" => {
            let Some(decision) = event.fields.get("decision").and_then(Value::as_object) else {
                return;
            };
            upsert_object(run, "permissionDecisions", decision, "id");
            let request_id = string(decision, "requestId").unwrap_or_default();
            let decision_value = string(decision, "decision").unwrap_or("cancelled");
            let request_status = match decision_value {
                "approved" => "approved",
                "denied" => "denied",
                _ => "cancelled",
            };
            if let Some(request) = array_mut(run, "permissionRequests")
                .iter_mut()
                .find(|request| request.get("id").and_then(Value::as_str) == Some(request_id))
                .and_then(Value::as_object_mut)
            {
                request.insert("status".into(), Value::String(request_status.into()));
            }
            run.insert(
                "status".into(),
                Value::String(
                    if decision_value == "approved" {
                        "running"
                    } else {
                        "cancelled"
                    }
                    .into(),
                ),
            );
        }
        "run.completed" => finish_run(run, "completed", event, now),
        "run.cancelled" => finish_run(run, "cancelled", event, now),
        "run.failed" => {
            finish_run(run, "failed", event, now);
            copy_string(event, run, "error");
        }
        _ => {}
    }
}

fn apply_task_event(
    task: &mut Map<String, Value>,
    event: &RuntimeEvent,
    settings: &TaskRunSettings,
    now: &str,
) {
    match event.event_type.as_str() {
        "run.started" => {
            task.insert("status".into(), Value::String("running".into()));
            task.insert("adapter".into(), Value::String(settings.adapter.clone()));
            task.insert(
                "agent".into(),
                Value::String(agent_name(&settings.adapter).into()),
            );
            task.insert(
                "permissionMode".into(),
                Value::String(settings.permission_mode.clone()),
            );
        }
        "assistant.message" => {
            if let (Some(run_id), Some(text)) = (event.string("runId"), event.string("text")) {
                append_assistant_message(task, run_id, text, now);
                task.insert("preview".into(), Value::String(truncate(text, 160)));
            }
        }
        "activity.started" | "activity.completed" => update_activity(task, event),
        "plan.updated" => update_plan(task, event),
        "run.usage" => update_usage(task, event),
        "permission.requested" => {
            task.insert("status".into(), Value::String("blocked".into()));
            task.insert(
                "preview".into(),
                Value::String("Waiting for workspace permission".into()),
            );
        }
        "permission.decided" => {
            let decision = event
                .fields
                .get("decision")
                .and_then(Value::as_object)
                .and_then(|decision| string(decision, "decision"));
            task.insert(
                "status".into(),
                Value::String(
                    if decision == Some("approved") {
                        "running"
                    } else {
                        "stopped"
                    }
                    .into(),
                ),
            );
        }
        "run.completed" => {
            task.insert("status".into(), Value::String("completed".into()));
            if let Some(duration) = event.fields.get("durationMs").and_then(Value::as_u64) {
                task.insert(
                    "elapsed".into(),
                    Value::String(format!("{}s", duration / 1_000)),
                );
            }
        }
        "run.cancelled" | "run.failed" => {
            task.insert("status".into(), Value::String("stopped".into()));
        }
        _ => {}
    }
}

fn finish_run(run: &mut Map<String, Value>, status: &str, event: &RuntimeEvent, now: &str) {
    run.insert("status".into(), Value::String(status.into()));
    run.insert("finishedAt".into(), Value::String(now.into()));
    for key in ["durationMs", "costUsd", "turns"] {
        if let Some(value) = event.fields.get(key) {
            run.insert(key.into(), value.clone());
        }
    }
}

fn append_assistant_message(task: &mut Map<String, Value>, run_id: &str, text: &str, now: &str) {
    let message_id = format!("tui-message-{run_id}");
    let messages = array_mut(task, "messages");
    if let Some(message) = messages
        .iter_mut()
        .find(|message| message.get("id").and_then(Value::as_str) == Some(&message_id))
        .and_then(Value::as_object_mut)
    {
        let current = string(message, "text").unwrap_or_default();
        message.insert("text".into(), Value::String(format!("{current}{text}")));
        return;
    }
    messages.push(json!({
        "id": message_id,
        "role": "assistant",
        "text": text,
        "time": "现在",
        "createdAt": now,
    }));
}

fn update_activity(task: &mut Map<String, Value>, event: &RuntimeEvent) {
    let Some(activity) = event.fields.get("activity").and_then(Value::as_object) else {
        return;
    };
    let Some(id) = string(activity, "id") else {
        return;
    };
    let activities = array_mut(task, "activity");
    if let Some(existing) = activities
        .iter_mut()
        .find(|value| value.get("id").and_then(Value::as_str) == Some(id))
    {
        *existing = Value::Object(activity.clone());
    } else {
        activities.push(Value::Object(activity.clone()));
    }
}

fn update_plan(task: &mut Map<String, Value>, event: &RuntimeEvent) {
    let items = event
        .fields
        .get("items")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            Some(json!({
                "label": item.get("text")?.as_str()?,
                "state": if item.get("completed").and_then(Value::as_bool) == Some(true) {
                    "done"
                } else {
                    "pending"
                },
            }))
        })
        .collect();
    task.insert("plan".into(), Value::Array(items));
}

fn update_usage(task: &mut Map<String, Value>, event: &RuntimeEvent) {
    let Some(usage) = event.fields.get("usage").and_then(Value::as_object) else {
        return;
    };
    let total = usage
        .values()
        .filter_map(Value::as_u64)
        .fold(0_u64, u64::saturating_add);
    task.insert("tokens".into(), Value::String(format!("{total} tokens")));
}

fn copy_string(event: &RuntimeEvent, target: &mut Map<String, Value>, key: &str) {
    if let Some(value) = event.string(key) {
        target.insert(key.into(), Value::String(value.into()));
    }
}

fn upsert_object(
    target: &mut Map<String, Value>,
    array_key: &str,
    item: &Map<String, Value>,
    id_key: &str,
) {
    let id = string(item, id_key).unwrap_or_default();
    let items = array_mut(target, array_key);
    if let Some(existing) = items
        .iter_mut()
        .find(|existing| existing.get(id_key).and_then(Value::as_str) == Some(id))
    {
        *existing = Value::Object(item.clone());
    } else {
        items.push(Value::Object(item.clone()));
    }
}

fn touch(task: &mut Map<String, Value>) {
    task.insert("updatedAt".into(), Value::String("刚刚".into()));
    task.insert("updatedAtIso".into(), Value::String(now_iso()));
}

fn array_mut<'a>(object: &'a mut Map<String, Value>, key: &str) -> &'a mut Vec<Value> {
    object
        .entry(key)
        .or_insert_with(|| Value::Array(Vec::new()))
        .as_array_mut()
        .expect("persisted task array field must remain an array")
}

fn string<'a>(object: &'a Map<String, Value>, key: &str) -> Option<&'a str> {
    object.get(key).and_then(Value::as_str)
}

fn agent_name(adapter: &str) -> &str {
    if adapter == "claude-code" {
        "Claude Code"
    } else {
        "Rux"
    }
}

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".into())
}

fn new_id(prefix: &str) -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    format!("{prefix}-{}-{nanos}", std::process::id())
}

fn truncate(text: &str, max_chars: usize) -> String {
    let mut truncated: String = text.chars().take(max_chars).collect();
    if text.chars().count() > max_chars {
        truncated.push('…');
    }
    truncated
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;

    use super::*;

    fn settings() -> TaskRunSettings {
        TaskRunSettings {
            adapter: "codex".into(),
            model: None,
            permission_mode: "plan".into(),
            profile_id: None,
            session_id: None,
        }
    }

    fn run_event(event_type: &str, extra: Option<(&str, Value)>) -> RuntimeEvent {
        let mut fields = BTreeMap::from([("runId".into(), Value::String("run-1".into()))]);
        if let Some((key, value)) = extra {
            fields.insert(key.into(), value);
        }
        RuntimeEvent::new(event_type, fields)
    }

    fn agent_snapshot() -> Value {
        json!({
            "id": "custom-00000000-0000-4000-8000-000000000001",
            "name": "Review Agent",
            "description": "",
            "backend": "codex",
            "instructions": "Review evidence first",
            "permissionMode": "plan",
            "skillIds": [],
            "toolIds": [],
            "enabled": true,
            "createdAt": "2026-08-10T00:00:00Z",
            "updatedAt": "2026-08-10T00:00:00Z"
        })
    }

    fn context_snapshot() -> Value {
        json!({
            "workspaceRoot": "/workspace",
            "generatedAt": "2026-08-10T00:00:01Z",
            "instructions": [{
                "path": "AGENTS.md",
                "kind": "instructions",
                "bytes": 16,
                "exists": true,
                "sha256": "a".repeat(64),
                "content": "Review first",
                "truncated": false,
                "binary": false
            }],
            "selectedFiles": [],
            "capabilities": ["Codex"]
        })
    }

    fn verification() -> Value {
        json!({
            "id": "verify-1",
            "runId": "run-1",
            "kind": "test",
            "command": "npm test",
            "cwd": "/workspace",
            "finishedAt": "2026-08-10T00:00:02Z",
            "exitCode": 0,
            "status": "passed",
            "log": "ok",
            "redacted": false,
            "truncated": false
        })
    }

    fn git_baseline() -> Value {
        json!({
            "id": "baseline-1",
            "runId": "run-1",
            "workspaceRoot": "/workspace",
            "createdAt": "2026-08-10T00:00:01Z",
            "treeId": "b".repeat(40),
            "headId": "c".repeat(40),
            "ignoredFilesExcluded": true
        })
    }

    fn git_patch() -> Value {
        json!({
            "id": "patch-1",
            "runId": "run-1",
            "baselineId": "baseline-1",
            "workspaceRoot": "/workspace",
            "generatedAt": "2026-08-10T00:00:02Z",
            "beforeTreeId": "b".repeat(40),
            "afterTreeId": "d".repeat(40),
            "snapshotId": "e".repeat(64),
            "files": [{
                "path": "src/main.rs",
                "kind": "modified",
                "additions": 2,
                "deletions": 1,
                "isBinary": false
            }],
            "totals": {"files": 1, "additions": 2, "deletions": 1, "binaryFiles": 0}
        })
    }

    #[test]
    fn records_a_valid_task_run_and_hydrates_it_again() {
        let mut persistence = TaskPersistence::awaiting();
        persistence
            .load(&json!({
                "version": 1,
                "workspaceId": "workspace-1",
                "tasks": [],
                "updatedAt": "2026-08-10T00:00:00Z"
            }))
            .unwrap();
        persistence.record_user("Fix the tests", &settings());
        persistence.record_event(
            &run_event(
                "run.started",
                Some(("adapter", Value::String("codex".into()))),
            ),
            &settings(),
        );
        persistence.record_event(
            &run_event(
                "assistant.message",
                Some(("text", Value::String("Done".into()))),
            ),
            &settings(),
        );
        persistence.record_event(
            &run_event("run.agent-snapshot", Some(("profile", agent_snapshot()))),
            &settings(),
        );
        persistence.record_event(
            &run_event(
                "run.context-snapshot",
                Some(("snapshot", context_snapshot())),
            ),
            &settings(),
        );
        persistence.record_event(
            &run_event("run.git-baseline", Some(("baseline", git_baseline()))),
            &settings(),
        );
        persistence.record_event(
            &run_event("run.git-patch", Some(("patch", git_patch()))),
            &settings(),
        );
        persistence.record_event(
            &run_event(
                "verification.recorded",
                Some(("verification", verification())),
            ),
            &settings(),
        );
        persistence.record_event(&run_event("run.completed", None), &settings());
        let snapshot = persistence.snapshot_value().unwrap().unwrap();
        let task = &snapshot["tasks"][0];
        assert_eq!(task["status"], "completed");
        assert_eq!(task["messages"][1]["text"], "Done");
        assert_eq!(task["runs"][0]["events"].as_array().unwrap().len(), 8);
        assert_eq!(task["runs"][0]["agentSnapshot"]["name"], "Review Agent");
        assert_eq!(
            task["runs"][0]["contextSnapshot"]["instructions"][0]["path"],
            "AGENTS.md"
        );
        assert_eq!(task["runs"][0]["verifications"][0]["status"], "passed");
        assert_eq!(task["runs"][0]["gitBaseline"]["id"], "baseline-1");
        assert_eq!(
            task["runs"][0]["gitPatch"]["files"][0]["path"],
            "src/main.rs"
        );

        let mut reloaded = TaskPersistence::awaiting();
        let hydrated = reloaded.load(&snapshot).unwrap().unwrap();
        assert_eq!(hydrated.messages.len(), 2);
        assert_eq!(hydrated.session_id, None);
        assert_eq!(hydrated.run_count, 1);
        assert_eq!(hydrated.evidence.len(), 2);
        assert!(matches!(
            &hydrated.evidence[0],
            EvidenceItem::RunOwnedPatch { files, .. } if files[0].path == "src/main.rs"
        ));
        assert!(matches!(
            &hydrated.evidence[1],
            EvidenceItem::Verification { status, .. } if status == "passed"
        ));
    }

    #[test]
    fn browses_and_switches_persisted_tasks_without_touching_recency() {
        let mut persistence = TaskPersistence::awaiting();
        let selected = persistence
            .load(&json!({
                "version": 1,
                "workspaceId": "workspace-1",
                "tasks": [
                    {
                        "id": "task-current",
                        "workspaceId": "workspace-1",
                        "title": "Current task",
                        "status": "completed",
                        "adapter": "codex",
                        "updatedAtIso": "2026-08-10T02:00:00Z",
                        "createdAt": "2026-08-10T01:00:00Z",
                        "messages": [{"role": "user", "text": "current"}],
                        "runs": []
                    },
                    {
                        "id": "task-older",
                        "workspaceId": "workspace-1",
                        "title": "Pinned older task",
                        "status": "stopped",
                        "adapter": "claude-code",
                        "pinned": true,
                        "updatedAtIso": "2026-08-09T02:00:00Z",
                        "createdAt": "2026-08-09T01:00:00Z",
                        "messages": [{"role": "user", "text": "older"}],
                        "runs": [{
                            "id": "run-older",
                            "adapter": "claude-code",
                            "permissionMode": "plan",
                            "updatedAt": "2026-08-09T02:00:00Z",
                            "verifications": [{
                                "id": "verification-unknown",
                                "kind": "test",
                                "status": "unexpected-value",
                                "command": "cargo test",
                                "cwd": "/workspace",
                                "finishedAt": "2026-08-09T02:00:00Z",
                                "log": "exit zero without authoritative result"
                            }]
                        }]
                    },
                    {
                        "id": "task-archived-newest",
                        "workspaceId": "workspace-1",
                        "title": "Archived newest task",
                        "status": "completed",
                        "adapter": "codex",
                        "archived": true,
                        "updatedAtIso": "2026-08-11T02:00:00Z",
                        "createdAt": "2026-08-11T01:00:00Z",
                        "messages": [],
                        "runs": []
                    }
                ],
                "updatedAt": "2026-08-11T02:00:00Z"
            }))
            .unwrap()
            .unwrap();

        assert_eq!(selected.id, "task-current");
        let summaries = persistence.task_summaries();
        assert_eq!(summaries[0].id, "task-older");
        assert_eq!(summaries[2].id, "task-archived-newest");

        let older = persistence.select_task("task-older").unwrap();
        assert_eq!(older.title, "Pinned older task");
        assert_eq!(older.adapter, "claude-code");
        assert!(matches!(
            &older.evidence[0],
            EvidenceItem::Verification {
                status,
                exit_code: None,
                ..
            } if status == "unknown"
        ));
        let snapshot = persistence.snapshot_value().unwrap().unwrap();
        assert_eq!(snapshot["tasks"][1]["updatedAtIso"], "2026-08-09T02:00:00Z");
    }

    #[test]
    fn restores_and_records_a_blocking_permission_lifecycle() {
        let request = json!({
            "id": "permission-1",
            "runId": "run-1",
            "action": "workspace.write",
            "scope": {
                "kind": "workspace",
                "path": "/workspace",
                "appliesTo": "this-run"
            },
            "impact": "May modify files inside the authorized Workspace.",
            "requestedAt": "2026-08-11T00:00:00Z",
            "status": "pending"
        });
        let mut persistence = TaskPersistence::awaiting();
        let hydrated = persistence
            .load(&json!({
                "version": 1,
                "workspaceId": "workspace-1",
                "tasks": [{
                    "id": "task-1",
                    "workspaceId": "workspace-1",
                    "title": "Pending approval",
                    "status": "blocked",
                    "adapter": "codex",
                    "permissionMode": "acceptEdits",
                    "updatedAtIso": "2026-08-11T00:00:00Z",
                    "createdAt": "2026-08-11T00:00:00Z",
                    "messages": [{"role": "user", "text": "Edit files"}],
                    "runs": [{
                        "id": "run-1",
                        "adapter": "codex",
                        "status": "waiting-permission",
                        "permissionMode": "acceptEdits",
                        "updatedAt": "2026-08-11T00:00:00Z",
                        "permissionRequests": [request.clone()],
                        "permissionDecisions": [],
                        "verifications": [],
                        "events": []
                    }]
                }],
                "updatedAt": "2026-08-11T00:00:00Z"
            }))
            .unwrap()
            .unwrap();
        let pending = hydrated.pending_permission.unwrap();
        assert_eq!(pending.action, "workspace.write");
        assert_eq!(pending.scope_path, "/workspace");

        persistence.record_event(
            &run_event(
                "permission.decided",
                Some((
                    "decision",
                    json!({
                        "id": "decision-1",
                        "requestId": "permission-1",
                        "runId": "run-1",
                        "decision": "approved",
                        "source": "user",
                        "decidedAt": "2026-08-11T00:00:01Z"
                    }),
                )),
            ),
            &settings(),
        );
        let snapshot = persistence.snapshot_value().unwrap().unwrap();
        assert_eq!(snapshot["tasks"][0]["status"], "running");
        assert_eq!(snapshot["tasks"][0]["runs"][0]["status"], "running");
        assert_eq!(
            snapshot["tasks"][0]["runs"][0]["permissionRequests"][0]["status"],
            "approved"
        );
        assert_eq!(
            snapshot["tasks"][0]["runs"][0]["permissionDecisions"][0]["decision"],
            "approved"
        );
    }
}
