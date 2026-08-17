use std::env;
use std::io::{self, Stdout};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use anyhow::{Context, Result, bail};
use crossterm::event::{self, Event};
use crossterm::execute;
use crossterm::terminal::{
    EnterAlternateScreen, LeaveAlternateScreen, disable_raw_mode, enable_raw_mode,
};
use ratatui::Terminal;
use ratatui::backend::CrosstermBackend;
use rux_tui::app::FileIndex;
use rux_tui::protocol::decode_wire_message;
use rux_tui::runtime::{DemoRuntimeClient, ProcessRuntimeClient, ReplayRuntimeClient};
use rux_tui::{Action, App, RunConfiguration, RuntimeClient, action_from_key, execute_effects, ui};

enum RuntimeMode {
    Demo,
    Replay(PathBuf),
    Connected {
        host: PathBuf,
        node: PathBuf,
        state_root: PathBuf,
    },
}

struct LaunchConfiguration {
    mode: RuntimeMode,
    workspace_root: PathBuf,
    adapter: Option<String>,
    model: Option<String>,
    permission_mode: Option<String>,
    profile_id: Option<String>,
}

fn main() {
    if let Err(error) = run() {
        eprintln!("Rux TUI failed: {error:#}");
        std::process::exit(1);
    }
}

fn run() -> Result<()> {
    let Some(configuration) = parse_args()? else {
        return Ok(());
    };
    let workspace_root = configuration.workspace_root;
    let mut runtime: Box<dyn RuntimeClient> = match configuration.mode {
        RuntimeMode::Demo => Box::new(DemoRuntimeClient::new(
            workspace_root.display().to_string(),
        )?),
        RuntimeMode::Replay(path) => Box::new(ReplayRuntimeClient::from_path(&path)?),
        RuntimeMode::Connected {
            host,
            node,
            state_root,
        } => Box::new(ProcessRuntimeClient::spawn(
            &node,
            &host,
            &workspace_root,
            &state_root,
        )?),
    };
    let descriptor = runtime.descriptor();
    let mut run_configuration = RunConfiguration::for_runtime(&descriptor);
    if let Some(adapter) = configuration.adapter {
        run_configuration.adapter = adapter;
    }
    if let Some(model) = configuration.model {
        run_configuration.model = (model != "default").then_some(model);
    }
    if let Some(permission_mode) = configuration.permission_mode {
        run_configuration.permission_mode = permission_mode;
    }
    run_configuration.profile_id = configuration.profile_id;
    let file_index = FileIndex::scan(&workspace_root);
    let mut app =
        App::new(workspace_root, descriptor, file_index).with_run_configuration(run_configuration);
    let startup_effects = app.startup_effects();
    if execute_effects(&mut app, runtime.as_mut(), startup_effects) {
        return Ok(());
    }

    enable_raw_mode().context("enable terminal raw mode")?;
    let mut stdout = io::stdout();
    execute!(stdout, EnterAlternateScreen).context("enter alternate screen")?;
    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend).context("create terminal")?;
    let result = event_loop(&mut terminal, &mut app, runtime.as_mut());
    let cleanup = restore_terminal(&mut terminal);
    result.and(cleanup)
}

fn event_loop(
    terminal: &mut Terminal<CrosstermBackend<Stdout>>,
    app: &mut App,
    runtime: &mut dyn RuntimeClient,
) -> Result<()> {
    let started = Instant::now();
    let mut dirty = true;
    loop {
        for line in runtime.poll_lines()? {
            let message = decode_wire_message(&line).context("decode runtime JSONL event")?;
            let effects = app.update(Action::Runtime(message));
            dirty = true;
            if execute_effects(app, runtime, effects) {
                return Ok(());
            }
        }

        if dirty {
            terminal.draw(|frame| ui::render(frame, app))?;
            dirty = false;
        }
        let at_ms = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
        if event::poll(Duration::from_millis(50))?
            && let Event::Key(key) = event::read()?
            && let Some(action) = action_from_key(key, at_ms)
        {
            let effects = app.update(action);
            dirty = true;
            if execute_effects(app, runtime, effects) {
                return Ok(());
            }
        }
        let previous_hint = app.status_hint.clone();
        app.update(Action::Tick { at_ms });
        dirty |= app.status_hint != previous_hint;
    }
}

