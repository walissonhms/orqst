//! Port of `owned-claude-hooks.ts`. The generated hook script is the exact TypeScript
//! template (`claude-hooks.cjs.template`, placeholders `__ORQST_EXPECTED__`/`__ORQST_MAXIMUM__`).
use super::config::ClaudeConfig;
use super::fsx::{getuid, realpath, terminal_directory, terminal_file};
use super::js::{self, Js};
use super::nodepath::join2;
use super::validate::uuid_pattern;
use super::{ProfileError, Result};
use std::fs::OpenOptions;
use std::io::{Read, Seek, SeekFrom};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};

pub const CHANNEL_MAXIMUM: u64 = 128 * 1024;
pub const SETTINGS_NAME: &str = "claude-hooks-settings.json";
pub const SCRIPT_NAME: &str = "claude-hooks.cjs";
/// `claudeOwnedHookChannelName`.
pub const CHANNEL_NAME: &str = "claude-hook-events.jsonl";
const TEMPLATE: &str = include_str!("claude-hooks.cjs.template");

/// `claudeOwnedHooksPath`.
pub fn claude_owned_hooks_path(config: &ClaudeConfig) -> String {
    join2(&config.state, SETTINGS_NAME)
}

/// Claude's transcript path for this exact session (`project` spelling as given).
pub fn claude_transcript_root(config: &ClaudeConfig) -> String {
    config
        .authentication
        .claude_config_directory
        .clone()
        .unwrap_or_else(|| join2(&config.authentication.home, ".claude"))
}

pub fn sanitize_project(project: &str) -> String {
    // Per UTF-16 code unit, as `replace(/[^a-zA-Z0-9-]/g, '-')`.
    let mut out = String::with_capacity(project.len());
    for c in project.chars() {
        if c.is_ascii_alphanumeric() || c == '-' {
            out.push(c);
        } else {
            out.extend(std::iter::repeat_n('-', c.len_utf16()));
        }
    }
    out
}

/// `claudeOwnedHookFiles`: `[(name, exact content)]` in TypeScript key order.
pub fn claude_owned_hook_files(config: &ClaudeConfig) -> Vec<(String, String)> {
    let root = claude_transcript_root(config);
    let transcript = join2(
        &join2(
            &join2(&root, "projects"),
            &sanitize_project(&config.project),
        ),
        &format!("{}.jsonl", config.session_id),
    );
    let expected = Js::obj([
        ("sessionId", Js::str(&config.session_id)),
        ("project", Js::str(&config.project)),
        ("transcript", Js::Str(transcript)),
        ("state", Js::str(&config.state)),
        ("channel", Js::Str(join2(&config.state, CHANNEL_NAME))),
    ]);
    let script = TEMPLATE
        .replace("__ORQST_EXPECTED__", &expected.stringify())
        .replace("__ORQST_MAXIMUM__", &CHANNEL_MAXIMUM.to_string());
    let quote = |word: &str| format!("'{}'", word.replace('\'', "'\"'\"'"));
    let command = format!(
        "{} {}",
        quote(&config.node.path),
        quote(&join2(&config.state, SCRIPT_NAME))
    );
    let handler = || {
        Js::obj([
            ("type", Js::str("command")),
            ("command", Js::str(&command)),
            ("timeout", Js::Num(2.0)),
        ])
    };
    let plain = || Js::Arr(vec![Js::obj([("hooks", Js::Arr(vec![handler()]))])]);
    let settings = Js::obj([(
        "hooks",
        Js::obj([
            ("UserPromptSubmit", plain()),
            ("PostToolUse", plain()),
            ("PostToolUseFailure", plain()),
            (
                "Notification",
                Js::Arr(vec![Js::obj([
                    ("matcher", Js::str("permission_prompt|idle_prompt")),
                    ("hooks", Js::Arr(vec![handler()])),
                ])]),
            ),
            ("Stop", plain()),
            ("StopFailure", plain()),
        ]),
    )])
    .stringify()
        + "\n";
    vec![
        (SETTINGS_NAME.to_owned(), settings),
        (SCRIPT_NAME.to_owned(), script),
    ]
}

