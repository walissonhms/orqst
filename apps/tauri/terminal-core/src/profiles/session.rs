//! Port of `owned-claude-session.ts`: a passive reader created only when the exact random
//! Claude session path was absent before this one-shot owned launch. Failure never prevents
//! or retries dispatch. Project directory spelling follows Anywh transcriptPath/sanitizeCwd
//! at 546f189c04415c3c5af5f40e3931a0a90b9aba31 (Apache-2.0), via the TypeScript port.
use super::config::ClaudeConfig;
use super::fsx::{getuid, lstat, realpath, terminal_directory};
use super::hooks::{claude_transcript_root, sanitize_project, HookTurn, OwnedHookEvidence};
use super::js::{self, js_len, Js};
use super::nodepath::{dirname, join2};
use super::validate::{date_parse, datetime_pattern, hex64_pattern, uuid_pattern};
use super::{now_ms, terminal_digest, Result};
use regex::Regex;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::sync::OnceLock;

const MAXIMUM: u64 = 2 * 1024 * 1024;
const LINE_MAXIMUM: usize = 64 * 1024;
const SAFE: u64 = 9_007_199_254_740_991;

/// `lifecycleBindingSchema` (`lifecycle-receipt.ts`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LifecycleBinding {
    pub instance_id: String,
    pub epoch: String,
    pub manifest_digest: String,
    pub config_digest: String,
}

impl LifecycleBinding {
    fn valid(&self) -> bool {
        uuid_pattern().is_match(&self.instance_id)
            && uuid_pattern().is_match(&self.epoch)
            && hex64_pattern().is_match(&self.manifest_digest)
            && hex64_pattern().is_match(&self.config_digest)
    }
    fn to_js(&self) -> Js {
        Js::obj([
            ("instanceId", Js::str(&self.instance_id)),
            ("epoch", Js::str(&self.epoch)),
            ("manifestDigest", Js::str(&self.manifest_digest)),
            ("configDigest", Js::str(&self.config_digest)),
        ])
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Activity {
    pub at: u64,
    /// Always `tool`.
    pub kind: &'static str,
    pub label: String,
}

/// One observation (`session` is always `{ provider: 'claude', sessionId,
/// bindingEvidence: 'claude-argv-receipt-transcript' }`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SessionSnapshot {
    pub session_id: String,
    pub activities: Vec<Activity>,
    pub turn: HookTurn,
}

pub struct OwnedClaudeSession {
    config: ClaudeConfig,
    binding: LifecycleBinding,
    hooks: Option<OwnedHookEvidence>,
    root: String,
    project: String,
    file: String,
    identity: Option<(u64, u64)>,
    invalidated: bool,
    persisted: bool,
}

fn token_pattern() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| {
        Regex::new(r"(?-u:\b)(?:sk-[A-Za-z0-9_-]{12,}|gh[pousr]_[A-Za-z0-9_]{15,}|github_pat_[A-Za-z0-9_]{15,}|xox[baprs]-[A-Za-z0-9-]{10,}|AKIA[A-Z0-9]{16})(?-u:\b)|(?-u:\b)eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+(?-u:\b)")
            .expect("static pattern")
    })
}

/// `redact(name) === name` for names of `/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/`: only the token
/// and JWT rules of `@orqst/shared` `redact` can match that alphabet.
fn tool_name_unredacted(name: &str) -> bool {
    !token_pattern().is_match(name)
}

fn tool_name_ok(name: &str) -> bool {
    let b = name.as_bytes();
    !b.is_empty()
        && b.len() <= 64
        && b[0].is_ascii_alphabetic()
        && b[1..]
            .iter()
            .all(|c| c.is_ascii_alphanumeric() || b"_.-".contains(c))
}

fn is_type(value: &Js, expected: &str) -> bool {
    value.is_object() && value.get("type").and_then(Js::as_str) == Some(expected)
}

struct TurnRecord<'a> {
    session_id: &'a str,
    cwd: &'a str,
    kind: &'a str,
    uuid: Option<&'a str>,
    is_meta: bool,
    is_sidechain: bool,
    is_api_error: bool,
    content: Option<&'a Js>,
    stop_reason: Option<&'a str>,
}

