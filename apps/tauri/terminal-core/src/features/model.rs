//! Wire types and validators mirroring the zod schemas in `packages/protocol/src`
//! (`features.ts`, `feature-permissions.ts`, `terminal-team.ts`, `terminal-workspace.ts`).
//! Field order equals the zod output order, so `serde_json` output is byte-identical to
//! `JSON.stringify(schema.parse(...))`.
use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Deserializer, Serialize};
use sha2::{Digest, Sha256};

use super::error::{invalid, FeatureError, Result};

pub const MAX_SAFE: u64 = 9_007_199_254_740_991;
/// `TERMINAL_SLOT_CEILING` (`terminal-capacity.ts`).
pub const TERMINAL_SLOT_CEILING: usize = 8;

/// `stableId` (`packages/shared`): sha256 hex of `JSON.stringify(parts)`.
pub fn stable_id(parts: &[&str]) -> String {
    let text = serde_json::to_string(parts).expect("string array serializes");
    hex(&Sha256::digest(text.as_bytes()))
}

pub fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `JSON.stringify([...ids].sort())` with default (UTF-16 code unit) ordering.
pub fn sorted_ids_json(ids: &[String]) -> String {
    let mut sorted: Vec<&String> = ids.iter().collect();
    sorted.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
    serde_json::to_string(&sorted).expect("string array serializes")
}

/// `String.prototype.length` (UTF-16 code units), used by zod `min`/`max`.
pub fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}

/// zod 4 `z.uuid()` regex (RFC 9562 variant, plus nil and max).
pub fn is_uuid(value: &str) -> bool {
    if value == "00000000-0000-0000-0000-000000000000"
        || value == "ffffffff-ffff-ffff-ffff-ffffffffffff"
    {
        return true;
    }
    let b = value.as_bytes();
    if b.len() != 36 {
        return false;
    }
    for (index, &c) in b.iter().enumerate() {
        let ok = match index {
            8 | 13 | 18 | 23 => c == b'-',
            14 => (b'1'..=b'8').contains(&c),
            19 => matches!(c, b'8' | b'9' | b'a' | b'b' | b'A' | b'B'),
            _ => c.is_ascii_hexdigit(),
        };
        if !ok {
            return false;
        }
    }
    true
}

/// `/^[a-zA-Z0-9_-]{1,128}$/` (workspace ids and actor ids).
pub fn is_identifier(value: &str) -> bool {
    (1..=128).contains(&value.len())
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

/// `paneHandleSchema`: `/^[a-z0-9][a-z0-9_-]{1,31}$/`.
pub fn is_handle(value: &str) -> bool {
    let b = value.as_bytes();
    (2..=32).contains(&b.len())
        && (b[0].is_ascii_lowercase() || b[0].is_ascii_digit())
        && b[1..]
            .iter()
            .all(|&c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == b'_' || c == b'-')
}

pub fn is_hex64(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
}

/// ECMAScript `WhiteSpace` + `LineTerminator` (what `String.prototype.trim` removes).
fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\u{9}'..='\u{d}'
            | ' '
            | '\u{a0}'
            | '\u{1680}'
            | '\u{2000}'..='\u{200a}'
            | '\u{2028}'
            | '\u{2029}'
            | '\u{202f}'
            | '\u{205f}'
            | '\u{3000}'
            | '\u{feff}'
    )
}

/// Unicode general categories Cc and Cf (Cs cannot occur in a Rust `str`). Table checked
/// against Node's `/\p{Cf}/u` by the golden test.
pub const CF_RANGES: &[(u32, u32)] = &[
    (0x00ad, 0x00ad),
    (0x0600, 0x0605),
    (0x061c, 0x061c),
    (0x06dd, 0x06dd),
    (0x070f, 0x070f),
    (0x0890, 0x0891),
    (0x08e2, 0x08e2),
    (0x180e, 0x180e),
    (0x200b, 0x200f),
    (0x202a, 0x202e),
    (0x2060, 0x2064),
    (0x2066, 0x206f),
    (0xfeff, 0xfeff),
    (0xfff9, 0xfffb),
    (0x110bd, 0x110bd),
    (0x110cd, 0x110cd),
    (0x13430, 0x1343f),
    (0x1bca0, 0x1bca3),
    (0x1d173, 0x1d17a),
    (0xe0001, 0xe0001),
    (0xe0020, 0xe007f),
];