fn hooks_contract(config: &ClaudeConfig) -> Result<()> {
    if config.executable_version != "2.1.318" || (config.interactive.mcp && !config.interactive.hub)
    {
        return Err(ProfileError::refused(
            "Owned hooks require the reviewed Claude TUI contract",
        ));
    }
    Ok(())
}

/// `validateClaudeOwnedHooks`: exact generated files are part of the approved profile.
pub fn validate_claude_owned_hooks(config: &ClaudeConfig) -> Result<()> {
    if !config.owned_hooks {
        return Ok(());
    }
    hooks_contract(config)?;
    terminal_directory(&config.state, true)?;
    for (name, expected) in claude_owned_hook_files(config) {
        let bytes = terminal_file(&join2(&config.state, &name), true, 16 * 1024, None)?;
        if String::from_utf8_lossy(&bytes) != expected {
            return Err(ProfileError::refused("Owned hook configuration changed"));
        }
    }
    Ok(())
}

/// Turn state derived from explicit hook records.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HookTurn {
    /// `running` | `waiting_for_user` | `completed` | `failed` | `unknown`.
    pub agent_state: &'static str,
    pub turn_id: Option<String>,
}

impl HookTurn {
    pub fn unknown() -> Self {
        HookTurn {
            agent_state: "unknown",
            turn_id: None,
        }
    }
}

struct Inspected {
    dev: u64,
    ino: u64,
    bytes: Vec<u8>,
}

/// `ownedClaudeHookEvidence`: pins the empty channel before dispatch.
pub struct OwnedHookEvidence {
    config: ClaudeConfig,
    file: String,
    initial: (u64, u64),
    invalid: bool,
    previous: Vec<u8>,
}

impl OwnedHookEvidence {
    pub fn new(config: &ClaudeConfig) -> Result<Self> {
        validate_claude_owned_hooks(config)?;
        let file = join2(&config.state, CHANNEL_NAME);
        let initial = inspect(config, &file)?;
        if !initial.bytes.is_empty() {
            return Err(ProfileError::refused(
                "Existing hook channel cannot be adopted",
            ));
        }
        Ok(OwnedHookEvidence {
            config: config.clone(),
            file,
            initial: (initial.dev, initial.ino),
            invalid: false,
            previous: Vec::new(),
        })
    }

    /// One evaluation of the returned TypeScript closure; any failure is `unknown`.
    pub fn poll(&mut self) -> HookTurn {
        if self.invalid {
            return HookTurn::unknown();
        }
        self.poll_inner().unwrap_or_else(|_| HookTurn::unknown())
    }

    fn poll_inner(&mut self) -> Result<HookTurn> {
        validate_claude_owned_hooks(&self.config)?;
        let current = inspect(&self.config, &self.file)?;
        if (current.ino, current.dev) != (self.initial.1, self.initial.0)
            || current.bytes.len() < self.previous.len()
            || current.bytes[..self.previous.len()] != self.previous[..]
        {
            self.invalid = true;
            return Ok(HookTurn::unknown());
        }
        self.previous = current.bytes.clone();
        if current.bytes.is_empty() {
            return Ok(HookTurn::unknown());
        }
        let text = std::str::from_utf8(&current.bytes).map_err(|_| ProfileError::schema("utf8"))?;
        if !text.ends_with('\n') {
            return Ok(HookTurn::unknown());
        }
        let mut state = HookTurn::unknown();
        let mut closed: Vec<String> = Vec::new();
        for line in text[..text.len() - 1].split('\n') {
            if js::js_len(line) > 512 {
                return Ok(HookTurn::unknown());
            }
            let (session_id, prompt_id, event) = hook_record(line)?;
            if session_id != self.config.session_id {
                return Ok(HookTurn::unknown());
            }
            if event == "unmatched" {
                closed.push(prompt_id);
                state = HookTurn::unknown();
                continue;
            }
            if event == "prompt" {
                if closed.contains(&prompt_id) {
                    return Ok(HookTurn::unknown());
                }
                if let Some(turn) = &state.turn_id {
                    if *turn != prompt_id {
                        closed.push(turn.clone());
                    }
                }
                state = HookTurn {
                    agent_state: "running",
                    turn_id: Some(prompt_id),
                };
            } else {
                let Some(turn) = &state.turn_id else { continue };
                if *turn != prompt_id {
                    return Ok(HookTurn::unknown());
                }
                let agent_state = match event.as_str() {
                    "progress" => "running",
                    "stop" => "completed",
                    "failure" => "failed",
                    _ => "waiting_for_user",
                };
                state = HookTurn {
                    agent_state,
                    turn_id: Some(prompt_id),
                };
            }
        }
        Ok(state)
    }
}

