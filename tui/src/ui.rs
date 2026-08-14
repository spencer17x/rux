use ratatui::Frame;
use ratatui::layout::{Alignment, Constraint, Direction, Layout, Margin, Position, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, ListState, Paragraph, Wrap};
use unicode_width::UnicodeWidthStr;

use crate::app::{App, Focus, Overlay, RunState, Screen, TranscriptEntry, adapter_label};
use crate::persistence::{EvidenceItem, TaskSummary};
use crate::protocol::PROTOCOL_VERSION;

const BG: Color = Color::Rgb(11, 13, 16);
const SURFACE: Color = Color::Rgb(18, 21, 26);
const BORDER: Color = Color::Rgb(54, 60, 70);
const TEXT: Color = Color::Rgb(222, 226, 232);
const MUTED: Color = Color::Rgb(126, 135, 149);
const ACCENT: Color = Color::Rgb(111, 211, 255);
const GREEN: Color = Color::Rgb(115, 210, 143);
const YELLOW: Color = Color::Rgb(235, 193, 92);
const RED: Color = Color::Rgb(242, 116, 116);

pub fn render(frame: &mut Frame<'_>, app: &App) {
    let area = frame.area();
    frame.render_widget(Block::default().style(Style::default().bg(BG)), area);
    if area.width < 48 || area.height < 14 {
        frame.render_widget(
            Paragraph::new("Rux TUI needs at least 48×14")
                .alignment(Alignment::Center)
                .style(Style::default().fg(YELLOW).bg(BG)),
            area,
        );
        return;
    }

    let overlay_height = match &app.overlay {
        Some(Overlay::Commands { items, .. } | Overlay::Files { items, .. }) => {
            u16::try_from(items.len())
                .unwrap_or(u16::MAX)
                .saturating_add(2)
                .clamp(3, 8)
        }
        _ => 0,
    };
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(1),
            Constraint::Min(5),
            Constraint::Length(overlay_height),
            Constraint::Length(4),
            Constraint::Length(1),
            Constraint::Length(1),
        ])
        .split(area);

    render_header(frame, rows[0], app);
    match app.screen {
        Screen::Welcome => render_welcome(frame, rows[1], app),
        Screen::Task => render_task(frame, rows[1], app),
    }
    if overlay_height > 0 {
        render_suggestions(frame, rows[2], app);
    }
    render_composer(frame, rows[3], app);
    render_status(frame, rows[4], app);
    render_shortcuts(frame, rows[5], app);

    if matches!(app.overlay, Some(Overlay::Rewind { .. })) {
        render_rewind(frame, area, app);
    }
    if matches!(app.overlay, Some(Overlay::TaskHistory { .. })) {
        render_task_history(frame, area, app);
    }
    if matches!(app.overlay, Some(Overlay::Evidence { .. })) {
        render_evidence(frame, area, app);
    }
    if matches!(app.overlay, Some(Overlay::Permission { .. })) {
        render_permission(frame, area, app);
    }
}

fn render_header(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(64), Constraint::Percentage(36)])
        .split(area);
    let left = match app.screen {
        Screen::Welcome => Line::from(vec![
            Span::styled(
                " Rux",
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            ),
            Span::styled("  coding-agent workbench", Style::default().fg(MUTED)),
        ]),
        Screen::Task => Line::from(vec![
            Span::styled(
                " TASK",
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!(
                    "  {}",
                    app.active_task_title.as_deref().unwrap_or("New task")
                ),
                Style::default().fg(TEXT),
            ),
            Span::styled(
                format!("  ·  {}", app.workspace_root.display()),
                Style::default().fg(MUTED),
            ),
        ]),
    };
    frame.render_widget(
        Paragraph::new(left).style(Style::default().bg(SURFACE)),
        columns[0],
    );

    let (connection, color) = if !app.runtime.connected_to_real_runtime {
        (format!("{} · NOT CONNECTED ", app.runtime.mode), YELLOW)
    } else if app.runtime_protocol_version == Some(u64::from(PROTOCOL_VERSION)) {
        (
            format!("{} · CONNECTED · v{} ", app.runtime.mode, PROTOCOL_VERSION),
            GREEN,
        )
    } else if app.runtime_protocol_version.is_some() {
        (format!("{} · INCOMPATIBLE ", app.runtime.mode), RED)
    } else {
        (format!("{} · NEGOTIATING ", app.runtime.mode), YELLOW)
    };
    frame.render_widget(
        Paragraph::new(connection)
            .alignment(Alignment::Right)
            .style(
                Style::default()
                    .fg(color)
                    .bg(SURFACE)
                    .add_modifier(Modifier::BOLD),
            ),
        columns[1],
    );
}

