use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::{Value, json};

use crate::action::Action;
use crate::effect::Effect;
use crate::persistence::{
    EvidenceItem, HydratedTask, PendingPermission, RunReviewSource, TaskPersistence,
    TaskRunSettings, TaskSummary,
};
use crate::protocol::{PROTOCOL_VERSION, RuntimeEvent, RuntimeRequest, RuntimeWireMessage};
use crate::runtime::RuntimeDescriptor;

const ESC_DOUBLE_PRESS_MS: u64 = 800;
const MAX_INDEXED_FILES: usize = 10_000;

#[must_use]
pub fn adapter_label(adapter: &str) -> &str {
    match adapter {
        "codex" => "Rux",
        "mock" => "Rux Demo",
        "claude-code" => "Claude Code",
        other => other,
    }
}

fn built_in_revision_id(adapter: &str) -> String {
    format!("builtin:{adapter}@1")
}

fn default_provider_connection(adapter: &str) -> Value {
    if adapter == "mock" {
        json!({
            "id": "legacy:mock:local-demo",
            "kind": "legacy",
            "engine": "mock",
            "label": "Legacy local demo"
        })
    } else {
        json!({
            "id": format!("cli:{adapter}:default"),
            "kind": "official-cli",
            "engine": adapter,
            "label": if adapter == "claude-code" { "Claude Code CLI default" } else { "Codex CLI default" }
        })
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RunConfiguration {
    pub adapter: String,
    pub model: Option<String>,
    pub model_source: String,
    pub model_verification_status: String,
    pub permission_mode: String,
    pub profile_id: Option<String>,
    pub agent_revision_id: String,
    pub provider_connection: Value,
    pub session_id: Option<String>,
}

impl RunConfiguration {
    #[must_use]
    pub fn for_runtime(runtime: &RuntimeDescriptor) -> Self {
        if runtime.connected_to_real_runtime {
            Self {
                adapter: "codex".into(),
                model: None,
                model_source: "engine-default".into(),
                model_verification_status: "not-required".into(),
                permission_mode: "plan".into(),
                profile_id: None,
                agent_revision_id: built_in_revision_id("codex"),
                provider_connection: default_provider_connection("codex"),
                session_id: None,
            }
        } else {
            Self {
                adapter: "mock".into(),
                model: Some("demo".into()),
                model_source: "manual".into(),
                model_verification_status: "unverified".into(),
                permission_mode: "acceptEdits".into(),
                profile_id: None,
                agent_revision_id: built_in_revision_id("mock"),
                provider_connection: default_provider_connection("mock"),
                session_id: None,
            }
        }
    }

    #[must_use]
    pub fn summary(&self) -> String {
        let model = self.model.as_deref().unwrap_or("default model");
        let profile = self
            .profile_id
            .as_deref()
            .map_or_else(String::new, |id| format!(" · profile {id}"));
        format!(
            "{} · {model} · {}{profile}",
            adapter_label(&self.adapter),
            self.permission_mode
        )
    }
}

#[derive(Clone, Debug)]
struct ProfileRevisionRef {
    revision_id: String,
    backend: String,
    provider_connection: Value,
}

#[derive(Clone, Debug)]
struct DiscoveredSessionRef {
    engine: String,
    native_session_id: String,
    provider_connection: Value,
    title: String,
}

#[derive(Clone, Debug)]
struct PendingHandoff {
    target_agent_id: String,
    fingerprint: String,
    message_ids: Vec<String>,
    file_paths: Vec<String>,
    agent_summary: Option<String>,
    agent_summary_generation_id: Option<String>,
}

#[derive(Clone, Debug)]
struct PendingLocalDataAction {
    scope: String,
    action: String,
    task_id: Option<String>,
    fingerprint: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Screen {
    Welcome,
    Task,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Focus {
    Scrollback,
    Composer,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum RunState {
    Idle,
    WaitingPermission {
        run_id: String,
        request_id: String,
    },
    DecidingPermission {
        run_id: String,
        request_id: String,
        decision: String,
    },
    Running {
        run_id: String,
    },
    Cancelling {
        run_id: String,
    },
}

impl RunState {
    #[must_use]
    pub fn label(&self) -> &'static str {
        match self {
            Self::Idle => "IDLE",
            Self::WaitingPermission { .. } => "PERMISSION",
            Self::DecidingPermission { .. } => "DECIDING",
            Self::Running { .. } => "RUNNING",
            Self::Cancelling { .. } => "CANCELLING",
        }
    }

    #[must_use]
    pub fn run_id(&self) -> Option<&str> {
        match self {
            Self::Idle => None,
            Self::WaitingPermission { run_id, .. }
            | Self::DecidingPermission { run_id, .. }
            | Self::Running { run_id }
            | Self::Cancelling { run_id } => Some(run_id),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum TranscriptEntry {
    User(String),
    Assistant {
        run_id: String,
        text: String,
        model: Option<String>,
        classification: Option<String>,
        total_tokens: Option<u64>,
    },
    Activity {
        run_id: String,
        id: String,
        title: String,
        detail: String,
        state: String,
    },
    System(String),
    Error(String),
}

#[derive(Clone, Debug, Default)]
struct RunTurnEvidence {
    model: Option<String>,
    classification: Option<String>,
    total_tokens: Option<u64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Suggestion {
    pub value: String,
    pub description: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RewindPoint {
    pub entry_index: usize,
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Overlay {
    Commands {
        items: Vec<Suggestion>,
        selected: usize,
    },
    Files {
        items: Vec<Suggestion>,
        selected: usize,
        token_start: usize,
    },
    Rewind {
        points: Vec<RewindPoint>,
        selected: usize,
    },
    TaskHistory {
        items: Vec<TaskSummary>,
        selected: usize,
    },
    Evidence {
        items: Vec<EvidenceItem>,
        selected: usize,
        expanded: bool,
        detail_scroll: usize,
    },
    Permission {
        request: PendingPermission,
        selected: usize,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum EscapeIntent {
    Clear,
    Rewind,
}

#[derive(Clone, Debug, Default)]
pub struct FileIndex {
    files: Vec<String>,
}

impl FileIndex {
    #[must_use]
    pub fn from_paths(paths: impl IntoIterator<Item = String>) -> Self {
        let mut files: Vec<String> = paths.into_iter().collect();
        files.sort();
        files.dedup();
        Self { files }
    }

    #[must_use]
    pub fn scan(root: &Path) -> Self {
        let mut files = Vec::new();
        let mut pending = vec![root.to_path_buf()];
        while let Some(directory) = pending.pop() {
            let Ok(entries) = fs::read_dir(&directory) else {
                continue;
            };
            for entry in entries.flatten() {
                if files.len() >= MAX_INDEXED_FILES {
                    break;
                }
                let path = entry.path();
                let name = entry.file_name();
                let name = name.to_string_lossy();
                let Ok(file_type) = entry.file_type() else {
                    continue;
                };
                if file_type.is_dir() {
                    if !matches!(
                        name.as_ref(),
                        ".git" | "node_modules" | "target" | "dist" | ".next"
                    ) {
                        pending.push(path);
                    }
                } else if (file_type.is_file() || file_type.is_symlink())
                    && let Ok(relative) = path.strip_prefix(root)
                {
                    files.push(relative.to_string_lossy().replace('\\', "/"));
                }
            }
        }
        Self::from_paths(files)
    }

    fn search(&self, raw_query: &str) -> Vec<Suggestion> {
        let include_hidden = raw_query.starts_with('!');
        let query = raw_query
            .strip_prefix('!')
            .unwrap_or(raw_query)
            .to_lowercase();
        self.files
            .iter()
            .filter(|path| include_hidden || !path.split('/').any(|part| part.starts_with('.')))
            .filter(|path| query.is_empty() || path.to_lowercase().contains(&query))
            .take(8)
            .map(|path| Suggestion {
                value: path.clone(),
                description: "workspace file".into(),
            })
            .collect()
    }
}

#[derive(Clone, Copy)]
struct CommandSpec {
    name: &'static str,
    description: &'static str,
}

const COMMANDS: &[CommandSpec] = &[
    CommandSpec {
        name: "help",
        description: "Show available prototype commands",
    },
    CommandSpec {
        name: "new",
        description: "Start a clean local task view",
    },
    CommandSpec {
        name: "tasks",
        description: "Browse and open persisted Task history",
    },
    CommandSpec {
        name: "evidence",
        description: "Inspect Verification and Run-owned change evidence",
    },
    CommandSpec {
        name: "clear",
        description: "Clear visible transcript only",
    },
    CommandSpec {
        name: "rewind",
        description: "Open the non-mutating rewind preview",
    },
    CommandSpec {
        name: "model",
        description: "Show or set the model (/model default clears)",
    },
    CommandSpec {
        name: "agent",
        description: "List or select Rux / Claude Code",
    },
    CommandSpec {
        name: "permission",
        description: "Show or set plan / acceptEdits / dontAsk",
    },
    CommandSpec {
        name: "profile",
        description: "List or select a custom Agent profile ID",
    },
    CommandSpec {
        name: "profile-create",
        description: "Create an Agent from strict JSON",
    },
    CommandSpec {
        name: "profile-update",
        description: "Append an immutable Agent Revision from strict JSON",
    },
    CommandSpec {
        name: "profile-delete",
        description: "Preview deleting an Agent definition",
    },
    CommandSpec {
        name: "profile-delete-confirm",
        description: "Confirm the exact pending Agent definition deletion",
    },
    CommandSpec {
        name: "providers",
        description: "Inspect official CLI Provider status and adapters",
    },
    CommandSpec {
        name: "login",
        description: "Start official CLI login for codex or claude-code",
    },
    CommandSpec {
        name: "logout",
        description: "Preview official CLI logout",
    },
    CommandSpec {
        name: "logout-confirm",
        description: "Confirm the exact pending official CLI logout",
    },
    CommandSpec {
        name: "models",
        description: "Refresh the official Codex model catalog",
    },
    CommandSpec {
        name: "sessions",
        description: "Discover Workspace-scoped external Sessions",
    },
    CommandSpec {
        name: "session-preview",
        description: "Read a selected discovered Session",
    },
    CommandSpec {
        name: "session-import",
        description: "Import a discovered Session as view or continue",
    },
    CommandSpec {
        name: "session-refresh",
        description: "Refresh the current imported Session and show its diff",
    },
    CommandSpec {
        name: "session-rebuild-confirm",
        description: "Confirm a candidate Projection Revision rebuild",
    },
    CommandSpec {
        name: "session-revisions",
        description: "List immutable local Projection Revisions",
    },
    CommandSpec {
        name: "session-restore",
        description: "Preview restoring an old local Projection Revision",
    },
    CommandSpec {
        name: "session-restore-confirm",
        description: "Confirm the exact pending local Revision restore",
    },
    CommandSpec {
        name: "status",
        description: "Show the active Agent run configuration",
    },
    CommandSpec {
        name: "changes",
        description: "Refresh real Git workspace changes",
    },
    CommandSpec {
        name: "diff",
        description: "Show a real file diff (/diff <path>)",
    },
    CommandSpec {
        name: "context",
        description: "Show Context for explicit files or current changes",
    },
    CommandSpec {
        name: "accept",
        description: "Record review-only acceptance for current changes",
    },
    CommandSpec {
        name: "restore",
        description: "Preview restoring one changed path",
    },
    CommandSpec {
        name: "restore-confirm",
        description: "Confirm the exact pending restore preview",
    },
    CommandSpec {
        name: "run-diff",
        description: "Show a Run-owned diff",
    },
    CommandSpec {
        name: "run-accept",
        description: "Record review-only acceptance for a Run patch",
    },
    CommandSpec {
        name: "run-restore",
        description: "Preview restoring Run-owned changes",
    },
    CommandSpec {
        name: "run-restore-confirm",
        description: "Confirm the exact Run restore preview",
    },
    CommandSpec {
        name: "branches",
        description: "List real local and remote Git branches",
    },
    CommandSpec {
        name: "switch",
        description: "Switch to an existing local Git branch",
    },
    CommandSpec {
        name: "worktree",
        description: "Preview creating a Git worktree: <absolute-path> <branch>",
    },
    CommandSpec {
        name: "worktree-confirm",
        description: "Confirm the exact pending worktree path and branch",
    },
    CommandSpec {
        name: "compare",
        description: "Compare a branch to the current branch",
    },
    CommandSpec {
        name: "commit",
        description: "Commit only already-staged changes",
    },
    CommandSpec {
        name: "push",
        description: "Preview pushing the current configured upstream",
    },
    CommandSpec {
        name: "push-confirm",
        description: "Confirm the exact pending upstream push",
    },
    CommandSpec {
        name: "handoff",
        description: "Preview a deterministic Context Handoff",
    },
    CommandSpec {
        name: "handoff-confirm",
        description: "Confirm the exact pending Context Handoff",
    },
    CommandSpec {
        name: "handoff-summary",
        description: "Generate an optional isolated source-Agent summary",
    },
    CommandSpec {
        name: "handoff-summary-set",
        description: "Edit or remove the pending Handoff summary",
    },
    CommandSpec {
        name: "data",
        description: "Show local Workspace data usage",
    },
    CommandSpec {
        name: "data-preview",
        description: "Preview unlink/remove-imported/delete-task",
    },
    CommandSpec {
        name: "data-confirm",
        description: "Confirm the exact pending local-data action",
    },
    CommandSpec {
        name: "data-export",
        description: "Preview a sensitive local-data export",
    },
    CommandSpec {
        name: "data-export-confirm",
        description: "Confirm the exact pending export",
    },
    CommandSpec {
        name: "quit",
        description: "Quit Rux TUI",
    },
];

pub struct App {
    pub screen: Screen,
    pub focus: Focus,
    pub composer: Vec<char>,
    pub cursor: usize,
    pub entries: Vec<TranscriptEntry>,
    pub overlay: Option<Overlay>,
    pub run_state: RunState,
    pub scroll_from_bottom: usize,
    pub status_hint: String,
    pub runtime_protocol_version: Option<u64>,
    pub runtime: RuntimeDescriptor,
    pub run_configuration: RunConfiguration,
    pub workspace_root: PathBuf,
    pub active_task_id: Option<String>,
    pub active_task_title: Option<String>,
    pub evidence: Vec<EvidenceItem>,
    pub pending_permission: Option<PendingPermission>,
    file_index: FileIndex,
    pending_escape: Option<(EscapeIntent, u64)>,
    next_request_number: u64,
    pending_requests: BTreeMap<String, String>,
    profile_revisions: BTreeMap<String, ProfileRevisionRef>,
    discovered_sessions: BTreeMap<String, DiscoveredSessionRef>,
    workspace_id: Option<String>,
    pending_logout: Option<String>,
    pending_profile_delete: Option<String>,
    pending_push: bool,
    pending_worktree: Option<(String, String)>,
    handoff_message_ids: Vec<String>,
    handoff_file_paths: Vec<String>,
    handoff_target_request: Option<String>,
    pending_handoff: Option<PendingHandoff>,
    pending_local_data: Option<PendingLocalDataAction>,
    pending_session_candidate: Option<String>,
    pending_session_restore: Option<String>,
    pending_data_export: Option<String>,
    run_review_sources: BTreeMap<String, RunReviewSource>,
    pending_run_baselines: BTreeMap<String, Value>,
    run_restore_preview_request: Option<(String, Value)>,
    pending_run_restore: Option<(String, Value)>,
    run_evidence: BTreeMap<String, RunTurnEvidence>,
    persistence: TaskPersistence,
    changes_snapshot_id: Option<String>,
    changed_paths: Vec<String>,
    pending_restore: Option<(String, String)>,
}

impl App {
    #[must_use]
    pub fn new(workspace_root: PathBuf, runtime: RuntimeDescriptor, file_index: FileIndex) -> Self {
        let run_configuration = RunConfiguration::for_runtime(&runtime);
        let persistence = if runtime.connected_to_real_runtime {
            TaskPersistence::awaiting()
        } else {
            TaskPersistence::disabled()
        };
        Self {
            screen: Screen::Welcome,
            focus: Focus::Composer,
            composer: Vec::new(),
            cursor: 0,
            entries: Vec::new(),
            overlay: None,
            run_state: RunState::Idle,
            scroll_from_bottom: 0,
            status_hint: if runtime.connected_to_real_runtime {
                format!("Runtime connected · {}", run_configuration.summary())
            } else {
                "Demo/replay boundary only — no real agent is connected".into()
            },
            runtime_protocol_version: if runtime.connected_to_real_runtime {
                None
            } else {
                Some(u64::from(PROTOCOL_VERSION))
            },
            runtime,
            run_configuration,
            workspace_root,
            active_task_id: None,
            active_task_title: None,
            evidence: Vec::new(),
            pending_permission: None,
            file_index,
            pending_escape: None,
            next_request_number: 1,
            pending_requests: BTreeMap::new(),
            profile_revisions: BTreeMap::new(),
            discovered_sessions: BTreeMap::new(),
            workspace_id: None,
            pending_logout: None,
            pending_profile_delete: None,
            pending_push: false,
            pending_worktree: None,
            handoff_message_ids: Vec::new(),
            handoff_file_paths: Vec::new(),
            handoff_target_request: None,
            pending_handoff: None,
            pending_local_data: None,
            pending_session_candidate: None,
            pending_session_restore: None,
            pending_data_export: None,
            run_review_sources: BTreeMap::new(),
            pending_run_baselines: BTreeMap::new(),
            run_restore_preview_request: None,
            pending_run_restore: None,
            run_evidence: BTreeMap::new(),
            persistence,
            changes_snapshot_id: None,
            changed_paths: Vec::new(),
            pending_restore: None,
        }
    }

    #[must_use]
    pub fn with_run_configuration(mut self, run_configuration: RunConfiguration) -> Self {
        if self.runtime.connected_to_real_runtime {
            self.status_hint = format!("Runtime connected · {}", run_configuration.summary());
        }
        self.run_configuration = run_configuration;
        self
    }

    #[must_use]
    pub fn startup_effects(&mut self) -> Vec<Effect> {
        if !self.runtime.connected_to_real_runtime {
            return Vec::new();
        }
        let request = self.request("task.state.load", json!({}));
        vec![Effect::SendRuntime(request)]
    }

    #[must_use]
    pub fn composer_text(&self) -> String {
        self.composer.iter().collect()
    }

    pub fn update(&mut self, action: Action) -> Vec<Effect> {
        if !matches!(action, Action::Escape { .. } | Action::Tick { .. }) {
            self.pending_escape = None;
        }

        match action {
            Action::Tick { at_ms } => {
                if self
                    .pending_escape
                    .is_some_and(|(_, armed)| at_ms.saturating_sub(armed) > ESC_DOUBLE_PRESS_MS)
                {
                    self.pending_escape = None;
                    if self.status_hint.starts_with("Esc again") {
                        self.status_hint.clear();
                    }
                }
            }
            Action::Quit => return vec![Effect::Quit],
            Action::ToggleTaskHistory => self.toggle_task_history(),
            Action::ToggleEvidence => self.toggle_evidence(),
            Action::ToggleFocus => self.toggle_focus_or_accept(),
            Action::Insert(character) => {
                if matches!(self.overlay, Some(Overlay::Permission { .. })) {
                    return self.permission_shortcut(character);
                }
                self.insert(character);
            }
            Action::InsertNewline => self.insert('\n'),
            Action::Backspace => self.backspace(),
            Action::Delete => self.delete(),
            Action::MoveCursorLeft => self.cursor = self.cursor.saturating_sub(1),
            Action::MoveCursorRight => self.cursor = (self.cursor + 1).min(self.composer.len()),
            Action::MoveCursorStart => self.cursor = 0,
            Action::MoveCursorEnd => self.cursor = self.composer.len(),
            Action::Submit => return self.submit(),
            Action::MoveSelection(delta) => self.move_selection(delta),
            Action::PageUp => self.page_evidence_or_scrollback(true),
            Action::PageDown => self.page_evidence_or_scrollback(false),
            Action::Escape { at_ms } => self.escape(at_ms),
            Action::Cancel => return self.cancel(),
            Action::Runtime(message) => return self.apply_runtime(message),
            Action::RuntimeTransportError(error) => {
                self.run_state = RunState::Idle;
                self.entries.push(TranscriptEntry::Error(format!(
                    "Runtime transport error: {error}"
                )));
                self.status_hint = "No real runtime handled this request".into();
                self.screen = Screen::Task;
            }
        }
        Vec::new()
    }

    fn insert(&mut self, character: char) {
        if self.focus == Focus::Scrollback {
            self.focus = Focus::Composer;
        }
        self.composer.insert(self.cursor, character);
        self.cursor += 1;
        self.refresh_overlay();
    }

    fn backspace(&mut self) {
        if self.cursor > 0 {
            self.cursor -= 1;
            self.composer.remove(self.cursor);
            self.refresh_overlay();
        }
    }

    fn delete(&mut self) {
        if self.cursor < self.composer.len() {
            self.composer.remove(self.cursor);
            self.refresh_overlay();
        }
    }

    fn toggle_focus_or_accept(&mut self) {
        if matches!(
            self.overlay,
            Some(Overlay::Commands { .. } | Overlay::Files { .. })
        ) {
            self.accept_suggestion();
            return;
        }
        if self.screen == Screen::Task {
            self.focus = match self.focus {
                Focus::Scrollback => Focus::Composer,
                Focus::Composer => Focus::Scrollback,
            };
        }
    }

    fn move_selection(&mut self, delta: i8) {
        let selected_and_len = match &self.overlay {
            Some(
                Overlay::Commands { items, selected }
                | Overlay::Files {
                    items, selected, ..
                },
            ) => Some((*selected, items.len())),
            Some(Overlay::Rewind { points, selected }) => Some((*selected, points.len())),
            Some(Overlay::TaskHistory { items, selected }) => Some((*selected, items.len())),
            Some(Overlay::Evidence {
                items, selected, ..
            }) => Some((*selected, items.len())),
            Some(Overlay::Permission { selected, .. }) => Some((*selected, 3)),
            None => None,
        };
        if let Some((selected, len)) = selected_and_len {
            let next = if delta < 0 {
                selected.saturating_sub(usize::from(delta.unsigned_abs()))
            } else {
                (selected + usize::from(delta.unsigned_abs())).min(len.saturating_sub(1))
            };
            match &mut self.overlay {
                Some(
                    Overlay::Commands { selected, .. }
                    | Overlay::Files { selected, .. }
                    | Overlay::Rewind { selected, .. }
                    | Overlay::TaskHistory { selected, .. }
                    | Overlay::Permission { selected, .. },
                ) => *selected = next,
                Some(Overlay::Evidence {
                    selected,
                    detail_scroll,
                    ..
                }) => {
                    *selected = next;
                    *detail_scroll = 0;
                }
                None => {}
            }
            return;
        }

        if self.focus == Focus::Scrollback {
            if delta < 0 {
                self.scroll_from_bottom = self.scroll_from_bottom.saturating_add(1);
            } else {
                self.scroll_from_bottom = self.scroll_from_bottom.saturating_sub(1);
            }
        }
    }

    fn submit(&mut self) -> Vec<Effect> {
        if let Some(effects) = self.submit_overlay() {
            return effects;
        }

        let text = self.composer_text();
        if let Some(command_text) = text.strip_prefix('/') {
            let mut parts = command_text.split_whitespace();
            let command = parts.next().unwrap_or_default();
            if COMMANDS.iter().any(|item| item.name == command) {
                let arguments = parts.collect::<Vec<_>>().join(" ");
                self.clear_composer();
                return self.execute_command(command, &arguments);
            }
            if !text.contains(char::is_whitespace)
                && matches!(self.overlay, Some(Overlay::Commands { .. }))
            {
                self.accept_suggestion();
                return Vec::new();
            }
            self.entries.push(TranscriptEntry::Error(format!(
                "Unknown command: /{command}"
            )));
            self.clear_composer();
            self.screen = Screen::Task;
            return Vec::new();
        }

        if text.trim().is_empty() {
            return Vec::new();
        }
        if self.runtime.connected_to_real_runtime
            && self.runtime_protocol_version != Some(u64::from(PROTOCOL_VERSION))
        {
            self.status_hint = "Runtime protocol incompatible; run request blocked".into();
            return Vec::new();
        }
        if self.runtime.connected_to_real_runtime && !self.persistence.is_loaded() {
            self.status_hint = "Loading shared Desktop/TUI task history…".into();
            return Vec::new();
        }
        if !matches!(self.run_state, RunState::Idle) {
            self.status_hint = "A run is active; Ctrl+C cancels after clearing any draft".into();
            return Vec::new();
        }

        self.screen = Screen::Task;
        self.focus = Focus::Composer;
        self.scroll_from_bottom = 0;
        if self.entries.is_empty() && !self.runtime.connected_to_real_runtime {
            self.entries.push(TranscriptEntry::System(
                "DEMO/REPLAY ONLY · Events below do not prove an agent executed or files changed."
                    .into(),
            ));
        }
        self.entries.push(TranscriptEntry::User(text.clone()));
        let persistence_settings = self.persistence_settings();
        self.persistence.record_user(&text, &persistence_settings);
        self.active_task_id = self.persistence.active_task_id().map(ToOwned::to_owned);
        self.active_task_title = self
            .persistence
            .task_summaries()
            .into_iter()
            .find(|task| Some(task.id.as_str()) == self.active_task_id.as_deref())
            .map(|task| task.title);
        self.clear_composer();

        let run_id = new_run_id();
        self.run_state = RunState::Running {
            run_id: run_id.clone(),
        };
        self.status_hint = "Waiting for JSONL runtime events…".into();
        let mut params = serde_json::Map::from_iter([
            ("runId".into(), Value::String(run_id)),
            (
                "adapter".into(),
                Value::String(self.run_configuration.adapter.clone()),
            ),
            ("prompt".into(), Value::String(text)),
            (
                "permissionMode".into(),
                Value::String(self.run_configuration.permission_mode.clone()),
            ),
        ]);
        self.append_model_params(&mut params);
        if let Some(profile_id) = &self.run_configuration.profile_id {
            params.insert("profileId".into(), Value::String(profile_id.clone()));
        }
        params.insert(
            "agentRevisionId".into(),
            Value::String(self.run_configuration.agent_revision_id.clone()),
        );
        if let Some(session_id) = &self.run_configuration.session_id {
            params.insert("sessionId".into(), Value::String(session_id.clone()));
        }
        let request = self.request("run.start", Value::Object(params));
        let mut effects = vec![Effect::SendRuntime(request)];
        if let Some(effect) = self.persistence_effect() {
            effects.push(effect);
        }
        effects
    }

    fn submit_overlay(&mut self) -> Option<Vec<Effect>> {
        if matches!(self.overlay, Some(Overlay::TaskHistory { .. })) {
            self.select_task_from_overlay();
            return Some(Vec::new());
        }
        if let Some(Overlay::Evidence { expanded, .. }) = &mut self.overlay {
            *expanded = !*expanded;
            self.status_hint = if *expanded {
                "Evidence detail expanded · PgUp/PgDn scrolls captured output".into()
            } else {
                "Evidence detail collapsed · Enter expands the selected record".into()
            };
            return Some(Vec::new());
        }
        if let Some(Overlay::Permission { selected, .. }) = &self.overlay {
            return Some(self.decide_permission(*selected));
        }
        if matches!(self.overlay, Some(Overlay::Files { .. })) {
            self.accept_suggestion();
            return Some(Vec::new());
        }
        None
    }

    fn execute_command(&mut self, command: &str, arguments: &str) -> Vec<Effect> {
        self.screen = Screen::Task;
        match command {
            "help" => self.entries.push(TranscriptEntry::System(
                "Commands: /new /tasks /agent /profile /providers /login /logout /models /sessions /session-preview /session-import /handoff /data /changes /diff /context /accept /restore /branches /switch /worktree /compare /commit /push /evidence /status /quit · Ctrl+T tasks · Ctrl+E evidence · @ files".into(),
            )),
            "new" => {
                self.entries.clear();
                self.run_state = RunState::Idle;
                self.run_configuration.session_id = None;
                self.persistence.start_new();
                self.active_task_id = None;
                self.active_task_title = Some("New task".into());
                self.evidence.clear();
                self.reset_task_transients();
                self.status_hint = format!(
                    "New local task view · next run starts a new {} session",
                    adapter_label(&self.run_configuration.adapter)
                );
            }
            "tasks" => self.open_task_history(),
            "evidence" => self.open_evidence(),
            "clear" => {
                self.entries.clear();
                self.status_hint =
                    "Visible transcript cleared locally; runtime history was not changed".into();
            }
            "rewind" => self.open_rewind(),
            "model" => self.configure_model(arguments),
            "agent" => return self.configure_agent(arguments),
            "permission" => self.configure_permission(arguments),
            "profile" => return self.configure_profile(arguments),
            "profile-create" => return self.create_profile(arguments),
            "profile-update" => return self.update_profile(arguments),
            "profile-delete" => self.preview_profile_delete(arguments),
            "profile-delete-confirm" => return self.confirm_profile_delete(arguments),
            "providers" => return self.request_providers(),
            "login" => return self.request_login(arguments),
            "logout" => self.preview_logout(arguments),
            "logout-confirm" => return self.confirm_logout(arguments),
            "models" => return self.request_models(),
            "sessions" => return self.request_sessions(arguments),
            "session-preview" => return self.request_session_preview(arguments),
            "session-import" => return self.request_session_import(arguments),
            "session-refresh" => return self.request_session_refresh(),
            "session-rebuild-confirm" => return self.confirm_session_rebuild(arguments),
            "session-revisions" => return self.request_session_revisions(),
            "session-restore" => self.preview_session_restore(arguments),
            "session-restore-confirm" => return self.confirm_session_restore(arguments),
            "status" => self.entries.push(TranscriptEntry::System(format!(
                "Run configuration: {}",
                self.run_configuration.summary()
            ))),
            "changes" => return self.request_changes(),
            "diff" => return self.request_diff(arguments),
            "context" => return self.request_context(arguments),
            "accept" => return self.request_accept(),
            "restore" => return self.request_restore_preview(arguments),
            "restore-confirm" => return self.request_restore_confirm(arguments),
            "run-diff" => return self.request_run_diff(arguments),
            "run-accept" => return self.request_run_accept(arguments),
            "run-restore" => return self.request_run_restore_preview(arguments),
            "run-restore-confirm" => return self.request_run_restore_confirm(arguments),
            "branches" => return self.request_branches(),
            "switch" => return self.request_branch_switch(arguments),
            "worktree" => self.preview_worktree_create(arguments),
            "worktree-confirm" => return self.confirm_worktree_create(arguments),
            "compare" => return self.request_branch_compare(arguments),
            "commit" => return self.request_commit(arguments),
            "push" => self.preview_push(),
            "push-confirm" => return self.confirm_push(),
            "handoff" => return self.request_handoff(arguments),
            "handoff-confirm" => return self.confirm_handoff(arguments),
            "handoff-summary" => return self.request_handoff_summary(),
            "handoff-summary-set" => self.set_handoff_summary(arguments),
            "data" => return vec![Effect::SendRuntime(self.request("local.data.summary", json!({})))],
            "data-preview" => return self.request_local_data_preview(arguments),
            "data-confirm" => return self.confirm_local_data(arguments),
            "data-export" => self.preview_data_export(arguments),
            "data-export-confirm" => return self.confirm_data_export(arguments),
            "quit" => return vec![Effect::Quit],
            _ => {}
        }
        Vec::new()
    }

    fn configure_model(&mut self, arguments: &str) {
        if arguments.is_empty() {
            self.entries.push(TranscriptEntry::System(format!(
                "Model: {} · use /model <name> or /model default",
                self.run_configuration.model.as_deref().unwrap_or("default")
            )));
            return;
        }
        self.run_configuration.model = (arguments != "default").then(|| arguments.to_owned());
        if self.run_configuration.model.is_some() {
            self.run_configuration.model_source = "manual".into();
            self.run_configuration.model_verification_status = "unverified".into();
        } else {
            self.run_configuration.model_source = "engine-default".into();
            self.run_configuration.model_verification_status = "not-required".into();
        }
        self.status_hint = format!("Next run: {}", self.run_configuration.summary());
    }

    fn append_model_params(&self, params: &mut serde_json::Map<String, Value>) {
        params.insert(
            "modelSource".into(),
            Value::String(self.run_configuration.model_source.clone()),
        );
        params.insert(
            "modelVerificationStatus".into(),
            Value::String(self.run_configuration.model_verification_status.clone()),
        );
        let Some(model) = &self.run_configuration.model else {
            params.insert("modelMode".into(), Value::String("fixed".into()));
            return;
        };
        if model.eq_ignore_ascii_case("auto") {
            params.insert("modelMode".into(), Value::String("auto".into()));
        } else {
            params.insert("modelMode".into(), Value::String("fixed".into()));
            params.insert("model".into(), Value::String(model.clone()));
        }
    }

    fn configure_agent(&mut self, arguments: &str) -> Vec<Effect> {
        if arguments.is_empty() {
            self.entries.push(TranscriptEntry::System(format!(
                "Current Agent: {} · querying installed adapters…",
                adapter_label(&self.run_configuration.adapter)
            )));
            let request = self.request("agent.list", json!({}));
            return vec![Effect::SendRuntime(request)];
        }
        let adapter = match arguments {
            "rux" | "codex" => "codex",
            "claude" | "claude-code" => "claude-code",
            "mock" if !self.runtime.connected_to_real_runtime => "mock",
            _ => {
                self.entries.push(TranscriptEntry::Error(
                    "Agent must be Rux or Claude Code (demo is local-only)".into(),
                ));
                return Vec::new();
            }
        };
        if self.run_configuration.adapter != adapter {
            self.run_configuration.adapter = adapter.into();
            self.run_configuration.profile_id = None;
            self.run_configuration.agent_revision_id = built_in_revision_id(adapter);
            self.run_configuration.provider_connection = default_provider_connection(adapter);
            self.run_configuration.session_id = None;
        }
        self.status_hint = format!("Next run: {}", self.run_configuration.summary());
        Vec::new()
    }

    fn configure_permission(&mut self, arguments: &str) {
        if arguments.is_empty() {
            self.entries.push(TranscriptEntry::System(format!(
                "Permission: {} · plan is read-only; acceptEdits asks before risky work; dontAsk never prompts",
                self.run_configuration.permission_mode
            )));
            return;
        }
        let permission = match arguments {
            "plan" | "read-only" => "plan",
            "acceptEdits" | "edit" => "acceptEdits",
            "dontAsk" | "never" => "dontAsk",
            _ => {
                self.entries.push(TranscriptEntry::Error(
                    "Permission must be plan, acceptEdits, or dontAsk".into(),
                ));
                return;
            }
        };
        self.run_configuration.permission_mode = permission.into();
        self.status_hint = format!("Next run: {}", self.run_configuration.summary());
    }

    fn configure_profile(&mut self, arguments: &str) -> Vec<Effect> {
        if arguments.is_empty() {
            self.entries.push(TranscriptEntry::System(
                "Querying custom Agent profiles… · select with /profile <id>".into(),
            ));
            let request = self.request("agent.profile.list", json!({}));
            return vec![Effect::SendRuntime(request)];
        }
        if arguments == "none" {
            self.run_configuration.profile_id = None;
            self.run_configuration.agent_revision_id =
                built_in_revision_id(&self.run_configuration.adapter);
            self.run_configuration.provider_connection =
                default_provider_connection(&self.run_configuration.adapter);
            self.run_configuration.session_id = None;
            self.status_hint = format!("Next run: {}", self.run_configuration.summary());
            return Vec::new();
        }
        let Some(selection) = self.profile_revisions.get(arguments).cloned() else {
            self.entries.push(TranscriptEntry::Error(
                "Unknown profile Revision; run /profile, then select a listed profile id".into(),
            ));
            return vec![Effect::SendRuntime(
                self.request("agent.profile.list", json!({})),
            )];
        };
        self.run_configuration.profile_id = Some(arguments.to_owned());
        self.run_configuration.adapter = selection.backend;
        self.run_configuration.agent_revision_id = selection.revision_id;
        self.run_configuration.provider_connection = selection.provider_connection;
        self.run_configuration.session_id = None;
        self.status_hint = format!("Next run: {}", self.run_configuration.summary());
        Vec::new()
    }

    fn create_profile(&mut self, arguments: &str) -> Vec<Effect> {
        let Ok(input) = serde_json::from_str::<Value>(arguments) else {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /profile-create {strict Agent JSON}".into(),
            ));
            return Vec::new();
        };
        vec![Effect::SendRuntime(
            self.request("agent.profile.create", input),
        )]
    }

    fn update_profile(&mut self, arguments: &str) -> Vec<Effect> {
        let Ok(input) = serde_json::from_str::<Value>(arguments) else {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /profile-update {\"id\":\"agent-id\",\"patch\":{...}}".into(),
            ));
            return Vec::new();
        };
        vec![Effect::SendRuntime(
            self.request("agent.profile.update", input),
        )]
    }

    fn preview_profile_delete(&mut self, id: &str) {
        if id.is_empty() {
            self.entries
                .push(TranscriptEntry::Error("Usage: /profile-delete <id>".into()));
            return;
        }
        self.pending_profile_delete = Some(id.into());
        self.entries.push(TranscriptEntry::System(format!("Agent Definition deletion preview: {id}. Historical immutable Revisions and Tasks remain. Type /profile-delete-confirm {id}")));
    }

    fn confirm_profile_delete(&mut self, id: &str) -> Vec<Effect> {
        if self.pending_profile_delete.as_deref() != Some(id) {
            self.entries.push(TranscriptEntry::Error(
                "Deletion confirmation must exactly match the pending Agent id".into(),
            ));
            return Vec::new();
        }
        self.pending_profile_delete = None;
        vec![Effect::SendRuntime(
            self.request("agent.profile.delete", json!({ "id": id })),
        )]
    }

    fn request_providers(&mut self) -> Vec<Effect> {
        self.entries.push(TranscriptEntry::System(
            "Inspecting official CLI status and available adapters; no credential files are read"
                .into(),
        ));
        vec![
            Effect::SendRuntime(self.request("auth.status", json!({}))),
            Effect::SendRuntime(self.request("agent.list", json!({ "refresh": true }))),
        ]
    }

    fn normalize_auth_provider(value: &str) -> Option<&'static str> {
        match value {
            "codex" | "chatgpt" => Some("chatgpt"),
            "claude" | "claude-code" => Some("claude-code"),
            _ => None,
        }
    }

    fn request_login(&mut self, provider: &str) -> Vec<Effect> {
        let Some(provider) = Self::normalize_auth_provider(provider) else {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /login codex|claude-code".into(),
            ));
            return Vec::new();
        };
        vec![Effect::SendRuntime(
            self.request("auth.login", json!({ "provider": provider })),
        )]
    }

    fn preview_logout(&mut self, provider: &str) {
        let Some(provider) = Self::normalize_auth_provider(provider) else {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /logout codex|claude-code".into(),
            ));
            return;
        };
        self.pending_logout = Some(provider.into());
        self.entries.push(TranscriptEntry::System(format!("Official {provider} logout preview: future Runs will be unavailable, local Tasks remain. Type /logout-confirm {provider}")));
    }

    fn confirm_logout(&mut self, provider: &str) -> Vec<Effect> {
        let Some(provider) = Self::normalize_auth_provider(provider) else {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /logout-confirm chatgpt|claude-code".into(),
            ));
            return Vec::new();
        };
        if self.pending_logout.as_deref() != Some(provider) {
            self.entries.push(TranscriptEntry::Error(
                "Logout confirmation must exactly match the pending Provider".into(),
            ));
            return Vec::new();
        }
        self.pending_logout = None;
        vec![Effect::SendRuntime(
            self.request("auth.logout", json!({ "provider": provider })),
        )]
    }

    fn request_models(&mut self) -> Vec<Effect> {
        vec![Effect::SendRuntime(self.request(
            "agent.model.list",
            json!({ "adapter": "codex", "refresh": true }),
        ))]
    }

    fn request_sessions(&mut self, engine: &str) -> Vec<Effect> {
        let engine = match engine {
            "codex" | "" => "codex",
            "claude" | "claude-code" => "claude-code",
            _ => {
                self.entries.push(TranscriptEntry::Error(
                    "Usage: /sessions codex|claude-code".into(),
                ));
                return Vec::new();
            }
        };
        let Some(workspace_id) = self.workspace_id.clone() else {
            self.entries.push(TranscriptEntry::Error(
                "Shared Workspace identity is not loaded yet".into(),
            ));
            return Vec::new();
        };
        let operation_id = format!("tui-session-discover-{}", new_run_id());
        vec![Effect::SendRuntime(self.request(
            "session.discover",
            json!({
                "operationId": operation_id,
                "engine": engine,
                "providerConnection": default_provider_connection(engine),
                "activeWorkspaceId": workspace_id,
                "limit": 100
            }),
        ))]
    }

    fn request_session_preview(&mut self, native_session_id: &str) -> Vec<Effect> {
        let Some(session) = self.discovered_sessions.get(native_session_id).cloned() else {
            self.entries.push(TranscriptEntry::Error(
                "Unknown Session id; run /sessions first".into(),
            ));
            return Vec::new();
        };
        let Some(workspace_id) = self.workspace_id.clone() else {
            return Vec::new();
        };
        self.status_hint = format!("Reading bounded normalized preview for {}…", session.title);
        vec![Effect::SendRuntime(self.request(
            "session.preview",
            json!({
                "operationId": format!("tui-session-preview-{}", new_run_id()),
                "engine": session.engine,
                "providerConnection": session.provider_connection,
                "activeWorkspaceId": workspace_id,
                "nativeSessionId": session.native_session_id,
                "limit": 100
            }),
        ))]
    }

    fn request_session_import(&mut self, arguments: &str) -> Vec<Effect> {
        let mut parts = arguments.split_whitespace();
        let native_session_id = parts.next().unwrap_or_default();
        let mode = parts.next().unwrap_or("view");
        if !matches!(mode, "view" | "continue") || parts.next().is_some() {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /session-import <native-session-id> view|continue".into(),
            ));
            return Vec::new();
        }
        let Some(session) = self.discovered_sessions.get(native_session_id).cloned() else {
            self.entries.push(TranscriptEntry::Error(
                "Unknown Session id; run /sessions first".into(),
            ));
            return Vec::new();
        };
        let Some(workspace_id) = self.workspace_id.clone() else {
            return Vec::new();
        };
        vec![Effect::SendRuntime(self.request(
            "session.import",
            json!({
                "operationId": format!("tui-session-import-{}", new_run_id()),
                "engine": session.engine,
                "providerConnection": session.provider_connection,
                "activeWorkspaceId": workspace_id,
                "nativeSessionId": session.native_session_id,
                "limit": 100,
                "mode": mode
            }),
        ))]
    }

    fn request_session_refresh(&mut self) -> Vec<Effect> {
        let Some(task_id) = self.active_task_id.clone() else {
            self.entries
                .push(TranscriptEntry::Error("Open an imported Task first".into()));
            return Vec::new();
        };
        vec![Effect::SendRuntime(self.request("session.refresh", json!({ "taskId": task_id, "operationId": format!("tui-session-refresh-{}", new_run_id()) })))]
    }

    fn confirm_session_rebuild(&mut self, revision_id: &str) -> Vec<Effect> {
        let Some(candidate) = self.pending_session_candidate.clone() else {
            self.entries.push(TranscriptEntry::Error(
                "No candidate Projection Revision is pending".into(),
            ));
            return Vec::new();
        };
        if revision_id != candidate {
            self.entries.push(TranscriptEntry::Error(
                "Rebuild confirmation must exactly match the candidate Revision".into(),
            ));
            return Vec::new();
        }
        let Some(task_id) = self.active_task_id.clone() else {
            return Vec::new();
        };
        self.pending_session_candidate = None;
        vec![Effect::SendRuntime(self.request(
            "session.rebuild",
            json!({ "taskId": task_id, "candidateRevisionId": candidate, "confirmed": true }),
        ))]
    }

    fn request_session_revisions(&mut self) -> Vec<Effect> {
        let Some(task_id) = self.active_task_id.clone() else {
            self.entries
                .push(TranscriptEntry::Error("Open an imported Task first".into()));
            return Vec::new();
        };
        vec![Effect::SendRuntime(self.request(
            "session.revision.list",
            json!({ "taskId": task_id }),
        ))]
    }

    fn preview_session_restore(&mut self, revision_id: &str) {
        if revision_id.is_empty() {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /session-restore <revision-id>".into(),
            ));
            return;
        }
        self.pending_session_restore = Some(revision_id.into());
        self.entries.push(TranscriptEntry::System(format!("Local Projection restore preview: activate immutable Revision {revision_id}; Rux-owned Runs, approvals and Handoffs remain, Provider Session is untouched. Type /session-restore-confirm {revision_id}")));
    }

    fn confirm_session_restore(&mut self, revision_id: &str) -> Vec<Effect> {
        if self.pending_session_restore.as_deref() != Some(revision_id) {
            self.entries.push(TranscriptEntry::Error(
                "Restore confirmation must exactly match the previewed Revision".into(),
            ));
            return Vec::new();
        }
        let Some(task_id) = self.active_task_id.clone() else {
            return Vec::new();
        };
        self.pending_session_restore = None;
        vec![Effect::SendRuntime(self.request(
            "session.revision.restore",
            json!({ "taskId": task_id, "revisionId": revision_id, "confirmed": true }),
        ))]
    }

    fn request_branches(&mut self) -> Vec<Effect> {
        vec![Effect::SendRuntime(
            self.request("git.branches.list", json!({})),
        )]
    }

    fn request_branch_switch(&mut self, branch: &str) -> Vec<Effect> {
        if branch.is_empty() {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /switch <local-branch>".into(),
            ));
            return Vec::new();
        }
        vec![Effect::SendRuntime(
            self.request("git.branch.switch", json!({ "branch": branch })),
        )]
    }

    fn parse_worktree_arguments(arguments: &str) -> Option<(String, String)> {
        let (path, branch) = arguments.trim().rsplit_once(' ')?;
        let path = path.trim();
        let branch = branch.trim();
        (!path.is_empty() && !branch.is_empty()).then(|| (path.into(), branch.into()))
    }

    fn preview_worktree_create(&mut self, arguments: &str) {
        let Some((path, branch)) = Self::parse_worktree_arguments(arguments) else {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /worktree <absolute-path> <local-branch>".into(),
            ));
            return;
        };
        if !Path::new(&path).is_absolute() {
            self.entries.push(TranscriptEntry::Error(
                "Worktree target must be an absolute path".into(),
            ));
            return;
        }
        self.pending_worktree = Some((path.clone(), branch.clone()));
        self.entries.push(TranscriptEntry::System(format!(
            "Worktree creation preview: Git will create {path} on local branch {branch}. The target must not exist; an occupied branch, Git metadata path, active Run, or Terminal mutation lock fails closed. Type /worktree-confirm {path} {branch}"
        )));
    }

    fn confirm_worktree_create(&mut self, arguments: &str) -> Vec<Effect> {
        let Some((path, branch)) = Self::parse_worktree_arguments(arguments) else {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /worktree-confirm <absolute-path> <local-branch>".into(),
            ));
            return Vec::new();
        };
        if self.pending_worktree.as_ref() != Some(&(path.clone(), branch.clone())) {
            self.entries.push(TranscriptEntry::Error(
                "Worktree confirmation must exactly match the previewed path and branch".into(),
            ));
            return Vec::new();
        }
        self.pending_worktree = None;
        vec![Effect::SendRuntime(self.request(
            "git.worktree.create",
            json!({ "path": path, "branch": branch, "confirmed": true }),
        ))]
    }

    fn request_branch_compare(&mut self, base: &str) -> Vec<Effect> {
        if base.is_empty() {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /compare <base-branch>".into(),
            ));
            return Vec::new();
        }
        vec![Effect::SendRuntime(
            self.request("git.compare", json!({ "base": base })),
        )]
    }

    fn request_commit(&mut self, message: &str) -> Vec<Effect> {
        if message.trim().is_empty() {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /commit <message>; only already-staged changes are committed".into(),
            ));
            return Vec::new();
        }
        vec![Effect::SendRuntime(
            self.request("git.commit", json!({ "message": message })),
        )]
    }

    fn preview_push(&mut self) {
        self.pending_push = true;
        self.entries.push(TranscriptEntry::System("Push preview: only the current branch is sent to its already-configured upstream; no upstream is created and force-push is forbidden. Type /push-confirm".into()));
    }

    fn confirm_push(&mut self) -> Vec<Effect> {
        if !self.pending_push {
            self.entries.push(TranscriptEntry::Error(
                "No push preview is pending; run /push first".into(),
            ));
            return Vec::new();
        }
        self.pending_push = false;
        vec![Effect::SendRuntime(
            self.request("git.push", json!({ "confirmed": true })),
        )]
    }

    fn request_handoff(&mut self, target_agent_id: &str) -> Vec<Effect> {
        let Some(source_task_id) = self.active_task_id.clone() else {
            self.entries.push(TranscriptEntry::Error(
                "Open a persisted source Task before Handoff".into(),
            ));
            return Vec::new();
        };
        let (persisted_message_ids, persisted_file_paths) =
            self.persistence.active_handoff_sources();
        if !persisted_message_ids.is_empty() {
            self.handoff_message_ids = persisted_message_ids;
            self.handoff_file_paths = persisted_file_paths;
        }
        if target_agent_id.is_empty() || self.handoff_message_ids.is_empty() {
            self.entries.push(TranscriptEntry::Error("Usage: /handoff <target-agent-id>; the source Task must contain persisted messages".into()));
            return Vec::new();
        }
        self.handoff_target_request = Some(target_agent_id.into());
        let message_ids = self
            .handoff_message_ids
            .iter()
            .rev()
            .take(20)
            .cloned()
            .collect::<Vec<_>>();
        let file_paths = self.handoff_file_paths.clone();
        vec![Effect::SendRuntime(self.request(
            "handoff.preview",
            json!({
                "sourceTaskId": source_task_id,
                "targetAgentId": target_agent_id,
                "messageIds": message_ids,
                "filePaths": file_paths
            }),
        ))]
    }

    fn confirm_handoff(&mut self, target_agent_id: &str) -> Vec<Effect> {
        let Some(pending) = self.pending_handoff.clone() else {
            self.entries.push(TranscriptEntry::Error(
                "No Handoff preview is pending".into(),
            ));
            return Vec::new();
        };
        if target_agent_id != pending.target_agent_id {
            self.entries.push(TranscriptEntry::Error(
                "Handoff confirmation must exactly match the previewed target Agent".into(),
            ));
            return Vec::new();
        }
        let Some(source_task_id) = self.active_task_id.clone() else {
            return Vec::new();
        };
        self.pending_handoff = None;
        let mut params = json!({
            "sourceTaskId": source_task_id,
            "targetAgentId": pending.target_agent_id,
            "messageIds": pending.message_ids,
            "filePaths": pending.file_paths,
            "fingerprint": pending.fingerprint,
            "confirmed": true
        });
        if let Some(object) = params.as_object_mut() {
            if let Some(summary) = pending.agent_summary {
                object.insert("agentSummary".into(), Value::String(summary));
            }
            if let Some(generation_id) = pending.agent_summary_generation_id {
                object.insert(
                    "agentSummaryGenerationId".into(),
                    Value::String(generation_id),
                );
            }
        }
        vec![Effect::SendRuntime(self.request("handoff.commit", params))]
    }

    fn request_handoff_summary(&mut self) -> Vec<Effect> {
        let Some(source_task_id) = self.active_task_id.clone() else {
            self.entries.push(TranscriptEntry::Error(
                "Open a persisted source Task before generating a Handoff summary".into(),
            ));
            return Vec::new();
        };
        let Some(pending) = self.pending_handoff.as_ref() else {
            self.entries.push(TranscriptEntry::Error(
                "Run /handoff <target-agent-id> and review its deterministic preview first".into(),
            ));
            return Vec::new();
        };
        vec![Effect::SendRuntime(self.request(
            "handoff.summary.generate",
            json!({
                "sourceTaskId": source_task_id,
                "targetAgentId": pending.target_agent_id,
                "messageIds": pending.message_ids,
                "filePaths": pending.file_paths,
                "fingerprint": pending.fingerprint,
            }),
        ))]
    }

    fn set_handoff_summary(&mut self, text: &str) {
        let Some(pending) = self.pending_handoff.as_mut() else {
            self.entries.push(TranscriptEntry::Error(
                "No Handoff preview is pending".into(),
            ));
            return;
        };
        if text.trim().eq_ignore_ascii_case("none") {
            pending.agent_summary = None;
            pending.agent_summary_generation_id = None;
            self.entries.push(TranscriptEntry::System(
                "Optional Handoff summary removed; deterministic facts remain".into(),
            ));
        } else if text.trim().is_empty() {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /handoff-summary-set <reviewed text>|none".into(),
            ));
        } else {
            pending.agent_summary = Some(text.trim().into());
            self.entries.push(TranscriptEntry::System(
                "Pending Handoff summary edited locally; review it before confirmation".into(),
            ));
        }
    }

    fn request_local_data_preview(&mut self, arguments: &str) -> Vec<Effect> {
        let mut parts = arguments.split_whitespace();
        let action = parts.next().unwrap_or_default();
        let scope = parts.next().unwrap_or("task");
        if !matches!(action, "unlink" | "remove-imported" | "delete-task")
            || !matches!(scope, "task" | "workspace")
            || parts.next().is_some()
        {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /data-preview unlink|remove-imported|delete-task [task|workspace]".into(),
            ));
            return Vec::new();
        }
        let task_id = (scope == "task")
            .then(|| self.active_task_id.clone())
            .flatten();
        if scope == "task" && task_id.is_none() {
            self.entries.push(TranscriptEntry::Error(
                "Task-scoped data action requires an open persisted Task".into(),
            ));
            return Vec::new();
        }
        let mut params = json!({ "scope": scope, "action": action });
        if let Some(task_id) = task_id
            && let Some(object) = params.as_object_mut()
        {
            object.insert("taskId".into(), Value::String(task_id));
        }
        vec![Effect::SendRuntime(
            self.request("local.data.preview", params),
        )]
    }

    fn confirm_local_data(&mut self, action: &str) -> Vec<Effect> {
        let Some(pending) = self.pending_local_data.clone() else {
            self.entries.push(TranscriptEntry::Error(
                "No local-data impact preview is pending".into(),
            ));
            return Vec::new();
        };
        if action != pending.action {
            self.entries.push(TranscriptEntry::Error(
                "Local-data confirmation must exactly match the previewed action".into(),
            ));
            return Vec::new();
        }
        self.pending_local_data = None;
        let mut params = json!({ "scope": pending.scope, "action": pending.action, "fingerprint": pending.fingerprint, "confirmed": true });
        if let Some(task_id) = pending.task_id
            && let Some(object) = params.as_object_mut()
        {
            object.insert("taskId".into(), Value::String(task_id));
        }
        vec![Effect::SendRuntime(
            self.request("local.data.execute", params),
        )]
    }

    fn preview_data_export(&mut self, arguments: &str) {
        if self.export_params(arguments).is_none() {
            return;
        }
        self.pending_data_export = Some(arguments.into());
        self.entries.push(TranscriptEntry::System(format!("Sensitive export preview: prompts, messages, file content and command output may be written to the Workspace path in this request. Credentials are structurally excluded. Type /data-export-confirm {arguments}")));
    }

    fn confirm_data_export(&mut self, arguments: &str) -> Vec<Effect> {
        if self.pending_data_export.as_deref() != Some(arguments) {
            self.entries.push(TranscriptEntry::Error("Export confirmation must exactly match the pending scope, format, Revision range and destination".into()));
            return Vec::new();
        }
        let Some(params) = self.export_params(arguments) else {
            return Vec::new();
        };
        self.pending_data_export = None;
        vec![Effect::SendRuntime(
            self.request("local.data.export", params),
        )]
    }

    fn export_params(&mut self, arguments: &str) -> Option<Value> {
        let mut parts = arguments.split_whitespace();
        let scope = parts.next().unwrap_or_default();
        let format = parts.next().unwrap_or_default();
        let revisions = parts.next().unwrap_or_default();
        let destination = parts.next().unwrap_or_default();
        if !matches!(scope, "task" | "workspace")
            || !matches!(format, "markdown" | "json")
            || !matches!(revisions, "current" | "all")
            || destination.is_empty()
            || parts.next().is_some()
        {
            self.entries.push(TranscriptEntry::Error("Usage: /data-export task|workspace markdown|json current|all <new-workspace-relative-path>".into()));
            return None;
        }
        let task_id = (scope == "task")
            .then(|| self.active_task_id.clone())
            .flatten();
        if scope == "task" && task_id.is_none() {
            self.entries.push(TranscriptEntry::Error(
                "Task-scoped export requires an open persisted Task".into(),
            ));
            return None;
        }
        let mut params = json!({ "scope": scope, "format": format, "revisions": revisions, "destination": destination, "confirmedSensitiveContent": true });
        if let Some(task_id) = task_id
            && let Some(object) = params.as_object_mut()
        {
            object.insert("taskId".into(), Value::String(task_id));
        }
        Some(params)
    }

    fn request_changes(&mut self) -> Vec<Effect> {
        self.status_hint = "Refreshing real Git workspace changes…".into();
        let request = self.request("changes.list", json!({}));
        vec![Effect::SendRuntime(request)]
    }

    fn request_diff(&mut self, path: &str) -> Vec<Effect> {
        if path.is_empty() {
            self.entries
                .push(TranscriptEntry::Error("Usage: /diff <changed path>".into()));
            return Vec::new();
        }
        let Some(snapshot_id) = self.changes_snapshot_id.clone() else {
            self.entries.push(TranscriptEntry::Error(
                "Run /changes before requesting a diff".into(),
            ));
            return Vec::new();
        };
        let request = self.request(
            "changes.diff",
            json!({ "path": path, "expectedSnapshotId": snapshot_id }),
        );
        vec![Effect::SendRuntime(request)]
    }

    fn request_context(&mut self, arguments: &str) -> Vec<Effect> {
        let selected_files = if arguments.trim().is_empty() {
            self.changed_paths
                .iter()
                .take(200)
                .cloned()
                .collect::<Vec<_>>()
        } else {
            arguments
                .split_whitespace()
                .take(200)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        };
        let request = self.request(
            "context.snapshot",
            json!({ "selectedFiles": selected_files }),
        );
        vec![Effect::SendRuntime(request)]
    }

    fn run_review_selection(&mut self, run_id: &str, path: Option<&str>) -> Option<Value> {
        let Some(source) = self.run_review_sources.get(run_id) else {
            self.entries.push(TranscriptEntry::Error(format!(
                "Run-owned patch not found for {run_id}; open the persisted Task or wait for its patch evidence"
            )));
            return None;
        };
        let mut params = json!({
            "baseline": source.baseline,
            "patch": source.patch,
            "expectedSnapshotId": source.expected_snapshot_id,
        });
        if let Some(path) = path
            && let Some(object) = params.as_object_mut()
        {
            object.insert("paths".into(), json!([path]));
        }
        Some(params)
    }

    fn request_run_diff(&mut self, arguments: &str) -> Vec<Effect> {
        let mut parts = arguments.split_whitespace();
        let run_id = parts.next().unwrap_or_default();
        let path = parts.next().unwrap_or_default();
        if run_id.is_empty() || path.is_empty() || parts.next().is_some() {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /run-diff <run-id> <path>".into(),
            ));
            return Vec::new();
        }
        let Some(mut params) = self.run_review_selection(run_id, None) else {
            return Vec::new();
        };
        params
            .as_object_mut()
            .expect("selection is an object")
            .insert("path".into(), Value::String(path.into()));
        vec![Effect::SendRuntime(
            self.request("run.changes.diff", params),
        )]
    }

    fn request_run_accept(&mut self, arguments: &str) -> Vec<Effect> {
        let mut parts = arguments.split_whitespace();
        let run_id = parts.next().unwrap_or_default();
        let path = parts.next();
        if run_id.is_empty() || parts.next().is_some() {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /run-accept <run-id> [path]".into(),
            ));
            return Vec::new();
        }
        let Some(params) = self.run_review_selection(run_id, path) else {
            return Vec::new();
        };
        vec![Effect::SendRuntime(
            self.request("run.changes.accept", params),
        )]
    }

    fn request_run_restore_preview(&mut self, arguments: &str) -> Vec<Effect> {
        let mut parts = arguments.split_whitespace();
        let run_id = parts.next().unwrap_or_default();
        let path = parts.next();
        if run_id.is_empty() || parts.next().is_some() {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /run-restore <run-id> [path] (preview only)".into(),
            ));
            return Vec::new();
        }
        let Some(params) = self.run_review_selection(run_id, path) else {
            return Vec::new();
        };
        self.run_restore_preview_request = Some((arguments.trim().into(), params.clone()));
        vec![Effect::SendRuntime(
            self.request("run.changes.previewRestore", params),
        )]
    }

    fn request_run_restore_confirm(&mut self, arguments: &str) -> Vec<Effect> {
        let Some((expected, mut params)) = self.pending_run_restore.clone() else {
            self.entries.push(TranscriptEntry::Error(
                "No successful Run-owned restore preview is pending".into(),
            ));
            return Vec::new();
        };
        if arguments.trim() != expected {
            self.entries.push(TranscriptEntry::Error(
                "Run restore confirmation must exactly match the successful preview".into(),
            ));
            return Vec::new();
        }
        params
            .as_object_mut()
            .expect("selection is an object")
            .insert("confirmed".into(), Value::Bool(true));
        self.pending_run_restore = None;
        vec![Effect::SendRuntime(
            self.request("run.changes.restore", params),
        )]
    }

    fn request_accept(&mut self) -> Vec<Effect> {
        let Some(snapshot_id) = self.changes_snapshot_id.clone() else {
            self.entries.push(TranscriptEntry::Error(
                "Run /changes before recording review acceptance".into(),
            ));
            return Vec::new();
        };
        let request = self.request(
            "changes.accept",
            json!({ "scope": "all", "expectedSnapshotId": snapshot_id }),
        );
        vec![Effect::SendRuntime(request)]
    }

    fn request_restore_preview(&mut self, path: &str) -> Vec<Effect> {
        if path.is_empty() {
            self.entries.push(TranscriptEntry::Error(
                "Usage: /restore <changed path> (preview only)".into(),
            ));
            return Vec::new();
        }
        let Some(snapshot_id) = self.changes_snapshot_id.clone() else {
            self.entries.push(TranscriptEntry::Error(
                "Run /changes before requesting a restore preview".into(),
            ));
            return Vec::new();
        };
        let request = self.request(
            "changes.previewRestore",
            json!({ "scope": "file", "path": path, "expectedSnapshotId": snapshot_id }),
        );
        vec![Effect::SendRuntime(request)]
    }

    fn request_restore_confirm(&mut self, path: &str) -> Vec<Effect> {
        let Some((preview_path, snapshot_id)) = self.pending_restore.clone() else {
            self.entries.push(TranscriptEntry::Error(
                "No restore preview is pending; use /restore <path> first".into(),
            ));
            return Vec::new();
        };
        if path != preview_path {
            self.entries.push(TranscriptEntry::Error(format!(
                "Confirmation path must exactly match the preview: {preview_path}"
            )));
            return Vec::new();
        }
        let request = self.request(
            "changes.restore",
            json!({
                "scope": "file",
                "path": preview_path,
                "expectedSnapshotId": snapshot_id,
                "confirmed": true
            }),
        );
        vec![Effect::SendRuntime(request)]
    }

    fn cancel(&mut self) -> Vec<Effect> {
        if !self.composer.is_empty() {
            self.clear_composer();
            self.status_hint =
                "Draft cleared; press Ctrl+C again with an empty composer to cancel".into();
            return Vec::new();
        }
        if matches!(self.run_state, RunState::WaitingPermission { .. }) {
            return self.decide_permission(2);
        }
        if matches!(self.run_state, RunState::DecidingPermission { .. }) {
            self.status_hint = "Permission decision is already in flight".into();
            return Vec::new();
        }

        let Some(run_id) = self.run_state.run_id().map(ToOwned::to_owned) else {
            self.status_hint = "Nothing is running · use /quit to exit".into();
            return Vec::new();
        };
        self.run_state = RunState::Cancelling {
            run_id: run_id.clone(),
        };
        self.status_hint = "Cancellation requested…".into();
        let request = self.request("run.cancel", json!({ "runId": run_id }));
        vec![Effect::SendRuntime(request)]
    }

    fn permission_shortcut(&mut self, character: char) -> Vec<Effect> {
        let selected = match character.to_ascii_lowercase() {
            'a' => 0,
            'd' => 1,
            's' => 2,
            _ => {
                self.status_hint =
                    "Permission is blocking this Run · use A approve, D deny, or S stop".into();
                return Vec::new();
            }
        };
        if let Some(Overlay::Permission {
            selected: current, ..
        }) = &mut self.overlay
        {
            *current = selected;
        }
        self.decide_permission(selected)
    }

    fn decide_permission(&mut self, selected: usize) -> Vec<Effect> {
        if matches!(
            self.run_state,
            RunState::DecidingPermission { .. } | RunState::Cancelling { .. }
        ) {
            self.status_hint = "Permission decision already submitted…".into();
            return Vec::new();
        }
        let Some(permission) = self.pending_permission.clone() else {
            self.overlay = None;
            self.status_hint = "Permission request is no longer pending".into();
            return Vec::new();
        };
        if selected == 2 {
            self.run_state = RunState::Cancelling {
                run_id: permission.run_id.clone(),
            };
            self.status_hint =
                "Stopping before approval · Runtime will record a cancelled decision".into();
            let request = self.request("run.cancel", json!({ "runId": permission.run_id }));
            return vec![Effect::SendRuntime(request)];
        }
        let decision = if selected == 0 { "approved" } else { "denied" };
        self.run_state = RunState::DecidingPermission {
            run_id: permission.run_id.clone(),
            request_id: permission.id.clone(),
            decision: decision.into(),
        };
        self.status_hint = format!("Submitting {decision} for this Run only…");
        let request = self.request(
            "permission.decide",
            json!({
                "runId": permission.run_id,
                "requestId": permission.id,
                "decision": decision,
            }),
        );
        vec![Effect::SendRuntime(request)]
    }

    fn toggle_task_history(&mut self) {
        if matches!(self.overlay, Some(Overlay::TaskHistory { .. })) {
            self.overlay = None;
            self.status_hint = "Task history closed".into();
        } else {
            self.open_task_history();
        }
    }

    fn open_task_history(&mut self) {
        if !matches!(self.run_state, RunState::Idle) {
            self.status_hint = "Task switching is locked while a Run is active".into();
            return;
        }
        if self.runtime.connected_to_real_runtime && !self.persistence.is_loaded() {
            self.status_hint = "Loading shared Desktop/TUI task history…".into();
            return;
        }
        let items = self.persistence.task_summaries();
        let selected = self.active_task_id.as_deref().map_or(0, |active_id| {
            items
                .iter()
                .position(|task| task.id == active_id)
                .unwrap_or_default()
        });
        self.status_hint = if items.is_empty() {
            "No persisted Tasks yet · send a prompt to create one".into()
        } else {
            format!(
                "{} persisted Task(s) · ↑↓ browse · Enter opens",
                items.len()
            )
        };
        self.overlay = Some(Overlay::TaskHistory { items, selected });
    }

    fn select_task_from_overlay(&mut self) {
        if !matches!(self.run_state, RunState::Idle) {
            self.status_hint = "Task switching is locked while a Run is active".into();
            return;
        }
        if !self.composer.is_empty() {
            self.status_hint =
                "Draft kept in the current Task · send or clear it before switching".into();
            return;
        }
        let task_id = match &self.overlay {
            Some(Overlay::TaskHistory { items, selected }) => {
                items.get(*selected).map(|task| task.id.clone())
            }
            _ => None,
        };
        let Some(task_id) = task_id else {
            self.status_hint = "No persisted Task selected".into();
            return;
        };
        match self.persistence.select_task(&task_id) {
            Ok(task) => {
                self.overlay = None;
                self.reset_task_transients();
                self.hydrate_task(task);
            }
            Err(error) => {
                self.overlay = None;
                self.entries.push(TranscriptEntry::Error(format!(
                    "Unable to open persisted Task: {error}"
                )));
            }
        }
    }

    fn toggle_evidence(&mut self) {
        if matches!(
            self.run_state,
            RunState::WaitingPermission { .. } | RunState::DecidingPermission { .. }
        ) {
            self.status_hint =
                "Resolve the blocking Permission before opening other inspectors".into();
            return;
        }
        if matches!(self.overlay, Some(Overlay::Evidence { .. })) {
            self.overlay = None;
            self.status_hint = "Evidence inspector closed".into();
        } else {
            self.open_evidence();
        }
    }

    fn open_evidence(&mut self) {
        let items = self.evidence.clone();
        self.status_hint = if items.is_empty() {
            "No structured Verification or Run-owned change evidence for this Task".into()
        } else {
            format!(
                "{} evidence record(s) · Enter expands · unknown remains unknown",
                items.len()
            )
        };
        self.overlay = Some(Overlay::Evidence {
            items,
            selected: 0,
            expanded: false,
            detail_scroll: 0,
        });
    }

    fn page_evidence_or_scrollback(&mut self, up: bool) {
        if let Some(Overlay::Evidence {
            expanded: true,
            detail_scroll,
            ..
        }) = &mut self.overlay
        {
            if up {
                *detail_scroll = detail_scroll.saturating_sub(8);
            } else {
                *detail_scroll = detail_scroll.saturating_add(8);
            }
            return;
        }
        if up {
            self.scroll_from_bottom = self.scroll_from_bottom.saturating_add(8);
        } else {
            self.scroll_from_bottom = self.scroll_from_bottom.saturating_sub(8);
        }
    }

    fn reset_task_transients(&mut self) {
        self.changes_snapshot_id = None;
        self.changed_paths.clear();
        self.pending_restore = None;
        self.pending_permission = None;
        self.run_review_sources.clear();
        self.pending_run_baselines.clear();
        self.run_restore_preview_request = None;
        self.pending_run_restore = None;
        self.handoff_message_ids.clear();
        self.handoff_file_paths.clear();
        self.handoff_target_request = None;
        self.pending_handoff = None;
        self.scroll_from_bottom = 0;
    }

    fn escape(&mut self, at_ms: u64) {
        if matches!(self.overlay, Some(Overlay::Permission { .. })) {
            self.pending_escape = None;
            self.status_hint =
                "Permission is blocking this Run · approve, deny, or stop before continuing".into();
            return;
        }
        if self.overlay.is_some() {
            self.overlay = None;
            self.pending_escape = None;
            self.status_hint = "Overlay closed".into();
            return;
        }
        if !matches!(self.run_state, RunState::Idle) {
            self.pending_escape = None;
            self.status_hint = "Esc does not cancel a run · use Ctrl+C".into();
            return;
        }

        let intent = if self.focus == Focus::Composer && !self.composer.is_empty() {
            Some(EscapeIntent::Clear)
        } else if self.composer.is_empty()
            && self
                .entries
                .iter()
                .any(|entry| matches!(entry, TranscriptEntry::User(_)))
        {
            Some(EscapeIntent::Rewind)
        } else {
            None
        };
        let Some(intent) = intent else {
            self.pending_escape = None;
            return;
        };

        if self.pending_escape.is_some_and(|(pending, armed)| {
            pending == intent && at_ms.saturating_sub(armed) <= ESC_DOUBLE_PRESS_MS
        }) {
            self.pending_escape = None;
            match intent {
                EscapeIntent::Clear => {
                    self.clear_composer();
                    self.status_hint = "Draft cleared".into();
                }
                EscapeIntent::Rewind => self.open_rewind(),
            }
        } else {
            self.pending_escape = Some((intent, at_ms));
            if intent == EscapeIntent::Clear {
                self.status_hint = "Esc again within 800ms to clear draft".into();
            }
        }
    }

    fn open_rewind(&mut self) {
        let points: Vec<RewindPoint> = self
            .entries
            .iter()
            .enumerate()
            .filter_map(|(entry_index, entry)| match entry {
                TranscriptEntry::User(text) => Some(RewindPoint {
                    entry_index,
                    label: truncate(text, 58),
                }),
                _ => None,
            })
            .collect();
        self.overlay = Some(Overlay::Rewind {
            selected: points.len().saturating_sub(1),
            points,
        });
        self.status_hint =
            "Rewind preview only · file/history restore waits for the real Runtime".into();
    }

    fn refresh_overlay(&mut self) {
        let prefix: String = self.composer.iter().take(self.cursor).collect();
        if prefix.starts_with('/') && !prefix.contains(char::is_whitespace) {
            let query = prefix.trim_start_matches('/').to_lowercase();
            let items = COMMANDS
                .iter()
                .filter(|command| command.name.contains(&query))
                .map(|command| Suggestion {
                    value: command.name.into(),
                    description: command.description.into(),
                })
                .collect();
            self.overlay = Some(Overlay::Commands { items, selected: 0 });
            return;
        }

        let token_start = prefix
            .char_indices()
            .rev()
            .find_map(|(index, character)| character.is_whitespace().then_some(index + 1))
            .unwrap_or(0);
        let token = &prefix[token_start..];
        if let Some(query) = token.strip_prefix('@') {
            let character_start = prefix[..token_start].chars().count();
            let items = self.file_index.search(query);
            self.overlay = Some(Overlay::Files {
                items,
                selected: 0,
                token_start: character_start,
            });
            return;
        }
        self.overlay = None;
    }

    fn accept_suggestion(&mut self) {
        match self.overlay.take() {
            Some(Overlay::Commands { items, selected }) => {
                if let Some(item) = items.get(selected) {
                    self.composer = format!("/{}", item.value).chars().collect();
                    self.cursor = self.composer.len();
                }
            }
            Some(Overlay::Files {
                items,
                selected,
                token_start,
            }) => {
                if let Some(item) = items.get(selected) {
                    self.composer.splice(
                        token_start..self.cursor,
                        format!("@{} ", item.value).chars(),
                    );
                    self.cursor = token_start + item.value.chars().count() + 2;
                }
            }
            Some(
                overlay @ (Overlay::Rewind { .. }
                | Overlay::TaskHistory { .. }
                | Overlay::Evidence { .. }
                | Overlay::Permission { .. }),
            ) => self.overlay = Some(overlay),
            None => {}
        }
    }

    fn clear_composer(&mut self) {
        self.composer.clear();
        self.cursor = 0;
        self.overlay = None;
    }

    fn request(&mut self, method: &str, params: Value) -> RuntimeRequest {
        let id = format!("tui-request-{}", self.next_request_number);
        self.next_request_number += 1;
        self.pending_requests.insert(id.clone(), method.into());
        RuntimeRequest::new(id, method, params)
    }

    fn apply_runtime(&mut self, message: RuntimeWireMessage) -> Vec<Effect> {
        match message {
            RuntimeWireMessage::Response {
                id,
                ok: false,
                error,
                ..
            } => {
                let method = self.pending_requests.remove(&id);
                let error_message = error.as_ref().map_or_else(
                    || "Runtime request failed".into(),
                    |error| error.message.clone(),
                );
                if method.as_deref() == Some("run.start") {
                    if let Some(run_id) = self.run_state.run_id().map(ToOwned::to_owned) {
                        let failed = RuntimeEvent::new(
                            "run.failed",
                            BTreeMap::from([
                                ("runId".into(), Value::String(run_id)),
                                ("error".into(), Value::String(error_message.clone())),
                            ]),
                        );
                        let settings = self.persistence_settings();
                        self.persistence.record_event(&failed, &settings);
                    }
                    self.run_state = RunState::Idle;
                }
                if matches!(method.as_deref(), Some("permission.decide" | "run.cancel"))
                    && let Some(permission) = self.pending_permission.clone()
                {
                    self.show_pending_permission(&permission, true);
                    self.status_hint =
                        "Permission decision failed; request is still pending · retry safely"
                            .into();
                }
                self.entries.push(TranscriptEntry::Error(error_message));
                return self.persistence_effect().into_iter().collect();
            }
            RuntimeWireMessage::Response {
                id,
                ok: true,
                result,
                ..
            } => {
                let method = self.pending_requests.remove(&id);
                self.apply_response(method.as_deref(), result.as_ref());
                if matches!(
                    method.as_deref(),
                    Some(
                        "session.import"
                            | "session.rebuild"
                            | "session.revision.restore"
                            | "handoff.commit"
                            | "local.data.execute"
                    )
                ) {
                    return vec![Effect::SendRuntime(
                        self.request("task.state.load", json!({})),
                    )];
                }
                if method.as_deref() == Some("changes.accept") {
                    return self.persistence_effect().into_iter().collect();
                }
            }
            RuntimeWireMessage::Event { event } => {
                self.apply_event(&event);
                if event.string("runId").is_some() {
                    let settings = self.persistence_settings();
                    self.persistence.record_event(&event, &settings);
                    return self.persistence_effect().into_iter().collect();
                }
            }
        }
        Vec::new()
    }

    #[allow(clippy::too_many_lines)]
    fn apply_response(&mut self, method: Option<&str>, result: Option<&Value>) {
        match method {
            Some("agent.list") => {
                let adapters = result
                    .and_then(|value| value.get("adapters"))
                    .and_then(Value::as_array)
                    .map_or_else(
                        || "No adapter capability data returned".into(),
                        |items| {
                            items
                                .iter()
                                .map(|item| {
                                    let name =
                                        item.get("name").and_then(Value::as_str).unwrap_or("Agent");
                                    let id =
                                        item.get("id").and_then(Value::as_str).unwrap_or("unknown");
                                    let state = if item.get("available").and_then(Value::as_bool)
                                        == Some(true)
                                    {
                                        "available"
                                    } else {
                                        "unavailable"
                                    };
                                    format!("{name} ({id}) — {state}")
                                })
                                .collect::<Vec<_>>()
                                .join(" · ")
                        },
                    );
                self.entries.push(TranscriptEntry::System(adapters));
            }
            Some("agent.profile.list") => {
                if let Some(items) = result
                    .and_then(|value| value.get("profiles"))
                    .and_then(Value::as_array)
                {
                    for item in items {
                        let Some(id) = item.get("id").and_then(Value::as_str) else {
                            continue;
                        };
                        let Some(revision_id) =
                            item.get("latestRevisionId").and_then(Value::as_str)
                        else {
                            continue;
                        };
                        let Some(backend) = item.get("backend").and_then(Value::as_str) else {
                            continue;
                        };
                        let Some(provider_connection) = item.get("providerConnection") else {
                            continue;
                        };
                        self.profile_revisions.insert(
                            id.into(),
                            ProfileRevisionRef {
                                revision_id: revision_id.into(),
                                backend: backend.into(),
                                provider_connection: provider_connection.clone(),
                            },
                        );
                    }
                }
                let profiles = result
                    .and_then(|value| value.get("profiles"))
                    .and_then(Value::as_array)
                    .map_or_else(
                        || "No profile data returned".into(),
                        |items| {
                            if items.is_empty() {
                                return "No custom Agent profiles yet; create one in Desktop"
                                    .into();
                            }
                            items
                                .iter()
                                .map(|item| {
                                    let name =
                                        item.get("name").and_then(Value::as_str).unwrap_or("Agent");
                                    let id =
                                        item.get("id").and_then(Value::as_str).unwrap_or("unknown");
                                    let backend = item
                                        .get("backend")
                                        .and_then(Value::as_str)
                                        .unwrap_or("unknown");
                                    let revision = item
                                        .get("latestRevisionId")
                                        .and_then(Value::as_str)
                                        .unwrap_or("unknown");
                                    format!("{name} [{backend}] id={id} revision={revision}")
                                })
                                .collect::<Vec<_>>()
                                .join(" · ")
                        },
                    );
                self.entries.push(TranscriptEntry::System(profiles));
            }
            Some("agent.profile.create") => {
                let id = result
                    .and_then(|value| value.get("id"))
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                self.entries.push(TranscriptEntry::System(format!("Agent Definition created: {id}. Run /profile to inspect its immutable Revision.")));
            }
            Some("agent.profile.update") => {
                let revision = result
                    .and_then(|value| value.get("latestRevisionId"))
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                self.entries.push(TranscriptEntry::System(format!(
                    "Agent updated by appending immutable Revision {revision}; existing Tasks remain pinned"
                )));
            }
            Some("agent.profile.delete") => self.entries.push(TranscriptEntry::System(
                "Agent Definition deleted; historical immutable Revisions and Tasks were retained"
                    .into(),
            )),
            Some("auth.status" | "auth.login" | "auth.logout") => self.apply_auth_response(result),
            Some("agent.model.list") => self.apply_model_catalog_response(result),
            Some("session.discover") => self.apply_session_discovery_response(result),
            Some("session.preview") => self.apply_session_preview_response(result),
            Some("session.import") => {
                let title = result
                    .and_then(|value| value.pointer("/task/title"))
                    .and_then(Value::as_str)
                    .unwrap_or("Imported Session");
                let created = result
                    .and_then(|value| value.get("created"))
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                self.entries.push(TranscriptEntry::System(format!(
                    "Session import {}: {title}. Provider-native Session was not mutated.",
                    if created {
                        "created a Task"
                    } else {
                        "deduplicated to the existing Task"
                    }
                )));
            }
            Some("session.refresh" | "session.rebuild" | "session.revision.restore") => {
                self.apply_session_refresh_response(result);
            }
            Some("session.revision.list") => self.apply_session_revisions_response(result),
            Some("task.state.load") => {
                let Some(result) = result else {
                    self.entries
                        .push(TranscriptEntry::Error("Shared task state was empty".into()));
                    return;
                };
                self.workspace_id = result
                    .get("workspaceId")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned);
                match self.persistence.load(result) {
                    Ok(Some(task)) => {
                        self.hydrate_task(task);
                        if self.persistence.task_summaries().len() > 1 {
                            self.open_task_history();
                        }
                    }
                    Ok(None) => {
                        self.status_hint = format!(
                            "Shared task store ready · next run uses {}",
                            self.run_configuration.summary()
                        );
                    }
                    Err(error) => {
                        self.entries.push(TranscriptEntry::Error(format!(
                            "Unable to load shared task history: {error}"
                        )));
                    }
                }
            }
            Some("changes.list") => self.apply_changes_response(result),
            Some("changes.diff" | "run.changes.diff") => self.apply_diff_response(result),
            Some("context.snapshot") => self.apply_context_response(result),
            Some("changes.accept" | "run.changes.accept") => self.apply_accept_response(result),
            Some("changes.previewRestore") => self.apply_restore_preview_response(result),
            Some("changes.restore") => self.apply_restore_response(result),
            Some("run.changes.previewRestore") => self.apply_run_restore_preview_response(result),
            Some("run.changes.restore") => self.apply_run_restore_response(result),
            Some("git.branches.list" | "git.branch.switch") => self.apply_branches_response(result),
            Some("git.worktree.create") => {
                let path = result
                    .and_then(|value| value.get("path"))
                    .and_then(Value::as_str)
                    .unwrap_or("worktree");
                let branch = result
                    .and_then(|value| value.get("branch"))
                    .and_then(Value::as_str)
                    .unwrap_or("branch");
                self.entries.push(TranscriptEntry::System(format!("Created Git worktree {path} · {branch}. Restart or point the TUI at that working copy to run there.")));
            }
            Some("git.compare") => self.apply_compare_response(result),
            Some("git.commit") => self.apply_commit_response(result),
            Some("git.push") => self.apply_push_response(result),
            Some("handoff.preview") => self.apply_handoff_preview_response(result),
            Some("handoff.summary.generate") => self.apply_handoff_summary_response(result),
            Some("handoff.commit") => self.apply_handoff_commit_response(result),
            Some("local.data.summary") => self.apply_local_data_summary_response(result),
            Some("local.data.preview") => self.apply_local_data_preview_response(result),
            Some("local.data.execute") => self.apply_local_data_execute_response(result),
            Some("local.data.export") => {
                let path = result
                    .and_then(|value| value.get("filePath"))
                    .and_then(Value::as_str)
                    .unwrap_or("export file");
                let bytes = result
                    .and_then(|value| value.get("bytes"))
                    .and_then(Value::as_u64)
                    .unwrap_or(0);
                self.entries.push(TranscriptEntry::System(format!("Sensitive local-data export saved to {path} · {bytes} bytes · credentials excluded")));
            }
            _ => {}
        }
    }

    fn apply_auth_response(&mut self, result: Option<&Value>) {
        let providers = result
            .and_then(|value| value.get("providers"))
            .and_then(Value::as_array);
        if let Some(providers) = providers {
            let detail = providers
                .iter()
                .map(|item| {
                    format!(
                        "{} — {} ({})",
                        item.get("name")
                            .and_then(Value::as_str)
                            .unwrap_or("Provider"),
                        item.get("status")
                            .and_then(Value::as_str)
                            .unwrap_or("unknown"),
                        item.get("detail")
                            .and_then(Value::as_str)
                            .unwrap_or("no detail")
                    )
                })
                .collect::<Vec<_>>()
                .join(" · ");
            self.entries.push(TranscriptEntry::System(format!(
                "Provider status: {detail}"
            )));
        } else {
            self.entries.push(TranscriptEntry::System("Official CLI authentication action completed; run /providers to refresh normalized status".into()));
        }
    }

    fn apply_model_catalog_response(&mut self, result: Option<&Value>) {
        let models = result
            .and_then(|value| value.get("models"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let names = models
            .iter()
            .take(30)
            .filter_map(|item| item.get("model").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join(", ");
        self.entries.push(TranscriptEntry::System(format!(
            "Codex model catalog: {} model(s){}{}",
            models.len(),
            if names.is_empty() { "" } else { " · " },
            names
        )));
    }

    fn apply_session_discovery_response(&mut self, result: Option<&Value>) {
        self.discovered_sessions.clear();
        let Some(result) = result else {
            return;
        };
        for group in [
            "current",
            "unassigned",
            "authorizationRequired",
            "migrationSuggestions",
        ] {
            for item in result
                .get(group)
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
            {
                let Some(metadata) = item.get("metadata") else {
                    continue;
                };
                let Some(id) = metadata.get("nativeSessionId").and_then(Value::as_str) else {
                    continue;
                };
                let engine = metadata
                    .get("engine")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown");
                let title = metadata
                    .get("title")
                    .and_then(Value::as_str)
                    .unwrap_or("Untitled Session");
                self.discovered_sessions.insert(
                    id.into(),
                    DiscoveredSessionRef {
                        engine: engine.into(),
                        native_session_id: id.into(),
                        provider_connection: default_provider_connection(engine),
                        title: title.into(),
                    },
                );
                self.entries.push(TranscriptEntry::System(format!(
                    "Session [{group}] {id} · {title} · {engine}"
                )));
            }
        }
        self.status_hint = format!(
            "{} Session(s) discovered · /session-preview <id> or /session-import <id> view|continue",
            self.discovered_sessions.len()
        );
    }

    fn apply_session_preview_response(&mut self, result: Option<&Value>) {
        let Some(result) = result else {
            return;
        };
        let title = result
            .pointer("/metadata/title")
            .and_then(Value::as_str)
            .unwrap_or("Session");
        let count = result
            .get("messages")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        let resume = result
            .pointer("/resume/available")
            .and_then(Value::as_bool)
            .unwrap_or(false);
        self.entries.push(TranscriptEntry::System(format!("Session preview: {title} · {count} normalized message(s) · continue {} · read-only preview, no Provider mutation", if resume { "available" } else { "unavailable" })));
    }

    fn apply_session_refresh_response(&mut self, result: Option<&Value>) {
        let Some(result) = result else {
            return;
        };
        let kind = result
            .pointer("/diff/kind")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let additions = result
            .pointer("/diff/additions")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        self.pending_session_candidate = result
            .get("candidateRevisionId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let suffix = self
            .pending_session_candidate
            .as_deref()
            .map_or_else(String::new, |id| {
                format!(" · candidate {id}; review and type /session-rebuild-confirm {id}")
            });
        self.entries.push(TranscriptEntry::System(format!("Session Projection refresh · diff {kind} · {additions} addition(s){suffix}. Current Projection was not overwritten by conflicts.")));
    }

    fn apply_session_revisions_response(&mut self, result: Option<&Value>) {
        let revisions = result
            .and_then(|value| value.get("revisions"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let detail = revisions
            .iter()
            .take(40)
            .map(|revision| {
                format!(
                    "{}{}",
                    revision
                        .get("id")
                        .and_then(Value::as_str)
                        .unwrap_or("unknown"),
                    if revision.get("current").and_then(Value::as_bool) == Some(true) {
                        " (current)"
                    } else {
                        ""
                    }
                )
            })
            .collect::<Vec<_>>()
            .join(" · ");
        self.entries.push(TranscriptEntry::System(format!("Immutable local Projection Revisions: {detail}. Use /session-restore <id> to preview a local-only restore.")));
    }

    fn apply_branches_response(&mut self, result: Option<&Value>) {
        let Some(result) = result else {
            return;
        };
        let current = result
            .get("currentBranch")
            .and_then(Value::as_str)
            .unwrap_or("detached");
        let local = result
            .get("local")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|item| item.get("name").and_then(Value::as_str))
            .take(40)
            .collect::<Vec<_>>()
            .join(", ");
        self.entries.push(TranscriptEntry::System(format!(
            "Git branches · current {current} · local [{local}]"
        )));
    }

    fn apply_compare_response(&mut self, result: Option<&Value>) {
        let Some(result) = result else {
            return;
        };
        let base = result.get("base").and_then(Value::as_str).unwrap_or("base");
        let files = result
            .get("files")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        self.entries.push(TranscriptEntry::System(format!(
            "Read-only branch comparison against {base}: {files} changed file(s)"
        )));
    }

    fn apply_commit_response(&mut self, result: Option<&Value>) {
        let commit = result
            .and_then(|value| value.get("commitId"))
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        self.entries.push(TranscriptEntry::System(format!(
            "Committed already-staged changes only · commit {commit}"
        )));
    }

    fn apply_push_response(&mut self, result: Option<&Value>) {
        let upstream = result
            .and_then(|value| value.get("upstream"))
            .and_then(Value::as_str)
            .unwrap_or("configured upstream");
        self.entries.push(TranscriptEntry::System(format!(
            "Current branch pushed to {upstream}; no force or upstream creation was used"
        )));
    }

    fn apply_handoff_preview_response(&mut self, result: Option<&Value>) {
        let Some(result) = result else {
            return;
        };
        let Some(target_agent_id) = self.handoff_target_request.take() else {
            return;
        };
        let Some(fingerprint) = result.get("fingerprint").and_then(Value::as_str) else {
            return;
        };
        let message_ids = result
            .pointer("/facts/messages")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|message| {
                message
                    .get("id")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .collect::<Vec<_>>();
        let file_paths = result
            .pointer("/facts/files")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(|file| {
                file.get("path")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .collect::<Vec<_>>();
        let target_name = result
            .pointer("/target/agentName")
            .and_then(Value::as_str)
            .unwrap_or(&target_agent_id);
        self.pending_handoff = Some(PendingHandoff {
            target_agent_id: target_agent_id.clone(),
            fingerprint: fingerprint.into(),
            message_ids: message_ids.clone(),
            file_paths: file_paths.clone(),
            agent_summary: None,
            agent_summary_generation_id: None,
        });
        self.entries.push(TranscriptEntry::System(format!("Context Handoff preview → {target_name}: {} persisted message(s), {} Run-owned file(s), fingerprint {}… No target Task or Session exists yet. Optionally run /handoff-summary; confirm with /handoff-confirm {target_agent_id}", message_ids.len(), file_paths.len(), &fingerprint[..12])));
    }

    fn apply_handoff_summary_response(&mut self, result: Option<&Value>) {
        let Some(result) = result else {
            return;
        };
        let Some(pending) = self.pending_handoff.as_mut() else {
            self.entries.push(TranscriptEntry::Error(
                "Handoff summary arrived after its preview was cleared; it was discarded".into(),
            ));
            return;
        };
        let Some(summary) = result.get("summary").and_then(Value::as_str) else {
            return;
        };
        let Some(generation_id) = result.get("generationId").and_then(Value::as_str) else {
            return;
        };
        pending.agent_summary = Some(summary.into());
        pending.agent_summary_generation_id = Some(generation_id.into());
        self.entries.push(TranscriptEntry::System(format!(
            "Optional source-Agent summary generated in an isolated, tool-disabled invocation (no Native Session persisted). Review/edit with /handoff-summary-set <text> or remove with /handoff-summary-set none:\n{summary}"
        )));
    }

    fn apply_handoff_commit_response(&mut self, result: Option<&Value>) {
        let target = result
            .and_then(|value| value.pointer("/targetTask/title"))
            .and_then(Value::as_str)
            .unwrap_or("new target Task");
        self.entries.push(TranscriptEntry::System(format!("Context Handoff committed to {target}; immutable snapshot and bidirectional relations persisted, target Native Session not started")));
    }

    fn apply_local_data_summary_response(&mut self, result: Option<&Value>) {
        let Some(result) = result else {
            return;
        };
        self.entries.push(TranscriptEntry::System(format!("Local data · {} Task(s), {} imported Task(s), {} Projection Revision(s), {} Handoff(s), approximately {} bytes", result.get("taskCount").and_then(Value::as_u64).unwrap_or(0), result.get("importedTaskCount").and_then(Value::as_u64).unwrap_or(0), result.get("projectionRevisionCount").and_then(Value::as_u64).unwrap_or(0), result.get("handoffCount").and_then(Value::as_u64).unwrap_or(0), result.get("estimatedBytes").and_then(Value::as_u64).unwrap_or(0))));
    }

    fn apply_local_data_preview_response(&mut self, result: Option<&Value>) {
        let Some(result) = result else {
            return;
        };
        let Some(fingerprint) = result.get("fingerprint").and_then(Value::as_str) else {
            return;
        };
        let scope = result
            .get("scope")
            .and_then(Value::as_str)
            .unwrap_or("task");
        let action = result
            .get("action")
            .and_then(Value::as_str)
            .unwrap_or("unlink");
        self.pending_local_data = Some(PendingLocalDataAction {
            scope: scope.into(),
            action: action.into(),
            task_id: (scope == "task")
                .then(|| self.active_task_id.clone())
                .flatten(),
            fingerprint: fingerprint.into(),
        });
        self.entries.push(TranscriptEntry::System(format!("Local-data impact preview · {action} / {scope} · {} Task(s), {} imported message(s), reclaim approximately {} bytes · Native Sessions are unaffected. Type /data-confirm {action}", result.get("affectedTaskCount").and_then(Value::as_u64).unwrap_or(0), result.get("importedMessageCount").and_then(Value::as_u64).unwrap_or(0), result.get("estimatedReclaimableBytes").and_then(Value::as_u64).unwrap_or(0))));
    }

    fn apply_local_data_execute_response(&mut self, result: Option<&Value>) {
        let action = result
            .and_then(|value| value.get("action"))
            .and_then(Value::as_str)
            .unwrap_or("action");
        self.entries.push(TranscriptEntry::System(format!(
            "Local-data {action} completed locally; no Provider-native Session was mutated"
        )));
    }

    fn apply_changes_response(&mut self, result: Option<&Value>) {
        let Some(snapshot) = result else {
            return;
        };
        self.changes_snapshot_id = snapshot
            .get("snapshotId")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let files = snapshot
            .get("files")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        self.changed_paths = files
            .iter()
            .filter_map(|file| {
                file.get("path")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
            .collect();
        self.pending_restore = None;
        let additions = snapshot
            .pointer("/totals/additions")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let deletions = snapshot
            .pointer("/totals/deletions")
            .and_then(Value::as_u64)
            .unwrap_or(0);
        let mut detail = files
            .iter()
            .take(14)
            .filter_map(|file| {
                let path = file.get("path")?.as_str()?;
                let added = file.get("additions").and_then(Value::as_u64).unwrap_or(0);
                let deleted = file.get("deletions").and_then(Value::as_u64).unwrap_or(0);
                Some(format!("{path} (+{added} -{deleted})"))
            })
            .collect::<Vec<_>>()
            .join(" · ");
        if files.len() > 14 {
            let _ = write!(detail, " · … {} more", files.len() - 14);
        }
        self.entries.push(TranscriptEntry::System(format!(
            "Git Changes: {} files, +{additions} -{deletions}{}{}",
            files.len(),
            if detail.is_empty() { "" } else { " · " },
            detail
        )));
        self.status_hint = "Real Git snapshot loaded · /diff, /accept, or /restore".into();
    }

    fn apply_diff_response(&mut self, result: Option<&Value>) {
        let Some(diff) = result else {
            return;
        };
        let path = diff
            .get("path")
            .and_then(Value::as_str)
            .unwrap_or("changed file");
        let mut text = diff
            .get("sections")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .map(|section| {
                let layer = section
                    .get("layer")
                    .and_then(Value::as_str)
                    .unwrap_or("diff");
                let patch_text = section
                    .get("patch")
                    .and_then(Value::as_str)
                    .unwrap_or("Binary diff · no textual patch");
                format!("[{layer}]\n{patch_text}")
            })
            .collect::<Vec<_>>()
            .join("\n");
        if text.chars().count() > 12_000 {
            text = format!("{}\n… diff truncated in TUI", truncate(&text, 12_000));
        }
        self.entries
            .push(TranscriptEntry::System(format!("Diff {path}:\n{text}")));
    }

    fn apply_context_response(&mut self, result: Option<&Value>) {
        let Some(context) = result else {
            return;
        };
        let instructions = value_paths(context.get("instructions"));
        let selected = value_paths(context.get("selectedFiles"));
        let capabilities = context
            .get("capabilities")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>()
            .join(", ");
        self.entries.push(TranscriptEntry::System(format!(
            "Runtime Context · instructions [{}] · selected files [{}] · capabilities [{}]",
            instructions.join(", "),
            selected.join(", "),
            capabilities
        )));
    }

    fn apply_accept_response(&mut self, result: Option<&Value>) {
        let Some(acceptance) = result else {
            return;
        };
        self.persistence.record_review_acceptance(acceptance);
        let paths = acceptance
            .get("paths")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        self.entries.push(TranscriptEntry::System(format!(
            "Review accepted for {paths} paths · review-only; Git index, worktree, commit, and remote were not changed"
        )));
        self.status_hint = "Review acceptance recorded in shared task history".into();
    }

    fn apply_restore_preview_response(&mut self, result: Option<&Value>) {
        let Some(preview) = result else {
            return;
        };
        let Some(snapshot_id) = preview.get("snapshotId").and_then(Value::as_str) else {
            return;
        };
        let Some(path) = preview
            .get("selectedPaths")
            .and_then(Value::as_array)
            .and_then(|paths| paths.first())
            .and_then(Value::as_str)
        else {
            return;
        };
        self.pending_restore = Some((path.into(), snapshot_id.into()));
        let deletes_untracked = preview
            .get("deletePaths")
            .and_then(Value::as_array)
            .is_some_and(|paths| !paths.is_empty());
        let warning = preview
            .get("warning")
            .and_then(Value::as_str)
            .unwrap_or_default();
        self.entries.push(TranscriptEntry::System(format!(
            "RESTORE PREVIEW for {path}: {}{} To apply this exact preview, type /restore-confirm {path}",
            if deletes_untracked {
                "this permanently deletes an untracked file. "
            } else {
                "tracked content will be restored from HEAD. "
            },
            warning
        )));
        self.status_hint = "Restore preview only · no file changed".into();
    }

    fn apply_restore_response(&mut self, result: Option<&Value>) {
        let Some(result) = result else {
            return;
        };
        let restored = result
            .get("restoredPaths")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        let deleted = result
            .get("deletedPaths")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        self.pending_restore = None;
        self.entries.push(TranscriptEntry::System(format!(
            "Restore completed · {restored} tracked restored, {deleted} untracked deleted"
        )));
        if let Some(remaining) = result.get("remaining") {
            self.apply_changes_response(Some(remaining));
        }
    }

    fn apply_run_restore_preview_response(&mut self, result: Option<&Value>) {
        let Some((arguments, params)) = self.run_restore_preview_request.take() else {
            return;
        };
        let Some(preview) = result else {
            return;
        };
        let conflicts = preview
            .get("conflicts")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        let selected = preview
            .get("selectedPaths")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        if conflicts > 0 {
            self.pending_run_restore = None;
            self.entries.push(TranscriptEntry::Error(format!(
                "Run restore preview found {conflicts} conflict(s) across {selected} selected path(s); nothing changed and confirmation is blocked"
            )));
            return;
        }
        self.pending_run_restore = Some((arguments.clone(), params));
        self.entries.push(TranscriptEntry::System(format!(
            "RUN RESTORE PREVIEW: {selected} path(s), no current conflict. This can discard Run-owned work while protecting pre-existing changes and the Git index. Type /run-restore-confirm {arguments}"
        )));
    }

    fn apply_run_restore_response(&mut self, result: Option<&Value>) {
        let Some(record) = result else {
            return;
        };
        let restored = record
            .pointer("/result/restoredPaths")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        let deleted = record
            .pointer("/result/deletedPaths")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        let unresolved = record
            .pointer("/result/unresolvedPaths")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        self.entries.push(TranscriptEntry::System(format!(
            "Run-owned restore completed · {restored} restored · {deleted} deleted · {unresolved} unresolved; Git index preserved"
        )));
    }

    fn hydrate_task(&mut self, task: HydratedTask) {
        let HydratedTask {
            id,
            title,
            status,
            updated_at,
            messages,
            adapter,
            model,
            permission_mode,
            profile_id,
            agent_revision_id,
            provider_connection,
            model_source,
            model_verification_status,
            session_id,
            run_count,
            evidence,
            pending_permission,
            handoff_message_ids,
            handoff_file_paths,
            run_review_sources,
        } = task;
        self.run_evidence.clear();
        self.entries = messages
            .into_iter()
            .filter_map(|(role, text)| match role.as_str() {
                "user" => Some(TranscriptEntry::User(text)),
                "assistant" => Some(TranscriptEntry::Assistant {
                    run_id: "persisted".into(),
                    text,
                    model: None,
                    classification: None,
                    total_tokens: None,
                }),
                _ => None,
            })
            .collect();
        self.active_task_id = Some(id.clone());
        self.active_task_title = Some(title.clone());
        self.evidence = evidence;
        self.handoff_message_ids = handoff_message_ids;
        self.handoff_file_paths = handoff_file_paths;
        self.run_review_sources = run_review_sources.into_iter().collect();
        self.pending_run_baselines.clear();
        self.pending_permission = None;
        self.run_configuration.adapter = adapter;
        self.run_configuration.model = model;
        self.run_configuration.model_source = model_source;
        self.run_configuration.model_verification_status = model_verification_status;
        self.run_configuration.permission_mode = permission_mode;
        self.run_configuration.profile_id = profile_id;
        self.run_configuration.agent_revision_id = agent_revision_id;
        self.run_configuration.provider_connection = provider_connection;
        self.run_configuration.session_id = session_id;
        self.screen = Screen::Task;
        self.focus = Focus::Composer;
        self.scroll_from_bottom = 0;
        self.run_state = RunState::Idle;
        self.status_hint = format!(
            "Opened {title} · {status} · {run_count} prior run(s) · updated {updated_at} · id {id}"
        );
        if let Some(permission) = pending_permission {
            self.show_pending_permission(&permission, true);
        }
    }

    fn persistence_settings(&self) -> TaskRunSettings {
        TaskRunSettings {
            adapter: self.run_configuration.adapter.clone(),
            model: self.run_configuration.model.clone(),
            permission_mode: self.run_configuration.permission_mode.clone(),
            profile_id: self.run_configuration.profile_id.clone(),
            agent_revision_id: self.run_configuration.agent_revision_id.clone(),
            provider_connection: self.run_configuration.provider_connection.clone(),
            model_source: self.run_configuration.model_source.clone(),
            model_verification_status: self.run_configuration.model_verification_status.clone(),
            session_id: self.run_configuration.session_id.clone(),
        }
    }

    fn persistence_effect(&mut self) -> Option<Effect> {
        match self.persistence.snapshot_value() {
            Ok(Some(snapshot)) => Some(Effect::SendRuntime(
                self.request("task.state.save", snapshot),
            )),
            Ok(None) => None,
            Err(error) => {
                self.entries.push(TranscriptEntry::Error(format!(
                    "Unable to persist shared task history: {error}"
                )));
                None
            }
        }
    }

    fn apply_event(&mut self, event: &RuntimeEvent) {
        match event.event_type.as_str() {
            "runtime.ready" => {
                let version = event
                    .object("status")
                    .and_then(|status| status.get("protocolVersion"))
                    .and_then(Value::as_u64);
                self.runtime_protocol_version = version;
                if self.runtime.connected_to_real_runtime
                    && version != Some(u64::from(PROTOCOL_VERSION))
                {
                    self.entries.push(TranscriptEntry::Error(format!(
                        "Runtime protocol mismatch · TUI expects {}, host reported {}",
                        PROTOCOL_VERSION,
                        version.map_or_else(|| "missing".into(), |value| value.to_string())
                    )));
                    self.status_hint = "Runtime protocol incompatible · runs are blocked".into();
                } else {
                    self.status_hint =
                        format!("{} ready · protocol v{PROTOCOL_VERSION}", self.runtime.name);
                }
                return;
            }
            "run.started" => {
                if let Some(run_id) = event.string("runId") {
                    self.pending_permission = None;
                    self.run_state = RunState::Running {
                        run_id: run_id.into(),
                    };
                    self.status_hint = "Run event stream active".into();
                }
            }
            "run.metadata" => self.apply_run_metadata(event),
            "run.model-decision" => self.apply_model_decision(event),
            "run.context-snapshot" => self.apply_context_snapshot(event),
            "run.git-baseline" => self.apply_git_baseline(event),
            "run.git-patch" => self.apply_git_patch(event),
            "permission.requested" => self.apply_permission_requested(event),
            "permission.decided" => self.apply_permission_decided(event),
            "activity.started" | "activity.completed" => self.apply_activity(event),
            "assistant.message" => self.apply_assistant_message(event),
            "run.completed" => {
                self.clear_terminal_permission();
                self.run_state = RunState::Idle;
                self.status_hint = if self.runtime.connected_to_real_runtime {
                    event.number("durationMs").map_or_else(
                        || "Agent run completed · review actual activity and Git Changes".into(),
                        |duration| {
                            format!("Agent run completed in {duration}ms · review Git Changes")
                        },
                    )
                } else {
                    let duration = event.number("durationMs").unwrap_or_default();
                    format!(
                        "Demo/replay event stream completed in {duration}ms · no verification is implied"
                    )
                };
            }
            "run.cancelled" => {
                self.clear_terminal_permission();
                self.run_state = RunState::Idle;
                self.entries
                    .push(TranscriptEntry::System("Run cancelled".into()));
                self.status_hint = "Cancellation acknowledged".into();
            }
            "run.failed" => {
                self.clear_terminal_permission();
                self.run_state = RunState::Idle;
                self.entries.push(TranscriptEntry::Error(
                    event.string("error").unwrap_or("Runtime run failed").into(),
                ));
                self.status_hint = "Run failed".into();
            }
            "assistant.reasoning-summary" => self.apply_reasoning_summary(event),
            "plan.updated" => self.apply_plan_update(event),
            "run.usage" => self.apply_usage(event),
            "run.log" => self.apply_run_log(event),
            "verification.recorded" => self.apply_verification(event),
            unknown => self.entries.push(TranscriptEntry::System(format!(
                "Runtime event received: {unknown}"
            ))),
        }
        self.screen = Screen::Task;
        self.scroll_from_bottom = 0;
    }

    fn apply_run_metadata(&mut self, event: &RuntimeEvent) {
        if let Some(session_id) = event.string("sessionId") {
            self.run_configuration.session_id = Some(session_id.into());
            self.status_hint = "External agent session captured for the next turn".into();
        }
    }

    fn apply_assistant_message(&mut self, event: &RuntimeEvent) {
        let (Some(run_id), Some(text)) = (event.string("runId"), event.string("text")) else {
            return;
        };
        if let Some(TranscriptEntry::Assistant {
            run_id: last_run_id,
            text: current,
            ..
        }) = self.entries.last_mut()
            && last_run_id == run_id
        {
            current.push_str(text);
        } else {
            let evidence = self.run_evidence.get(run_id).cloned().unwrap_or_default();
            self.entries.push(TranscriptEntry::Assistant {
                run_id: run_id.into(),
                text: text.into(),
                model: evidence.model,
                classification: evidence.classification,
                total_tokens: evidence.total_tokens,
            });
        }
    }

    fn apply_model_decision(&mut self, event: &RuntimeEvent) {
        let (Some(run_id), Some(decision)) = (event.string("runId"), event.object("decision"))
        else {
            return;
        };
        let model = decision
            .get("actualModel")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let classification = decision
            .get("classification")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let current_tokens = self
            .run_evidence
            .get(run_id)
            .and_then(|value| value.total_tokens);
        self.run_evidence.insert(
            run_id.into(),
            RunTurnEvidence {
                model,
                classification,
                total_tokens: current_tokens,
            },
        );
    }

    fn clear_terminal_permission(&mut self) {
        self.pending_permission = None;
        if matches!(self.overlay, Some(Overlay::Permission { .. })) {
            self.overlay = None;
        }
    }

    fn apply_permission_requested(&mut self, event: &RuntimeEvent) {
        let Some(request) = event.object("request") else {
            self.entries.push(TranscriptEntry::Error(
                "Runtime emitted a malformed Permission request".into(),
            ));
            return;
        };
        let Some(permission) = PendingPermission::from_value(request) else {
            self.entries.push(TranscriptEntry::Error(
                "Runtime Permission request is missing action, scope, impact, or pending status"
                    .into(),
            ));
            return;
        };
        self.show_pending_permission(&permission, false);
    }

    fn show_pending_permission(&mut self, permission: &PendingPermission, restored: bool) {
        self.run_state = RunState::WaitingPermission {
            run_id: permission.run_id.clone(),
            request_id: permission.id.clone(),
        };
        self.pending_permission = Some(permission.clone());
        self.overlay = Some(Overlay::Permission {
            request: permission.clone(),
            selected: 0,
        });
        self.entries.push(TranscriptEntry::System(format!(
            "{}Permission required · action {} · scope {} · this Run only",
            if restored { "Restored pending " } else { "" },
            permission.action,
            permission.scope_path
        )));
        self.status_hint =
            "Permission required · review action, scope, and impact before deciding".into();
        self.screen = Screen::Task;
    }

    fn apply_permission_decided(&mut self, event: &RuntimeEvent) {
        let Some(decision) = event.object("decision") else {
            return;
        };
        let decision_value = decision
            .get("decision")
            .and_then(Value::as_str)
            .unwrap_or("cancelled");
        let run_id = event.string("runId").unwrap_or("unknown-run");
        self.pending_permission = None;
        if matches!(self.overlay, Some(Overlay::Permission { .. })) {
            self.overlay = None;
        }
        self.entries.push(TranscriptEntry::System(format!(
            "Permission {decision_value} · Run {run_id} · decision recorded by Runtime"
        )));
        match decision_value {
            "approved" => {
                self.run_state = RunState::Running {
                    run_id: run_id.into(),
                };
                self.status_hint = "Permission approved for this Run · launching Agent…".into();
            }
            "denied" => {
                self.run_state = RunState::Cancelling {
                    run_id: run_id.into(),
                };
                self.status_hint = "Permission denied · Run will stop without launching".into();
            }
            _ => {
                self.run_state = RunState::Cancelling {
                    run_id: run_id.into(),
                };
                self.status_hint = "Run stopped before Permission approval".into();
            }
        }
    }

    fn apply_context_snapshot(&mut self, event: &RuntimeEvent) {
        let Some(snapshot) = event.object("snapshot") else {
            return;
        };
        let instructions = snapshot
            .get("instructions")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        let selected = snapshot
            .get("selectedFiles")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        self.entries.push(TranscriptEntry::System(format!(
            "Immutable Context snapshot · {instructions} instructions · {selected} selected files"
        )));
        self.status_hint = "Run Context snapshot recorded".into();
    }

    fn apply_git_baseline(&mut self, event: &RuntimeEvent) {
        let Some(baseline) = event.object("baseline") else {
            return;
        };
        if let Some(run_id) = event.string("runId") {
            self.pending_run_baselines
                .insert(run_id.into(), Value::Object(baseline.clone()));
        }
        let tree = baseline
            .get("treeId")
            .and_then(Value::as_str)
            .map_or("unknown", |value| &value[..value.len().min(12)]);
        self.entries.push(TranscriptEntry::System(format!(
            "Run Git baseline recorded · tree {tree} · ignored files excluded"
        )));
        self.status_hint = "Run-owned Git baseline recorded".into();
    }

    fn apply_git_patch(&mut self, event: &RuntimeEvent) {
        let Some(patch) = event.object("patch") else {
            return;
        };
        if let Some(run_id) = event.string("runId")
            && let Some(item) = EvidenceItem::from_git_patch(run_id, patch)
        {
            self.upsert_evidence(item);
            self.handoff_file_paths = patch
                .get("files")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|file| {
                    file.get("path")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned)
                })
                .collect();
            if let (Some(baseline), Some(snapshot_id)) = (
                self.pending_run_baselines.remove(run_id),
                patch.get("snapshotId").and_then(Value::as_str),
            ) {
                self.run_review_sources.insert(
                    run_id.into(),
                    RunReviewSource {
                        baseline,
                        patch: Value::Object(patch.clone()),
                        expected_snapshot_id: snapshot_id.into(),
                    },
                );
            }
        }
        let totals = patch.get("totals").and_then(Value::as_object);
        let files = totals
            .and_then(|value| value.get("files"))
            .and_then(Value::as_u64)
            .unwrap_or_default();
        let additions = totals
            .and_then(|value| value.get("additions"))
            .and_then(Value::as_u64)
            .unwrap_or_default();
        let deletions = totals
            .and_then(|value| value.get("deletions"))
            .and_then(Value::as_u64)
            .unwrap_or_default();
        self.entries.push(TranscriptEntry::System(format!(
            "Run-owned Git patch · {files} files · +{additions} -{deletions}"
        )));
        self.status_hint = "Run-owned Git evidence recorded".into();
    }

    fn apply_reasoning_summary(&mut self, event: &RuntimeEvent) {
        if let Some(text) = event.string("text") {
            self.entries.push(TranscriptEntry::System(format!(
                "Reasoning summary: {text}"
            )));
        }
    }

    fn apply_plan_update(&mut self, event: &RuntimeEvent) {
        let count = event
            .fields
            .get("items")
            .and_then(Value::as_array)
            .map_or(0, Vec::len);
        self.entries.push(TranscriptEntry::System(format!(
            "Agent plan updated · {count} items"
        )));
    }

    fn apply_usage(&mut self, event: &RuntimeEvent) {
        let (Some(run_id), Some(usage)) = (event.string("runId"), event.object("usage")) else {
            return;
        };
        let input = usage.get("inputTokens").and_then(Value::as_u64);
        let output = usage.get("outputTokens").and_then(Value::as_u64);
        let total = usage
            .get("totalTokens")
            .and_then(Value::as_u64)
            .or_else(|| input.zip(output).map(|(left, right)| left + right));
        let mut evidence = self.run_evidence.get(run_id).cloned().unwrap_or_default();
        evidence.total_tokens = total;
        self.run_evidence.insert(run_id.into(), evidence);
        for entry in &mut self.entries {
            if let TranscriptEntry::Assistant {
                run_id: entry_run_id,
                total_tokens,
                ..
            } = entry
                && entry_run_id == run_id
            {
                *total_tokens = total;
            }
        }
        self.status_hint = total.map_or_else(
            || "Usage · Engine did not report a total".into(),
            |value| format!("Usage · {value} total tokens"),
        );
    }

    fn apply_run_log(&mut self, event: &RuntimeEvent) {
        if let Some(message) = event.string("message") {
            let level = event.string("level").unwrap_or("info");
            self.entries
                .push(TranscriptEntry::System(format!("{level}: {message}")));
        }
    }

    fn apply_verification(&mut self, event: &RuntimeEvent) {
        let Some(verification) = event.object("verification") else {
            return;
        };
        if let Some(run_id) = event.string("runId")
            && let Some(item) = EvidenceItem::from_verification(run_id, verification)
        {
            self.upsert_evidence(item);
        }
        let kind = verification
            .get("kind")
            .and_then(Value::as_str)
            .unwrap_or("command");
        let status = verification
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let command = verification
            .get("command")
            .and_then(Value::as_str)
            .unwrap_or("unknown command");
        let exit = verification
            .get("exitCode")
            .and_then(Value::as_i64)
            .map_or_else(|| "unknown".into(), |code| code.to_string());
        self.entries.push(TranscriptEntry::System(format!(
            "Verification {status} · {kind} · exit {exit}\n{command}"
        )));
        self.status_hint = format!("Verification evidence recorded · {status}");
    }

    fn upsert_evidence(&mut self, item: EvidenceItem) {
        if let Some(existing) = self
            .evidence
            .iter_mut()
            .find(|existing| existing.id() == item.id())
        {
            *existing = item.clone();
        } else {
            self.evidence.insert(0, item.clone());
        }
        if let Some(Overlay::Evidence { items, .. }) = &mut self.overlay {
            if let Some(existing) = items.iter_mut().find(|existing| existing.id() == item.id()) {
                *existing = item;
            } else {
                items.insert(0, item);
            }
        }
    }

    fn apply_activity(&mut self, event: &RuntimeEvent) {
        let Some(run_id) = event.string("runId") else {
            return;
        };
        let Some(activity) = event.object("activity") else {
            return;
        };
        let id = activity
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or("activity");
        let title = activity
            .get("title")
            .and_then(Value::as_str)
            .unwrap_or("Activity");
        let detail = activity
            .get("detail")
            .and_then(Value::as_str)
            .unwrap_or_default();
        let state = activity
            .get("state")
            .and_then(Value::as_str)
            .unwrap_or("active");
        if let Some(TranscriptEntry::Activity {
            title: current_title,
            detail: current_detail,
            state: current_state,
            ..
        }) = self.entries.iter_mut().rev().find(|entry| {
            matches!(
                entry,
                TranscriptEntry::Activity { id: current_id, .. } if current_id == id
            )
        }) {
            *current_title = title.into();
            *current_detail = detail.into();
            *current_state = state.into();
        } else {
            self.entries.push(TranscriptEntry::Activity {
                run_id: run_id.into(),
                id: id.into(),
                title: title.into(),
                detail: detail.into(),
                state: state.into(),
            });
        }
    }
}

fn truncate(text: &str, max_chars: usize) -> String {
    let mut value: String = text.chars().take(max_chars).collect();
    if text.chars().count() > max_chars {
        value.push('…');
    }
    value
}

fn new_run_id() -> String {
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_nanos());
    format!("tui-run-{}-{nanos}", std::process::id())
}

fn value_paths(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|item| {
            item.get("path")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn app() -> App {
        App::new(
            PathBuf::from("/workspace"),
            RuntimeDescriptor::demo(),
            FileIndex::from_paths([
                "src/main.rs".into(),
                "src/runtime.rs".into(),
                ".github/workflows/test.yml".into(),
            ]),
        )
    }

    fn type_text(app: &mut App, text: &str) {
        for character in text.chars() {
            app.update(Action::Insert(character));
        }
    }

    fn load_empty_shared_state(app: &mut App) {
        load_shared_state(
            app,
            json!({
                "version": 2,
                "workspaceId": "workspace-1",
                "tasks": [],
                "updatedAt": "2026-08-10T00:00:00Z"
            }),
        );
    }

    fn load_shared_state(app: &mut App, state: Value) {
        app.update(Action::Runtime(RuntimeWireMessage::event(
            "runtime.ready",
            BTreeMap::from([(
                "status".into(),
                json!({ "protocolVersion": PROTOCOL_VERSION }),
            )]),
        )));
        let effects = app.startup_effects();
        let [Effect::SendRuntime(request)] = effects.as_slice() else {
            panic!("expected shared task load request");
        };
        app.update(Action::Runtime(RuntimeWireMessage::Response {
            id: request.id.clone(),
            ok: true,
            result: Some(state),
            error: None,
        }));
    }

    fn live_app() -> App {
        let mut app = App::new(
            PathBuf::from("/workspace"),
            RuntimeDescriptor::process("runtime-host"),
            FileIndex::default(),
        );
        load_empty_shared_state(&mut app);
        app
    }

    fn permission_requested(run_id: &str, request_id: &str) -> RuntimeWireMessage {
        RuntimeWireMessage::event(
            "permission.requested",
            BTreeMap::from([
                ("runId".into(), Value::String(run_id.into())),
                ("adapter".into(), Value::String("codex".into())),
                ("prompt".into(), Value::String("Edit the workspace".into())),
                ("permissionMode".into(), Value::String("acceptEdits".into())),
                ("contextFiles".into(), Value::Array(Vec::new())),
                (
                    "request".into(),
                    json!({
                        "id": request_id,
                        "runId": run_id,
                        "action": "workspace.write",
                        "scope": {
                            "kind": "workspace",
                            "path": "/workspace",
                            "appliesTo": "this-run"
                        },
                        "impact": "May create, edit, or delete files inside the authorized Workspace.",
                        "requestedAt": "2026-08-11T00:00:00Z",
                        "status": "pending"
                    }),
                ),
            ]),
        )
    }

    #[test]
    fn tab_switches_focus_when_no_suggestion_is_open() {
        let mut app = app();
        app.screen = Screen::Task;
        assert_eq!(app.focus, Focus::Composer);
        app.update(Action::ToggleFocus);
        assert_eq!(app.focus, Focus::Scrollback);
        app.update(Action::ToggleFocus);
        assert_eq!(app.focus, Focus::Composer);
    }

    #[test]
    fn blocking_permission_shows_scope_and_routes_approve_deny_and_stop_truthfully() {
        let mut approved = live_app();
        approved.update(Action::Runtime(permission_requested(
            "run-approved",
            "request-approved",
        )));
        assert!(matches!(
            &approved.run_state,
            RunState::WaitingPermission { run_id, request_id }
                if run_id == "run-approved" && request_id == "request-approved"
        ));
        assert!(matches!(
            &approved.overlay,
            Some(Overlay::Permission { request, selected: 0 })
                if request.action == "workspace.write"
                    && request.scope_path == "/workspace"
                    && request.applies_to == "this-run"
        ));
        approved.update(Action::Escape { at_ms: 100 });
        assert!(matches!(
            &approved.overlay,
            Some(Overlay::Permission { .. })
        ));
        let effects = approved.update(Action::Insert('a'));
        assert!(effects.iter().any(|effect| matches!(
            effect,
            Effect::SendRuntime(request)
                if request.method == "permission.decide"
                    && request.params["runId"] == "run-approved"
                    && request.params["requestId"] == "request-approved"
                    && request.params["decision"] == "approved"
        )));
        assert!(matches!(
            &approved.run_state,
            RunState::DecidingPermission { decision, .. } if decision == "approved"
        ));
        approved.update(Action::Runtime(RuntimeWireMessage::event(
            "permission.decided",
            BTreeMap::from([
                ("runId".into(), Value::String("run-approved".into())),
                (
                    "decision".into(),
                    json!({
                        "id": "decision-approved",
                        "requestId": "request-approved",
                        "runId": "run-approved",
                        "decision": "approved",
                        "source": "user",
                        "decidedAt": "2026-08-11T00:00:01Z"
                    }),
                ),
            ]),
        )));
        assert!(matches!(&approved.run_state, RunState::Running { .. }));
        assert!(approved.pending_permission.is_none());

        let mut denied = live_app();
        denied.update(Action::Runtime(permission_requested(
            "run-denied",
            "request-denied",
        )));
        let effects = denied.update(Action::Insert('d'));
        assert!(effects.iter().any(|effect| matches!(
            effect,
            Effect::SendRuntime(request)
                if request.method == "permission.decide"
                    && request.params["decision"] == "denied"
        )));

        let mut stopped = live_app();
        stopped.update(Action::Runtime(permission_requested(
            "run-stopped",
            "request-stopped",
        )));
        let effects = stopped.update(Action::Insert('s'));
        assert!(effects.iter().any(|effect| matches!(
            effect,
            Effect::SendRuntime(request)
                if request.method == "run.cancel"
                    && request.params["runId"] == "run-stopped"
        )));
        assert!(stopped.status_hint.contains("cancelled decision"));
    }

    #[test]
    fn startup_browses_and_switches_persisted_task_history_with_the_keyboard() {
        let mut app = App::new(
            PathBuf::from("/workspace"),
            RuntimeDescriptor::process("runtime-host"),
            FileIndex::default(),
        );
        load_shared_state(
            &mut app,
            json!({
                "version": 2,
                "workspaceId": "workspace-1",
                "tasks": [
                    {
                        "id": "task-older",
                        "title": "Investigate flaky test",
                        "status": "stopped",
                        "adapter": "claude-code",
                        "permissionMode": "plan",
                        "updatedAtIso": "2026-08-09T00:00:00Z",
                        "createdAt": "2026-08-09T00:00:00Z",
                        "messages": [{"role": "user", "text": "older prompt"}],
                        "runs": []
                    },
                    {
                        "id": "task-current",
                        "title": "Ship TUI history",
                        "status": "completed",
                        "adapter": "codex",
                        "permissionMode": "acceptEdits",
                        "updatedAtIso": "2026-08-10T00:00:00Z",
                        "createdAt": "2026-08-10T00:00:00Z",
                        "messages": [{"role": "user", "text": "current prompt"}],
                        "runs": []
                    }
                ],
                "updatedAt": "2026-08-10T00:00:00Z"
            }),
        );

        assert_eq!(app.active_task_id.as_deref(), Some("task-current"));
        assert!(matches!(
            &app.overlay,
            Some(Overlay::TaskHistory { selected: 0, .. })
        ));
        app.update(Action::MoveSelection(1));
        app.update(Action::Submit);
        assert_eq!(app.active_task_id.as_deref(), Some("task-older"));
        assert_eq!(
            app.active_task_title.as_deref(),
            Some("Investigate flaky test")
        );
        assert_eq!(app.run_configuration.adapter, "claude-code");
        assert!(matches!(
            &app.entries[0],
            TranscriptEntry::User(text) if text == "older prompt"
        ));
        assert!(app.overlay.is_none());
    }

    #[test]
    fn evidence_inspector_expands_recorded_unknown_and_run_owned_facts() {
        let mut app = App::new(
            PathBuf::from("/workspace"),
            RuntimeDescriptor::process("runtime-host"),
            FileIndex::default(),
        );
        load_shared_state(
            &mut app,
            json!({
                "version": 2,
                "workspaceId": "workspace-1",
                "tasks": [{
                    "id": "task-evidence",
                    "title": "Review evidence",
                    "status": "completed",
                    "adapter": "codex",
                    "permissionMode": "plan",
                    "updatedAtIso": "2026-08-10T00:00:00Z",
                    "createdAt": "2026-08-10T00:00:00Z",
                    "messages": [],
                    "runs": [{
                        "id": "run-evidence",
                        "adapter": "codex",
                        "updatedAt": "2026-08-10T00:00:00Z",
                        "verifications": [{
                            "id": "verification-unknown",
                            "kind": "test",
                            "status": "unknown",
                            "command": "npm test",
                            "cwd": "/workspace",
                            "finishedAt": "2026-08-10T00:00:00Z",
                            "log": "No exact exit status from adapter",
                            "redacted": true,
                            "truncated": false
                        }],
                        "gitPatch": {
                            "id": "patch-1",
                            "runId": "run-evidence",
                            "baselineId": "baseline-1",
                            "generatedAt": "2026-08-10T00:00:00Z",
                            "beforeTreeId": "before-tree",
                            "afterTreeId": "after-tree",
                            "snapshotId": "snapshot-1",
                            "files": [{
                                "path": "src/main.rs",
                                "kind": "modified",
                                "additions": 2,
                                "deletions": 1,
                                "isBinary": false
                            }],
                            "totals": {"files": 1, "additions": 2, "deletions": 1, "binaryFiles": 0}
                        }
                    }]
                }],
                "updatedAt": "2026-08-10T00:00:00Z"
            }),
        );
        app.update(Action::ToggleEvidence);
        assert!(matches!(
            &app.overlay,
            Some(Overlay::Evidence {
                items,
                expanded: false,
                ..
            }) if items.len() == 2
        ));
        app.update(Action::MoveSelection(1));
        app.update(Action::Submit);
        assert!(matches!(
            &app.overlay,
            Some(Overlay::Evidence {
                selected: 1,
                expanded: true,
                ..
            })
        ));
        assert!(matches!(
            &app.evidence[1],
            EvidenceItem::Verification {
                status,
                exit_code: None,
                ..
            } if status == "unknown"
        ));
    }

    #[test]
    fn slash_and_file_search_have_keyboard_selectable_state() {
        let mut app = app();
        type_text(&mut app, "/re");
        assert!(matches!(app.overlay, Some(Overlay::Commands { .. })));
        app.update(Action::ToggleFocus);
        assert_eq!(app.composer_text(), "/rewind");

        app.composer.clear();
        app.cursor = 0;
        type_text(&mut app, "check @runtime");
        let Some(Overlay::Files { items, .. }) = &app.overlay else {
            panic!("expected file search");
        };
        assert_eq!(items[0].value, "src/runtime.rs");
        app.update(Action::Submit);
        assert_eq!(app.composer_text(), "check @src/runtime.rs ");
    }

    #[test]
    fn escape_double_press_clears_or_opens_honest_rewind_preview() {
        let mut app = app();
        type_text(&mut app, "draft");
        app.update(Action::Escape { at_ms: 100 });
        assert_eq!(app.composer_text(), "draft");
        assert!(app.status_hint.contains("Esc again"));
        app.update(Action::Escape { at_ms: 700 });
        assert!(app.composer.is_empty());

        app.entries.push(TranscriptEntry::User("first turn".into()));
        app.update(Action::Escape { at_ms: 1_000 });
        assert!(app.overlay.is_none());
        app.update(Action::Escape { at_ms: 1_700 });
        assert!(matches!(app.overlay, Some(Overlay::Rewind { .. })));
        assert!(app.status_hint.contains("preview only"));
    }

    #[test]
    fn ctrl_c_clears_a_draft_before_requesting_cancel() {
        let mut app = app();
        app.run_state = RunState::Running {
            run_id: "run-1".into(),
        };
        type_text(&mut app, "do not send");
        assert!(app.update(Action::Cancel).is_empty());
        assert!(app.composer.is_empty());
        let effects = app.update(Action::Cancel);
        assert!(
            matches!(effects.as_slice(), [Effect::SendRuntime(request)] if request.method == "run.cancel")
        );
        assert!(matches!(app.run_state, RunState::Cancelling { .. }));
    }

    #[test]
    fn live_agent_model_permission_and_profile_reach_the_run_request() {
        let mut app = App::new(
            PathBuf::from("/workspace"),
            RuntimeDescriptor::process("runtime-host"),
            FileIndex::default(),
        );
        load_empty_shared_state(&mut app);
        type_text(&mut app, "/agent claude-code");
        app.update(Action::Submit);
        type_text(&mut app, "/model opus");
        app.update(Action::Submit);
        type_text(&mut app, "/permission plan");
        app.update(Action::Submit);
        app.profile_revisions.insert(
            "custom-reviewer".into(),
            ProfileRevisionRef {
                revision_id: "agent-revision:custom-reviewer@1".into(),
                backend: "claude-code".into(),
                provider_connection: default_provider_connection("claude-code"),
            },
        );
        type_text(&mut app, "/profile custom-reviewer");
        app.update(Action::Submit);
        type_text(&mut app, "review this change");
        let effects = app.update(Action::Submit);
        let Some(request) = effects.iter().find_map(|effect| match effect {
            Effect::SendRuntime(request) if request.method == "run.start" => Some(request),
            _ => None,
        }) else {
            panic!("expected a live run request");
        };
        assert_eq!(request.method, "run.start");
        assert_eq!(request.params["adapter"], "claude-code");
        assert_eq!(request.params["model"], "opus");
        assert_eq!(request.params["modelMode"], "fixed");
        assert_eq!(request.params["permissionMode"], "plan");
        assert_eq!(request.params["profileId"], "custom-reviewer");
        assert_eq!(
            request.params["agentRevisionId"],
            "agent-revision:custom-reviewer@1"
        );
        assert_eq!(request.params["prompt"], "review this change");
    }

    #[test]
    fn incompatible_runtime_protocol_is_visible_and_blocks_runs() {
        let mut app = App::new(
            PathBuf::from("/workspace"),
            RuntimeDescriptor::process("runtime-host"),
            FileIndex::default(),
        );
        app.update(Action::Runtime(RuntimeWireMessage::event(
            "runtime.ready",
            BTreeMap::from([(
                "status".into(),
                json!({ "protocolVersion": PROTOCOL_VERSION + 1 }),
            )]),
        )));
        type_text(&mut app, "do not run this");
        assert!(app.update(Action::Submit).is_empty());
        assert!(app.status_hint.contains("incompatible"));
        assert!(app.entries.iter().any(|entry| matches!(
            entry,
            TranscriptEntry::Error(text) if text.contains("protocol mismatch")
        )));
    }

    #[test]
    fn live_session_metadata_is_reused_until_new_task_or_agent_selection() {
        let mut app = App::new(
            PathBuf::from("/workspace"),
            RuntimeDescriptor::process("runtime-host"),
            FileIndex::default(),
        );
        load_empty_shared_state(&mut app);
        app.update(Action::Runtime(RuntimeWireMessage::event(
            "run.metadata",
            BTreeMap::from([("sessionId".into(), Value::String("session-1".into()))]),
        )));
        type_text(&mut app, "continue");
        let effects = app.update(Action::Submit);
        assert!(effects.iter().any(|effect| matches!(
            effect,
            Effect::SendRuntime(request)
                if request.method == "run.start" && request.params["sessionId"] == "session-1"
        )));

        app.run_state = RunState::Idle;
        type_text(&mut app, "/new");
        app.update(Action::Submit);
        assert!(app.run_configuration.session_id.is_none());
    }

    #[test]
    fn live_git_review_commands_use_snapshot_guards_and_explicit_restore_confirmation() {
        let mut app = App::new(
            PathBuf::from("/workspace"),
            RuntimeDescriptor::process("runtime-host"),
            FileIndex::default(),
        );
        load_empty_shared_state(&mut app);
        type_text(&mut app, "review task");
        app.update(Action::Submit);
        app.run_state = RunState::Idle;

        type_text(&mut app, "/changes");
        let effects = app.update(Action::Submit);
        let request = effects
            .iter()
            .find_map(|effect| match effect {
                Effect::SendRuntime(request) if request.method == "changes.list" => Some(request),
                _ => None,
            })
            .unwrap();
        let snapshot_id = "a".repeat(64);
        app.update(Action::Runtime(RuntimeWireMessage::Response {
            id: request.id.clone(),
            ok: true,
            result: Some(json!({
                "workspaceRoot": "/workspace",
                "snapshotId": snapshot_id,
                "files": [{
                    "path": "src/main.rs",
                    "kind": "modified",
                    "indexStatus": ".",
                    "worktreeStatus": "M",
                    "staged": false,
                    "unstaged": true,
                    "untracked": false,
                    "additions": 2,
                    "deletions": 1,
                    "isBinary": false,
                    "layers": {}
                }],
                "totals": {"files": 1, "additions": 2, "deletions": 1, "binaryFiles": 0}
            })),
            error: None,
        }));

        type_text(&mut app, "/restore src/main.rs");
        let effects = app.update(Action::Submit);
        let preview = effects
            .iter()
            .find_map(|effect| match effect {
                Effect::SendRuntime(request) if request.method == "changes.previewRestore" => {
                    Some(request)
                }
                _ => None,
            })
            .unwrap();
        app.update(Action::Runtime(RuntimeWireMessage::Response {
            id: preview.id.clone(),
            ok: true,
            result: Some(json!({
                "snapshotId": snapshot_id,
                "selectedPaths": ["src/main.rs"],
                "restoreFromHeadPaths": ["src/main.rs"],
                "deletePaths": []
            })),
            error: None,
        }));
        assert!(app.entries.iter().any(|entry| matches!(
            entry,
            TranscriptEntry::System(text) if text.contains("/restore-confirm src/main.rs")
        )));

        type_text(&mut app, "/restore-confirm wrong.rs");
        assert!(app.update(Action::Submit).is_empty());
        type_text(&mut app, "/restore-confirm src/main.rs");
        let effects = app.update(Action::Submit);
        assert!(effects.iter().any(|effect| matches!(
            effect,
            Effect::SendRuntime(request)
                if request.method == "changes.restore"
                    && request.params["confirmed"] == true
                    && request.params["expectedSnapshotId"] == snapshot_id
        )));
    }

    #[test]
    fn model_decision_and_usage_are_attached_to_the_assistant_turn() {
        let mut app = App::new(
            PathBuf::from("/workspace"),
            RuntimeDescriptor::process("runtime-host"),
            FileIndex::default(),
        );
        let event = |event_type: &str, fields: Value| {
            RuntimeEvent::new(
                event_type,
                fields
                    .as_object()
                    .unwrap()
                    .iter()
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect(),
            )
        };
        app.apply_event(&event(
            "run.model-decision",
            json!({
                "runId": "run-auto",
                "decision": {"actualModel": "gpt-complex", "classification": "complex"}
            }),
        ));
        app.apply_event(&event(
            "assistant.message",
            json!({
                "runId": "run-auto", "text": "Implemented the migration."
            }),
        ));
        app.apply_event(&event(
            "run.usage",
            json!({
                "runId": "run-auto",
                "usage": {"source": "engine", "totalTokens": 42}
            }),
        ));
        assert!(matches!(
            app.entries.last(),
            Some(TranscriptEntry::Assistant { model: Some(model), classification: Some(classification), total_tokens: Some(42), .. })
                if model == "gpt-complex" && classification == "complex"
        ));
    }

    #[test]
    fn management_session_import_and_git_mutations_are_real_and_confirmation_gated() {
        let mut app = live_app();
        type_text(&mut app, "/providers");
        let effects = app.update(Action::Submit);
        assert!(effects.iter().any(|effect| matches!(effect, Effect::SendRuntime(request) if request.method == "auth.status")));
        assert!(effects.iter().any(|effect| matches!(effect, Effect::SendRuntime(request) if request.method == "agent.list")));

        type_text(&mut app, "/logout codex");
        assert!(app.update(Action::Submit).is_empty());
        type_text(&mut app, "/logout-confirm claude-code");
        assert!(app.update(Action::Submit).is_empty());
        type_text(&mut app, "/logout-confirm chatgpt");
        let effects = app.update(Action::Submit);
        assert!(effects.iter().any(|effect| matches!(effect, Effect::SendRuntime(request) if request.method == "auth.logout" && request.params["provider"] == "chatgpt")));

        type_text(&mut app, "/sessions codex");
        let effects = app.update(Action::Submit);
        let discovery = effects
            .iter()
            .find_map(|effect| match effect {
                Effect::SendRuntime(request) if request.method == "session.discover" => {
                    Some(request)
                }
                _ => None,
            })
            .unwrap();
        assert_eq!(discovery.params["activeWorkspaceId"], "workspace-1");
        app.update(Action::Runtime(RuntimeWireMessage::Response { id: discovery.id.clone(), ok: true, result: Some(json!({
            "engine": "codex",
            "current": [{"identityKey":"identity-1","metadata":{"engine":"codex","nativeSessionId":"thread-1","title":"Imported thread","cwd":"/workspace"},"attribution":{"status":"current-workspace","workspaceId":"workspace-1"}}],
            "unassigned": [], "authorizationRequired": [], "migrationSuggestions": [], "nextCursor": null
        })), error: None }));
        type_text(&mut app, "/session-import thread-1 continue");
        let effects = app.update(Action::Submit);
        assert!(effects.iter().any(|effect| matches!(effect, Effect::SendRuntime(request) if request.method == "session.import" && request.params["mode"] == "continue" && request.params["nativeSessionId"] == "thread-1")));

        type_text(&mut app, "/push");
        assert!(app.update(Action::Submit).is_empty());
        type_text(&mut app, "/push-confirm");
        let effects = app.update(Action::Submit);
        assert!(effects.iter().any(|effect| matches!(effect, Effect::SendRuntime(request) if request.method == "git.push" && request.params["confirmed"] == true)));

        type_text(&mut app, "/worktree /tmp/rux-new codex/worktree-test");
        assert!(app.update(Action::Submit).is_empty());
        type_text(
            &mut app,
            "/worktree-confirm /tmp/rux-other codex/worktree-test",
        );
        assert!(app.update(Action::Submit).is_empty());
        type_text(
            &mut app,
            "/worktree-confirm /tmp/rux-new codex/worktree-test",
        );
        let effects = app.update(Action::Submit);
        assert!(effects.iter().any(|effect| matches!(effect, Effect::SendRuntime(request) if request.method == "git.worktree.create" && request.params["confirmed"] == true && request.params["path"] == "/tmp/rux-new")));

        app.run_review_sources.insert(
            "run-1".into(),
            RunReviewSource {
                baseline: json!({"id":"baseline-1"}),
                patch: json!({"runId":"run-1","snapshotId":"a".repeat(64)}),
                expected_snapshot_id: "a".repeat(64),
            },
        );
        type_text(&mut app, "/run-restore run-1 src/main.rs");
        let effects = app.update(Action::Submit);
        let preview = effects
            .iter()
            .find_map(|effect| match effect {
                Effect::SendRuntime(request) if request.method == "run.changes.previewRestore" => {
                    Some(request)
                }
                _ => None,
            })
            .unwrap();
        app.update(Action::Runtime(RuntimeWireMessage::Response {
            id: preview.id.clone(),
            ok: true,
            result: Some(json!({"selectedPaths":["src/main.rs"],"conflicts":[]})),
            error: None,
        }));
        type_text(&mut app, "/run-restore-confirm run-1 src/main.rs");
        let effects = app.update(Action::Submit);
        assert!(effects.iter().any(|effect| matches!(effect, Effect::SendRuntime(request) if request.method == "run.changes.restore" && request.params["confirmed"] == true)));
    }
}
