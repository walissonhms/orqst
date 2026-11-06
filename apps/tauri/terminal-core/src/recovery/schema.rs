//! zod schema ports used by offline recovery. Every parser validates like the TypeScript
//! schema and returns the zod *output* (schema key order, absent optionals omitted), because the
//! parsed values are serialized into signed snapshots and digests.
use super::error::{invalid, RecoveryError, Result};
use super::js::{number, obj, s};
use crate::admission::json::{is_digest, is_uuid, utf16_len};
use crate::profiles::config::parse_interactive_config;
use crate::profiles::js::{self as pjs, Js};
use serde_json::{Map, Value};

pub fn strict<'a>(value: &'a Value, keys: &[&str]) -> Result<&'a Map<String, Value>> {
    let map = value
        .as_object()
        .ok_or_else(|| invalid("expected object"))?;
    if let Some(key) = map.keys().find(|key| !keys.contains(&key.as_str())) {
        return Err(invalid(format!("unrecognized key {key}")));
    }
    Ok(map)
}

pub fn string(value: Option<&Value>, name: &str) -> Result<String> {
    value
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| invalid(format!("{name}: expected string")))
}

pub fn abs_path(value: Option<&Value>, name: &str) -> Result<String> {
    let text = string(value, name)?;
    if !text.starts_with('/') || utf16_len(&text) > 2048 {
        return Err(invalid(format!("{name}: path")));
    }
    Ok(text)
}

/// `path` of the historical evidence schema: absolute, bounded, no NUL.
pub fn nul_free_path(value: Option<&Value>, name: &str) -> Result<String> {
    let text = abs_path(value, name)?;
    if text.contains('\0') {
        return Err(invalid(format!("{name}: NUL")));
    }
    Ok(text)
}

pub fn digest(value: Option<&Value>, name: &str) -> Result<String> {
    let text = string(value, name)?;
    if !is_digest(&text) {
        return Err(invalid(format!("{name}: digest")));
    }
    Ok(text)
}

pub fn uuid(value: Option<&Value>, name: &str) -> Result<String> {
    let text = string(value, name)?;
    if !is_uuid(&text) {
        return Err(invalid(format!("{name}: uuid")));
    }
    Ok(text)
}

pub fn nullable_uuid(value: Option<&Value>, name: &str) -> Result<Option<String>> {
    match value {
        Some(Value::Null) => Ok(None),
        other => uuid(other, name).map(Some),
    }
}

pub fn int(value: Option<&Value>, name: &str, min: i64, max: i64) -> Result<i64> {
    let number = value
        .and_then(Value::as_f64)
        .ok_or_else(|| invalid(format!("{name}: expected number")))?;
    if !number.is_finite() || number.fract() != 0.0 || number < min as f64 || number > max as f64 {
        return Err(invalid(format!("{name}: range")));
    }
    Ok(number as i64)
}

pub const SAFE: i64 = 9_007_199_254_740_991;

pub fn literal_number(value: Option<&Value>, expected: f64, name: &str) -> Result<()> {
    if value.and_then(Value::as_f64) != Some(expected) {
        return Err(invalid(format!("{name}: literal")));
    }
    Ok(())
}

pub fn literal_str(value: Option<&Value>, expected: &str, name: &str) -> Result<()> {
    if value.and_then(Value::as_str) != Some(expected) {
        return Err(invalid(format!("{name}: literal")));
    }
    Ok(())
}

pub fn string_tuple(value: Option<&Value>, length: usize, name: &str) -> Result<Vec<String>> {
    let items = value
        .and_then(Value::as_array)
        .filter(|items| items.len() == length)
        .ok_or_else(|| invalid(format!("{name}: tuple")))?;
    items
        .iter()
        .map(|item| {
            item.as_str()
                .map(str::to_owned)
                .ok_or_else(|| invalid(name.to_owned()))
        })
        .collect()
}

fn strings_value(values: &[String]) -> Value {
    Value::Array(values.iter().map(|v| s(v)).collect())
}

fn optional_uuid_value(value: &Option<String>) -> Value {
    value.as_ref().map_or(Value::Null, |v| s(v))
}