fn restore_terminal(terminal: &mut Terminal<CrosstermBackend<Stdout>>) -> Result<()> {
    disable_raw_mode().context("disable terminal raw mode")?;
    execute!(terminal.backend_mut(), LeaveAlternateScreen).context("leave alternate screen")?;
    terminal.show_cursor().context("show terminal cursor")?;
    Ok(())
}

fn parse_args() -> Result<Option<LaunchConfiguration>> {
    let mut args = env::args().skip(1);
    let mut explicit_mode: Option<RuntimeMode> = None;
    let mut workspace_root = env::current_dir().context("resolve current workspace")?;
    let mut node = env::var_os("RUX_NODE").map_or_else(default_node_runner, PathBuf::from);
    let mut state_root =
        env::var_os("RUX_STATE_ROOT").map_or_else(default_state_root, PathBuf::from);
    let mut adapter = None;
    let mut model = None;
    let mut permission_mode = None;
    let mut profile_id = None;
    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--demo" => explicit_mode = Some(RuntimeMode::Demo),
            "--replay" => {
                let path = PathBuf::from(required_argument(
                    &mut args,
                    "--replay",
                    "a JSONL file path",
                )?);
                explicit_mode = Some(RuntimeMode::Replay(path));
            }
            "--runtime-host" => {
                let host = PathBuf::from(required_argument(
                    &mut args,
                    "--runtime-host",
                    "a JavaScript file",
                )?);
                explicit_mode = Some(RuntimeMode::Connected {
                    host,
                    node: node.clone(),
                    state_root: state_root.clone(),
                });
            }
            "--node" => {
                node = PathBuf::from(required_argument(
                    &mut args,
                    "--node",
                    "an executable path",
                )?);
            }
            "--workspace" => {
                workspace_root =
                    PathBuf::from(required_argument(&mut args, "--workspace", "a directory")?);
            }
            "--state-root" => {
                state_root =
                    PathBuf::from(required_argument(&mut args, "--state-root", "a directory")?);
            }
            "--agent" => {
                let value = required_argument(&mut args, "--agent", "Rux or Claude Code")?;
                adapter = Some(match value.as_str() {
                    "rux" | "codex" => "codex".into(),
                    "claude-code" => value,
                    _ => bail!("--agent must be Rux or Claude Code"),
                });
            }
            "--model" => {
                model = Some(required_argument(
                    &mut args,
                    "--model",
                    "a model name or default",
                )?);
            }
            "--permission" => {
                let value =
                    required_argument(&mut args, "--permission", "plan, acceptEdits, or dontAsk")?;
                if !matches!(value.as_str(), "plan" | "acceptEdits" | "dontAsk") {
                    bail!("--permission must be plan, acceptEdits, or dontAsk");
                }
                permission_mode = Some(value);
            }
            "--profile" => {
                profile_id = Some(required_argument(
                    &mut args,
                    "--profile",
                    "a custom Agent ID",
                )?);
            }
            "-h" | "--help" => {
                println!(
                    "Rux TUI\n\nUSAGE:\n  rux-tui [--workspace <dir>]\n  rux-tui --runtime-host <rux-runtime.mjs> [--node <node>] [--agent rux|claude-code]\n  rux-tui --demo\n  rux-tui --replay <events.jsonl>\n\nOPTIONS:\n  --workspace <dir>       Authorized workspace (default: current directory)\n  --state-root <dir>      Shared non-secret Agent profile state\n  --agent <id>            Rux or Claude Code\n  --model <name>          Agent model, or default\n  --permission <mode>     plan, acceptEdits, or dontAsk\n  --profile <id>          Custom Agent profile ID\n\nIf a built Runtime host is found, Rux connects automatically. Otherwise it starts the clearly labelled non-mutating demo."
                );
                return Ok(None);
            }
            "-V" | "--version" => return Ok(version_output()),
            unknown => bail!("unknown argument: {unknown}"),
        }
    }

    Ok(Some(LaunchConfiguration {
        mode: finalized_mode(explicit_mode, node, state_root),
        workspace_root,
        adapter,
        model,
        permission_mode,
        profile_id,
    }))
}

