//! Port of the composition in `packages/core/src/terminal/host.ts` (the Node Core entry):
//! argv, startup stages and `startup-failure`, the per-slot Store/journal/profile/PTY
//! composition, the Feature-scoped MCP hub and the pair-RPC kinds owned outside `pair`.
//!
//! Out of scope: the legacy disposable pair MCP (`InteractiveMcpSession`,
//! `prepareMcp`/`authorizeMcp`, `config.interactive.mcp` without `hub`). Such a selection is
//! refused at startup with the `core_startup` / `startup_failed` failure message; hub and
//! non-MCP selections are composed.
use crate::admission::enrollment::{inode, terminal_enrollment_file, TerminalEnrollmentBinding};
use crate::admission::exit_pending::{
    inspect_pending_owned_exits, preserve_owned_exit_pending, read_owned_exit_pending,
    OwnedExitPending, LEADER_EXITED_RETIREMENT_PENDING,
};
use crate::admission::startup_failure::{core_startup_failure_message, is_startup_id};
use crate::admission::{AdmissionError, DesktopAdmission, RefusalCode, SharedDesktopAdmission};
use crate::authority::{ed25519_spki, now_ms, Authority};
use crate::backend::{LifecycleReceipt, PtyBackend, Receipt, SessionReader, SlotProfiles};
use crate::core::{CoreEvent, Extensions, Startup};
use crate::features::model::stable_id;
use crate::features::FeatureContext;
use crate::hub::journal::HubJournal;
use crate::hub::mentions::{hub_delivery, record_composer_mention};
use crate::hub::{
    hub_members, open_hub_endpoint, HubActivity, HubEndpoint, HubSlot, TerminalBinding,
    TerminalMessageHub,
};
use crate::journal::Journal;
use crate::pair::{
    member_schema_order, receipt_schema_order, Admission, EnrollmentCandidate, Pair, Slot,
};
use crate::preparation::FeaturePreparation;
use crate::profiles::adapters::interactive_cli_adapter;
use crate::profiles::backend::ManagedProfileBackend;
use crate::profiles::config::{Binary, InteractiveConfig, McpLaunch};
use crate::profiles::fsx::terminal_file;
use crate::profiles::identity::terminal_identity;
use crate::profiles::interactive::{
    interactive_provider, manifest_source, read_interactive_terminal_config,
};
use crate::profiles::managed_files::inspect_managed_terminal_files;
use crate::profiles::nodepath::relative;
use crate::profiles::session::LifecycleBinding;
use crate::store::Store;
use crate::supervisor::{Identity, PreparedProfile, Shared};
use serde_json::{json, Map, Value};
use std::cell::RefCell;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::rc::Rc;
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};

type R<T> = Result<T, String>;

const CLIENT: &str = "desktop-managed";
const RELAY: &str = "orqst-mcp-relay.cjs";
const RELAY_LIMIT: u64 = 16 * 1024 * 1024;

/// `process.argv[2..6]` of host.ts as `argv[1..5]`.
#[derive(Clone, Debug)]
pub struct Args {
    pub files: String,
    pub public_key: String,
    pub preferences: String,
    pub limit: String,
    pub startup_id: String,
}

impl Args {
    /// `None` when the startup id itself is unusable: no failure can be correlated, exactly
    /// like a `terminalStartupIdSchema.parse` failure at host.ts module load.
    pub fn parse(argv: &[String]) -> Option<(Args, bool)> {
        let startup_id = argv.get(5)?.clone();
        if !is_startup_id(&startup_id) {
            return None;
        }
        let get = |i: usize| argv.get(i).cloned().unwrap_or_default();
        Some((
            Args {
                files: get(1),
                public_key: get(2),
                preferences: get(3),
                limit: get(4),
                startup_id,
            },
            argv.len() == 6,
        ))
    }
}

/// A startup failure: the stage that was active and an admission refusal code, if any.
#[derive(Debug)]
pub struct Failure {
    pub stage: &'static str,
    pub refusal: Option<RefusalCode>,
    pub detail: String,
}

impl Failure {
    fn startup(detail: impl ToString) -> Failure {
        Failure {
            stage: "core_startup",
            refusal: None,
            detail: detail.to_string(),
        }
    }
    /// The IPC `startup-failure` message (`terminalStartupFailureSchema`).
    pub fn message(&self, startup_id: &str) -> Option<Value> {
        core_startup_failure_message(startup_id, self.stage, self.refusal).ok()
    }
}

/// `terminalSlotLimit(Number(text))`: an integer in 1..=8.
pub fn slot_limit(text: &str) -> R<usize> {
    let value: f64 = text
        .trim()
        .parse()
        .map_err(|_| "Invalid terminal slot limit".to_owned())?;
    if value.fract() != 0.0 || !(1.0..=8.0).contains(&value) {
        return Err("Invalid terminal slot limit".into());
    }
    Ok(value as usize)
}