fn render_welcome(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let inner = area.inner(Margin::new(3, 1));
    let content = vec![
        Line::from(""),
        Line::from(Span::styled(
            "R  U  X",
            Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
        )),
        Line::from(""),
        Line::from(Span::styled(
            "Make agent runs visible, controllable, reviewable, recoverable.",
            Style::default().fg(TEXT),
        )),
        Line::from(""),
        Line::from(Span::styled(
            "Type a coding task below · / commands · @ workspace files",
            Style::default().fg(MUTED),
        )),
        Line::from(""),
        Line::from(Span::styled(
            &app.runtime.detail,
            Style::default().fg(YELLOW),
        )),
        Line::from(""),
        Line::from(Span::styled(
            format!("Next run · {}", app.run_configuration.summary()),
            Style::default().fg(MUTED),
        )),
    ];
    frame.render_widget(
        Paragraph::new(content)
            .alignment(Alignment::Center)
            .wrap(Wrap { trim: true })
            .style(Style::default().bg(BG)),
        inner,
    );
}

fn render_task(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let lines = transcript_lines(app);
    let visible_height = area.height.saturating_sub(1) as usize;
    let start = lines
        .len()
        .saturating_sub(visible_height + app.scroll_from_bottom);
    let end = (start + visible_height).min(lines.len());
    let visible = if start < end {
        lines[start..end].to_vec()
    } else {
        Vec::new()
    };
    let title = match app.focus {
        Focus::Scrollback => " SCROLLBACK · FOCUSED ",
        Focus::Composer => " SCROLLBACK ",
    };
    frame.render_widget(
        Paragraph::new(visible)
            .block(
                Block::default()
                    .title(title)
                    .title_style(Style::default().fg(if app.focus == Focus::Scrollback {
                        ACCENT
                    } else {
                        MUTED
                    }))
                    .borders(Borders::BOTTOM)
                    .border_style(Style::default().fg(BORDER)),
            )
            .style(Style::default().fg(TEXT).bg(BG))
            .wrap(Wrap { trim: false }),
        area,
    );
}

fn transcript_lines(app: &App) -> Vec<Line<'static>> {
    let mut lines = Vec::new();
    for entry in &app.entries {
        match entry {
            TranscriptEntry::User(text) => {
                lines.push(Line::from(Span::styled(
                    "YOU",
                    Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
                )));
                push_text(&mut lines, text, TEXT);
            }
            TranscriptEntry::Assistant {
                text,
                model,
                classification,
                total_tokens,
                ..
            } => {
                let evidence = format!(
                    " · {}{} · {}",
                    model.as_deref().unwrap_or("model not reported"),
                    classification
                        .as_deref()
                        .map_or_else(String::new, |value| format!(" · Auto {value}")),
                    total_tokens.map_or_else(
                        || "tokens not reported".into(),
                        |value| format!("{value} tokens")
                    ),
                );
                lines.push(Line::from(vec![
                    Span::styled(
                        "AGENT",
                        Style::default().fg(GREEN).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(evidence, Style::default().fg(MUTED)),
                ]));
                push_text(&mut lines, text, TEXT);
            }
            TranscriptEntry::Activity {
                title,
                detail,
                state,
                ..
            } => {
                let (marker, color) = match state.as_str() {
                    "done" => ("✓", GREEN),
                    "error" => ("×", RED),
                    _ => ("◌", YELLOW),
                };
                lines.push(Line::from(vec![
                    Span::styled(format!("{marker} "), Style::default().fg(color)),
                    Span::styled(title.clone(), Style::default().fg(TEXT)),
                    Span::styled(format!("  {detail}"), Style::default().fg(MUTED)),
                ]));
            }
            TranscriptEntry::System(text) => lines.push(Line::from(vec![
                Span::styled(
                    "NOTE  ",
                    Style::default().fg(YELLOW).add_modifier(Modifier::BOLD),
                ),
                Span::styled(text.clone(), Style::default().fg(MUTED)),
            ])),
            TranscriptEntry::Error(text) => lines.push(Line::from(vec![
                Span::styled(
                    "ERROR  ",
                    Style::default().fg(RED).add_modifier(Modifier::BOLD),
                ),
                Span::styled(text.clone(), Style::default().fg(RED)),
            ])),
        }
        lines.push(Line::from(""));
    }
    lines
}

