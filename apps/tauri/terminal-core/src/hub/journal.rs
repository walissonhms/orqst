//! Port of `hubMessageJournal` (`mcp-hub-journal.ts`) plus the hub glue of `host.ts`: the
//! member provider (Feature scope read from the database on every call) and the recent
//! metadata-only events behind `communicationProjection`.
use std::collections::VecDeque;
use std::fs;
use std::io::Write;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;
use std::sync::Mutex;

use serde::Serialize;

use super::hub::{HubEvidence, HubMember, MessageKind, OWNER_SENDER};
use crate::features::error::{store, Result};
use crate::features::features::{Env, Features};
use crate::features::model::{is_uuid, FeatureStatus};
use crate::features::store::{
    getuid, private_mkdir, terminal_directory, with_terminal_preferences,
};

pub const MAX_BYTES: u64 = 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct JournalLine<'a> {
    id: &'a str,
    kind: MessageKind,
    from: &'a str,
    to: &'a str,
    feature_id: &'a str,
    at: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    task_id: Option<&'a str>,
}

/// Append-only, metadata-only JSONL audit (`<preferences>/hub-communication/<epoch>.jsonl`,
/// 0600, 1 MiB cap; past the cap one `{"truncated":true,"at":...}` line and no more writes).
pub struct HubJournal {
    file: Mutex<(fs::File, u64, bool)>,
}

impl HubJournal {
    pub fn open(preferences: &Path, epoch: &str) -> Result<Self> {
        if !is_uuid(epoch) {
            return Err(store("Invalid hub epoch"));
        }
        let parent = fs::canonicalize(preferences)?;
        terminal_directory(&parent, true)?;
        let root = parent.join("hub-communication");
        private_mkdir(&root)?;
        terminal_directory(&root, true)?;
        let file = fs::OpenOptions::new()
            .append(true)
            .create(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(root.join(format!("{epoch}.jsonl")))?;
        let info = file.metadata()?;
        if !info.is_file()
            || info.uid() != getuid()
            || info.mode() & 0o077 != 0
            || info.nlink() != 1
        {
            return Err(store("Hub journal unavailable"));
        }
        Ok(Self {
            file: Mutex::new((file, info.size(), false)),
        })
    }

    pub fn append(&self, event: &HubEvidence) {
        let mut guard = self.file.lock().unwrap_or_else(|p| p.into_inner());
        let (file, written, full) = &mut *guard;
        if *full {
            return;
        }
        let line = JournalLine {
            id: &event.message_id,
            kind: event.kind,
            from: &event.from,
            to: &event.to,
            feature_id: &event.feature_id,
            at: event.at,
            task_id: event.task_id.as_deref(),
        };
        let Ok(mut text) = serde_json::to_string(&line) else {
            return;
        };
        text.push('\n');
        if *written + text.len() as u64 > MAX_BYTES {
            *full = true;
            let _ =
                file.write_all(format!("{{\"truncated\":true,\"at\":{}}}\n", event.at).as_bytes());
            return;
        }
        // Node ignores nothing here either: a failed write throws inside the evidence callback.
        if file.write_all(text.as_bytes()).is_ok() {
            *written += text.len() as u64;
        }
    }
}

#[derive(Clone, Serialize)]
pub struct ProjectedEvent {
    pub id: String,
    pub from: String,
    pub to: String,
    pub kind: &'static str,
    pub at: u64,
}

/// Recent hub events for the Studio (`hubEvents` in host.ts): terminals only (owner sends
/// excluded), at most 200 kept, 50 projected per Feature, `task` shown as `delegation`.
#[derive(Default)]
pub struct HubActivity {
    events: Mutex<VecDeque<(String, ProjectedEvent)>>,
}

impl HubActivity {
    pub fn record(&self, event: &HubEvidence) {
        if event.from == OWNER_SENDER {
            return;
        }
        let kind = match event.kind {
            MessageKind::Message => "message",
            MessageKind::Task => "delegation",
            MessageKind::Result => "result",
        };
        let mut events = self.events.lock().unwrap_or_else(|p| p.into_inner());
        events.push_back((
            event.feature_id.clone(),
            ProjectedEvent {
                id: event.message_id.clone(),
                from: event.from.clone(),
                to: event.to.clone(),
                kind,
                at: event.at,
            },
        ));
        while events.len() > 200 {
            events.pop_front();
        }
    }

    /// `communicationProjection` reply JSON: `{"events":[...]}`.
    pub fn project(&self, feature_id: Option<&str>) -> String {
        let events = self.events.lock().unwrap_or_else(|p| p.into_inner());
        let matching: Vec<&ProjectedEvent> = events
            .iter()
            .filter(|(feature, _)| Some(feature.as_str()) == feature_id)
            .map(|(_, e)| e)
            .collect();
        let tail = &matching[matching.len().saturating_sub(50)..];
        format!(
            r#"{{"events":{}}}"#,
            serde_json::to_string(tail).unwrap_or_else(|_| "[]".into())
        )
    }
}

/// One hub-enabled slot of the Core selection.
#[derive(Clone, Debug)]
pub struct HubSlot {
    pub terminal_id: String,
    pub provider: String,
}

pub fn provider_name(provider: &str) -> String {
    match provider {
        "codex" => "Codex".into(),
        "claude" => "Claude Code".into(),
        "opencode" => "OpenCode".into(),
        other => other.into(),
    }
}

/// The member provider of `host.ts`: alias `T-00n` by slot, Feature only when exactly one
/// non-archived Feature of the workspace owns the terminal.
pub fn hub_members(
    preferences: &Path,
    workspace_id: &str,
    slots: &[Option<HubSlot>],
) -> Result<Vec<HubMember>> {
    let env = Env::default();
    let features = with_terminal_preferences(preferences, |db| {
        Features::open(db, &env)?.list(workspace_id)
    })?;
    Ok(slots
        .iter()
        .enumerate()
        .filter_map(|(slot, member)| {
            let member = member.as_ref()?;
            let owners: Vec<_> = features
                .iter()
                .filter(|f| {
                    f.status != FeatureStatus::Archived
                        && f.terminal_ids.contains(&member.terminal_id)
                })
                .collect();
            Some(HubMember {
                terminal_id: member.terminal_id.clone(),
                alias: format!("T-{:03}", slot + 1),
                name: provider_name(&member.provider),
                provider: member.provider.clone(),
                feature_id: (owners.len() == 1).then(|| owners[0].feature_id.clone()),
                running: true,
            })
        })
        .collect())
}