fn reorder(value: &Value, keys: &[&str]) -> Value {
    let Some(object) = value.as_object() else {
        return value.clone();
    };
    let mut out = Map::new();
    for key in keys {
        if let Some(v) = object.get(*key) {
            out.insert((*key).to_owned(), v.clone());
        }
    }
    // Strict schemas: unknown keys were already refused by the profile parser.
    Value::Object(out)
}

fn reorder_field(out: &mut Value, key: &str, keys: &[&str]) {
    if let Some(field) = out.get_mut(key) {
        *field = reorder(field, keys);
    }
}

/// The `InteractiveTerminalConfig` value in zod output order (schema shape order, absent
/// optionals omitted) from the manifest bytes. No schema in the chain transforms values.
pub fn config_value(file: &str) -> R<Value> {
    let source = manifest_source(file).map_err(|e| e.to_string())?;
    let raw: Value = serde_json::from_slice(&source).map_err(|e| e.to_string())?;
    let version = raw.get("version").and_then(Value::as_u64);
    let head = [
        "version",
        "provider",
        "trust",
        "executable",
        "executableVersion",
        "node",
        "toolPath",
        "identity",
        "project",
        "state",
        "model",
        "preparation",
    ];
    let tail: &[&str] = match version {
        Some(2) => &["sessionId", "ownedHooks", "authentication", "interactive"],
        Some(3) => &["authentication", "interactive"],
        _ => &["interactive", "authentication"],
    };
    let keys: Vec<&str> = head.iter().chain(tail).copied().collect();
    let mut out = reorder(&raw, &keys);
    for key in ["executable", "node"] {
        reorder_field(&mut out, key, &["path", "sha256"]);
    }
    reorder_field(&mut out, "identity", &["terminalId"]);
    reorder_field(
        &mut out,
        "model",
        &["value", "source", "expiresAt", "files"],
    );
    if let Some(Value::Array(files)) = out.get_mut("model").and_then(|m| m.get_mut("files")) {
        for file in files.iter_mut() {
            *file = reorder(file, &["path", "codexModel", "openCodeModel", "sha256"]);
        }
    }
    reorder_field(
        &mut out,
        "preparation",
        &[
            "observerDatabase",
            "preferencesDirectory",
            "workspaceId",
            "featureId",
            "fence",
        ],
    );
    let (interactive, authentication): (&[&str], &[&str]) = match version {
        Some(2) => (
            &[
                "sharedNativeSessions",
                "mcp",
                "strictMcpAcknowledged",
                "hub",
            ],
            &[
                "mode",
                "home",
                "claudeConfigDirectory",
                "sharedNativeConfiguration",
            ],
        ),
        Some(3) => (
            &[
                "sharedNativeSessions",
                "nativeStartupAuthorized",
                "nativeDatabaseMigrationsAcknowledged",
                "nativeStartupActivityAcknowledged",
                "mcp",
                "mergedMcpAcknowledged",
                "hub",
            ],
            &["mode", "nativeIdentity", "sharedNativeConfiguration"],
        ),
        _ => (
            &["sharedNativeSessions", "mcp", "hub"],
            &["mode", "home", "codexHome", "sharedNativeConfiguration"],
        ),
    };
    reorder_field(&mut out, "interactive", interactive);
    reorder_field(&mut out, "authentication", authentication);
    if let Some(auth) = out.get_mut("authentication") {
        reorder_field(
            auth,
            "nativeIdentity",
            &[
                "HOME",
                "XDG_CONFIG_HOME",
                "XDG_DATA_HOME",
                "XDG_STATE_HOME",
                "XDG_CACHE_HOME",
                "OPENCODE_CONFIG_DIR",
                "OPENCODE_DB",
            ],
        );
    }
    Ok(out)
}

/// `terminalEnrollmentFile(file, config)`.
#[derive(Clone)]
pub struct EnrollmentRecord {
    pub file: String,
    pub config: InteractiveConfig,
    pub value: Value,
    pub binding: TerminalEnrollmentBinding,
}

pub fn enrollment_record(file: &str, config: InteractiveConfig) -> R<EnrollmentRecord> {
    let value = config_value(file)?;
    let binding = terminal_enrollment_file(Path::new(file), &value).map_err(|e| e.to_string())?;
    Ok(EnrollmentRecord {
        file: file.to_owned(),
        config,
        value,
        binding,
    })
}

fn terminal_id(config: &InteractiveConfig) -> (String, String) {
    terminal_identity(config.state(), config.identity())
}

fn requested_model(value: &Value) -> Option<Value> {
    value
        .get("model")
        .map(|m| m.get("value").cloned().unwrap_or(Value::Null))
}

type Validate = Rc<dyn Fn() -> R<()>>;