fn push_text(lines: &mut Vec<Line<'static>>, text: &str, color: Color) {
    for line in text.lines() {
        lines.push(Line::from(Span::styled(
            line.to_owned(),
            Style::default().fg(color),
        )));
    }
}

fn render_suggestions(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let (title, items, selected) = match &app.overlay {
        Some(Overlay::Commands { items, selected }) => {
            (" COMMANDS · Tab/Enter complete ", items, *selected)
        }
        Some(Overlay::Files {
            items, selected, ..
        }) => (" FILE SEARCH · @ workspace paths ", items, *selected),
        _ => return,
    };
    let list_items = if items.is_empty() {
        vec![ListItem::new(Line::from(Span::styled(
            "No matches",
            Style::default().fg(MUTED),
        )))]
    } else {
        items
            .iter()
            .map(|item| {
                ListItem::new(Line::from(vec![
                    Span::styled(format!("{}  ", item.value), Style::default().fg(TEXT)),
                    Span::styled(item.description.clone(), Style::default().fg(MUTED)),
                ]))
            })
            .collect()
    };
    let mut state = ListState::default().with_selected((!items.is_empty()).then_some(selected));
    frame.render_stateful_widget(
        List::new(list_items)
            .block(
                Block::default()
                    .title(title)
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(ACCENT)),
            )
            .highlight_style(
                Style::default()
                    .fg(BG)
                    .bg(ACCENT)
                    .add_modifier(Modifier::BOLD),
            )
            .style(Style::default().bg(SURFACE)),
        area,
        &mut state,
    );
}

fn render_composer(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let focused = app.focus == Focus::Composer;
    let border = if focused { ACCENT } else { BORDER };
    let block = Block::default()
        .title(if focused {
            " MESSAGE · FOCUSED "
        } else {
            " MESSAGE "
        })
        .borders(Borders::ALL)
        .border_style(Style::default().fg(border))
        .style(Style::default().bg(SURFACE));
    let inner = block.inner(area);
    let text = app.composer_text();
    let paragraph = if text.is_empty() {
        Paragraph::new("› Describe a coding task…").style(Style::default().fg(MUTED).bg(SURFACE))
    } else {
        Paragraph::new(format!("› {text}"))
            .style(Style::default().fg(TEXT).bg(SURFACE))
            .wrap(Wrap { trim: false })
    };
    frame.render_widget(block, area);
    frame.render_widget(paragraph, inner);

    if focused
        && app.overlay.as_ref().is_none_or(|overlay| {
            matches!(overlay, Overlay::Commands { .. } | Overlay::Files { .. })
        })
    {
        let before: String = app.composer.iter().take(app.cursor).collect();
        let line = before.rsplit('\n').next().unwrap_or_default();
        let row = u16::try_from(
            before
                .chars()
                .filter(|character| *character == '\n')
                .count(),
        )
        .unwrap_or(u16::MAX);
        let line_width = u16::try_from(line.width()).unwrap_or(u16::MAX);
        let x = inner.x.saturating_add(2).saturating_add(line_width);
        let y = inner.y.saturating_add(row);
        if x < inner.right() && y < inner.bottom() {
            frame.set_cursor_position(Position::new(x, y));
        }
    }
}

fn render_status(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let color = if app.status_hint.contains("error") || app.status_hint.contains("failed") {
        RED
    } else if app.status_hint.contains("Demo") || app.status_hint.contains("not connected") {
        YELLOW
    } else {
        MUTED
    };
    frame.render_widget(
        Paragraph::new(format!(" {}", app.status_hint)).style(Style::default().fg(color).bg(BG)),
        area,
    );
}