fn version_output() -> Option<LaunchConfiguration> {
    println!(
        "rux-tui {} · protocol v{}",
        env!("CARGO_PKG_VERSION"),
        rux_tui::protocol::PROTOCOL_VERSION
    );
    None
}

fn finalized_mode(
    explicit_mode: Option<RuntimeMode>,
    node: PathBuf,
    state_root: PathBuf,
) -> RuntimeMode {
    let mut mode = explicit_mode.unwrap_or_else(|| {
        discover_runtime_host().map_or(RuntimeMode::Demo, |host| RuntimeMode::Connected {
            host,
            node: node.clone(),
            state_root: state_root.clone(),
        })
    });
    if let RuntimeMode::Connected {
        node: mode_node,
        state_root: mode_state_root,
        ..
    } = &mut mode
    {
        *mode_node = node;
        *mode_state_root = state_root;
    }
    mode
}

fn required_argument(
    args: &mut impl Iterator<Item = String>,
    flag: &str,
    expectation: &str,
) -> Result<String> {
    args.next()
        .ok_or_else(|| anyhow::anyhow!("{flag} requires {expectation}"))
}

fn default_state_root() -> PathBuf {
    if cfg!(target_os = "macos") {
        return user_home().join("Library/Application Support/RUX");
    }
    if cfg!(target_os = "windows") {
        return env::var_os("APPDATA")
            .map_or_else(|| user_home().join("AppData/Roaming"), PathBuf::from)
            .join("RUX");
    }
    env::var_os("XDG_CONFIG_HOME")
        .map_or_else(|| user_home().join(".config"), PathBuf::from)
        .join("RUX")
}

fn default_node_runner() -> PathBuf {
    if let Ok(executable) = env::current_exe()
        && let Some(resources) = executable.parent().and_then(Path::parent)
        && resources
            .file_name()
            .is_some_and(|name| name == "Resources")
        && let Some(contents) = resources.parent()
    {
        for executable_name in ["Rux", "RUX"] {
            let packaged = contents.join("MacOS").join(executable_name);
            if packaged.is_file() {
                return packaged;
            }
        }
    }
    PathBuf::from("node")
}

fn user_home() -> PathBuf {
    env::var_os("HOME")
        .or_else(|| env::var_os("USERPROFILE"))
        .map_or_else(|| PathBuf::from("."), PathBuf::from)
}

fn discover_runtime_host() -> Option<PathBuf> {
    if let Some(path) = env::var_os("RUX_RUNTIME_HOST").map(PathBuf::from)
        && path.is_file()
    {
        return Some(path);
    }

    if let Ok(executable) = env::current_exe()
        && let Some(bin) = executable.parent()
    {
        let bundled = bin.join("../runtime-host/rux-runtime.mjs");
        if bundled.is_file() {
            return Some(bundled);
        }
    }

    let development =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../app/out/runtime-host/rux-runtime.mjs");
    if development.is_file() {
        return Some(development);
    }

    for application_name in ["Rux.app", "RUX.app"] {
        let system = PathBuf::from("/Applications")
            .join(application_name)
            .join("Contents/Resources/runtime-host/rux-runtime.mjs");
        if system.is_file() {
            return Some(system);
        }
    }
    env::var_os("HOME").map(PathBuf::from).and_then(|home| {
        ["Rux.app", "RUX.app"]
            .into_iter()
            .map(|application_name| {
                home.join("Applications")
                    .join(application_name)
                    .join("Contents/Resources/runtime-host/rux-runtime.mjs")
            })
            .find(|path| path.is_file())
    })
}