/// `inspectTerminalEnrollment(file, input, existing)`: read-only.
pub fn inspect_terminal_enrollment(
    file: &str,
    input: &Map<String, Value>,
    existing: &[EnrollmentRecord],
) -> R<(EnrollmentRecord, Map<String, Value>, Validate)> {
    let prep = FeaturePreparation;
    let text = |e: &dyn ToString| e.to_string();
    let before = inode(Path::new(file), false).map_err(|e| text(&e))?;
    let selected = inspect_managed_terminal_files(&[file.to_owned()], Some(1), &prep)
        .map_err(|e| text(&e))?
        .remove(0);
    let config = selected.config;
    let preparation = config.preparation().cloned();
    let candidate = enrollment_record(file, config.clone())?;
    if selected.blocker.is_some()
        || config.identity().is_none()
        || candidate.value.get("model").is_none()
        || preparation.is_none()
        || !config.has_interactive()
        || (config.mcp() && !config.hub())
    {
        return Err("Enrollment requires a prepared independent native profile".into());
    }
    let preparation = preparation.unwrap();
    let workspace = input
        .get("workspaceId")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let feature = input.get("featureId").and_then(Value::as_str);
    if Some(config.project()) != existing.first().map(|m| m.config.project())
        || stable_id(&["workspace", config.project()]) != workspace
        || preparation.workspace_id != workspace
        || preparation.feature_id.as_deref() != feature
    {
        return Err("Enrollment workspace or Feature changed".into());
    }
    if candidate.binding.identities.first() != Some(&before) {
        return Err("Enrollment manifest replaced".into());
    }
    let (id, alias) = terminal_id(&config);
    for member in existing {
        if terminal_id(&member.config).0 == id {
            return Err("Duplicate terminal identity".into());
        }
        let theirs = &member.binding.identities[..2.min(member.binding.identities.len())];
        if candidate
            .binding
            .identities
            .iter()
            .take(2)
            .any(|i| theirs.contains(i))
        {
            return Err("Duplicate terminal manifest or state".into());
        }
        for path in [
            relative(member.config.state(), config.state()),
            relative(config.state(), member.config.state()),
        ] {
            if path.is_empty() || (path != ".." && !path.starts_with("../")) {
                return Err("Overlapping terminal state".into());
            }
        }
        if let (InteractiveConfig::Claude(a), InteractiveConfig::Claude(b)) =
            (&config, &member.config)
        {
            if a.session_id == b.session_id {
                return Err("Duplicate Claude session UUID".into());
            }
        }
    }
    let path = file.to_owned();
    let digest = candidate.binding.binding_digest.clone();
    let validate: Validate = Rc::new(move || {
        let current = read_interactive_terminal_config(&path, &FeaturePreparation)
            .map_err(|e| e.to_string())?;
        if enrollment_record(&path, current)?.binding.binding_digest != digest {
            return Err("Enrollment profile or source identity changed".into());
        }
        Ok(())
    });
    validate()?;
    let mut member = Map::new();
    member.insert("terminalId".into(), id.into());
    member.insert("alias".into(), alias.into());
    member.insert("provider".into(), interactive_provider(&config).into());
    member.insert(
        "requestedModel".into(),
        requested_model(&candidate.value).unwrap_or(Value::Null),
    );
    member.insert("workspaceId".into(), workspace.into());
    member.insert(
        "featureId".into(),
        input.get("featureId").cloned().unwrap_or(Value::Null),
    );
    member.insert(
        "bindingDigest".into(),
        candidate.binding.binding_digest.clone().into(),
    );
    Ok((candidate, member, validate))
}

/// The profile side of one slot: `managedTerminalBackend` over the L2 port, plus the
/// enrollment revalidation of an enrolled slot.
pub struct ManagedSlotProfiles {
    backend: ManagedProfileBackend,
    state: PathBuf,
    revalidate: Option<Validate>,
}

impl ManagedSlotProfiles {
    pub fn new(backend: ManagedProfileBackend, revalidate: Option<Validate>) -> Self {
        let state = PathBuf::from(backend.config().state());
        ManagedSlotProfiles {
            backend,
            state,
            revalidate,
        }
    }
}

impl SlotProfiles for ManagedSlotProfiles {
    fn validate(&mut self, profile: &PreparedProfile) -> bool {
        if self.revalidate.as_ref().is_some_and(|v| v().is_err()) {
            return false;
        }
        self.backend.validate(&profile.json, &FeaturePreparation)
    }

    fn environment(&self, _profile: &PreparedProfile) -> R<Vec<(String, String)>> {
        self.backend.environment().map_err(|e| e.to_string())
    }

    fn receipt(&mut self, identity: &Identity) -> R<Box<dyn Receipt>> {
        LifecycleReceipt::create(&self.state, identity, &self.backend.config_digest())
    }

    /// Native Claude/OpenCode manifests become single-dispatch here, including failed starts.
    fn session_evidence(&mut self, identity: &Identity) -> Option<SessionReader> {
        let binding = LifecycleBinding {
            instance_id: identity.instance_id.clone(),
            epoch: identity.epoch.clone(),
            manifest_digest: identity.manifest_digest.clone(),
            config_digest: self.backend.config_digest(),
        };
        let mut session = self.backend.mark_dispatched(&binding)?;
        Some(Box::new(move || {
            let snapshot = session.poll()?;
            serde_json::from_str(&snapshot.to_js().stringify()).ok()
        }))
    }
}

