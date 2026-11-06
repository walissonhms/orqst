//! Port of `TerminalMessageHub` (`packages/core/src/terminal/mcp-hub.ts`): Feature-scoped
//! messaging between ORQST terminals (docs/design/mcp-n-terminals.md). Tool surface adapted
//! from Anywh 51bca54 relay/src/session/roomTools.ts and limits from Tucano 91061b0
//! src/core/runs.ts (both Apache-2.0, via the TypeScript port; see
//! docs/research/mcp-n-terminals.md). In-memory only: no socket, PTY, process or persisted
//! message content.
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::{Condvar, Mutex, MutexGuard};
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use crate::features::model::{is_uuid, utf16_len};

pub const INBOX: usize = 20;
pub const READ_BATCH: usize = 20;
pub const RECIPIENTS: usize = 3;
pub const TEXT_BYTES: usize = 16 * 1024;
pub const SUMMARY_BYTES: usize = 4 * 1024;
pub const SENDS_PER_MINUTE: usize = 30;
pub const MAX_DEPTH: u32 = 3;
pub const WAIT_MS: u64 = 60_000;
pub const TASKS: usize = 64;
pub const OWNER_SENDER: &str = "owner";

/// A terminal as the hub sees it. `feature_id` None means unassigned: it reaches no one.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HubMember {
    pub terminal_id: String,
    pub alias: String,
    pub name: String,
    pub provider: String,
    pub feature_id: Option<String>,
    pub running: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum MessageKind {
    Message,
    Task,
    Result,
}

/// Metadata-only audit event: never the text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct HubEvidence {
    pub message_id: String,
    pub kind: MessageKind,
    pub from: String,
    pub to: String,
    pub feature_id: String,
    pub at: u64,
    pub task_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum HubError {
    /// `HubRefusal`: answered to the agent as `{ refused, message }`.
    Refused(&'static str),
    /// Invalid call (zod failure) or member lookup failure: answered `{ id, ok: false }`.
    Failed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskState {
    Delivered,
    Done,
    Failed,
    Blocked,
}

#[derive(Clone, Debug)]
struct Message {
    id: String,
    kind: MessageKind,
    from_alias: String,
    at: u64,
    text: String,
    truncated: bool,
    depth: u32,
    task_id: Option<String>,
    status: Option<TaskState>,
}

#[derive(Clone, Debug)]
struct Task {
    id: String,
    from: String,
    to: String,
    state: TaskState,
    summary: Option<String>,
    updated_at: u64,
}

#[derive(Default)]
struct State {
    inboxes: HashMap<String, VecDeque<Message>>,
    sends: HashMap<String, Vec<u64>>,
    // Depth of what each terminal last read, and when; a stale chain counts as a new one.
    chain: HashMap<String, (u32, u64)>,
    // Insertion ordered like a JS Map.
    tasks: Vec<Task>,
    // Wake counters for `wait_messages` (deliver, forget).
    wakes: HashMap<String, u64>,
    closed: bool,
}

/// Cut to a byte budget on a UTF-8 boundary and say so (Tucano truncate-and-tell).
pub fn truncate_text(text: &str, bytes: usize) -> (String, bool) {
    if text.len() <= bytes {
        return (text.to_owned(), false);
    }
    let mut end = bytes;
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    (text[..end].to_owned(), true)
}

// ------------------------------------------------------------------ replies (field order = TS)

#[derive(Serialize)]
pub struct TerminalListing {
    pub handle: String,
    pub name: String,
    pub cli: String,
    pub state: &'static str,
    pub queued: usize,
}
#[derive(Serialize)]
pub struct SentTo {
    pub to: String,
    #[serde(rename = "messageId")]
    pub message_id: String,
}
#[derive(Serialize)]
pub struct ReadMessage {
    pub id: String,
    pub from: String,
    pub kind: MessageKind,
    pub at: String,
    pub text: String,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub truncated: bool,
    #[serde(rename = "taskId", skip_serializing_if = "Option::is_none")]
    pub task_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub status: Option<TaskState>,
}

#[derive(Serialize)]
#[serde(untagged)]
pub enum HubReply {
    Terminals {
        terminals: Vec<TerminalListing>,
    },
    Sent {
        sent: Vec<SentTo>,
        state: &'static str,
        truncated: bool,
    },
    Delegated {
        #[serde(rename = "taskId")]
        task_id: String,
        to: String,
        state: &'static str,
    },
    Submitted {
        #[serde(rename = "taskId")]
        task_id: String,
        state: TaskState,
    },
    Status {
        #[serde(rename = "taskId")]
        task_id: String,
        state: TaskState,
        #[serde(skip_serializing_if = "Option::is_none")]
        summary: Option<String>,
        #[serde(rename = "updatedAt")]
        updated_at: u64,
    },
    Messages {
        messages: Vec<ReadMessage>,
        remaining: usize,
    },
}

#[derive(Serialize)]
pub struct OwnerSent {
    #[serde(rename = "messageId")]
    pub message_id: String,
    pub state: &'static str,
}

// ------------------------------------------------------------------ call parsing (zod)

enum Call {
    List,
    Send {
        to: Vec<String>,
        text: String,
    },
    Read {
        limit: Option<usize>,
    },
    Wait {
        timeout_ms: Option<u64>,
    },
    Delegate {
        to: String,
        task: String,
    },
    Submit {
        task_id: String,
        status: TaskState,
        summary: String,
    },
    Status {
        task_id: String,
    },
}

fn strict<'a>(
    value: &'a Value,
    keys: &[&str],
    required: &[&str],
) -> Option<&'a serde_json::Map<String, Value>> {
    let map = value.as_object()?;
    if map.keys().any(|k| !keys.contains(&k.as_str()))
        || required.iter().any(|k| !map.contains_key(*k))
    {
        return None;
    }
    Some(map)
}
fn text_arg(value: Option<&Value>, max_units: usize) -> Option<String> {
    let text = value?.as_str()?;
    (1..=max_units)
        .contains(&utf16_len(text))
        .then(|| text.to_owned())
}
fn handle_arg(value: &Value) -> Option<String> {
    text_arg(Some(value), 64)
}
fn int_arg(value: Option<&Value>, min: u64, max: u64) -> Option<Option<u64>> {
    match value {
        None => Some(None),
        Some(v) => {
            let n = v.as_u64().or_else(|| {
                v.as_f64()
                    .filter(|f| f.fract() == 0.0 && *f >= 0.0)
                    .map(|f| f as u64)
            })?;
            (min..=max).contains(&n).then_some(Some(n))
        }
    }
}