const HOOK_EVENTS: [&str; 7] = [
    "prompt",
    "progress",
    "permission_prompt",
    "idle_prompt",
    "stop",
    "failure",
    "unmatched",
];

/// `hookRecord.parse(JSON.parse(line))` (strict object).
fn hook_record(line: &str) -> Result<(String, String, String)> {
    let value = js::parse(line).map_err(ProfileError::schema)?;
    let bad = || ProfileError::schema("hook record");
    let Js::Obj(entries) = &value else {
        return Err(bad());
    };
    if entries
        .iter()
        .any(|(k, _)| !["version", "sessionId", "promptId", "event", "at"].contains(&k.as_str()))
    {
        return Err(bad());
    }
    if value.get("version") != Some(&Js::Num(1.0)) {
        return Err(bad());
    }
    let uuid = |k: &str| {
        value
            .get(k)
            .and_then(Js::as_str)
            .filter(|s| uuid_pattern().is_match(s))
            .map(str::to_owned)
            .ok_or_else(bad)
    };
    let (session_id, prompt_id) = (uuid("sessionId")?, uuid("promptId")?);
    let event = value
        .get("event")
        .and_then(Js::as_str)
        .filter(|e| HOOK_EVENTS.contains(e))
        .ok_or_else(bad)?;
    match value.get("at") {
        Some(Js::Num(n)) if n.fract() == 0.0 && *n >= 0.0 && *n <= 9_007_199_254_740_991.0 => {}
        _ => return Err(bad()),
    }
    Ok((session_id, prompt_id, event.to_owned()))
}

fn inspect(config: &ClaudeConfig, file: &str) -> Result<Inspected> {
    terminal_directory(&config.state, true)?;
    if realpath(file)? != file {
        return Err(ProfileError::refused("Owned hook channel changed"));
    }
    let mut fd = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
        .open(file)
        .map_err(super::fsx::io)?;
    let info = fd.metadata().map_err(super::fsx::io)?;
    if !info.is_file()
        || info.uid() != getuid()
        || info.mode() & 0o077 != 0
        || info.nlink() != 1
        || info.size() >= CHANNEL_MAXIMUM
    {
        return Err(ProfileError::refused("Owned hook channel unavailable"));
    }
    let mut bytes = vec![0u8; info.size() as usize];
    fd.seek(SeekFrom::Start(0)).map_err(super::fsx::io)?;
    let mut offset = 0;
    while offset < bytes.len() {
        let count = fd.read(&mut bytes[offset..]).map_err(super::fsx::io)?;
        if count == 0 {
            return Err(ProfileError::refused("Incomplete owned hook channel"));
        }
        offset += count;
    }
    let after = fd.metadata().map_err(super::fsx::io)?;
    if after.size() != info.size()
        || after.mtime() != info.mtime()
        || after.mtime_nsec() != info.mtime_nsec()
    {
        return Err(ProfileError::refused(
            "Owned hook channel changed during read",
        ));
    }
    Ok(Inspected {
        dev: info.dev(),
        ino: info.ino(),
        bytes,
    })
}