fn prepared(backend: &ManagedProfileBackend) -> Vec<PreparedProfile> {
    backend
        .profiles()
        .iter()
        .map(|p| PreparedProfile {
            profile: p.profile.clone(),
            json: p.json.clone(),
        })
        .collect()
}

fn admission_failure(error: AdmissionError) -> Failure {
    let refusal = match &error {
        AdmissionError::Refused(code) => Some(*code),
        _ => None,
    };
    Failure {
        stage: "core_admission",
        refusal,
        detail: error.to_string(),
    }
}

struct Hub {
    hub: Arc<TerminalMessageHub>,
    slots: Arc<Mutex<Vec<Option<HubSlot>>>>,
    activity: Arc<HubActivity>,
    endpoints: Vec<HubEndpoint>,
    launches: Vec<McpLaunch>,
}

/// The `Extensions` of the Rust Core: Features, hub, composer, enrollment, preserved exits.
pub struct HostExtensions {
    preferences: PathBuf,
    workspace_id: String,
    team_workspace_id: String,
    files: Vec<String>,
    selection: Vec<InteractiveConfig>,
    enrollment_files: Vec<EnrollmentRecord>,
    initial_members: Vec<Map<String, Value>>,
    admission: SharedDesktopAdmission,
    owner: String,
    authority: Shared,
    epoch: String,
    hub: Option<Hub>,
    preserved: Option<OwnedExitPending>,
    events: Sender<CoreEvent>,
    helper: OsString,
    closed: bool,
}

fn exact(request: &Value, keys: &[&str]) -> bool {
    request
        .as_object()
        .is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k)))
}

fn uuid_or_null(value: Option<&Value>) -> Option<Option<String>> {
    match value? {
        Value::Null => Some(None),
        v if crate::rpc::is_uuid(v) => Some(Some(v.as_str()?.to_owned())),
        _ => None,
    }
}

impl HostExtensions {
    fn terminal_ids(&self) -> Vec<String> {
        self.selection.iter().map(|c| terminal_id(c).0).collect()
    }

    fn features(&self) -> FeatureContext {
        FeatureContext::new(
            self.preferences.clone(),
            self.workspace_id.clone(),
            self.team_workspace_id.clone(),
            self.terminal_ids(),
        )
    }

    fn assert_owner(&self) -> R<()> {
        Admission::assert_owner(&self.admission)
    }

    fn enrollment_inspect(&self, request: &Value, pair: &mut Pair) -> Option<R<Option<Value>>> {
        let op = match request.get("opId") {
            None if exact(request, &["kind", "id"]) => None,
            Some(v) if exact(request, &["kind", "id", "opId"]) && crate::rpc::is_uuid(v) => {
                v.as_str()
            }
            _ => return None,
        };
        Some((|| {
            let state = pair.enrollment_inspect(op)?;
            let mut members = Vec::new();
            for member in self.initial_members.iter().cloned().chain(
                state["members"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|m| m.as_object().cloned()),
            ) {
                members.push(member_schema_order(&member)?);
            }
            let receipt = match &state["receipt"] {
                Value::Null => Value::Null,
                receipt => receipt_schema_order(receipt)?,
            };
            let reserved = state["reservedSlots"].as_u64().unwrap_or(0);
            let revision = state["revision"].as_u64().unwrap_or(0);
            if reserved as usize != members.len()
                || reserved > state["capacity"].as_u64().unwrap_or(0)
                || members.iter().enumerate().any(|(i, m)| {
                    m["slot"].as_u64() != Some(i as u64)
                        || m["admissionRevision"].as_u64().unwrap_or(u64::MAX) > revision
                })
            {
                return Err("Enrollment inspection continuity changed".into());
            }
            Ok(Some(json!({
                "version": 1,
                "epoch": state["epoch"],
                "revision": revision,
                "capacity": state["capacity"],
                "reservedSlots": reserved,
                "members": members,
                "receipt": receipt,
            })))
        })())
    }

