use std::path::PathBuf;

use rux_tui::app::FileIndex;
use rux_tui::protocol::decode_wire_message;
use rux_tui::runtime::DemoRuntimeClient;
use rux_tui::{Action, App, RunState, RuntimeClient, Screen, TranscriptEntry, execute_effects};

#[test]
fn prompt_to_jsonl_demo_to_completed_transcript_is_a_runnable_honest_loop() {
    let mut runtime = DemoRuntimeClient::new("/workspace").unwrap();
    let mut app = App::new(
        PathBuf::from("/workspace"),
        runtime.descriptor(),
        FileIndex::default(),
    );

    for line in runtime.poll_lines().unwrap() {
        app.update(Action::Runtime(decode_wire_message(&line).unwrap()));
    }
    assert_eq!(app.screen, Screen::Welcome);
    for character in "inspect the project".chars() {
        app.update(Action::Insert(character));
    }
    let effects = app.update(Action::Submit);
    assert!(!execute_effects(&mut app, &mut runtime, effects));
    assert!(matches!(app.run_state, RunState::Running { .. }));

    while let Some(line) = runtime.poll_lines().unwrap().into_iter().next() {
        app.update(Action::Runtime(decode_wire_message(&line).unwrap()));
    }

    assert_eq!(app.run_state, RunState::Idle);
    assert!(app.entries.iter().any(|entry| matches!(
        entry,
        TranscriptEntry::Assistant { text, .. }
            if text.contains("No real coding agent ran")
    )));
    assert!(app.entries.iter().any(|entry| matches!(
        entry,
        TranscriptEntry::Activity { state, .. } if state == "done"
    )));
    assert!(app.status_hint.contains("no verification is implied"));
}