pub fn is_control_or_format(c: char) -> bool {
    let code = c as u32;
    code <= 0x1f
        || (0x7f..=0x9f).contains(&code)
        || CF_RANGES
            .iter()
            .any(|&(start, end)| (start..=end).contains(&code))
}

/// `terminalDisplayNameSchema`.
pub fn is_display_name(value: &str) -> bool {
    (1..=48).contains(&utf16_len(value))
        && !value.chars().all(is_js_space)
        && !value.chars().any(is_control_or_format)
}

fn unique<T: std::hash::Hash + Eq>(values: impl IntoIterator<Item = T>, len: usize) -> bool {
    values.into_iter().collect::<HashSet<_>>().len() == len
}

/// `z.array(z.uuid()).max(8).refine(unique)`.
pub fn valid_ids(ids: &[String]) -> bool {
    ids.len() <= TERMINAL_SLOT_CEILING && ids.iter().all(|id| is_uuid(id)) && unique(ids, ids.len())
}

// zod `.optional()` rejects `null`; serde's plain `Option` would accept it.
pub fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<T>, D::Error> {
    T::deserialize(d).map(Some)
}
// zod `.nullable().optional()`: absent, null and a value are three different inputs.
pub fn nullable_present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> std::result::Result<Option<Option<T>>, D::Error> {
    Option::<T>::deserialize(d).map(Some)
}

pub fn parse<T: for<'de> Deserialize<'de>>(value: &serde_json::Value, what: &str) -> Result<T> {
    T::deserialize(value).map_err(|_| invalid(format!("Invalid {what}")))
}

pub fn check_safe(value: u64, positive: bool) -> Result<u64> {
    if value > MAX_SAFE || (positive && value == 0) {
        return Err(invalid("Invalid integer"));
    }
    Ok(value)
}

// ---------------------------------------------------------------- Features

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FeatureStatus {
    Planned,
    Active,
    Blocked,
    Completed,
    Archived,
}

impl FeatureStatus {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Planned => "planned",
            Self::Active => "active",
            Self::Blocked => "blocked",
            Self::Completed => "completed",
            Self::Archived => "archived",
        }
    }
    pub fn parse(value: &str) -> Result<Self> {
        Ok(match value {
            "planned" => Self::Planned,
            "active" => Self::Active,
            "blocked" => Self::Blocked,
            "completed" => Self::Completed,
            "archived" => Self::Archived,
            _ => return Err(invalid("Invalid feature status")),
        })
    }
}

/// `featureScopeSchema`.
pub fn check_scope(workspace_id: &str, feature_id: &str) -> Result<()> {
    if !is_identifier(workspace_id) || !is_uuid(feature_id) {
        return Err(invalid("Invalid feature scope"));
    }
    Ok(())
}

/// `workspaceFeatureSchema` output.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceFeature {
    pub workspace_id: String,
    pub feature_id: String,
    pub schema_version: u8,
    pub name: String,
    pub description: String,
    pub status: FeatureStatus,
    pub revision: u64,
    pub terminal_ids: Vec<String>,
    pub orchestrator_terminal_id: Option<String>,
    pub created_at: u64,
    pub updated_at: u64,
}

impl WorkspaceFeature {
    pub fn validate(&self) -> Result<()> {
        check_scope(&self.workspace_id, &self.feature_id)?;
        check_safe(self.revision, true)?;
        check_safe(self.created_at, false)?;
        check_safe(self.updated_at, false)?;
        let orchestrator_ok = match &self.orchestrator_terminal_id {
            None => true,
            Some(id) => is_uuid(id) && self.terminal_ids.contains(id),
        };
        if !is_display_name(&self.name)
            || utf16_len(&self.description) > 2048
            || !valid_ids(&self.terminal_ids)
            || !orchestrator_ok
        {
            return Err(invalid("Invalid feature"));
        }
        Ok(())
    }
}