    fn enroll(&mut self, request: &Value, pair: &mut Pair) -> Option<R<Option<Value>>> {
        if !exact(request, &["kind", "id", "input", "manifestFile"]) {
            return None;
        }
        let manifest = request["manifestFile"]
            .as_str()
            .filter(|m| {
                m.starts_with('/') && m.encode_utf16().count() <= 2048 && !m.contains('\0')
            })?
            .to_owned();
        let input = crate::pair::parse_enrollment_input(&request["input"]).ok()?;
        let mut inspected: Option<EnrollmentRecord> = None;
        let preferences = self.preferences.to_string_lossy().into_owned();
        let selection_len = self.selection.len();
        let hub_launch_for = |config: &InteractiveConfig| -> R<Option<McpLaunch>> {
            match &self.hub {
                Some(hub) if config.hub() => hub
                    .launches
                    .get(selection_len)
                    .cloned()
                    .map(Some)
                    .ok_or_else(|| "No free hub endpoint".into()),
                Some(_) => Err("Hub Core requires hub terminals".into()),
                None => Ok(None),
            }
        };
        let (admission, events, helper, authority) = (
            self.admission.clone(),
            self.events.clone(),
            self.helper.clone(),
            self.authority.clone(),
        );
        let existing = self.enrollment_files.clone();
        let receipt = pair.enroll(&request["input"], &manifest, || {
            let (candidate, member, validate) =
                inspect_terminal_enrollment(&manifest, &input, &existing)?;
            inspected = Some(candidate.clone());
            let config = &candidate.config;
            if config
                .preparation()
                .map(|p| p.preferences_directory.as_str())
                != Some(preferences.as_str())
            {
                return Err("Enrollment preferences scope changed".into());
            }
            interactive_cli_adapter(interactive_provider(config), "reuse-existing", true)
                .map_err(|e| e.to_string())?;
            let launch = hub_launch_for(config)?;
            let backend = ManagedProfileBackend::new(&manifest, launch, &FeaturePreparation)
                .map_err(|e| e.to_string())?;
            validate()?;
            let state = PathBuf::from(config.state());
            Ok(EnrollmentCandidate {
                member,
                create: Box::new(move |slot| {
                    // Last check before durable journal effects. Existing slots are never rebuilt.
                    validate()?;
                    Admission::assert_owner(&admission)?;
                    let epoch = authority.borrow().epoch.clone();
                    let journal = Journal::open(
                        Store::open(&state.join("terminal.sqlite"))?,
                        &epoch,
                        false,
                        now_ms,
                    )?;
                    validate()?;
                    let profiles = prepared(&backend);
                    let backend = PtyBackend::new(
                        slot,
                        Box::new(ManagedSlotProfiles::new(backend, Some(validate))),
                        helper,
                        events,
                    );
                    Ok(Slot {
                        profiles,
                        backend: Box::new(backend),
                        journal,
                    })
                }),
            })
        });
        let receipt = match receipt {
            Ok(receipt) => receipt,
            Err(error) => return Some(Err(error)),
        };
        if let (Some(record), false) = (inspected, receipt["member"].is_null()) {
            // Includes uncertain reservations: never reuse their identities or state paths.
            self.enrollment_files.push(record.clone());
            if receipt["status"] == "ready" {
                self.files.push(manifest);
                if let Some(hub) = &self.hub {
                    if record.config.hub() {
                        let mut slots = hub.slots.lock().unwrap_or_else(|p| p.into_inner());
                        if let Some(entry) = slots.get_mut(self.selection.len()) {
                            *entry = Some(HubSlot {
                                terminal_id: terminal_id(&record.config).0,
                                provider: interactive_provider(&record.config).into(),
                            });
                        }
                    }
                }
                self.selection.push(record.config);
            }
        }
        Some(receipt_schema_order(&receipt).map(Some))
    }

    fn composer_mention(&self, request: &Value) -> Option<R<Option<Value>>> {
        if !exact(request, &["kind", "id", "featureId", "input"]) {
            return None;
        }
        let feature = uuid_or_null(request.get("featureId"))?;
        let hub = self.hub.as_ref().map(|h| h.hub.clone());
        let deliver = |terminal: &str, text: &str| {
            hub_delivery(hub.as_ref().unwrap().owner_send(
                feature.as_deref().unwrap_or_default(),
                terminal,
                text,
            ))
        };
        let deliver: Option<crate::hub::mentions::Deliver<'_>> =
            if hub.is_some() && feature.is_some() {
                Some(&deliver)
            } else {
                None
            };
        let result = record_composer_mention(
            &self.preferences,
            &self.workspace_id,
            feature.as_deref(),
            &self.terminal_ids(),
            &request["input"],
            deliver,
        );
        Some(result.map_err(|e| e.to_string()).and_then(|text| {
            serde_json::from_str(&text)
                .map(Some)
                .map_err(|e| e.to_string())
        }))
    }

    fn communication_projection(&self, request: &Value) -> Option<R<Option<Value>>> {
        if !exact(request, &["kind", "id", "featureId"]) {
            return None;
        }
        let feature = uuid_or_null(request.get("featureId"))?;
        let Some(hub) = &self.hub else {
            return Some(Ok(None));
        };
        Some(self.assert_owner().and_then(|()| {
            serde_json::from_str(&hub.activity.project(feature.as_deref()))
                .map(Some)
                .map_err(|e| e.to_string())
        }))
    }

    fn begin_preserved(&self) -> Option<R<Option<Value>>> {
        let preserved = self.preserved.as_ref()?;
        Some((|| {
            self.admission.preserve_pending_exit()?;
            let record = read_owned_exit_pending(&self.preferences, &self.owner, &self.epoch)
                .map_err(|e| e.to_string())?;
            if record.as_ref().map(OwnedExitPending::to_json) != Some(preserved.to_json()) {
                return Err("Pending exit evidence changed".into());
            }
            Ok(Some(preserved.evidence.to_value()))
        })())
    }