fn render_shortcuts(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let columns = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(62), Constraint::Percentage(38)])
        .split(area);
    let hints = match &app.overlay {
        Some(Overlay::Commands { .. } | Overlay::Files { .. }) => {
            " ↑↓:navigate  Tab/Enter:complete  Esc:close"
        }
        Some(Overlay::Rewind { .. }) => " ↑↓:preview  Esc:close  restore:not wired",
        Some(Overlay::TaskHistory { .. }) => " ↑↓ browse · Enter open · Ctrl+T/Esc close",
        Some(Overlay::Evidence { expanded, .. }) => {
            if *expanded {
                " ↑↓ record · PgUp/PgDn detail · Enter collapse · Esc close"
            } else {
                " ↑↓ record · Enter expand · Ctrl+E/Esc close"
            }
        }
        Some(Overlay::Permission { .. }) => {
            " ↑↓ choose · Enter confirm · A approve · D deny · S/Ctrl+C stop"
        }
        None if matches!(
            app.run_state,
            RunState::Running { .. } | RunState::Cancelling { .. }
        ) =>
        {
            " Enter send · Tab switch · Ctrl+C cancel · Ctrl+E evidence"
        }
        None if app.focus == Focus::Scrollback => {
            " ↑↓/Pg scroll · Tab compose · Ctrl+T tasks · Ctrl+E evidence"
        }
        None => " Enter send · Ctrl+T tasks · Ctrl+E evidence · / commands",
    };
    frame.render_widget(
        Paragraph::new(hints).style(Style::default().fg(MUTED).bg(SURFACE)),
        columns[0],
    );
    frame.render_widget(
        Paragraph::new(format!(
            "{} · {} · {} ",
            adapter_label(&app.run_configuration.adapter),
            app.run_configuration.permission_mode,
            app.run_state.label()
        ))
        .alignment(Alignment::Right)
        .style(
            Style::default()
                .fg(run_color(&app.run_state))
                .bg(SURFACE)
                .add_modifier(Modifier::BOLD),
        ),
        columns[1],
    );
}

fn render_rewind(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let Some(Overlay::Rewind { points, selected }) = &app.overlay else {
        return;
    };
    let popup = centered_rect(72, 54, area);
    frame.render_widget(Clear, popup);
    let items = if points.is_empty() {
        vec![ListItem::new("No user turns to rewind")]
    } else {
        points
            .iter()
            .map(|point| ListItem::new(format!("Turn {}  {}", point.entry_index + 1, point.label)))
            .collect()
    };
    let mut state = ListState::default().with_selected((!points.is_empty()).then_some(*selected));
    frame.render_stateful_widget(
        List::new(items)
            .block(
                Block::default()
                    .title(" REWIND PREVIEW · NOT CONNECTED ")
                    .title_bottom(
                        Line::from(" Esc closes · no files or history will change ")
                            .alignment(Alignment::Center),
                    )
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(YELLOW))
                    .style(Style::default().bg(SURFACE)),
            )
            .highlight_style(Style::default().fg(BG).bg(YELLOW)),
        popup,
        &mut state,
    );
}

fn render_task_history(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let Some(Overlay::TaskHistory { items, selected }) = &app.overlay else {
        return;
    };
    let popup = centered_rect(92, 76, area);
    frame.render_widget(Clear, popup);
    let list_items = if items.is_empty() {
        vec![ListItem::new(Line::from(Span::styled(
            "No persisted Tasks yet · send a prompt to create one",
            Style::default().fg(MUTED),
        )))]
    } else {
        items
            .iter()
            .map(|task| task_history_line(task, app.active_task_id.as_deref()))
            .map(ListItem::new)
            .collect()
    };
    let mut state = ListState::default().with_selected((!items.is_empty()).then_some(*selected));
    frame.render_stateful_widget(
        List::new(list_items)
            .block(
                Block::default()
                    .title(format!(" TASK HISTORY · {} PERSISTED ", items.len()))
                    .title_bottom(
                        Line::from(" ↑↓ browse · Enter open · Ctrl+T/Esc close ")
                            .alignment(Alignment::Center),
                    )
                    .borders(Borders::ALL)
                    .border_style(Style::default().fg(ACCENT))
                    .style(Style::default().bg(SURFACE)),
            )
            .highlight_style(
                Style::default()
                    .fg(BG)
                    .bg(ACCENT)
                    .add_modifier(Modifier::BOLD),
            ),
        popup,
        &mut state,
    );
}

