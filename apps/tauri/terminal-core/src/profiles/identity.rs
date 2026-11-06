//! Port of `identity.ts`. Metadata only: never an authority, process binding or target.
use super::js::Js;
use super::terminal_digest;

/// `terminalIdentity(config)`: `(terminalId, alias)`.
pub fn terminal_identity(state: &str, identity: Option<&str>) -> (String, String) {
    if let Some(id) = identity {
        return (id.to_owned(), format!("P-{id}"));
    }
    let hash = terminal_digest(Js::strs(["legacy-terminal-state", state]).stringify());
    let id = format!(
        "{}-{}-5{}-a{}-{}",
        &hash[0..8],
        &hash[8..12],
        &hash[13..16],
        &hash[17..20],
        &hash[20..32]
    );
    let alias = format!("P-{id}");
    (id, alias)
}