    fn preserve(&mut self, pair: &mut Pair, draining: bool) -> R<Option<Value>> {
        if !draining || !self.selection.iter().any(|c| c.version() == 3) {
            return Err("Preserved owned exit is unavailable".into());
        }
        let record = match &self.preserved {
            Some(record) => record.clone(),
            None => {
                let value = json!({
                    "version": 1,
                    "status": LEADER_EXITED_RETIREMENT_PENDING,
                    "owner": self.owner,
                    "evidence": pair.owned_exit_evidence()?,
                });
                let admission = self.admission.clone();
                let assert = move || -> crate::admission::Result<()> {
                    admission
                        .with(|a| a.assert_owner())
                        .map_err(|_| AdmissionError::Rejected("Desktop admission unavailable"))?
                };
                preserve_owned_exit_pending(&self.preferences, &value, &assert)
                    .map_err(|e| e.to_string())?
            }
        };
        self.preserved = Some(record.clone());
        self.admission.preserve_pending_exit()?;
        serde_json::from_str(&record.to_json())
            .map(Some)
            .map_err(|e| e.to_string())
    }
}

impl Extensions for HostExtensions {
    fn handle(
        &mut self,
        kind: &str,
        request: &Value,
        pair: &mut Pair,
        draining: bool,
    ) -> Option<R<Option<Value>>> {
        if crate::features::handles(kind) {
            return Some(
                crate::features::dispatch(&self.features(), request)
                    .map_err(|e| e.to_string())
                    .and_then(|text| {
                        text.map(|t| serde_json::from_str(&t).map_err(|e| e.to_string()))
                            .transpose()
                    }),
            );
        }
        match kind {
            "enrollmentInspect" => self.enrollment_inspect(request, pair),
            "enroll" => self.enroll(request, pair),
            "composerMention" => self.composer_mention(request),
            "communicationProjection" => self.communication_projection(request),
            // Called by the Core after it set `draining`; `None` answers with the inventory.
            "beginOwnedShutdown" => self.begin_preserved(),
            "preserveOwnedShutdown" => {
                exact(request, &["kind", "id"]).then(|| self.preserve(pair, draining))
            }
            // The legacy pair MCP is refused at startup: nothing is ever opted in.
            "prepareMcp" => exact(request, &["kind", "id"]).then(|| Err("MCP not opted in".into())),
            "authorizeMcp" => {
                exact(request, &["kind", "id", "proof"]).then(|| Err("MCP not opted in".into()))
            }
            _ => None,
        }
    }

    fn close(&mut self) {
        if self.closed {
            return;
        }
        self.closed = true;
        self.authority.borrow_mut().revoke(CLIENT);
        if let Some(hub) = &mut self.hub {
            hub.hub.close();
            for endpoint in &mut hub.endpoints {
                endpoint.close();
            }
        }
    }

    fn retire_blocked(&self) -> bool {
        self.selection.iter().any(|c| c.version() == 3)
    }
}

/// `<exe dir>/orqst-mcp-relay.cjs` with its digest (`hubRelay()` in host.ts).
fn hub_relay(directory: &Path) -> R<Binary> {
    let path = directory.join(RELAY).to_string_lossy().into_owned();
    let bytes = terminal_file(&path, false, RELAY_LIMIT, None).map_err(|e| e.to_string())?;
    Ok(Binary {
        path,
        sha256: crate::profiles::terminal_digest(bytes),
    })
}