fn task_history_line(task: &TaskSummary, active_task_id: Option<&str>) -> Line<'static> {
    let active = active_task_id == Some(task.id.as_str());
    let marker = if active { "●" } else { "○" };
    let archive = if task.archived { " · archived" } else { "" };
    let pin = if task.pinned { " · pinned" } else { "" };
    Line::from(vec![
        Span::styled(
            format!("{marker} "),
            Style::default().fg(if active { GREEN } else { MUTED }),
        ),
        Span::styled(task.title.clone(), Style::default().fg(TEXT)),
        Span::styled(
            format!(
                "  {} · {} · {} run(s){pin}{archive}",
                task.status,
                adapter_label(&task.adapter),
                task.run_count
            ),
            Style::default().fg(MUTED),
        ),
    ])
}

fn render_evidence(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let Some(Overlay::Evidence {
        items,
        selected,
        expanded,
        detail_scroll,
    }) = &app.overlay
    else {
        return;
    };
    let popup = centered_rect(96, if *expanded { 92 } else { 64 }, area);
    frame.render_widget(Clear, popup);
    let outer = Block::default()
        .title(format!(" EVIDENCE INSPECTOR · {} RECORD(S) ", items.len()))
        .title_bottom(
            Line::from(if *expanded {
                " ↑↓ record · PgUp/PgDn detail · Enter collapse · Esc close "
            } else {
                " ↑↓ record · Enter expand · Ctrl+E/Esc close "
            })
            .alignment(Alignment::Center),
        )
        .borders(Borders::ALL)
        .border_style(Style::default().fg(ACCENT))
        .style(Style::default().bg(SURFACE));
    let inner = outer.inner(popup);
    frame.render_widget(outer, popup);

    let sections = if *expanded {
        Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Length(6), Constraint::Min(5)])
            .split(inner)
    } else {
        Layout::default()
            .direction(Direction::Vertical)
            .constraints([Constraint::Min(4), Constraint::Length(0)])
            .split(inner)
    };
    let list_items = if items.is_empty() {
        vec![ListItem::new(Line::from(Span::styled(
            "No structured evidence · run completion alone is not a pass",
            Style::default().fg(YELLOW),
        )))]
    } else {
        items
            .iter()
            .map(evidence_summary_line)
            .map(ListItem::new)
            .collect()
    };
    let mut state = ListState::default().with_selected((!items.is_empty()).then_some(*selected));
    frame.render_stateful_widget(
        List::new(list_items)
            .block(
                Block::default()
                    .title(" RECORDS ")
                    .borders(if *expanded {
                        Borders::BOTTOM
                    } else {
                        Borders::NONE
                    })
                    .border_style(Style::default().fg(BORDER)),
            )
            .highlight_style(
                Style::default()
                    .fg(BG)
                    .bg(ACCENT)
                    .add_modifier(Modifier::BOLD),
            ),
        sections[0],
        &mut state,
    );

    if *expanded {
        let detail = items.get(*selected).map_or_else(
            || {
                vec![Line::from(Span::styled(
                    "No evidence record selected",
                    Style::default().fg(MUTED),
                ))]
            },
            evidence_detail_lines,
        );
        frame.render_widget(
            Paragraph::new(detail)
                .block(Block::default().title(" DETAILS · RECORDED FACTS "))
                .scroll((u16::try_from(*detail_scroll).unwrap_or(u16::MAX), 0))
                .wrap(Wrap { trim: false })
                .style(Style::default().fg(TEXT).bg(SURFACE)),
            sections[1],
        );
    }
}