/// `turnRecord.safeParse(raw)`.
fn turn_record(raw: &Js) -> Option<TurnRecord<'_>> {
    if !raw.is_object() {
        return None;
    }
    let s = |k: &str| raw.get(k).and_then(Js::as_str);
    let kind = s("type").filter(|t| *t == "user" || *t == "assistant")?;
    let uuid = match raw.get("uuid") {
        None => None,
        Some(v) => Some(v.as_str().filter(|u| uuid_pattern().is_match(u))?),
    };
    let flag = |k: &str| -> Option<bool> {
        match raw.get(k) {
            None => Some(false),
            Some(Js::Bool(b)) => Some(*b),
            Some(_) => None,
        }
    };
    let message = raw.get("message").filter(|m| m.is_object())?;
    let stop_reason = match message.get("stop_reason") {
        None | Some(Js::Null) => None,
        Some(Js::Str(r)) => Some(r.as_str()),
        Some(_) => return None,
    };
    Some(TurnRecord {
        session_id: s("sessionId")?,
        cwd: s("cwd")?,
        kind,
        uuid,
        is_meta: flag("isMeta")?,
        is_sidechain: flag("isSidechain")?,
        is_api_error: flag("isApiErrorMessage")?,
        content: message.get("content"),
        stop_reason,
    })
}

impl OwnedClaudeSession {
    /// `ownedClaudeSession(config, binding)`; `None` where TypeScript returns `undefined`.
    pub fn new(config: &ClaudeConfig, binding: &LifecycleBinding) -> Option<Self> {
        if !binding.valid() {
            return None;
        }
        let hooks = if config.owned_hooks {
            Some(OwnedHookEvidence::new(config).ok()?)
        } else {
            None
        };
        let root = claude_transcript_root(config);
        terminal_directory(&root, false).ok()?;
        terminal_directory(&config.project, false).ok()?;
        let project = realpath(&config.project).ok()?;
        let file = join2(
            &join2(&join2(&root, "projects"), &sanitize_project(&project)),
            &format!("{}.jsonl", config.session_id),
        );
        match lstat(&file) {
            Ok(_) => return None,
            Err(error) if error.io_code() != Some("ENOENT") => return None,
            Err(_) => {}
        }
        Some(OwnedClaudeSession {
            config: config.clone(),
            binding: binding.clone(),
            hooks,
            root,
            project,
            file,
            identity: None,
            invalidated: false,
            persisted: false,
        })
    }