/// `featureViewStateSchema`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureViewState {
    pub contract_version: u8,
    pub storage: &'static str,
    pub workspace_id: String,
    pub feature_id: Option<String>,
    pub revision: u64,
}

/// `featureViewSaveSchema`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeatureViewSave {
    pub expected_revision: u64,
    #[serde(deserialize_with = "Option::deserialize")]
    pub feature_id: Option<String>,
}

impl FeatureViewSave {
    pub fn parse(value: &serde_json::Value) -> Result<Self> {
        let save: Self = parse(value, "feature view")?;
        check_safe(save.expected_revision, false)?;
        if save.feature_id.as_deref().is_some_and(|id| !is_uuid(id)) {
            return Err(invalid("Invalid feature view"));
        }
        Ok(save)
    }
}

fn planned() -> FeatureStatus {
    FeatureStatus::Planned
}

/// `featureCreateSchema.omit({ workspaceId: true })`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeatureCreate {
    pub name: String,
    #[serde(default)]
    pub description: String,
    #[serde(default = "planned")]
    pub status: FeatureStatus,
}

impl FeatureCreate {
    pub fn parse(value: &serde_json::Value) -> Result<Self> {
        let create: Self = parse(value, "feature")?;
        if !is_display_name(&create.name) || utf16_len(&create.description) > 2048 {
            return Err(invalid("Invalid feature"));
        }
        Ok(create)
    }
}

/// `featureUpdateSchema`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeatureUpdate {
    pub expected_revision: u64,
    #[serde(default, deserialize_with = "present")]
    pub name: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub description: Option<String>,
    #[serde(default, deserialize_with = "present")]
    pub status: Option<FeatureStatus>,
    #[serde(default, deserialize_with = "nullable_present")]
    pub orchestrator_terminal_id: Option<Option<String>>,
}

impl FeatureUpdate {
    pub fn parse(value: &serde_json::Value) -> Result<Self> {
        let update: Self = parse(value, "feature update")?;
        check_safe(update.expected_revision, true)?;
        if update
            .name
            .as_deref()
            .is_some_and(|name| !is_display_name(name))
            || update
                .description
                .as_deref()
                .is_some_and(|d| utf16_len(d) > 2048)
            || matches!(&update.orchestrator_terminal_id, Some(Some(id)) if !is_uuid(id))
            || (update.name.is_none()
                && update.description.is_none()
                && update.status.is_none()
                && update.orchestrator_terminal_id.is_none())
        {
            return Err(invalid("Invalid feature update"));
        }
        Ok(update)
    }
}

/// `featureConfigurationEventSchema.omit({ sequence })` as written by `audit`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeatureConfigurationEvent<'a> {
    pub workspace_id: &'a str,
    pub feature_id: &'a str,
    pub schema_version: u8,
    pub action: &'static str,
    pub revision: u64,
    pub timestamp: u64,
    pub terminal_id: Option<&'a str>,
}

// ---------------------------------------------------------------- Permissions

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PermissionOperation {
    Delegate,
    Execute,
    View,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PermissionRule {
    pub source_terminal_id: String,
    pub target_terminal_id: String,
    pub operations: Vec<PermissionOperation>,
}

/// `featurePermissionConfigurationSchema`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PermissionConfiguration {
    pub schema_version: u8,
    pub rules: Vec<PermissionRule>,
}

/// Directed-graph cycle check shared by the permission and team superRefines.
fn has_cycle(graph: &HashMap<&str, Vec<&str>>, roots: &[&str]) -> bool {
    fn visit<'a>(
        id: &'a str,
        graph: &HashMap<&'a str, Vec<&'a str>>,
        visiting: &mut HashSet<&'a str>,
        visited: &mut HashSet<&'a str>,
    ) -> bool {
        if visiting.contains(id) {
            return true;
        }
        if visited.contains(id) {
            return false;
        }
        visiting.insert(id);
        if graph
            .get(id)
            .is_some_and(|targets| targets.iter().any(|t| visit(t, graph, visiting, visited)))
        {
            return true;
        }
        visiting.remove(id);
        visited.insert(id);
        false
    }
    let (mut visiting, mut visited) = (HashSet::new(), HashSet::new());
    roots
        .iter()
        .any(|root| visit(root, graph, &mut visiting, &mut visited))
}