fn evidence_summary_line(item: &EvidenceItem) -> Line<'static> {
    match item {
        EvidenceItem::Verification {
            kind,
            status,
            command,
            ..
        } => {
            let (label, color) = verification_status(status);
            Line::from(vec![
                Span::styled(
                    format!("[{label}] "),
                    Style::default().fg(color).add_modifier(Modifier::BOLD),
                ),
                Span::styled(format!("{kind} · {command}"), Style::default().fg(TEXT)),
            ])
        }
        EvidenceItem::RunOwnedPatch {
            files,
            additions,
            deletions,
            ..
        } => Line::from(vec![
            Span::styled(
                "[RUN CHANGES] ",
                Style::default().fg(ACCENT).add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("{} file(s) · +{additions} -{deletions}", files.len()),
                Style::default().fg(TEXT),
            ),
        ]),
    }
}

fn evidence_detail_lines(item: &EvidenceItem) -> Vec<Line<'static>> {
    match item {
        EvidenceItem::Verification {
            id,
            run_id,
            kind,
            status,
            command,
            cwd,
            exit_code,
            finished_at,
            log,
            redacted,
            truncated,
        } => {
            let (label, color) = verification_status(status);
            let exit = exit_code.map_or_else(|| "unknown".into(), |code| code.to_string());
            let mut lines = vec![
                Line::from(vec![
                    Span::styled("STATUS  ", Style::default().fg(MUTED)),
                    Span::styled(
                        label,
                        Style::default().fg(color).add_modifier(Modifier::BOLD),
                    ),
                    Span::styled(
                        " · only the recorded status is shown",
                        Style::default().fg(MUTED),
                    ),
                ]),
                evidence_field("RUN", run_id),
                evidence_field("KIND", kind),
                evidence_field("COMMAND", command),
                evidence_field("CWD", cwd),
                evidence_field("EXIT", &exit),
                evidence_field("FINISHED", finished_at),
                evidence_field("RECORD", id),
                evidence_field(
                    "OUTPUT",
                    &format!("redacted={redacted} · truncated={truncated}"),
                ),
                Line::from(Span::styled("LOG", Style::default().fg(MUTED))),
            ];
            push_text(&mut lines, log, TEXT);
            lines
        }
        EvidenceItem::RunOwnedPatch {
            id,
            run_id,
            baseline_id,
            generated_at,
            before_tree_id,
            after_tree_id,
            snapshot_id,
            files,
            additions,
            deletions,
            binary_files,
        } => {
            let mut lines = vec![
                evidence_field("TYPE", "RUN-OWNED CHANGE ATTRIBUTION"),
                evidence_field("RUN", run_id),
                evidence_field("RECORD", id),
                evidence_field("BASELINE", baseline_id),
                evidence_field("BEFORE TREE", before_tree_id),
                evidence_field("AFTER TREE", after_tree_id),
                evidence_field("SNAPSHOT", snapshot_id),
                evidence_field("GENERATED", generated_at),
                evidence_field(
                    "TOTALS",
                    &format!(
                        "{} file(s) · +{additions} -{deletions} · {binary_files} binary",
                        files.len()
                    ),
                ),
                Line::from(Span::styled("FILES", Style::default().fg(MUTED))),
            ];
            lines.extend(files.iter().map(|file| {
                Line::from(vec![
                    Span::styled("  • ", Style::default().fg(ACCENT)),
                    Span::styled(file.path.clone(), Style::default().fg(TEXT)),
                    Span::styled(
                        format!(
                            " · {} · +{} -{}{}",
                            file.kind,
                            file.additions,
                            file.deletions,
                            if file.binary { " · binary" } else { "" }
                        ),
                        Style::default().fg(MUTED),
                    ),
                ])
            }));
            lines
        }
    }
}

fn evidence_field(label: &str, value: &str) -> Line<'static> {
    Line::from(vec![
        Span::styled(format!("{label}  "), Style::default().fg(MUTED)),
        Span::styled(value.to_owned(), Style::default().fg(TEXT)),
    ])
}

fn verification_status(status: &str) -> (&'static str, Color) {
    match status {
        "passed" => ("PASSED", GREEN),
        "failed" => ("FAILED", RED),
        _ => ("UNKNOWN", YELLOW),
    }
}