    fn persist(&mut self, dev: u64, ino: u64, record: &str) -> bool {
        if self.persisted {
            return true;
        }
        if self.invalidated {
            return false;
        }
        // An uncertain evidence write is never retried and no partial file is removed.
        self.invalidated = true;
        let result = (|| -> std::io::Result<()> {
            terminal_directory(&self.config.state, true)
                .map_err(|_| std::io::Error::other("state"))?;
            let path = join2(
                &self.config.state,
                &format!("session-binding-{}.json", self.binding.instance_id),
            );
            let mut out = OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW)
                .open(path)?;
            let bytes = Js::obj([
                ("version", Js::Num(1.0)),
                ("binding", self.binding.to_js()),
                ("provider", Js::str("claude")),
                ("sessionId", Js::str(&self.config.session_id)),
                ("evidence", Js::str("claude-argv-receipt-transcript")),
                ("recordedAt", Js::Num(now_ms())),
                (
                    "source",
                    Js::obj([
                        ("dev", Js::Num(dev as f64)),
                        ("ino", Js::Num(ino as f64)),
                        ("recordSha256", Js::str(record)),
                    ]),
                ),
            ])
            .stringify()
                + "\n";
            out.write_all(bytes.as_bytes())?;
            out.sync_all()?;
            let directory = OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_NOFOLLOW | libc::O_DIRECTORY)
                .open(&self.config.state)?;
            directory.sync_all()?;
            Ok(())
        })();
        if result.is_ok() {
            self.persisted = true;
            self.invalidated = false;
        }
        result.is_ok()
    }

    /// One evaluation of the returned TypeScript closure.
    pub fn poll(&mut self) -> Option<SessionSnapshot> {
        if self.invalidated {
            return None;
        }
        match self.poll_inner() {
            Ok(value) => value,
            Err(_) => {
                if self.identity.is_some() {
                    self.invalidated = true;
                }
                None
            }
        }
    }

    fn poll_inner(&mut self) -> Result<Option<SessionSnapshot>> {
        terminal_directory(&self.root, false)?;
        terminal_directory(&dirname(&self.file), false)?;
        if realpath(&self.file)? != self.file || realpath(&self.config.project)? != self.project {
            return Ok(None);
        }
        let mut fd = OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(&self.file)
            .map_err(super::fsx::io)?;
        let info = fd.metadata().map_err(super::fsx::io)?;
        if !info.is_file()
            || info.uid() != getuid()
            || info.mode() & 0o022 != 0
            || info.nlink() != 1
            || info.size() > MAXIMUM
            || info.dev() > SAFE
            || info.ino() > SAFE
        {
            return Ok(None);
        }
        if let Some(identity) = self.identity {
            if identity != (info.dev(), info.ino()) {
                self.invalidated = true;
                return Ok(None);
            }
        }
        let identity = *self.identity.get_or_insert((info.dev(), info.ino()));
        let mut bytes = Vec::new();
        (&mut fd)
            .take(MAXIMUM + 1)
            .read_to_end(&mut bytes)
            .map_err(super::fsx::io)?;
        if bytes.len() as u64 > MAXIMUM {
            return Ok(None);
        }
        let text = std::str::from_utf8(&bytes).map_err(|_| super::ProfileError::schema("utf8"))?;
        let mut lines: Vec<&str> = text.split('\n').collect();
        let partial = lines.pop().unwrap_or_default();
        let mut activities: Vec<Activity> = Vec::new();
        let mut agent_state = "unknown";
        let mut turn_id: Option<String> = None;
        let mut matched: Option<String> = None;
        let start = lines.len().saturating_sub(512);
        let session_id = self.config.session_id.clone();
        for line in &lines[start..] {
            if line.is_empty() {
                continue;
            }
            if js_len(line) > LINE_MAXIMUM {
                agent_state = "unknown";
                turn_id = None;
                continue;
            }
            let Ok(raw) = js::parse(line) else {
                agent_state = "unknown";
                turn_id = None;
                continue;
            };
            let turn = turn_record(&raw);
            if turn.is_none()
                && raw.is_object()
                && raw.get("sessionId").and_then(Js::as_str) == Some(session_id.as_str())
                && raw.get("cwd").and_then(Js::as_str) == Some(self.project.as_str())
                && matches!(
                    raw.get("type").and_then(Js::as_str),
                    Some("user" | "assistant")
                )
            {
                agent_state = "unknown";
                turn_id = None;
            }
            if let Some(record) =
                turn.filter(|t| t.session_id == session_id && t.cwd == self.project)
            {
                if record.is_sidechain {
                    continue;
                }
                if record.kind == "user" && !record.is_meta {
                    let is_prompt = match record.content {
                        Some(Js::Str(_)) => true,
                        Some(Js::Arr(items)) => {
                            items.iter().any(|i| is_type(i, "text"))
                                && !items.iter().any(|i| is_type(i, "tool_result"))
                        }
                        _ => false,
                    };
                    if is_prompt {
                        turn_id = record.uuid.map(str::to_owned);
                        agent_state = if turn_id.is_some() {
                            "running"
                        } else {
                            "unknown"
                        };
                    } else if agent_state == "completed" || agent_state == "failed" {
                        agent_state = "unknown";
                    }
                } else if record.kind == "assistant" && turn_id.is_some() {
                    if record.is_api_error {
                        agent_state = "failed";
                    } else if record.stop_reason == Some("end_turn") {
                        agent_state = "completed";
                    } else if record.stop_reason == Some("tool_use") {
                        let asks = matches!(record.content, Some(Js::Arr(items)) if items.iter().any(|b| {
                            is_type(b, "tool_use") && b.get("name").and_then(Js::as_str) == Some("AskUserQuestion")
                        }));
                        agent_state = if asks { "unknown" } else { "running" };
                    }
                }
            }
            // `lineSchema`.
            let Some(timestamp) = raw.get("timestamp").and_then(Js::as_str) else {
                continue;
            };
            let message = raw.get("message").filter(|m| m.is_object());
            let content = match message.and_then(|m| m.get("content")) {
                Some(Js::Arr(items)) if items.len() <= 256 => items,
                _ => continue,
            };
            if !raw.is_object()
                || raw.get("sessionId").and_then(Js::as_str) != Some(session_id.as_str())
                || raw.get("cwd").and_then(Js::as_str) != Some(self.project.as_str())
                || raw.get("type").and_then(Js::as_str) != Some("assistant")
                || !datetime_pattern().is_match(timestamp)
            {
                continue;
            }
            if matched.is_none() {
                matched = Some(terminal_digest(line.as_bytes()));
            }
            let Some(at) = date_parse(timestamp).filter(|a| *a >= 0.0 && *a <= SAFE as f64) else {
                continue;
            };
            for block in content {
                if !is_type(block, "tool_use") {
                    continue;
                }
                if let Some(name) = block.get("name").and_then(Js::as_str) {
                    if tool_name_ok(name) && tool_name_unredacted(name) {
                        activities.push(Activity {
                            at: at as u64,
                            kind: "tool",
                            label: name.to_owned(),
                        });
                    }
                }
            }
        }
        if !partial.is_empty() {
            agent_state = "unknown";
            turn_id = None;
        }
        let Some(record) = matched else {
            return Ok(None);
        };
        if !self.persist(identity.0, identity.1, &record) {
            return Ok(None);
        }
        let turn = match &mut self.hooks {
            Some(_) if !partial.is_empty() => HookTurn::unknown(),
            Some(hooks) => hooks.poll(),
            None => HookTurn {
                agent_state,
                turn_id,
            },
        };
        let skip = activities.len().saturating_sub(3);
        Ok(Some(SessionSnapshot {
            session_id,
            activities: activities.split_off(skip),
            turn,
        }))
    }
}