impl PermissionConfiguration {
    pub fn validate(&self) -> Result<()> {
        let err = || invalid("Invalid directed Feature permission policy");
        if self.schema_version != 1
            || self.rules.len() > TERMINAL_SLOT_CEILING * (TERMINAL_SLOT_CEILING - 1)
        {
            return Err(err());
        }
        let mut pairs = HashSet::new();
        let mut graph: HashMap<&str, Vec<&str>> = HashMap::new();
        let mut roots: Vec<&str> = Vec::new();
        for rule in &self.rules {
            if !is_uuid(&rule.source_terminal_id)
                || !is_uuid(&rule.target_terminal_id)
                || rule.operations.len() > 3
            {
                return Err(err());
            }
            if !pairs.insert((
                rule.source_terminal_id.as_str(),
                rule.target_terminal_id.as_str(),
            )) || rule.source_terminal_id == rule.target_terminal_id
                || !unique(rule.operations.iter(), rule.operations.len())
            {
                return Err(err());
            }
            if rule.operations.contains(&PermissionOperation::Delegate) {
                let source = rule.source_terminal_id.as_str();
                if !graph.contains_key(source) {
                    roots.push(source);
                }
                graph
                    .entry(source)
                    .or_default()
                    .push(&rule.target_terminal_id);
            }
        }
        if has_cycle(&graph, &roots) {
            return Err(err());
        }
        Ok(())
    }
}

/// `featurePermissionStateSchema` output.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FeaturePermissionState {
    pub workspace_id: String,
    pub feature_id: String,
    pub schema_version: u8,
    pub revision: u64,
    pub configuration: Option<PermissionConfiguration>,
}

/// `featurePermissionSaveSchema`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FeaturePermissionSave {
    pub expected_revision: u64,
    #[serde(default, deserialize_with = "present")]
    pub expected_feature_revision: Option<u64>,
    #[serde(default, deserialize_with = "present")]
    pub expected_view_revision: Option<u64>,
    pub configuration: PermissionConfiguration,
    #[serde(default, deserialize_with = "present")]
    pub review_digest: Option<String>,
}

impl FeaturePermissionSave {
    pub fn parse(value: &serde_json::Value) -> Result<Self> {
        let save: Self = parse(value, "permission save")?;
        check_safe(save.expected_revision, false)?;
        if let Some(r) = save.expected_feature_revision {
            check_safe(r, true)?;
        }
        if let Some(r) = save.expected_view_revision {
            check_safe(r, false)?;
        }
        save.configuration.validate()?;
        if save.review_digest.as_deref().is_some_and(|d| !is_hex64(d)) {
            return Err(invalid("Invalid permission save"));
        }
        Ok(save)
    }
}

/// Permission audit metadata, in the exact key order `save` builds it.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionEventWrite<'a> {
    pub schema_version: u8,
    pub workspace_id: &'a str,
    pub feature_id: &'a str,
    pub timestamp: u64,
    pub actor_id: &'a str,
    pub action: &'static str,
    pub previous_revision: u64,
    pub revision: u64,
    pub previous_configuration: &'a Option<PermissionConfiguration>,
    pub configuration: &'a PermissionConfiguration,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub review_digest: Option<&'a str>,
}

/// `featurePermissionEventSchema` (validation of stored metadata).
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PermissionEventRead {
    pub workspace_id: String,
    pub feature_id: String,
    pub schema_version: u8,
    #[serde(default, deserialize_with = "present")]
    pub sequence: Option<u64>,
    pub timestamp: u64,
    pub actor_id: String,
    pub action: String,
    pub previous_revision: u64,
    pub revision: u64,
    #[serde(deserialize_with = "Option::deserialize")]
    pub previous_configuration: Option<PermissionConfiguration>,
    pub configuration: PermissionConfiguration,
    #[serde(default, deserialize_with = "present")]
    pub review_digest: Option<String>,
}