/// Composes the Core. `helper` is this executable (PTY helper mode), `directory` holds the
/// MCP relay. Any error is reported with the active stage.
pub fn start(
    args: &Args,
    events: Sender<CoreEvent>,
    helper: OsString,
    directory: &Path,
) -> Result<(Startup, HostExtensions), Failure> {
    let prep = FeaturePreparation;
    let files: Vec<String> = serde_json::from_str(&args.files).map_err(Failure::startup)?;
    let limit = slot_limit(&args.limit).map_err(Failure::startup)?;
    let selection = inspect_managed_terminal_files(&files, Some(limit as u32), &prep)
        .map_err(Failure::startup)?;
    if selection.iter().any(|s| s.blocker.is_some()) {
        return Err(Failure::startup("Terminal profile blocked"));
    }
    let uses_hub = selection.iter().any(|s| s.config.hub());
    if !uses_hub && selection[0].config.mcp() {
        return Err(Failure::startup(
            "Legacy pair MCP is not available in the Rust Core",
        ));
    }
    let mut enrollment_files = Vec::new();
    for (slot, s) in selection.iter().enumerate() {
        enrollment_files
            .push(enrollment_record(&files[slot], s.config.clone()).map_err(Failure::startup)?);
    }
    let project = selection[0].config.project().to_owned();
    let workspace_id = stable_id(&["workspace", &project]);
    let initial_members: Vec<Map<String, Value>> = enrollment_files
        .iter()
        .enumerate()
        .map(|(slot, record)| {
            let (id, alias) = terminal_id(&record.config);
            let mut member = Map::new();
            member.insert("terminalId".into(), id.into());
            member.insert("alias".into(), alias.into());
            member.insert("slot".into(), slot.into());
            member.insert(
                "provider".into(),
                interactive_provider(&record.config).into(),
            );
            if let Some(model) = requested_model(&record.value) {
                member.insert("requestedModel".into(), model);
            }
            member.insert("workspaceId".into(), workspace_id.clone().into());
            member.insert(
                "featureId".into(),
                record
                    .config
                    .preparation()
                    .and_then(|p| p.feature_id.clone())
                    .map_or(Value::Null, Value::String),
            );
            member.insert("admissionRevision".into(), 0.into());
            member.insert(
                "bindingDigest".into(),
                record.binding.binding_digest.clone().into(),
            );
            member.insert("status".into(), "ready".into());
            member
        })
        .collect();
    use base64::Engine;
    let der = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(args.public_key.trim_end_matches('='))
        .map_err(Failure::startup)?;
    let key = ed25519_spki(&der).map_err(Failure::startup)?;
    let authority: Shared = Rc::new(RefCell::new(
        Authority::new(vec![(CLIENT.into(), key)], now_ms).map_err(Failure::startup)?,
    ));
    let epoch = authority.borrow().epoch.clone();
    let preferences = PathBuf::from(&args.preferences);
    // Stage core_admission: the sticky desktop admission marker.
    let admission =
        DesktopAdmission::open(&preferences, &files, Some(&epoch)).map_err(admission_failure)?;
    let owner = admission.owner().to_owned();
    let admission = SharedDesktopAdmission::new(admission);
    // Stage core_startup.
    let mut hub = None;
    if uses_hub {
        let slots: Arc<Mutex<Vec<Option<HubSlot>>>> = Arc::new(Mutex::new(
            (0..limit)
                .map(|slot| {
                    selection
                        .get(slot)
                        .filter(|s| s.config.hub())
                        .map(|s| HubSlot {
                            terminal_id: terminal_id(&s.config).0,
                            provider: interactive_provider(&s.config).into(),
                        })
                })
                .collect(),
        ));
        let journal = Arc::new(HubJournal::open(&preferences, &epoch).map_err(Failure::startup)?);
        let activity = Arc::new(HubActivity::default());
        let (member_slots, member_preferences, member_workspace) =
            (slots.clone(), preferences.clone(), workspace_id.clone());
        let recorder = activity.clone();
        let message_hub = Arc::new(TerminalMessageHub::new(
            move || {
                let slots = member_slots.lock().map_err(|_| ())?.clone();
                hub_members(&member_preferences, &member_workspace, &slots).map_err(|_| ())
            },
            move |event| {
                // Durable metadata-only audit, owner messages included; Studio: terminals only.
                journal.append(event);
                recorder.record(event);
            },
        ));
        let relay = hub_relay(directory).map_err(Failure::startup)?;
        let mut endpoints = Vec::new();
        let mut launches = Vec::new();
        // One endpoint per possible slot, opened ahead: enrolled terminals bind to a free one.
        for slot in 0..limit {
            let lookup_slots = slots.clone();
            let lookup = move || {
                lookup_slots
                    .lock()
                    .ok()?
                    .get(slot)
                    .cloned()
                    .flatten()
                    .map(|s| s.terminal_id)
            };
            let endpoint = open_hub_endpoint(
                message_hub.clone(),
                TerminalBinding::Lookup(Arc::new(lookup)),
                Path::new("/tmp"),
            )
            .map_err(Failure::startup)?;
            launches.push(McpLaunch {
                server_name: format!("orqst_{}", uuid::Uuid::new_v4().simple()),
                socket_path: endpoint.socket_path.to_string_lossy().into_owned(),
                capability_file: endpoint.capability_file.to_string_lossy().into_owned(),
                relay: relay.clone(),
            });
            endpoints.push(endpoint);
        }
        hub = Some(Hub {
            hub: message_hub,
            slots,
            activity,
            endpoints,
            launches,
        });
    }
    let mut slots = Vec::new();
    for (slot, s) in selection.iter().enumerate() {
        let config = &s.config;
        let authentication = if config.has_authentication() {
            "reuse-existing"
        } else {
            "separate-login"
        };
        interactive_cli_adapter(
            interactive_provider(config),
            authentication,
            config.has_interactive(),
        )
        .map_err(Failure::startup)?;
        let launch = hub
            .as_ref()
            .filter(|_| config.hub())
            .map(|h| h.launches[slot].clone());
        let backend =
            ManagedProfileBackend::new(&files[slot], launch, &prep).map_err(Failure::startup)?;
        let journal = Journal::open(
            Store::open(&Path::new(config.state()).join("terminal.sqlite"))
                .map_err(Failure::startup)?,
            &epoch,
            false,
            now_ms,
        )
        .map_err(Failure::startup)?;
        let profiles = prepared(&backend);
        let pty = PtyBackend::new(
            slot,
            Box::new(ManagedSlotProfiles::new(backend, None)),
            helper.clone(),
            events.clone(),
        );
        slots.push(Slot {
            profiles,
            backend: Box::new(pty),
            journal,
        });
    }
    let pair = Pair::new(authority.clone(), slots, Box::new(admission.clone()), limit)
        .map_err(Failure::startup)?;
    let pending = inspect_pending_owned_exits(&preferences).map_err(Failure::startup)?;
    let identities: Vec<Value> = selection
        .iter()
        .enumerate()
        .map(|(slot, s)| {
            let (id, alias) = terminal_id(&s.config);
            json!({"slot": slot, "terminalId": id, "alias": alias, "provider": interactive_provider(&s.config)})
        })
        .collect();
    let ready = json!({
        "type": "ready",
        "pendingOwnedExits": pending,
        "id": args.startup_id,
        "epoch": epoch,
        "admissionOwner": owner,
        "initialFiles": files,
        "identities": identities,
    });
    let opencode = selection.iter().any(|s| s.config.version() == 3);
    let extensions = HostExtensions {
        preferences,
        team_workspace_id: crate::profiles::terminal_digest(&project),
        workspace_id,
        files,
        selection: selection.into_iter().map(|s| s.config).collect(),
        enrollment_files,
        initial_members,
        admission,
        owner,
        authority,
        epoch,
        hub,
        preserved: None,
        events,
        helper,
        closed: false,
    };
    Ok((
        Startup {
            ready,
            pair,
            opencode,
        },
        extensions,
    ))
}

