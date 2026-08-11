use crate::action::Action;
use crate::app::App;
use crate::protocol::{RuntimeRequest, encode_jsonl};
use crate::runtime::RuntimeClient;

#[derive(Clone, Debug, PartialEq)]
pub enum Effect {
    SendRuntime(RuntimeRequest),
    Quit,
}

/// Executes reducer-produced effects. Returns `true` when the event loop should
/// quit. Transport failures are fed back through `Action`, keeping state
/// transitions observable and testable.
pub fn execute_effects(
    app: &mut App,
    runtime: &mut dyn RuntimeClient,
    effects: Vec<Effect>,
) -> bool {
    for effect in effects {
        match effect {
            Effect::Quit => return true,
            Effect::SendRuntime(request) => {
                let result = encode_jsonl(&request).and_then(|line| runtime.send_line(&line));
                if let Err(error) = result {
                    app.update(Action::RuntimeTransportError(error.to_string()));
                }
            }
        }
    }
    false
}