impl PermissionEventRead {
    pub fn parse(text: &str) -> Result<Self> {
        let value: serde_json::Value =
            serde_json::from_str(text).map_err(|_| invalid("Invalid permission audit"))?;
        let event: Self = parse(&value, "permission audit")?;
        let err = || invalid("Invalid Feature permission audit revision");
        check_scope(&event.workspace_id, &event.feature_id)?;
        check_safe(event.timestamp, false)?;
        check_safe(event.previous_revision, false)?;
        check_safe(event.revision, true)?;
        if event.schema_version != 1
            || !is_identifier(&event.actor_id)
            || event.action != "feature.permissions.updated"
            || event.review_digest.as_deref().is_some_and(|d| !is_hex64(d))
            || event.revision != event.previous_revision + 1
            || (event.previous_revision == 0) != event.previous_configuration.is_none()
        {
            return Err(err());
        }
        if let Some(c) = &event.previous_configuration {
            c.validate()?;
        }
        event.configuration.validate()?;
        Ok(event)
    }
}

// ---------------------------------------------------------------- Teams

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TeamRole {
    Worker,
    Reviewer,
    Orchestrator,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TeamMember {
    pub terminal_id: String,
    pub name: String,
    pub handle: String,
    pub role: TeamRole,
    pub allowed_target_terminal_ids: Vec<String>,
}

/// `terminalTeamSchema`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalTeam {
    pub version: u8,
    pub name: String,
    pub members: Vec<TeamMember>,
}

impl TerminalTeam {
    pub fn validate(&self) -> Result<()> {
        let err = || invalid("Invalid team identities or directed policy");
        if self.version != 1
            || !is_display_name(&self.name)
            || self.members.is_empty()
            || self.members.len() > TERMINAL_SLOT_CEILING
        {
            return Err(err());
        }
        for m in &self.members {
            if !is_uuid(&m.terminal_id)
                || !is_display_name(&m.name)
                || !is_handle(&m.handle)
                || m.allowed_target_terminal_ids.len() > TERMINAL_SLOT_CEILING - 1
                || !m.allowed_target_terminal_ids.iter().all(|id| is_uuid(id))
            {
                return Err(err());
            }
        }
        let ids: HashSet<&str> = self
            .members
            .iter()
            .map(|m| m.terminal_id.as_str())
            .collect();
        let len = self.members.len();
        let graph: HashMap<&str, Vec<&str>> = self
            .members
            .iter()
            .map(|m| {
                (
                    m.terminal_id.as_str(),
                    m.allowed_target_terminal_ids
                        .iter()
                        .map(String::as_str)
                        .collect(),
                )
            })
            .collect();
        let roots: Vec<&str> = self
            .members
            .iter()
            .map(|m| m.terminal_id.as_str())
            .collect();
        if ids.len() != len
            || !unique(self.members.iter().map(|m| &m.handle), len)
            || self.members.iter().any(|m| {
                m.allowed_target_terminal_ids
                    .iter()
                    .any(|id| !ids.contains(id.as_str()) || *id == m.terminal_id)
            })
            || self.members.iter().any(|m| {
                !unique(
                    m.allowed_target_terminal_ids.iter(),
                    m.allowed_target_terminal_ids.len(),
                )
            })
            || has_cycle(&graph, &roots)
        {
            return Err(err());
        }
        Ok(())
    }
}

/// `terminalTeamStateSchema`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct TerminalTeamState {
    pub revision: u64,
    pub configuration: Option<TerminalTeam>,
}

/// `terminalTeamSaveSchema`.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TerminalTeamSave {
    pub expected_revision: u64,
    pub configuration: TerminalTeam,
}

impl TerminalTeamSave {
    pub fn parse(value: &serde_json::Value) -> Result<Self> {
        let save: Self = parse(value, "team save")?;
        check_safe(save.expected_revision, false)?;
        save.configuration.validate()?;
        Ok(save)
    }
}

// ---------------------------------------------------------------- Layouts

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LayoutAxis {
    Columns,
    Rows,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct LayoutName {
    pub id: String,
    pub name: String,
}

/// `terminalLayoutRecordSchema`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TerminalLayoutRecord {
    pub version: u8,
    pub order: Vec<String>,
    pub shown: Vec<String>,
    pub active: String,
    #[serde(deserialize_with = "Option::deserialize")]
    pub maximized: Option<String>,
    pub axis: LayoutAxis,
    pub columns: u8,
    pub percent: u8,
    pub names: Vec<LayoutName>,
}