/// `hubToolCallSchema`.
fn parse_call(raw: &Value) -> Option<Call> {
    let call = strict(raw, &["name", "arguments"], &["name", "arguments"])?;
    let args = &call["arguments"];
    Some(match call["name"].as_str()? {
        "list_terminals" => {
            strict(args, &[], &[])?;
            Call::List
        }
        "send_message" => {
            let a = strict(args, &["to", "text"], &["to", "text"])?;
            let to = match &a["to"] {
                Value::Array(items) if (1..=RECIPIENTS).contains(&items.len()) => {
                    items.iter().map(handle_arg).collect::<Option<Vec<_>>>()?
                }
                Value::Array(_) => return None,
                single => vec![handle_arg(single)?],
            };
            Call::Send {
                to,
                text: text_arg(a.get("text"), 256 * 1024)?,
            }
        }
        "read_messages" => {
            let a = strict(args, &["limit"], &[])?;
            Call::Read {
                limit: int_arg(a.get("limit"), 1, READ_BATCH as u64)?.map(|n| n as usize),
            }
        }
        "wait_messages" => {
            let a = strict(args, &["timeout_ms"], &[])?;
            Call::Wait {
                timeout_ms: int_arg(a.get("timeout_ms"), 0, WAIT_MS)?,
            }
        }
        "delegate_task" => {
            let a = strict(args, &["to", "task"], &["to", "task"])?;
            Call::Delegate {
                to: handle_arg(&a["to"])?,
                task: text_arg(a.get("task"), 256 * 1024)?,
            }
        }
        "submit_result" => {
            let a = strict(
                args,
                &["taskId", "status", "summary"],
                &["taskId", "status", "summary"],
            )?;
            let task_id = a["taskId"].as_str().filter(|id| is_uuid(id))?.to_owned();
            let status = match a["status"].as_str()? {
                "done" => TaskState::Done,
                "failed" => TaskState::Failed,
                "blocked" => TaskState::Blocked,
                _ => return None,
            };
            Call::Submit {
                task_id,
                status,
                summary: text_arg(a.get("summary"), 64 * 1024)?,
            }
        }
        "task_status" => {
            let a = strict(args, &["taskId"], &["taskId"])?;
            Call::Status {
                task_id: a["taskId"].as_str().filter(|id| is_uuid(id))?.to_owned(),
            }
        }
        _ => return None,
    })
}