// ---------------------------------------------------------------------------------------------
// desktopAdmissionMarkerSchema
#[derive(Clone, Debug)]
pub struct Marker {
    pub owner: String,
    pub manifests: Vec<String>,
    pub epoch: Option<String>,
    pub value: Value,
}

pub fn marker(value: &Value) -> Result<Marker> {
    let parsed = crate::admission::marker::parse_desktop_admission_marker(value)?;
    let mut map = Map::new();
    map.insert("version".into(), number(1.0));
    map.insert("owner".into(), s(&parsed.owner));
    map.insert("manifests".into(), strings_value(&parsed.manifests));
    if let Some(epoch) = &parsed.epoch {
        map.insert("epoch".into(), s(epoch));
    }
    Ok(Marker {
        owner: parsed.owner,
        manifests: parsed.manifests,
        epoch: parsed.epoch,
        value: Value::Object(map),
    })
}

// ---------------------------------------------------------------------------------------------
// terminal-enrollment.ts
#[derive(Clone, Debug, PartialEq)]
pub struct EnrollmentInput {
    pub epoch: String,
    pub op_id: String,
    pub expected_revision: i64,
    pub workspace_id: String,
    pub feature_id: Option<String>,
}

const INPUT_KEYS: [&str; 6] = [
    "version",
    "epoch",
    "opId",
    "expectedRevision",
    "workspaceId",
    "featureId",
];

fn input_fields(map: &Map<String, Value>) -> Result<EnrollmentInput> {
    literal_number(map.get("version"), 1.0, "version")?;
    Ok(EnrollmentInput {
        epoch: uuid(map.get("epoch"), "epoch")?,
        op_id: uuid(map.get("opId"), "opId")?,
        expected_revision: int(map.get("expectedRevision"), "expectedRevision", 0, SAFE)?,
        workspace_id: digest(map.get("workspaceId"), "workspaceId")?,
        feature_id: nullable_uuid(map.get("featureId"), "featureId")?,
    })
}