impl TerminalLayoutRecord {
    pub fn parse(value: &serde_json::Value) -> Result<Self> {
        let record: Self = parse(value, "layout")?;
        record.validate()?;
        Ok(record)
    }
    pub fn validate(&self) -> Result<()> {
        let ok = self.version == 1
            && !self.order.is_empty()
            && valid_ids(&self.order)
            && valid_ids(&self.shown)
            && is_uuid(&self.active)
            && self.maximized.as_deref().is_none_or(is_uuid)
            && self.columns <= 3
            && (25..=75).contains(&self.percent)
            && self.names.len() <= TERMINAL_SLOT_CEILING
            && self
                .names
                .iter()
                .all(|n| is_uuid(&n.id) && is_display_name(&n.name))
            && self.shown.iter().all(|id| self.order.contains(id))
            && self.order.contains(&self.active)
            && self
                .maximized
                .as_ref()
                .is_none_or(|m| self.shown.contains(m))
            && self.names.iter().all(|n| self.order.contains(&n.id))
            && unique(self.names.iter().map(|n| &n.id), self.names.len());
        if ok {
            Ok(())
        } else {
            Err(invalid("Invalid layout identities"))
        }
    }
}

pub fn to_json<T: Serialize>(value: &T) -> Result<String> {
    serde_json::to_string(value).map_err(|_| FeatureError::Store("Unserializable value".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uuid_matches_zod() {
        assert!(is_uuid("00000000-0000-4000-8000-0000000000a1"));
        assert!(is_uuid("00000000-0000-0000-0000-000000000000"));
        assert!(is_uuid("FFFFFFFF-FFFF-1FFF-BFFF-FFFFFFFFFFFF"));
        assert!(!is_uuid("00000000-0000-9000-8000-0000000000a1"));
        assert!(!is_uuid("00000000-0000-4000-c000-0000000000a1"));
        assert!(!is_uuid("00000000-0000-4000-8000-0000000000a"));
    }

    #[test]
    fn names_handles_and_ids() {
        assert!(is_display_name("Ação ✓"));
        assert!(!is_display_name(" \u{3000} "));
        assert!(!is_display_name("a\u{200b}"));
        assert!(!is_display_name(&"x".repeat(49)));
        assert!(is_display_name(&"😀".repeat(24)));
        assert!(!is_display_name(&"😀".repeat(25)));
        assert!(is_handle("t-1") && !is_handle("a") && !is_handle("-a") && !is_handle("Ab"));
        assert!(is_identifier("ws_1-a") && !is_identifier("ws 1") && !is_identifier(""));
    }

    #[test]
    fn stable_id_matches_shared() {
        // sha256('["workspace","/p"]')
        assert_eq!(
            stable_id(&["workspace", "/p"]),
            hex(&Sha256::digest(br#"["workspace","/p"]"#))
        );
        assert_eq!(sorted_ids_json(&["b".into(), "a".into()]), r#"["a","b"]"#);
    }

    #[test]
    fn permission_cycles_are_refused() {
        let rule = |s: &str, t: &str| PermissionRule {
            source_terminal_id: s.into(),
            target_terminal_id: t.into(),
            operations: vec![PermissionOperation::Delegate],
        };
        let (a, b) = (
            "00000000-0000-4000-8000-0000000000a1",
            "00000000-0000-4000-8000-0000000000b1",
        );
        let ok = PermissionConfiguration {
            schema_version: 1,
            rules: vec![rule(a, b)],
        };
        assert!(ok.validate().is_ok());
        let cycle = PermissionConfiguration {
            schema_version: 1,
            rules: vec![rule(a, b), rule(b, a)],
        };
        assert!(cycle.validate().is_err());
        let selfie = PermissionConfiguration {
            schema_version: 1,
            rules: vec![rule(a, a)],
        };
        assert!(selfie.validate().is_err());
    }
}
