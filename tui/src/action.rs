use crossterm::event::{KeyCode, KeyEvent, KeyEventKind, KeyModifiers};

use crate::protocol::RuntimeWireMessage;

#[derive(Clone, Debug, PartialEq)]
pub enum Action {
    Tick { at_ms: u64 },
    Quit,
    ToggleTaskHistory,
    ToggleEvidence,
    ToggleFocus,
    Insert(char),
    InsertNewline,
    Backspace,
    Delete,
    MoveCursorLeft,
    MoveCursorRight,
    MoveCursorStart,
    MoveCursorEnd,
    Submit,
    MoveSelection(i8),
    PageUp,
    PageDown,
    Escape { at_ms: u64 },
    Cancel,
    Runtime(RuntimeWireMessage),
    RuntimeTransportError(String),
}

#[must_use]
pub fn action_from_key(key: KeyEvent, at_ms: u64) -> Option<Action> {
    if !matches!(key.kind, KeyEventKind::Press | KeyEventKind::Repeat) {
        return None;
    }

    if key.modifiers.contains(KeyModifiers::CONTROL) {
        return match key.code {
            KeyCode::Char('c') => Some(Action::Cancel),
            KeyCode::Char('q') => Some(Action::Quit),
            KeyCode::Char('t') => Some(Action::ToggleTaskHistory),
            KeyCode::Char('e') => Some(Action::ToggleEvidence),
            _ => None,
        };
    }

    match key.code {
        KeyCode::Tab | KeyCode::BackTab => Some(Action::ToggleFocus),
        KeyCode::Esc => Some(Action::Escape { at_ms }),
        KeyCode::Enter if key.modifiers.contains(KeyModifiers::SHIFT) => {
            Some(Action::InsertNewline)
        }
        KeyCode::Enter => Some(Action::Submit),
        KeyCode::Backspace => Some(Action::Backspace),
        KeyCode::Delete => Some(Action::Delete),
        KeyCode::Left => Some(Action::MoveCursorLeft),
        KeyCode::Right => Some(Action::MoveCursorRight),
        KeyCode::Home => Some(Action::MoveCursorStart),
        KeyCode::End => Some(Action::MoveCursorEnd),
        KeyCode::Up => Some(Action::MoveSelection(-1)),
        KeyCode::Down => Some(Action::MoveSelection(1)),
        KeyCode::PageUp => Some(Action::PageUp),
        KeyCode::PageDown => Some(Action::PageDown),
        KeyCode::Char(character)
            if key.modifiers.is_empty() || key.modifiers == KeyModifiers::SHIFT =>
        {
            Some(Action::Insert(character))
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ctrl_c_is_cancel_and_escape_is_distinct() {
        let ctrl_c = KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL);
        assert_eq!(action_from_key(ctrl_c, 42), Some(Action::Cancel));
        assert_eq!(
            action_from_key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE), 42),
            Some(Action::Escape { at_ms: 42 })
        );
        assert_eq!(
            action_from_key(KeyEvent::new(KeyCode::Char('t'), KeyModifiers::CONTROL), 42),
            Some(Action::ToggleTaskHistory)
        );
        assert_eq!(
            action_from_key(KeyEvent::new(KeyCode::Char('e'), KeyModifiers::CONTROL), 42),
            Some(Action::ToggleEvidence)
        );
    }
}