impl EnrollmentInput {
    /// `Object.keys(intent.input)` values in schema order, for the structural comparison.
    pub fn fields(&self) -> Vec<(&'static str, Value)> {
        vec![
            ("version", number(1.0)),
            ("epoch", s(&self.epoch)),
            ("opId", s(&self.op_id)),
            ("expectedRevision", number(self.expected_revision as f64)),
            ("workspaceId", s(&self.workspace_id)),
            ("featureId", optional_uuid_value(&self.feature_id)),
        ]
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct EnrollmentMember {
    pub slot: i64,
    pub terminal_id: String,
    pub alias: Option<String>,
    pub provider: String,
    /// `None` = absent, `Some(None)` = null.
    pub requested_model: Option<Option<String>>,
    pub workspace_id: String,
    pub feature_id: Option<String>,
    pub admission_revision: i64,
    pub binding_digest: String,
    pub status: String,
}

pub fn member(value: &Value) -> Result<EnrollmentMember> {
    let map = strict(
        value,
        &[
            "slot",
            "terminalId",
            "alias",
            "provider",
            "requestedModel",
            "workspaceId",
            "featureId",
            "admissionRevision",
            "bindingDigest",
            "status",
        ],
    )?;
    let alias = match map.get("alias") {
        None => None,
        some => {
            let text = string(some, "alias")?;
            let length = utf16_len(&text);
            if !(1..=128).contains(&length) {
                return Err(invalid("alias"));
            }
            Some(text)
        }
    };
    let provider = string(map.get("provider"), "provider")?;
    if !matches!(provider.as_str(), "codex" | "claude" | "opencode") {
        return Err(invalid("provider"));
    }
    let requested_model = match map.get("requestedModel") {
        None => None,
        Some(Value::Null) => Some(None),
        some => {
            let text = string(some, "requestedModel")?;
            if !(1..=160).contains(&utf16_len(&text)) {
                return Err(invalid("requestedModel"));
            }
            Some(Some(text))
        }
    };
    let status = string(map.get("status"), "status")?;
    if !matches!(status.as_str(), "ready" | "uncertain") {
        return Err(invalid("status"));
    }
    Ok(EnrollmentMember {
        slot: int(map.get("slot"), "slot", 0, 7)?,
        terminal_id: uuid(map.get("terminalId"), "terminalId")?,
        alias,
        provider,
        requested_model,
        workspace_id: digest(map.get("workspaceId"), "workspaceId")?,
        feature_id: nullable_uuid(map.get("featureId"), "featureId")?,
        admission_revision: int(map.get("admissionRevision"), "admissionRevision", 0, SAFE)?,
        binding_digest: digest(map.get("bindingDigest"), "bindingDigest")?,
        status,
    })
}

impl EnrollmentMember {
    pub fn to_value(&self, status: &str) -> Value {
        let mut map = Map::new();
        map.insert("slot".into(), number(self.slot as f64));
        map.insert("terminalId".into(), s(&self.terminal_id));
        if let Some(alias) = &self.alias {
            map.insert("alias".into(), s(alias));
        }
        map.insert("provider".into(), s(&self.provider));
        if let Some(model) = &self.requested_model {
            map.insert("requestedModel".into(), optional_uuid_value(model));
        }
        map.insert("workspaceId".into(), s(&self.workspace_id));
        map.insert("featureId".into(), optional_uuid_value(&self.feature_id));
        map.insert(
            "admissionRevision".into(),
            number(self.admission_revision as f64),
        );
        map.insert("bindingDigest".into(), s(&self.binding_digest));
        map.insert("status".into(), s(status));
        Value::Object(map)
    }
}

/// `intentSchema` of `offline-recovery-files.ts`.
#[derive(Clone, Debug)]
pub struct Intent {
    pub owner: String,
    pub input: EnrollmentInput,
    pub manifest_file: String,
    pub member: EnrollmentMember,
}

pub fn enrollment_intent(value: &Value) -> Result<Intent> {
    let map = strict(
        value,
        &["version", "owner", "input", "manifestFile", "member"],
    )?;
    literal_number(map.get("version"), 1.0, "version")?;
    let input = input_fields(strict(
        map.get("input").ok_or_else(|| invalid("input"))?,
        &INPUT_KEYS,
    )?)?;
    Ok(Intent {
        owner: uuid(map.get("owner"), "owner")?,
        input,
        manifest_file: abs_path(map.get("manifestFile"), "manifestFile")?,
        member: member(map.get("member").ok_or_else(|| invalid("member"))?)?,
    })
}

/// `receiptSchema` (`{ version, owner, receipt: terminalEnrollmentReceiptSchema }`).
#[derive(Clone, Debug)]
pub struct Receipt {
    pub owner: String,
    pub input: EnrollmentInput,
    pub status: String,
    pub member: Option<EnrollmentMember>,
}

pub fn enrollment_receipt(value: &Value) -> Result<Receipt> {
    let map = strict(value, &["version", "owner", "receipt"])?;
    literal_number(map.get("version"), 1.0, "version")?;
    let owner = uuid(map.get("owner"), "owner")?;
    let mut keys = INPUT_KEYS.to_vec();
    keys.extend(["revision", "status", "reason", "member"]);
    let receipt = strict(map.get("receipt").ok_or_else(|| invalid("receipt"))?, &keys)?;
    let input = input_fields(receipt)?;
    let revision = int(receipt.get("revision"), "revision", 0, SAFE)?;
    let status = string(receipt.get("status"), "status")?;
    if !matches!(status.as_str(), "ready" | "rejected" | "uncertain") {
        return Err(invalid("status"));
    }
    let reason = string(receipt.get("reason"), "reason")?;
    if !matches!(
        reason.as_str(),
        "admitted" | "revision_conflict" | "capacity" | "invalid_profile" | "effect_uncertain"
    ) {
        return Err(invalid("reason"));
    }
    let member_value = receipt.get("member").ok_or_else(|| invalid("member"))?;
    let parsed_member = if member_value.is_null() {
        None
    } else {
        Some(member(member_value)?)
    };
    // superRefine
    if status == "rejected" {
        if parsed_member.is_some() || reason == "admitted" {
            return Err(invalid("Rejected enrollment cannot convey admission"));
        }
    } else {
        let ok = parsed_member.as_ref().is_some_and(|m| {
            m.status == status
                && revision == input.expected_revision + 1
                && m.admission_revision == revision
                && m.workspace_id == input.workspace_id
                && m.feature_id == input.feature_id
        }) && reason
            == if status == "ready" {
                "admitted"
            } else {
                "effect_uncertain"
            };
        if !ok {
            return Err(invalid("Enrollment receipt binding changed"));
        }
    }
    Ok(Receipt {
        owner,
        input,
        status,
        member: parsed_member,
    })
}

// ---------------------------------------------------------------------------------------------
// terminalAttemptSchema
pub fn attempt(value: &Value) -> Result<Value> {
    let map = strict(
        value,
        &[
            "instanceId",
            "epoch",
            "clientId",
            "projectId",
            "manifestDigest",
            "state",
            "createdAt",
            "updatedAt",
            "exit",
        ],
    )?;
    let identifier = |key: &str| -> Result<String> {
        let text = string(map.get(key), key)?;
        if !(1..=128).contains(&utf16_len(&text)) {
            return Err(invalid(key.to_owned()));
        }
        Ok(text)
    };
    let state = string(map.get("state"), "state")?;
    if !crate::journal::STATES.contains(&state.as_str()) {
        return Err(invalid("state"));
    }
    let created = int(map.get("createdAt"), "createdAt", 0, SAFE)?;
    let updated = int(map.get("updatedAt"), "updatedAt", 0, SAFE)?;
    let mut out = Map::new();
    out.insert(
        "instanceId".into(),
        s(&uuid(map.get("instanceId"), "instanceId")?),
    );
    out.insert("epoch".into(), s(&uuid(map.get("epoch"), "epoch")?));
    out.insert("clientId".into(), s(&identifier("clientId")?));
    out.insert("projectId".into(), s(&identifier("projectId")?));
    out.insert(
        "manifestDigest".into(),
        s(&digest(map.get("manifestDigest"), "manifestDigest")?),
    );
    out.insert("state".into(), s(&state));
    out.insert("createdAt".into(), number(created as f64));
    out.insert("updatedAt".into(), number(updated as f64));
    let mut exit_present = false;
    let mut exit_invalid = false;
    if let Some(exit) = map.get("exit") {
        let e = strict(exit, &["exitCode", "signal"])?;
        let code = match e.get("exitCode") {
            Some(Value::Null) => None,
            some => Some(int(some, "exitCode", -SAFE, SAFE)?),
        };
        let mut exit_out = Map::new();
        exit_out.insert(
            "exitCode".into(),
            code.map_or(Value::Null, |c| number(c as f64)),
        );
        let signal_ok = match e.get("signal") {
            None => code.is_some(),
            Some(Value::String(text)) => {
                let valid = text.len() >= 4
                    && text.len() <= 32
                    && text.starts_with("SIG")
                    && text[3..]
                        .bytes()
                        .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit());
                if !valid {
                    return Err(invalid("signal"));
                }
                exit_out.insert("signal".into(), s(text));
                true
            }
            some => {
                let n = int(some, "signal", -SAFE, SAFE)?;
                exit_out.insert("signal".into(), number(n as f64));
                code.is_some() || n > 0
            }
        };
        exit_invalid = !signal_ok;
        exit_present = true;
        out.insert("exit".into(), Value::Object(exit_out));
    }
    if (state == "exited") != exit_present || updated < created || exit_invalid {
        return Err(invalid("Invalid terminal lifecycle evidence"));
    }
    Ok(Value::Object(out))
}

// ---------------------------------------------------------------------------------------------
// managedCodex/Claude/OpenCode config schemas: validation plus zod output order.
enum Shape {
    Leaf,
    Obj(Vec<(&'static str, Shape)>),
    Arr(Box<Shape>),
}

fn leafs(keys: &[&'static str]) -> Shape {
    Shape::Obj(keys.iter().map(|k| (*k, Shape::Leaf)).collect())
}

fn common(version_keys: &[&'static str]) -> Vec<(&'static str, Shape)> {
    let mut out: Vec<(&'static str, Shape)> =
        version_keys.iter().map(|k| (*k, Shape::Leaf)).collect();
    out.extend([
        ("executable", leafs(&["path", "sha256"])),
        ("executableVersion", Shape::Leaf),
        ("node", leafs(&["path", "sha256"])),
        ("toolPath", Shape::Leaf),
        ("identity", leafs(&["terminalId"])),
        ("project", Shape::Leaf),
        ("state", Shape::Leaf),
        (
            "model",
            Shape::Obj(vec![
                ("value", Shape::Leaf),
                ("source", Shape::Leaf),
                ("expiresAt", Shape::Leaf),
                (
                    "files",
                    Shape::Arr(Box::new(leafs(&[
                        "path",
                        "codexModel",
                        "openCodeModel",
                        "sha256",
                    ]))),
                ),
            ]),
        ),
        (
            "preparation",
            leafs(&[
                "observerDatabase",
                "preferencesDirectory",
                "workspaceId",
                "featureId",
                "fence",
            ]),
        ),
    ]);
    out
}

fn config_shape(version: f64) -> Shape {
    if version == 2.0 {
        let mut keys = common(&["version", "provider", "trust"]);
        keys.extend([
            ("sessionId", Shape::Leaf),
            ("ownedHooks", Shape::Leaf),
            (
                "authentication",
                leafs(&[
                    "mode",
                    "home",
                    "claudeConfigDirectory",
                    "sharedNativeConfiguration",
                ]),
            ),
            (
                "interactive",
                leafs(&[
                    "sharedNativeSessions",
                    "mcp",
                    "strictMcpAcknowledged",
                    "hub",
                ]),
            ),
        ]);
        Shape::Obj(keys)
    } else if version == 3.0 {
        let mut keys = common(&["version", "provider", "trust"]);
        keys.extend([
            (
                "authentication",
                Shape::Obj(vec![
                    ("mode", Shape::Leaf),
                    (
                        "nativeIdentity",
                        leafs(&[
                            "HOME",
                            "XDG_CONFIG_HOME",
                            "XDG_DATA_HOME",
                            "XDG_STATE_HOME",
                            "XDG_CACHE_HOME",
                            "OPENCODE_CONFIG_DIR",
                            "OPENCODE_DB",
                        ]),
                    ),
                    ("sharedNativeConfiguration", Shape::Leaf),
                ]),
            ),
            (
                "interactive",
                leafs(&[
                    "sharedNativeSessions",
                    "nativeStartupAuthorized",
                    "nativeDatabaseMigrationsAcknowledged",
                    "nativeStartupActivityAcknowledged",
                    "mcp",
                    "mergedMcpAcknowledged",
                    "hub",
                ]),
            ),
        ]);
        Shape::Obj(keys)
    } else {
        let mut keys = common(&["version", "trust"]);
        keys.extend([
            (
                "interactive",
                leafs(&["sharedNativeSessions", "mcp", "hub"]),
            ),
            (
                "authentication",
                leafs(&["mode", "home", "codexHome", "sharedNativeConfiguration"]),
            ),
        ]);
        Shape::Obj(keys)
    }
}

fn reorder(value: &Value, shape: &Shape) -> Result<Value> {
    match (shape, value) {
        (Shape::Leaf, _) => Ok(value.clone()),
        (Shape::Arr(item), Value::Array(items)) => Ok(Value::Array(
            items
                .iter()
                .map(|v| reorder(v, item))
                .collect::<Result<_>>()?,
        )),
        (Shape::Obj(keys), Value::Object(map)) => {
            if let Some(key) = map.keys().find(|k| !keys.iter().any(|(name, _)| name == k)) {
                return Err(invalid(format!("unrecognized key {key}")));
            }
            let mut out = Map::new();
            for (key, inner) in keys {
                if let Some(item) = map.get(*key) {
                    out.insert((*key).to_owned(), reorder(item, inner)?);
                }
            }
            Ok(Value::Object(out))
        }
        _ => Err(invalid("config shape")),
    }
}

fn to_js(value: &Value) -> Js {
    match value {
        Value::Null => Js::Null,
        Value::Bool(b) => Js::Bool(*b),
        Value::Number(n) => Js::Num(n.as_f64().unwrap_or(f64::NAN)),
        Value::String(text) => Js::Str(text.clone()),
        Value::Array(items) => Js::Arr(items.iter().map(to_js).collect()),
        Value::Object(map) => {
            let mut entries = Vec::new();
            for (key, item) in map {
                pjs::obj_set(&mut entries, key, to_js(item));
            }
            Js::Obj(entries)
        }
    }
}

/// `z.union([managedCodexConfigSchema, managedClaudeConfigSchema, managedOpenCodeConfigSchema])`.
pub fn interactive_config(value: &Value) -> Result<Value> {
    parse_interactive_config(&to_js(value)).map_err(RecoveryError::from)?;
    let version = value.get("version").and_then(Value::as_f64).unwrap_or(1.0);
    reorder(value, &config_shape(version))
}

// ---------------------------------------------------------------------------------------------
// historicalBindingEvidenceSchema / historicalBindingSnapshotSchema
fn identity_text(value: Option<&Value>, name: &str) -> Result<String> {
    let text = string(value, name)?;
    let part = |p: &str| {
        !p.is_empty() && p.bytes().all(|b| b.is_ascii_digit()) && (p == "0" || !p.starts_with('0'))
    };
    match text.split_once(':') {
        Some((a, b)) if part(a) && part(b) => Ok(text),
        _ => Err(invalid(format!("{name}: identity"))),
    }
}

pub fn historical_evidence(value: &Value) -> Result<Value> {
    let map = strict(
        value,
        &[
            "kind",
            "version",
            "marker",
            "enrollment",
            "member",
            "historicalModelSource",
            "modelSources",
        ],
    )?;
    literal_str(
        map.get("kind"),
        "orqst.offline-recovery.historical-binding-evidence",
        "kind",
    )?;
    literal_number(map.get("version"), 1.0, "version")?;
    let get = |key: &str| map.get(key).ok_or_else(|| invalid(key.to_owned()));
    let m = strict(get("marker")?, &["owner", "sha256"])?;
    let e = strict(
        get("enrollment")?,
        &["opId", "epoch", "intentSha256", "receiptSha256"],
    )?;
    let mem = strict(
        get("member")?,
        &[
            "slot",
            "terminalId",
            "manifestSha256",
            "manifestIdentity",
            "frozenBindingDigest",
        ],
    )?;
    let h = strict(
        get("historicalModelSource")?,
        &["index", "path", "identity"],
    )?;
    let sources = get("modelSources")?
        .as_array()
        .filter(|items| (1..=8).contains(&items.len()))
        .ok_or_else(|| invalid("modelSources"))?;
    let sources = sources
        .iter()
        .map(|item| {
            let source = strict(item, &["path", "identity"])?;
            let identity = match source.get("identity") {
                Some(Value::Null) => Value::Null,
                some => s(&identity_text(some, "identity")?),
            };
            Ok(obj([
                ("path", s(&nul_free_path(source.get("path"), "path")?)),
                ("identity", identity),
            ]))
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(obj([
        (
            "kind",
            s("orqst.offline-recovery.historical-binding-evidence"),
        ),
        ("version", number(1.0)),
        (
            "marker",
            obj([
                ("owner", s(&uuid(m.get("owner"), "owner")?)),
                ("sha256", s(&digest(m.get("sha256"), "sha256")?)),
            ]),
        ),
        (
            "enrollment",
            obj([
                ("opId", s(&uuid(e.get("opId"), "opId")?)),
                ("epoch", s(&uuid(e.get("epoch"), "epoch")?)),
                (
                    "intentSha256",
                    s(&digest(e.get("intentSha256"), "intentSha256")?),
                ),
                (
                    "receiptSha256",
                    s(&digest(e.get("receiptSha256"), "receiptSha256")?),
                ),
            ]),
        ),
        (
            "member",
            obj([
                ("slot", number(int(mem.get("slot"), "slot", 0, 7)? as f64)),
                ("terminalId", s(&uuid(mem.get("terminalId"), "terminalId")?)),
                (
                    "manifestSha256",
                    s(&digest(mem.get("manifestSha256"), "manifestSha256")?),
                ),
                (
                    "manifestIdentity",
                    s(&identity_text(
                        mem.get("manifestIdentity"),
                        "manifestIdentity",
                    )?),
                ),
                (
                    "frozenBindingDigest",
                    s(&digest(
                        mem.get("frozenBindingDigest"),
                        "frozenBindingDigest",
                    )?),
                ),
            ]),
        ),
        (
            "historicalModelSource",
            obj([
                ("index", number(int(h.get("index"), "index", 0, 7)? as f64)),
                ("path", s(&nul_free_path(h.get("path"), "path")?)),
                (
                    "identity",
                    s(&identity_text(h.get("identity"), "identity")?),
                ),
            ]),
        ),
        ("modelSources", Value::Array(sources)),
    ]))
}

fn source_list(
    value: Option<&Value>,
    min: usize,
    max: usize,
    path: fn(Option<&Value>, &str) -> Result<String>,
) -> Result<Value> {
    let items = value
        .and_then(Value::as_array)
        .filter(|items| (min..=max).contains(&items.len()))
        .ok_or_else(|| invalid("sources"))?;
    Ok(Value::Array(
        items
            .iter()
            .map(|item| {
                let map = strict(item, &["path", "identity"])?;
                let identity = match map.get("identity") {
                    Some(Value::Null) => Value::Null,
                    some => strings_value(&string_tuple(some, 5, "identity")?),
                };
                Ok(obj([
                    ("path", s(&path(map.get("path"), "path")?)),
                    ("identity", identity),
                ]))
            })
            .collect::<Result<Vec<_>>>()?,
    ))
}

pub fn historical_snapshot(value: &Value) -> Result<Value> {
    let map = strict(value, &["evidenceSha256", "evidence", "currentSources"])?;
    Ok(obj([
        (
            "evidenceSha256",
            s(&digest(map.get("evidenceSha256"), "evidenceSha256")?),
        ),
        (
            "evidence",
            historical_evidence(map.get("evidence").ok_or_else(|| invalid("evidence"))?)?,
        ),
        (
            "currentSources",
            source_list(map.get("currentSources"), 1, 8, nul_free_path)?,
        ),
    ]))
}

fn device(value: Option<&Value>, name: &str) -> Result<String> {
    let text = string(value, name)?;
    if text.is_empty()
        || !text.bytes().all(|b| b.is_ascii_digit())
        || (text.len() > 1 && text.starts_with('0'))
    {
        return Err(invalid(name.to_owned()));
    }
    Ok(text)
}

pub fn physical_difference(value: &Value) -> Result<Value> {
    let map = strict(
        value,
        &["kind", "historicalDevice", "currentDevice", "bindings"],
    )?;
    literal_str(map.get("kind"), "administrative_device_difference", "kind")?;
    let bindings = map
        .get("bindings")
        .and_then(Value::as_array)
        .filter(|items| (1..=8).contains(&items.len()))
        .ok_or_else(|| invalid("bindings"))?;
    let bindings = bindings
        .iter()
        .map(|item| {
            let b = strict(item, &["slot", "identities"])?;
            Ok(obj([
                ("slot", number(int(b.get("slot"), "slot", 0, 7)? as f64)),
                (
                    "identities",
                    source_list(b.get("identities"), 5, 13, abs_path)?,
                ),
            ]))
        })
        .collect::<Result<Vec<_>>>()?;
    Ok(obj([
        ("kind", s("administrative_device_difference")),
        (
            "historicalDevice",
            s(&device(map.get("historicalDevice"), "historicalDevice")?),
        ),
        (
            "currentDevice",
            s(&device(map.get("currentDevice"), "currentDevice")?),
        ),
        ("bindings", Value::Array(bindings)),
    ]))
}

// ---------------------------------------------------------------------------------------------
// offlineSnapshotSchema
fn definitions(value: Option<&Value>) -> Result<Value> {
    let items = value
        .and_then(Value::as_array)
        .filter(|items| items.len() <= 16)
        .ok_or_else(|| invalid("definitions"))?;
    for item in items {
        let map = item.as_object().ok_or_else(|| invalid("definition"))?;
        if !map
            .values()
            .all(|v| v.is_string() || v.is_number() || v.is_null())
        {
            return Err(invalid("definition"));
        }
    }
    Ok(Value::Array(items.clone()))
}

pub fn logical(value: &Value) -> Result<Value> {
    let map = strict(
        value,
        &["schemaVersion", "epoch", "definitions", "attempts"],
    )?;
    literal_number(map.get("schemaVersion"), 2.0, "schemaVersion")?;
    let attempts = map
        .get("attempts")
        .and_then(Value::as_array)
        .filter(|items| items.len() <= 10_000)
        .ok_or_else(|| invalid("attempts"))?;
    Ok(obj([
        ("schemaVersion", number(2.0)),
        ("epoch", s(&uuid(map.get("epoch"), "epoch")?)),
        ("definitions", definitions(map.get("definitions"))?),
        (
            "attempts",
            Value::Array(attempts.iter().map(attempt).collect::<Result<_>>()?),
        ),
    ]))
}

fn journal(value: &Value) -> Result<Value> {
    let map = strict(
        value,
        &[
            "path",
            "slot",
            "terminalId",
            "bindingDigest",
            "databaseIdentity",
            "stateNames",
            "shmIdentity",
            "logical",
        ],
    )?;
    let names = map
        .get("stateNames")
        .and_then(Value::as_array)
        .filter(|items| items.len() <= 256 && items.iter().all(Value::is_string))
        .ok_or_else(|| invalid("stateNames"))?;
    let shm = match map.get("shmIdentity") {
        Some(Value::Null) => Value::Null,
        some => strings_value(&string_tuple(some, 7, "shmIdentity")?),
    };
    Ok(obj([
        ("path", s(&abs_path(map.get("path"), "path")?)),
        ("slot", number(int(map.get("slot"), "slot", 0, 7)? as f64)),
        ("terminalId", s(&uuid(map.get("terminalId"), "terminalId")?)),
        (
            "bindingDigest",
            s(&digest(map.get("bindingDigest"), "bindingDigest")?),
        ),
        (
            "databaseIdentity",
            strings_value(&string_tuple(
                map.get("databaseIdentity"),
                4,
                "databaseIdentity",
            )?),
        ),
        ("stateNames", Value::Array(names.clone())),
        ("shmIdentity", shm),
        (
            "logical",
            logical(map.get("logical").ok_or_else(|| invalid("logical"))?)?,
        ),
    ]))
}

pub fn snapshot(value: &Value) -> Result<Value> {
    let map = strict(
        value,
        &[
            "version",
            "files",
            "journals",
            "membership",
            "historicalBinding",
            "physicalDifference",
            "logicalDigest",
            "rawDigest",
        ],
    )?;
    literal_number(map.get("version"), 1.0, "version")?;
    let files = map
        .get("files")
        .and_then(Value::as_array)
        .filter(|items| (3..=48).contains(&items.len()))
        .ok_or_else(|| invalid("files"))?;
    let journals = map
        .get("journals")
        .and_then(Value::as_array)
        .filter(|items| (1..=8).contains(&items.len()))
        .ok_or_else(|| invalid("journals"))?;
    let membership = map
        .get("membership")
        .and_then(Value::as_array)
        .filter(|items| items.len() <= 256 && items.iter().all(Value::is_string))
        .ok_or_else(|| invalid("membership"))?;
    let mut out = Map::new();
    out.insert("version".into(), number(1.0));
    out.insert(
        "files".into(),
        Value::Array(
            files
                .iter()
                .map(|f| super::fsio::FileRecord::from_value(f).map(|r| r.to_value()))
                .collect::<Result<_>>()?,
        ),
    );
    out.insert(
        "journals".into(),
        Value::Array(journals.iter().map(journal).collect::<Result<_>>()?),
    );
    out.insert("membership".into(), Value::Array(membership.clone()));
    if let Some(h) = map.get("historicalBinding") {
        out.insert("historicalBinding".into(), historical_snapshot(h)?);
    }
    if let Some(p) = map.get("physicalDifference") {
        out.insert("physicalDifference".into(), physical_difference(p)?);
    }
    out.insert(
        "logicalDigest".into(),
        s(&digest(map.get("logicalDigest"), "logicalDigest")?),
    );
    out.insert(
        "rawDigest".into(),
        s(&digest(map.get("rawDigest"), "rawDigest")?),
    );
    Ok(Value::Object(out))
}