type Members = Box<dyn Fn() -> Result<Vec<HubMember>, ()> + Send + Sync>;
type EvidenceSink = Box<dyn Fn(&HubEvidence) + Send + Sync>;

pub struct TerminalMessageHub {
    state: Mutex<State>,
    wake: Condvar,
    members: Members,
    evidence: EvidenceSink,
    now: Box<dyn Fn() -> u64 + Send + Sync>,
    new_id: Box<dyn Fn() -> String + Send + Sync>,
}

fn alias_matches(member: &HubMember, wanted: &str) -> bool {
    member.alias.to_lowercase() == wanted || member.terminal_id.to_lowercase() == wanted
}

impl TerminalMessageHub {
    /// `members` is read on every call (Feature scope comes from the database each time);
    /// `evidence` receives metadata only and must not call back into the hub.
    pub fn new(
        members: impl Fn() -> Result<Vec<HubMember>, ()> + Send + Sync + 'static,
        evidence: impl Fn(&HubEvidence) + Send + Sync + 'static,
    ) -> Self {
        Self::with_clock(members, evidence, crate::features::store::now_ms, || {
            uuid::Uuid::new_v4().to_string()
        })
    }

    pub fn with_clock(
        members: impl Fn() -> Result<Vec<HubMember>, ()> + Send + Sync + 'static,
        evidence: impl Fn(&HubEvidence) + Send + Sync + 'static,
        now: impl Fn() -> u64 + Send + Sync + 'static,
        new_id: impl Fn() -> String + Send + Sync + 'static,
    ) -> Self {
        Self {
            state: Mutex::new(State::default()),
            wake: Condvar::new(),
            members: Box::new(members),
            evidence: Box::new(evidence),
            now: Box::new(now),
            new_id: Box::new(new_id),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    pub fn close(&self) {
        let mut state = self.lock();
        state.closed = true;
        state.inboxes.clear();
        drop(state);
        self.wake.notify_all();
    }

    /// Forget a terminal's queue and waits (closed, reloaded or left its Feature).
    pub fn forget(&self, terminal_id: &str) {
        let mut state = self.lock();
        state.inboxes.remove(terminal_id);
        state.chain.remove(terminal_id);
        *state.wakes.entry(terminal_id.to_owned()).or_default() += 1;
        drop(state);
        self.wake.notify_all();
    }

    fn peers<'m>(members: &'m [HubMember], sender: &HubMember) -> Vec<&'m HubMember> {
        let Some(feature) = &sender.feature_id else {
            return Vec::new();
        };
        members
            .iter()
            .filter(|m| {
                m.feature_id.as_ref() == Some(feature) && m.terminal_id != sender.terminal_id
            })
            .collect()
    }