/// The `orqst-terminal-core` entry: private Node IPC only. Returns the process exit code.
pub fn run() -> i32 {
    // SAFETY: process-wide umask before any file is created.
    unsafe {
        libc::umask(0o077);
    }
    let argv: Option<Vec<String>> = std::env::args_os().map(|a| a.into_string().ok()).collect();
    let Some((args, complete)) = argv.as_deref().and_then(Args::parse) else {
        return 1;
    };
    let Ok((channel, reader)) = crate::ipc::Channel::from_env() else {
        return 1;
    };
    let fail = |mut channel: crate::ipc::Channel, failure: Failure| {
        if let Some(message) = failure.message(&args.startup_id) {
            let _ = channel.send(&message);
        }
        channel.disconnect();
        1
    };
    if !complete {
        return fail(channel, Failure::startup("Private Core only"));
    }
    let Ok(exe) = std::env::current_exe() else {
        return fail(channel, Failure::startup("Core executable unavailable"));
    };
    let directory = exe.parent().map(Path::to_path_buf).unwrap_or_default();
    let (sender, receiver) = crate::core::events();
    match start(&args, sender.clone(), exe.into_os_string(), &directory) {
        Ok((startup, extensions)) => {
            let ready = startup.ready.clone();
            crate::core::Core::new(startup, Box::new(extensions))
                .run(channel, reader, &ready, sender, receiver);
            0
        }
        Err(failure) => fail(channel, failure),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn slot_limit_is_number_then_integer_range() {
        assert_eq!(slot_limit("2"), Ok(2));
        assert_eq!(slot_limit(" 8 "), Ok(8));
        assert!(slot_limit("9").is_err());
        assert!(slot_limit("0").is_err());
        assert!(slot_limit("1.5").is_err());
        assert!(slot_limit("x").is_err());
    }

    #[test]
    fn args_need_a_valid_startup_id() {
        let argv = |id: &str| -> Vec<String> {
            ["core", "[]", "k", "/p", "2", id]
                .iter()
                .map(|s| s.to_string())
                .collect()
        };
        assert!(Args::parse(&argv("not-an-id")).is_none());
        let (args, complete) = Args::parse(&argv("startup-7")).unwrap();
        assert!(complete);
        assert_eq!((args.files.as_str(), args.limit.as_str()), ("[]", "2"));
        let mut short = argv("startup-7");
        short.push("extra".into());
        assert!(!Args::parse(&short).unwrap().1);
    }

    #[test]
    fn config_value_follows_schema_order() {
        let base = std::fs::canonicalize(std::env::temp_dir())
            .unwrap()
            .join(format!("orqst-synthetic-order-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        let file = base.join("m.json");
        // SYNTHETIC manifest text in scrambled key order.
        std::fs::write(&file, r#"{"state":"/s","authentication":{"sharedNativeConfiguration":true,"codexHome":"/h/.codex","home":"/h","mode":"reuse-existing"},"interactive":{"hub":true,"mcp":true,"sharedNativeSessions":true},"node":{"sha256":"b","path":"/n"},"version":1,"project":"/p"}"#).unwrap();
        std::fs::set_permissions(&file, std::os::unix::fs::PermissionsExt::from_mode(0o600))
            .unwrap();
        let value = config_value(file.to_str().unwrap()).unwrap();
        assert_eq!(
            serde_json::to_string(&value).unwrap(),
            r#"{"version":1,"node":{"path":"/n","sha256":"b"},"project":"/p","state":"/s","interactive":{"sharedNativeSessions":true,"mcp":true,"hub":true},"authentication":{"mode":"reuse-existing","home":"/h","codexHome":"/h/.codex","sharedNativeConfiguration":true}}"#
        );
        std::fs::remove_dir_all(base).unwrap();
    }
}
