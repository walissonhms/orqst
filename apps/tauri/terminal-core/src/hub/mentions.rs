//! Port of `recordComposerMention` (`composer-mentions.ts`): records the Studio mention box
//! attempt (metadata only: the text is never written) and, for owner messages to a Feature
//! member, hands the text to the hub inbox.
use std::collections::HashSet;
use std::fs;
use std::io::Write;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::features::error::{invalid, refused, store, Result};
use crate::features::features::{Env, Features};
use crate::features::model::{is_uuid, parse, utf16_len};
use crate::features::store::{
    getuid, now_ms, private_mkdir, terminal_directory, with_terminal_preferences,
};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum ComposerOrigin {
    User,
    Terminal {
        #[serde(rename = "terminalId")]
        terminal_id: String,
    },
}

/// `composerMentionInputSchema`.
#[derive(Clone, Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComposerMentionInput {
    pub from: ComposerOrigin,
    pub to: Vec<String>,
    pub text: String,
}

impl ComposerMentionInput {
    pub fn parse(value: &Value) -> Result<Self> {
        let input: Self = parse(value, "composer mention")?;
        let origin_ok = match &input.from {
            ComposerOrigin::User => true,
            ComposerOrigin::Terminal { terminal_id } => is_uuid(terminal_id),
        };
        if !origin_ok
            || input.to.is_empty()
            || input.to.len() > 8
            || !input.to.iter().all(|id| is_uuid(id))
            || input.to.iter().collect::<HashSet<_>>().len() != input.to.len()
            || !(1..=4000).contains(&utf16_len(&input.text))
        {
            return Err(invalid("Invalid composer mention"));
        }
        Ok(input)
    }
}

/// `composerMentionOutcomeSchema` (`delivery` + `reason`).
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MentionOutcome {
    pub terminal_id: String,
    pub delivery: &'static str,
    pub reason: &'static str,
}

/// Hub delivery result for one owner message: `("queued","hub_inbox")` or
/// `("denied", "inbox_full" | "unavailable" | "unknown_terminal")`.
pub type Delivery = (&'static str, &'static str);
/// The hub owner-send callback: `(terminalId, text) -> Delivery`.
pub type Deliver<'a> = &'a dyn Fn(&str, &str) -> Delivery;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MentionRecord<'a> {
    from: &'a ComposerOrigin,
    to: &'a [String],
    id: &'a str,
    at: u64,
    workspace_id: &'a str,
    feature_id: Option<&'a str>,
    outcomes: &'a [MentionOutcome],
}

#[derive(Serialize)]
struct MentionReply<'a> {
    id: &'a str,
    outcomes: &'a [MentionOutcome],
}

/// Maps a hub refusal to the composer outcome, as host.ts does.
pub fn hub_delivery(
    result: std::result::Result<super::hub::OwnerSent, super::hub::HubError>,
) -> Delivery {
    use super::hub::HubError;
    match result {
        Ok(_) => ("queued", "hub_inbox"),
        Err(HubError::Refused("inbox_full")) => ("denied", "inbox_full"),
        Err(HubError::Refused("unknown_terminal")) => ("denied", "unknown_terminal"),
        Err(_) => ("denied", "unavailable"),
    }
}

/// Returns the reply JSON `{"id":...,"outcomes":[...]}`. `deliver` is the hub owner send
/// (`None` keeps v1: no structured route).
pub fn record_composer_mention(
    directory: &Path,
    workspace_id: &str,
    feature_id: Option<&str>,
    known_ids: &[String],
    raw: &Value,
    deliver: Option<Deliver<'_>>,
) -> Result<String> {
    if feature_id.is_some_and(|id| !is_uuid(id)) {
        return Err(invalid("Invalid feature"));
    }
    let input = ComposerMentionInput::parse(raw)?;
    let env = Env::default();
    with_terminal_preferences(directory, |db| {
        db.transaction(|| {
            let features = Features::open(db, &env)?.list(workspace_id)?;
            let feature = features
                .iter()
                .find(|f| Some(f.feature_id.as_str()) == feature_id);
            if feature_id.is_some() && feature.is_none() {
                return Err(refused("Feature unavailable"));
            }
            let assigned: HashSet<&String> = features
                .iter()
                .flat_map(|f| f.terminal_ids.iter())
                .collect();
            let members: HashSet<&String> = match feature {
                Some(f) => f.terminal_ids.iter().collect(),
                None => known_ids
                    .iter()
                    .filter(|id| !assigned.contains(id))
                    .collect(),
            };
            let origin_valid = match &input.from {
                ComposerOrigin::User => true,
                ComposerOrigin::Terminal { terminal_id } => members.contains(terminal_id),
            };
            let outcomes: Vec<MentionOutcome> = input
                .to
                .iter()
                .map(|terminal_id| {
                    let (delivery, reason) = if !known_ids.contains(terminal_id) {
                        ("denied", "unknown_terminal")
                    } else if !origin_valid {
                        ("denied", "not_member")
                    } else if !members.contains(terminal_id) {
                        (
                            "denied",
                            if assigned.contains(terminal_id) {
                                "cross_feature_denied"
                            } else {
                                "not_member"
                            },
                        )
                    } else if let (Some(deliver), ComposerOrigin::User, Some(_)) =
                        (deliver, &input.from, feature_id)
                    {
                        deliver(terminal_id, &input.text)
                    } else {
                        ("unsupported", "no_structured_route")
                    };
                    MentionOutcome {
                        terminal_id: terminal_id.clone(),
                        delivery,
                        reason,
                    }
                })
                .collect();
            if workspace_id.is_empty() || utf16_len(workspace_id) > 128 {
                return Err(invalid("Invalid workspace"));
            }
            let id = (env.new_id)();
            let record = MentionRecord {
                from: &input.from,
                to: &input.to,
                id: &id,
                at: now_ms(),
                workspace_id,
                feature_id,
                outcomes: &outcomes,
            };
            let parent = fs::canonicalize(directory)?;
            terminal_directory(&parent, true)?;
            let root = parent.join("composer-mentions");
            private_mkdir(&root)?;
            terminal_directory(&root, true)?;
            if fs::read_dir(&root)?.count() >= 10_000 {
                return Err(refused("Mention journal full"));
            }
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .mode(0o600)
                .custom_flags(libc::O_NOFOLLOW)
                .open(root.join(format!("{id}.json")))?;
            let info = file.metadata()?;
            if !info.is_file()
                || info.nlink() != 1
                || info.uid() != getuid()
                || info.mode() & 0o077 != 0
            {
                return Err(store("Unsafe mention journal"));
            }
            let mut text = serde_json::to_string(&record).map_err(|_| store("json"))?;
            text.push('\n');
            file.write_all(text.as_bytes())?;
            file.sync_all()?;
            fs::OpenOptions::new()
                .read(true)
                .custom_flags(libc::O_NOFOLLOW)
                .open(&root)?
                .sync_all()?;
            serde_json::to_string(&MentionReply {
                id: &id,
                outcomes: &outcomes,
            })
            .map_err(|_| store("json"))
        })
    })
}