fn render_permission(frame: &mut Frame<'_>, area: Rect, app: &App) {
    let Some(Overlay::Permission { request, selected }) = &app.overlay else {
        return;
    };
    let popup = centered_rect(96, 88, area);
    frame.render_widget(Clear, popup);
    let outer = Block::default()
        .title(" PERMISSION REQUIRED · THIS RUN ONLY ")
        .title_bottom(
            Line::from(" ↑↓ choose · Enter confirm · A approve · D deny · S/Ctrl+C stop ")
                .alignment(Alignment::Center),
        )
        .borders(Borders::ALL)
        .border_style(Style::default().fg(YELLOW))
        .style(Style::default().bg(SURFACE));
    let inner = outer.inner(popup);
    frame.render_widget(outer, popup);
    let sections = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Min(9), Constraint::Length(5)])
        .split(inner);
    let detail = vec![
        evidence_field("ACTION", &request.action),
        evidence_field("SCOPE", &request.scope_path),
        evidence_field("APPLIES", &request.applies_to),
        evidence_field("REQUESTED", &request.requested_at),
        Line::from(""),
        Line::from(Span::styled("IMPACT", Style::default().fg(MUTED))),
        Line::from(Span::styled(
            request.impact.clone(),
            Style::default().fg(TEXT),
        )),
    ];
    frame.render_widget(
        Paragraph::new(detail)
            .wrap(Wrap { trim: false })
            .style(Style::default().fg(TEXT).bg(SURFACE)),
        sections[0],
    );
    let options = vec![
        ListItem::new("[A] Approve once · allow this Run in the shown Workspace"),
        ListItem::new("[D] Deny · do not launch this Run"),
        ListItem::new("[S] Stop · cancel the Run while approval is pending"),
    ];
    let mut state = ListState::default().with_selected(Some(*selected));
    frame.render_stateful_widget(
        List::new(options)
            .block(
                Block::default()
                    .title(" DECISION ")
                    .borders(Borders::TOP)
                    .border_style(Style::default().fg(BORDER)),
            )
            .highlight_style(
                Style::default()
                    .fg(BG)
                    .bg(YELLOW)
                    .add_modifier(Modifier::BOLD),
            ),
        sections[1],
        &mut state,
    );
}

fn centered_rect(percent_x: u16, percent_y: u16, area: Rect) -> Rect {
    let vertical = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(area);
    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(vertical[1])[1]
}

fn run_color(state: &RunState) -> Color {
    match state {
        RunState::Idle => MUTED,
        RunState::WaitingPermission { .. }
        | RunState::DecidingPermission { .. }
        | RunState::Cancelling { .. } => YELLOW,
        RunState::Running { .. } => GREEN,
    }
}

#[cfg(test)]
mod tests {
    use std::path::PathBuf;

    use ratatui::Terminal;
    use ratatui::backend::TestBackend;

    use super::*;
    use crate::app::FileIndex;
    use crate::runtime::RuntimeDescriptor;