    fn resolve_target<'m>(
        members: &'m [HubMember],
        sender: &HubMember,
        raw: &str,
    ) -> Result<&'m HubMember, HubError> {
        let wanted = raw.strip_prefix('@').unwrap_or(raw).to_lowercase();
        // Self, other Features/workspaces and unknown handles are all refused the same way.
        Self::peers(members, sender)
            .into_iter()
            .find(|m| alias_matches(m, &wanted))
            .ok_or(HubError::Refused("unknown_terminal"))
    }

    fn admit(
        &self,
        state: &mut State,
        sender: &str,
        targets: &[&HubMember],
    ) -> Result<(), HubError> {
        // A refused send never spends the sender's budget.
        if targets
            .iter()
            .any(|t| state.inboxes.get(&t.terminal_id).map_or(0, VecDeque::len) >= INBOX)
        {
            return Err(HubError::Refused("inbox_full"));
        }
        let now = (self.now)();
        let mut recent: Vec<u64> = state
            .sends
            .get(sender)
            .map(|v| {
                v.iter()
                    .copied()
                    .filter(|at| (now as i64 - *at as i64) < 60_000)
                    .collect()
            })
            .unwrap_or_default();
        if recent.len() >= SENDS_PER_MINUTE {
            return Err(HubError::Refused("rate_limited"));
        }
        recent.push(now);
        state.sends.insert(sender.to_owned(), recent);
        Ok(())
    }

    #[allow(clippy::too_many_arguments)]
    fn deliver(
        &self,
        state: &mut State,
        from: (&str, &str),
        target: &HubMember,
        id: String,
        kind: MessageKind,
        (text, truncated): (String, bool),
        depth: u32,
        task_id: Option<String>,
        status: Option<TaskState>,
    ) -> Result<(), HubError> {
        let inbox = state.inboxes.entry(target.terminal_id.clone()).or_default();
        if inbox.len() >= INBOX {
            return Err(HubError::Refused("inbox_full"));
        }
        let at = (self.now)();
        inbox.push_back(Message {
            id: id.clone(),
            kind,
            from_alias: from.1.to_owned(),
            at,
            text,
            truncated,
            depth,
            task_id: task_id.clone(),
            status,
        });
        (self.evidence)(&HubEvidence {
            message_id: id,
            kind,
            from: from.0.to_owned(),
            to: target.terminal_id.clone(),
            feature_id: target.feature_id.clone().unwrap_or_default(),
            at,
            task_id,
        });
        *state.wakes.entry(target.terminal_id.clone()).or_default() += 1;
        self.wake.notify_all();
        Ok(())
    }

    fn chain_depth(&self, state: &State, sender: &str) -> u32 {
        match state.chain.get(sender) {
            Some(&(depth, at)) if ((self.now)() as i64 - at as i64) < 5 * 60_000 => depth,
            _ => 0,
        }
    }

    fn next_depth(&self, state: &State, sender: &str) -> Result<u32, HubError> {
        let depth = self.chain_depth(state, sender) + 1;
        if depth > MAX_DEPTH {
            return Err(HubError::Refused("chain_too_deep"));
        }
        Ok(depth)
    }

    /// Owner messages start a new chain (depth 0) and need only a Feature member target.
    pub fn owner_send(
        &self,
        feature_id: &str,
        to: &str,
        text: &str,
    ) -> Result<OwnerSent, HubError> {
        if self.lock().closed {
            return Err(HubError::Refused("unavailable"));
        }
        let members = (self.members)().map_err(|()| HubError::Failed)?;
        let wanted = to.strip_prefix('@').unwrap_or(to).to_lowercase();
        let target = members
            .iter()
            .find(|m| {
                m.feature_id.as_deref() == Some(feature_id)
                    && (m.alias.to_lowercase() == wanted || m.terminal_id == to)
            })
            .ok_or(HubError::Refused("unknown_terminal"))?;
        let mut state = self.lock();
        if state.closed {
            return Err(HubError::Refused("unavailable"));
        }
        let id = (self.new_id)();
        let cut = truncate_text(text, TEXT_BYTES);
        self.deliver(
            &mut state,
            (OWNER_SENDER, "owner"),
            target,
            id.clone(),
            MessageKind::Message,
            cut,
            0,
            None,
            None,
        )?;
        Ok(OwnerSent {
            message_id: id,
            state: "queued",
        })
    }

    /// One tool call from a bound terminal. `wait_messages` blocks up to its timeout.
    pub fn call(&self, sender_id: &str, raw: &Value) -> Result<HubReply, HubError> {
        if self.lock().closed {
            return Err(HubError::Refused("unavailable"));
        }
        let members = (self.members)().map_err(|()| HubError::Failed)?;
        let sender = members
            .iter()
            .find(|m| m.terminal_id == sender_id)
            .filter(|m| m.running)
            .ok_or(HubError::Refused("not_member"))?;
        let call = parse_call(raw).ok_or(HubError::Failed)?;
        let mut state = self.lock();
        if state.closed {
            return Err(HubError::Refused("unavailable"));
        }
        match call {
            Call::List => Ok(HubReply::Terminals {
                terminals: Self::peers(&members, sender)
                    .into_iter()
                    .map(|m| TerminalListing {
                        handle: m.alias.clone(),
                        name: m.name.clone(),
                        cli: m.provider.clone(),
                        state: if m.running { "running" } else { "stopped" },
                        queued: state.inboxes.get(&m.terminal_id).map_or(0, VecDeque::len),
                    })
                    .collect(),
            }),
            Call::Send { to, text } => {
                let mut seen = HashSet::new();
                let recipients: Vec<String> =
                    to.into_iter().filter(|r| seen.insert(r.clone())).collect();
                let targets = recipients
                    .iter()
                    .map(|r| Self::resolve_target(&members, sender, r))
                    .collect::<Result<Vec<_>, _>>()?;
                let depth = self.next_depth(&state, sender_id)?;
                self.admit(&mut state, sender_id, &targets)?;
                let (cut, truncated) = truncate_text(&text, TEXT_BYTES);
                let mut sent = Vec::new();
                for target in targets {
                    let id = (self.new_id)();
                    self.deliver(
                        &mut state,
                        (&sender.terminal_id, &sender.alias),
                        target,
                        id.clone(),
                        MessageKind::Message,
                        (cut.clone(), truncated),
                        depth,
                        None,
                        None,
                    )?;
                    sent.push(SentTo {
                        to: target.alias.clone(),
                        message_id: id,
                    });
                }
                // The chain travels with the recipients; the sender's next message starts over.
                state.chain.remove(sender_id);
                Ok(HubReply::Sent {
                    sent,
                    state: "queued",
                    truncated,
                })
            }
            Call::Delegate { to, task } => {
                let target = Self::resolve_target(&members, sender, &to)?;
                let depth = self.next_depth(&state, sender_id)?;
                if state
                    .tasks
                    .iter()
                    .filter(|t| t.state == TaskState::Delivered)
                    .count()
                    >= TASKS
                {
                    return Err(HubError::Refused("too_many_tasks"));
                }
                // Finished tasks stay queryable for a while; the oldest are dropped past 256.
                while state.tasks.len() >= 256 {
                    let Some(index) = state
                        .tasks
                        .iter()
                        .position(|t| t.state != TaskState::Delivered)
                    else {
                        break;
                    };
                    state.tasks.remove(index);
                }
                self.admit(&mut state, sender_id, &[target])?;
                let cut = truncate_text(&task, TEXT_BYTES);
                let task_id = (self.new_id)();
                state.tasks.push(Task {
                    id: task_id.clone(),
                    from: sender_id.to_owned(),
                    to: target.terminal_id.clone(),
                    state: TaskState::Delivered,
                    summary: None,
                    updated_at: (self.now)(),
                });
                let message_id = (self.new_id)();
                self.deliver(
                    &mut state,
                    (&sender.terminal_id, &sender.alias),
                    target,
                    message_id,
                    MessageKind::Task,
                    cut,
                    depth,
                    Some(task_id.clone()),
                    None,
                )?;
                state.chain.remove(sender_id);
                Ok(HubReply::Delegated {
                    task_id,
                    to: target.alias.clone(),
                    state: "delivered",
                })
            }
            Call::Submit {
                task_id,
                status,
                summary,
            } => {
                let now = (self.now)();
                let task = state
                    .tasks
                    .iter_mut()
                    .find(|t| t.id == task_id)
                    .filter(|t| t.to == sender_id)
                    .ok_or(HubError::Refused("unknown_task"))?;
                if task.state != TaskState::Delivered {
                    return Err(HubError::Refused("already_submitted"));
                }
                task.state = status;
                task.updated_at = now;
                let cut = truncate_text(&summary, SUMMARY_BYTES);
                task.summary = Some(cut.0.clone());
                let from = task.from.clone();
                let delegator = members.iter().find(|m| m.terminal_id == from);
                // The result returns to the delegator only while both stay in one Feature.
                if let Some(delegator) = delegator {
                    if delegator.running
                        && delegator.feature_id.is_some()
                        && delegator.feature_id == sender.feature_id
                    {
                        let id = (self.new_id)();
                        // A result closes its task: it does not deepen the chain.
                        self.deliver(
                            &mut state,
                            (&sender.terminal_id, &sender.alias),
                            delegator,
                            id,
                            MessageKind::Result,
                            cut,
                            0,
                            Some(task_id.clone()),
                            Some(status),
                        )?;
                    }
                }
                Ok(HubReply::Submitted {
                    task_id,
                    state: status,
                })
            }
            Call::Status { task_id } => {
                let task = state
                    .tasks
                    .iter()
                    .find(|t| t.id == task_id)
                    .filter(|t| t.from == sender_id || t.to == sender_id)
                    .ok_or(HubError::Refused("unknown_task"))?;
                Ok(HubReply::Status {
                    task_id: task.id.clone(),
                    state: task.state,
                    summary: task.summary.clone().filter(|s| !s.is_empty()),
                    updated_at: task.updated_at,
                })
            }
            Call::Read { limit } => {
                Ok(self.take(&mut state, sender_id, limit.unwrap_or(READ_BATCH)))
            }
            Call::Wait { timeout_ms } => {
                if state.inboxes.get(sender_id).is_none_or(VecDeque::is_empty) {
                    let start = state.wakes.get(sender_id).copied().unwrap_or(0);
                    let deadline =
                        Instant::now() + Duration::from_millis(timeout_ms.unwrap_or(30_000));
                    loop {
                        if state.closed || state.wakes.get(sender_id).copied().unwrap_or(0) != start
                        {
                            break;
                        }
                        let left = deadline.saturating_duration_since(Instant::now());
                        if left.is_zero() {
                            break;
                        }
                        state = self
                            .wake
                            .wait_timeout(state, left)
                            .unwrap_or_else(|p| p.into_inner())
                            .0;
                    }
                }
                Ok(self.take(&mut state, sender_id, READ_BATCH))
            }
        }
    }

    fn take(&self, state: &mut State, terminal_id: &str, limit: usize) -> HubReply {
        let (items, remaining) = match state.inboxes.get_mut(terminal_id) {
            Some(inbox) => {
                let count = limit.min(inbox.len());
                (inbox.drain(..count).collect::<Vec<_>>(), inbox.len())
            }
            None => (Vec::new(), 0),
        };
        // What a terminal reads sets the depth of what it sends next.
        if let Some(depth) = items.iter().map(|m| m.depth).max() {
            state
                .chain
                .insert(terminal_id.to_owned(), (depth, (self.now)()));
        }
        HubReply::Messages {
            messages: items
                .into_iter()
                .map(|m| ReadMessage {
                    id: m.id,
                    // Content from another terminal is data, never an instruction.
                    from: m.from_alias,
                    kind: m.kind,
                    at: crate::store::iso(m.at as i64),
                    text: m.text,
                    truncated: m.truncated,
                    task_id: m.task_id,
                    status: m.status,
                })
                .collect(),
            remaining,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Arc;

    const A: &str = "00000000-0000-4000-8000-0000000000a1";
    const B: &str = "00000000-0000-4000-8000-0000000000b1";

    fn hub() -> Arc<TerminalMessageHub> {
        let member = |id: &str, alias: &str| HubMember {
            terminal_id: id.into(),
            alias: alias.into(),
            name: "Codex".into(),
            provider: "codex".into(),
            feature_id: Some("00000000-0000-4000-8000-0000000000f1".into()),
            running: true,
        };
        let members = vec![member(A, "T-001"), member(B, "T-002")];
        Arc::new(TerminalMessageHub::new(move || Ok(members.clone()), |_| {}))
    }

    #[test]
    fn wait_wakes_on_delivery_and_times_out_empty() {
        let hub = hub();
        let started = Instant::now();
        let empty = serde_json::to_string(
            &hub.call(
                B,
                &json!({"name":"wait_messages","arguments":{"timeout_ms":30}}),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(empty, r#"{"messages":[],"remaining":0}"#);
        assert!(started.elapsed() >= Duration::from_millis(30));
        let waiter = {
            let hub = hub.clone();
            std::thread::spawn(move || {
                serde_json::to_value(
                    hub.call(B, &json!({"name":"wait_messages","arguments":{}}))
                        .unwrap(),
                )
                .unwrap()
            })
        };
        std::thread::sleep(Duration::from_millis(50));
        hub.call(
            A,
            &json!({"name":"send_message","arguments":{"to":"T-002","text":"wake"}}),
        )
        .unwrap();
        let woke = waiter.join().unwrap();
        assert_eq!(woke["messages"][0]["text"], "wake");
    }

    #[test]
    fn close_releases_waiters() {
        let hub = hub();
        let waiter = {
            let hub = hub.clone();
            std::thread::spawn(move || {
                hub.call(
                    B,
                    &json!({"name":"wait_messages","arguments":{"timeout_ms":60000}}),
                )
                .is_ok()
            })
        };
        std::thread::sleep(Duration::from_millis(50));
        hub.close();
        assert!(waiter.join().unwrap());
        assert_eq!(
            hub.call(A, &json!({"name":"list_terminals","arguments":{}}))
                .err(),
            Some(HubError::Refused("unavailable"))
        );
    }

    #[test]
    fn truncates_on_utf8_boundary() {
        assert_eq!(truncate_text("aé", 2), ("a".to_string(), true));
        assert_eq!(truncate_text("aé", 3), ("aé".to_string(), false));
    }
}