    fn buffer_text(app: &App, width: u16, height: u16) -> String {
        let backend = TestBackend::new(width, height);
        let mut terminal = Terminal::new(backend).unwrap();
        terminal.draw(|frame| render(frame, app)).unwrap();
        let buffer = terminal.backend().buffer();
        (0..height)
            .map(|y| {
                (0..width)
                    .map(|x| buffer.cell((x, y)).unwrap().symbol())
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn app() -> App {
        App::new(
            PathBuf::from("/workspace"),
            RuntimeDescriptor::demo(),
            FileIndex::default(),
        )
    }

    #[test]
    fn welcome_is_full_screen_and_truthfully_labels_demo_runtime() {
        let text = buffer_text(&app(), 100, 30);
        assert!(text.contains("R  U  X"));
        assert!(text.contains("DEMO JSONL · NOT CONNECTED"));
        assert!(text.contains("Enter send"));
        assert!(text.contains("no real agent is connected"));
    }

    #[test]
    fn task_layout_contains_scrollback_composer_status_and_runtime_state() {
        let mut app = app();
        app.screen = Screen::Task;
        app.entries
            .push(TranscriptEntry::User("Fix the tests".into()));
        app.entries.push(TranscriptEntry::Assistant {
            run_id: "run-1".into(),
            text: "Inspecting the failure".into(),
            model: Some("gpt-test".into()),
            classification: Some("simple".into()),
            total_tokens: Some(12),
        });
        app.run_state = RunState::Running {
            run_id: "run-1".into(),
        };
        let text = buffer_text(&app, 100, 30);
        assert!(text.contains("SCROLLBACK"));
        assert!(text.contains("Fix the tests"));
        assert!(text.contains("gpt-test · Auto simple · 12 tokens"));
        assert!(text.contains("MESSAGE · FOCUSED"));
        assert!(text.contains("Ctrl+C cancel"));
        assert!(text.contains("RUNNING"));
    }

    #[test]
    fn task_history_is_keyboard_discoverable_at_eighty_by_twenty_four() {
        let mut app = app();
        app.screen = Screen::Task;
        app.active_task_id = Some("task-current".into());
        app.active_task_title = Some("Current task".into());
        app.overlay = Some(Overlay::TaskHistory {
            selected: 1,
            items: vec![
                TaskSummary {
                    id: "task-current".into(),
                    title: "Current task".into(),
                    status: "completed".into(),
                    updated_at: "2026-08-10T00:00:00Z".into(),
                    adapter: "codex".into(),
                    run_count: 2,
                    pinned: true,
                    archived: false,
                },
                TaskSummary {
                    id: "task-older".into(),
                    title: "Investigate flaky test".into(),
                    status: "stopped".into(),
                    updated_at: "2026-08-09T00:00:00Z".into(),
                    adapter: "claude-code".into(),
                    run_count: 1,
                    pinned: false,
                    archived: false,
                },
            ],
        });
        let text = buffer_text(&app, 80, 24);
        assert!(text.contains("TASK HISTORY · 2 PERSISTED"));
        assert!(text.contains("Investigate flaky test"));
        assert!(text.contains("Enter open"));
        assert!(text.contains("Ctrl+T/Esc close"));
    }

    #[test]
    fn evidence_inspector_keeps_unknown_explicit_at_eighty_by_twenty_four() {
        let mut app = app();
        app.screen = Screen::Task;
        app.overlay = Some(Overlay::Evidence {
            selected: 0,
            expanded: true,
            detail_scroll: 0,
            items: vec![EvidenceItem::Verification {
                id: "verification-1".into(),
                run_id: "run-1".into(),
                kind: "test".into(),
                status: "unknown".into(),
                command: "npm test".into(),
                cwd: "/workspace".into(),
                exit_code: None,
                finished_at: "2026-08-10T00:00:00Z".into(),
                log: "Adapter did not expose an authoritative result".into(),
                redacted: true,
                truncated: false,
            }],
        });
        let text = buffer_text(&app, 80, 24);
        assert!(text.contains("EVIDENCE INSPECTOR · 1 RECORD(S)"));
        assert!(text.contains("[UNKNOWN]"));
        assert!(text.contains("COMMAND  npm test"));
        assert!(text.contains("only the recorded status is shown"));
        assert!(!text.contains("[PASSED]"));
    }

    #[test]
    fn blocking_permission_exposes_action_scope_impact_and_choices_at_eighty_by_twenty_four() {
        let mut app = app();
        app.screen = Screen::Task;
        let request = crate::persistence::PendingPermission {
            id: "permission-1".into(),
            run_id: "run-1".into(),
            action: "workspace.write".into(),
            scope_path: "/workspace".into(),
            applies_to: "this-run".into(),
            impact: "May create, modify, or delete files inside this Workspace.".into(),
            requested_at: "2026-08-11T00:00:00Z".into(),
        };
        app.pending_permission = Some(request.clone());
        app.run_state = RunState::WaitingPermission {
            run_id: "run-1".into(),
            request_id: "permission-1".into(),
        };
        app.overlay = Some(Overlay::Permission {
            request,
            selected: 0,
        });
        let text = buffer_text(&app, 80, 24);
        assert!(text.contains("PERMISSION REQUIRED · THIS RUN ONLY"));
        assert!(text.contains("ACTION  workspace.write"));
        assert!(text.contains("SCOPE  /workspace"));
        assert!(text.contains("May create, modify, or delete files"));
        assert!(text.contains("[A] Approve once"));
        assert!(text.contains("[D] Deny"));
        assert!(text.contains("[S] Stop"));
        assert!(text.contains("A approve · D deny"));
    }
}
