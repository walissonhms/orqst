//! Port of `OfflineReservationRecovery` (`packages/core/src/terminal/offline-recovery.ts`).
//! Offline only: no Core, Store, journal owner acquisition, provider, PID probe or automatic
//! retry. Kernel identity is `kern.bootsessionuuid` plus the per-boot lease files; every phase
//! requires one fresh native owner approval; absence never proves exit; markers and evidence are
//! never deleted (only this operation's own controls and lease, exactly as the TypeScript code).
use super::error::{blocked, fail, invalid, RecoveryError, Result};
use super::fsio::{
    self, join, mkdir_private, mkdtemp, present, read_recovery_file, sync_recovery_directory,
    sync_recovery_file, tdir, write_recovery_file, FileRecord, Sync, RECOVERY_GATE, RECOVERY_LIMIT,
};
use super::intent::{signature_field, signature_shape, verify, AdminIntent, Challenge};
use super::js::{number, obj, parse, parse_fatal, pretty, s, stringify, with};
use super::schema::{self, strict};
use super::snapshot::{snapshot_offline_reservation, snapshot_raw_digest, HistoricalEvidence};
use crate::admission::json::is_uuid;
use crate::authority::terminal_digest;
use ed25519_dalek::VerifyingKey;
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

/// No renderer override, wall-clock fallback, PID probe or userspace-restart inference.
pub fn native_kernel_boot_uuid() -> Result<String> {
    if !cfg!(target_os = "macos") {
        return fail("Offline kernel fence requires macOS");
    }
    let output = std::process::Command::new("/usr/sbin/sysctl")
        .args(["-n", "kern.bootsessionuuid"])
        .env_clear()
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()?;
    if !output.status.success() || output.stdout.len() > 128 {
        return fail("Offline kernel fence unavailable");
    }
    let value = String::from_utf8_lossy(&output.stdout)
        .trim()
        .to_lowercase();
    if !is_uuid(&value) {
        return Err(invalid("boot uuid"));
    }
    Ok(value)
}

/// The trusted native administrative authority (`NativeAdministrativeRecovery`).
pub trait NativeAdministrativeRecovery {
    fn public_key(&self) -> &VerifyingKey;
    fn review(
        &mut self,
        intent: &AdminIntent,
        full_review: &str,
        fingerprint: &str,
    ) -> Result<bool>;
    /// One fresh signature after explicit consent: `(signature, validUntil)`.
    fn sign(&mut self, challenge: &Challenge) -> Result<Option<(String, f64)>>;
    fn revalidate(&mut self, challenge: &Challenge) -> Result<Option<f64>>;
}

pub type Boundary = Box<dyn FnMut(&str) -> Result<()>>;

/// `RecoveryDependencies`. Fixture/native composition only, never an IPC request field.
pub struct Dependencies {
    pub boot_uuid: Box<dyn FnMut() -> Result<String>>,
    pub now: Box<dyn FnMut() -> f64>,
    pub sync: Sync,
    pub boundary: Option<Boundary>,
    /// `randomUUID` (fixtures may make it deterministic).
    pub uuid: Box<dyn FnMut() -> String>,
}

impl Default for Dependencies {
    fn default() -> Self {
        let start = std::time::Instant::now();
        Dependencies {
            boot_uuid: Box::new(native_kernel_boot_uuid),
            now: Box::new(move || start.elapsed().as_secs_f64() * 1000.0),
            sync: fsio::native_sync(),
            boundary: None,
            uuid: Box::new(|| uuid::Uuid::new_v4().to_string()),
        }
    }
}

struct Approval {
    challenge: Challenge,
    signature: String,
    deadline: f64,
}

struct Lease {
    bytes: String,
    identity: Vec<String>,
    active: bool,
}

struct LeaseHandle {
    file: String,
}

struct CaptureRecord {
    operation_id: String,
    snapshot_hash: String,
    challenge: Challenge,
    signature: String,
}

impl CaptureRecord {
    /// zod `captureSchema` output.
    fn schema_value(&self) -> Value {
        obj([
            ("version", number(1.0)),
            ("operationId", s(&self.operation_id)),
            ("snapshotHash", s(&self.snapshot_hash)),
            ("challenge", self.challenge.schema_order()),
            ("signature", s(&self.signature)),
        ])
    }
    fn parse(value: &Value) -> Result<CaptureRecord> {
        let map = strict(
            value,
            &[
                "version",
                "operationId",
                "snapshotHash",
                "challenge",
                "signature",
            ],
        )?;
        schema::literal_number(map.get("version"), 1.0, "version")?;
        let challenge = Challenge::parse(
            map.get("challenge").ok_or_else(|| invalid("challenge"))?,
            Some("capture"),
        )?;
        Ok(CaptureRecord {
            operation_id: schema::uuid(map.get("operationId"), "operationId")?,
            snapshot_hash: schema::digest(map.get("snapshotHash"), "snapshotHash")?,
            challenge,
            signature: signature_field(map.get("signature"))?,
        })
    }
}

struct Archive {
    current: Value,
    challenge: Challenge,
}

/// `OfflineReservationRecovery`.
pub struct OfflineReservationRecovery<A: NativeAdministrativeRecovery> {
    authority: A,
    deps: Dependencies,
    used: HashSet<String>,
    leases: HashMap<String, Lease>,
}

fn source_json(file: &str, limit: usize) -> Result<Value> {
    parse(&read_recovery_file(file, limit)?.raw())
}

fn exact(file: &str, value: &Value) -> Result<()> {
    if stringify(&source_json(file, RECOVERY_LIMIT)?) != stringify(value) {
        return fail("Recovery durable record changed");
    }
    Ok(())
}

const SMALL: usize = 16 * 1024;

/// Physical identity of the reviewed reservation only (`physicalRecords`).
fn physical_records(snapshot: &Value) -> String {
    let mut files: Vec<Value> = snapshot["files"].as_array().cloned().unwrap_or_default();
    files.sort_by(|a, b| {
        let (a, b) = (
            a["path"].as_str().unwrap_or_default(),
            b["path"].as_str().unwrap_or_default(),
        );
        a.encode_utf16().cmp(b.encode_utf16())
    });
    let files: Vec<Value> = files
        .iter()
        .map(|f| {
            obj([
                ("path", f["path"].clone()),
                ("identity", f["identity"].clone()),
            ])
        })
        .collect();
    let physical = match snapshot.get("physicalDifference") {
        Some(p) => {
            let bindings: Vec<Value> = p["bindings"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|b| {
                    let ids: Vec<Value> = b["identities"]
                        .as_array()
                        .cloned()
                        .unwrap_or_default()
                        .into_iter()
                        .take(5)
                        .collect();
                    with(b, &[("identities", Value::Array(ids))])
                })
                .collect();
            with(p, &[("bindings", Value::Array(bindings))])
        }
        None => Value::Null,
    };
    stringify(&obj([
        ("files", Value::Array(files)),
        ("physicalDifference", physical),
    ]))
}

fn gate_value(capture: &CaptureRecord) -> Value {
    let c = &capture.challenge.intent;
    obj([
        ("version", number(1.0)),
        ("operationId", s(&capture.operation_id)),
        ("owner", s(&c.owner)),
        ("epoch", s(&c.epoch)),
        ("bundle", s(&c.bundle)),
        ("beforeBoot", s(&c.before_boot)),
    ])
}

fn rendered(value: &Value) -> String {
    stringify(value)
}

/// Outcome of `capture`.
#[derive(Clone, Debug, PartialEq)]
pub struct CaptureOutcome {
    pub operation_id: String,
    pub bundle: String,
    pub owner: String,
    pub epoch: String,
    pub before_boot: String,
    pub snapshot_digest: String,
}

/// Outcome of `release` / `continueRelease` (`{ ...receipt, bundle, admissionBlocked: true }`).
#[derive(Clone, Debug, PartialEq)]
pub struct ReleaseOutcome {
    pub receipt: Value,
    pub bundle: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FinalizeOutcome {
    pub operation_id: String,
    pub cleanup: String,
}

impl<A: NativeAdministrativeRecovery> OfflineReservationRecovery<A> {
    pub fn new(authority: A, deps: Dependencies) -> Self {
        OfflineReservationRecovery {
            authority,
            deps,
            used: HashSet::new(),
            leases: HashMap::new(),
        }
    }
    pub fn authority(&mut self) -> &mut A {
        &mut self.authority
    }
    fn boot(&mut self) -> Result<String> {
        let value = (self.deps.boot_uuid)()?;
        if !is_uuid(&value) {
            return Err(invalid("boot uuid"));
        }
        Ok(value)
    }
    fn now(&mut self) -> f64 {
        (self.deps.now)()
    }
    fn uuid(&mut self) -> String {
        (self.deps.uuid)()
    }
    fn boundary(&mut self, stage: &str) -> Result<()> {
        match self.deps.boundary.as_mut() {
            Some(boundary) => boundary(stage),
            None => Ok(()),
        }
    }
    fn write(&self, file: &str, bytes: &str) -> Result<()> {
        write_recovery_file(file, bytes.as_bytes(), &self.deps.sync)
    }
    fn sync_file(&self, file: &str) -> Result<()> {
        sync_recovery_file(file, &self.deps.sync)
    }
    fn sync(&self, directory: &str) -> Result<()> {
        sync_recovery_directory(directory, &self.deps.sync)
    }
    fn historical_evidence(&self, bundle: &str) -> Result<Option<HistoricalEvidence>> {
        let file = join(bundle, "historical-binding-evidence.json");
        if !present(&file)? {
            return Ok(None);
        }
        self.read_historical_evidence(&file).map(Some)
    }
    fn read_historical_evidence(&self, file: &str) -> Result<HistoricalEvidence> {
        let record = read_recovery_file(file, 4096)?;
        let mode: u64 = record.identity[3].parse().unwrap_or(0);
        if mode & 0o7777 != 0o600 {
            return fail("Historical binding evidence must be private");
        }
        let evidence = schema::historical_evidence(&parse_fatal(&record.raw())?)?;
        Ok(HistoricalEvidence {
            evidence,
            sha256: record.sha256.clone(),
            bytes: record.bytes.clone(),
            record,
        })
    }
    fn snapshot(
        &mut self,
        directory: &str,
        bundle: &str,
        admit_physical_difference: bool,
    ) -> Result<Value> {
        let historical = self.historical_evidence(bundle)?;
        let scratch = mkdtemp(&join(bundle, "inspection-"))?;
        let signed = if admit_physical_difference && present(&join(bundle, "capture.json"))? {
            Some(self.capture_record(bundle, true)?)
        } else {
            None
        };
        let saved = match &signed {
            Some(signed) if self.boot()? != signed.challenge.intent.before_boot => {
                Some(schema::snapshot(&source_json(
                    &join(bundle, "snapshot.json"),
                    RECOVERY_LIMIT,
                )?)?)
            }
            _ => None,
        };
        snapshot_offline_reservation(
            directory,
            &scratch,
            historical.as_ref(),
            saved.as_ref(),
            &self.deps.sync,
        )
    }

    /// `approve(proposal, snapshot, transaction)`.
    fn approve(
        &mut self,
        proposal: &AdminIntent,
        snapshot: &Value,
        transaction: Option<&Value>,
    ) -> Result<Approval> {
        proposal.validate()?;
        let intent = proposal.clone();
        let action = match intent.phase.as_str() {
            "abort" => "Abort administrative recovery controls only; preserve the original reservation and every journal; no release or launch",
            "finalize" => "Explicitly finalize verified administrative recovery; no launch or old process exit claim",
            "capture" => "Capture privately before a kernel reboot; retain admission",
            _ => "Prepare durable administrative evidence after external kernel fence; retain the original reservation until separate final commit approval; no process exit claim",
        };
        let files = snapshot["files"].as_array().cloned().unwrap_or_default();
        let journals = snapshot["journals"].as_array().cloned().unwrap_or_default();
        let is_journal = |path: &str| {
            journals.iter().any(|j| {
                let p = j["path"].as_str().unwrap_or_default();
                path == p || path == format!("{p}-wal")
            })
        };
        let mut review = Map::new();
        review.insert("action".into(), s(action));
        review.insert("intent".into(), intent.to_value());
        review.insert("rawSnapshotDigest".into(), snapshot["rawDigest"].clone());
        review.insert(
            "transaction".into(),
            transaction.cloned().unwrap_or(Value::Null),
        );
        review.insert(
            "files".into(),
            Value::Array(
                files
                    .iter()
                    .map(|f| {
                        obj([
                            ("path", f["path"].clone()),
                            ("identity", f["identity"].clone()),
                            ("sha256", f["sha256"].clone()),
                        ])
                    })
                    .collect(),
            ),
        );
        let mut records = Vec::new();
        for file in files
            .iter()
            .filter(|f| !is_journal(f["path"].as_str().unwrap_or_default()))
        {
            let record = FileRecord::from_value(file)?;
            records.push(obj([
                ("path", file["path"].clone()),
                ("record", parse(&record.raw())?),
            ]));
        }
        review.insert("metadataRecords".into(), Value::Array(records));
        if let Some(historical) = snapshot.get("historicalBinding") {
            let source = &historical["evidence"]["historicalModelSource"];
            let index = source["index"].as_u64().unwrap_or(0) as usize;
            let current = historical["currentSources"][index]["identity"]
                .as_array()
                .ok_or_else(|| {
                    RecoveryError::Failed("Cannot read properties of null (reading 'slice')".into())
                })?;
            let current = current
                .iter()
                .take(2)
                .map(|v| v.as_str().unwrap_or_default())
                .collect::<Vec<_>>()
                .join(":");
            review.insert("historicalBinding".into(), historical.clone());
            review.insert(
                "modelSourceIdentityDrift".into(),
                obj([
                    ("path", source["path"].clone()),
                    ("historicalIdentity", source["identity"].clone()),
                    ("currentIdentity", s(&current)),
                    (
                        "scope",
                        s("historical identity differs from current physical identity"),
                    ),
                ]),
            );
            review.insert("historicalBindingScope".into(), s("Historical enrollment preimage verified; current model source CONTENT was NOT inspected or validated; current critical metadata (canonical path/dev/ino/regular/mode/uid/nlink) is fresh for this review only; critical metadata changes during this phase deny stale approval; current model source size/mtime/ctime and content are not evidence; no automatic retry, a new explicit operation/review is required; NO launch, claim, config reuse or provider authority"));
        }
        if let Some(physical) = snapshot.get("physicalDifference") {
            review.insert("physicalDifference".into(), physical.clone());
            review.insert("physicalDifferenceAuthority".into(), s("Explicit CURRENT administrative approval to archive ONLY this exact reviewed reservation after the external kernel boot fence. Historical signature authenticates captured evidence; it does NOT prove filesystem or volume continuity. Device mapping is declared, not certified equivalence. All preserved bytes/hashes and other physical fields match exactly. Current enrollment/model source metadata is phase-local and revalidated; model source CONTENT was NOT inspected. NO process adoption, owned exit, restored grant, launch, claim or provider authority. Original marker remains until separate final commit approval."));
        }
        review.insert("membership".into(), snapshot["membership"].clone());
        review.insert("journals".into(), snapshot["journals"].clone());
        let full_review = pretty(&Value::Object(review));
        if full_review.len() > 64 * 1024 {
            return fail("Complete native recovery review exceeds budget");
        }
        let fingerprint = intent.digest(&full_review);
        if !self.authority.review(&intent, &full_review, &fingerprint)? {
            return fail("Administrative recovery approval denied");
        }
        let nonce = self.uuid();
        let expires_at = self.now() + 30_000.0;
        let challenge = Challenge {
            version: 2,
            intent_digest: Some(fingerprint.clone()),
            nonce,
            expires_at,
            intent: intent.clone(),
        };
        let proof = self.authority.sign(&challenge)?;
        let deadline = challenge
            .expires_at
            .min(proof.as_ref().map_or(f64::NEG_INFINITY, |p| p.1));
        let now = self.now();
        let denied = match &proof {
            None => true,
            Some((signature, valid_until)) => {
                !valid_until.is_finite()
                    || !deadline.is_finite()
                    || deadline <= now
                    || intent.digest(&full_review) != fingerprint
                    || !signature_shape(signature)
                    || self.used.contains(&challenge.nonce)
                    || !verify(self.authority.public_key(), &challenge, signature)?
            }
        };
        if denied {
            return fail("Administrative recovery approval denied/expired/consumed");
        }
        self.used.insert(challenge.nonce.clone());
        let signature = proof.map(|p| p.0).unwrap_or_default();
        Ok(Approval {
            challenge,
            signature,
            deadline,
        })
    }
    fn revalidate(&mut self, approval: &mut Approval) -> Result<()> {
        let renewed = self.authority.revalidate(&approval.challenge)?;
        approval.deadline = approval.deadline.min(match renewed {
            Some(value) if value.is_finite() => value,
            _ => f64::NEG_INFINITY,
        });
        self.assert_approval(approval)
    }
    fn assert_approval(&mut self, approval: &Approval) -> Result<()> {
        if !approval.deadline.is_finite() || approval.deadline <= self.now() {
            return fail("Administrative recovery approval expired");
        }
        Ok(())
    }

    /// Trusted native paths only. Creates its own exclusive bundle and sticky gate.
    pub fn capture(
        &mut self,
        directory: &str,
        recovery_root: &str,
        historical_evidence_file: Option<&str>,
    ) -> Result<CaptureOutcome> {
        tdir(directory, true)?;
        tdir(recovery_root, true)?;
        let operation_id = self.uuid();
        let bundle = join(recovery_root, &format!("offline-{operation_id}"));
        mkdir_private(&bundle)?;
        self.sync(recovery_root)?;
        if let Some(file) = historical_evidence_file {
            let candidate = self.read_historical_evidence(file)?;
            self.write(
                &join(&bundle, "historical-binding-evidence.json"),
                &String::from_utf8_lossy(&candidate.record.raw()),
            )?;
            let saved = self.historical_evidence(&bundle)?;
            if saved.as_ref().map(|s| (&s.sha256, &s.bytes))
                != Some((&candidate.sha256, &candidate.bytes))
            {
                return blocked("historical_evidence_copy_changed", &bundle);
            }
        }
        let before_boot = self.boot()?;
        let snapshot = self.snapshot(directory, &bundle, false)?;
        let bytes = stringify(&snapshot);
        let marker = source_json(&join(directory, "active-pair.json"), SMALL)?;
        let proposal = AdminIntent {
            operation_id: operation_id.clone(),
            phase: "capture".into(),
            owner: marker["owner"].as_str().unwrap_or_default().to_owned(),
            epoch: snapshot["journals"][0]["logical"]["epoch"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            before_boot: before_boot.clone(),
            current_boot: before_boot.clone(),
            snapshot_digest: terminal_digest(bytes.as_bytes()),
            current_digest: snapshot["logicalDigest"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
            directory: directory.to_owned(),
            bundle: bundle.clone(),
        };
        let mut approval = self.approve(&proposal, &snapshot, None)?;
        self.revalidate(&mut approval)?;
        let challenge = approval.challenge.clone();
        let gate = obj([
            ("version", number(1.0)),
            ("operationId", s(&operation_id)),
            ("owner", s(&challenge.intent.owner)),
            ("epoch", s(&challenge.intent.epoch)),
            ("bundle", s(&bundle)),
            ("beforeBoot", s(&before_boot)),
        ]);
        let raw = snapshot["rawDigest"].clone();
        let unchanged = |this: &mut Self| -> Result<bool> {
            Ok(this.boot()? == before_boot
                && this.snapshot(directory, &bundle, false)?["rawDigest"] == raw)
        };
        if !unchanged(self)? {
            return blocked("capture_source_changed", &bundle);
        }
        self.assert_approval(&approval)?;
        self.write(&join(&bundle, "snapshot.json"), &bytes)?;
        let capture = obj([
            ("version", number(1.0)),
            ("operationId", s(&operation_id)),
            ("snapshotHash", s(&terminal_digest(bytes.as_bytes()))),
            ("challenge", challenge.created()),
            ("signature", s(&approval.signature)),
        ]);
        self.assert_approval(&approval)?;
        self.write(&join(&bundle, "capture.json"), &stringify(&capture))?;
        self.boundary("capture")?;
        self.revalidate(&mut approval)?;
        if !unchanged(self)? {
            return blocked("capture_source_changed", &bundle);
        }
        self.assert_approval(&approval)?;
        self.write(&join(directory, RECOVERY_GATE), &stringify(&gate))?;
        self.boundary("gate")?;
        exact(&join(directory, RECOVERY_GATE), &gate)?;
        if !unchanged(self)? {
            return blocked("capture_source_changed", &bundle);
        }
        Ok(CaptureOutcome {
            operation_id,
            bundle,
            owner: challenge.intent.owner.clone(),
            epoch: challenge.intent.epoch.clone(),
            before_boot,
            snapshot_digest: challenge.intent.snapshot_digest.clone(),
        })
    }

    fn capture_record(&mut self, bundle: &str, aborting: bool) -> Result<CaptureRecord> {
        if !aborting && present(&join(bundle, "aborted.json"))? {
            return blocked("operation_aborted_original_reservation_preserved", bundle);
        }
        tdir(bundle, true)?;
        let capture = match source_json(&join(bundle, "capture.json"), SMALL)
            .and_then(|v| CaptureRecord::parse(&v))
        {
            Ok(capture) => capture,
            Err(_) => return blocked("missing_or_partial_capture_preserve_original", bundle),
        };
        let before = &capture.challenge;
        if before.intent.bundle != bundle
            || before.intent.operation_id != capture.operation_id
            || before.intent.current_boot != before.intent.before_boot
            || !verify(self.authority.public_key(), before, &capture.signature)?
        {
            return fail("Untrusted administrative capture");
        }
        let saved = read_recovery_file(&join(bundle, "snapshot.json"), RECOVERY_LIMIT)?;
        if saved.sha256 != capture.snapshot_hash
            || capture.snapshot_hash != before.intent.snapshot_digest
        {
            return fail("Recovery capture corrupted");
        }
        let snapshot = schema::snapshot(&parse(&saved.raw())?)?;
        let historical = self.historical_evidence(bundle)?;
        let evidence_path = join(bundle, "historical-binding-evidence.json");
        let snapshot_record = snapshot["files"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|f| f["path"].as_str() == Some(evidence_path.as_str()))
            .cloned();
        let mut mismatch = false;
        if let Some(h) = &historical {
            let mut expected = h.record.clone();
            if self.boot()? != before.intent.before_boot {
                let device = snapshot_record
                    .as_ref()
                    .map(|r| r["identity"][0].clone())
                    .unwrap_or(Value::Null);
                let mut value = expected.to_value();
                let mut identity = vec![device];
                identity.extend(h.record.identity[1..].iter().map(|v| s(v)));
                value["identity"] = Value::Array(identity);
                mismatch = snapshot_record.as_ref().map(rendered) != Some(rendered(&value));
            } else {
                expected.identity = h.record.identity.clone();
                mismatch =
                    snapshot_record.as_ref().map(rendered) != Some(rendered(&expected.to_value()));
            }
        }
        let binding = snapshot.get("historicalBinding");
        if mismatch
            || binding.map(|b| b["evidenceSha256"].clone())
                != historical.as_ref().map(|h| s(&h.sha256))
            || binding.is_some_and(|b| {
                Some(rendered(&b["evidence"])) != historical.as_ref().map(|h| rendered(&h.evidence))
            })
        {
            return fail("Recovery historical evidence changed");
        }
        if snapshot["logicalDigest"].as_str() != Some(before.intent.current_digest.as_str()) {
            return fail("Recovery capture binding changed");
        }
        Ok(capture)
    }

    /// Per-boot exclusion, never a stale-PID takeover or proof of approval.
    fn lease(
        &mut self,
        bundle: &str,
        boot: &str,
        continuation: bool,
        operation_id: &str,
    ) -> Result<LeaseHandle> {
        let file = join(bundle, &format!("operation-{boot}.lock"));
        if let Some(previous) = self.leases.get(&file) {
            if previous.active || !continuation {
                return blocked("operation_busy_or_explicit_continuation_required", bundle);
            }
            let current = read_recovery_file(&file, SMALL)?;
            let expected = base64::Engine::encode(
                &base64::engine::general_purpose::STANDARD,
                previous.bytes.as_bytes(),
            );
            if current.bytes != expected || current.identity != previous.identity {
                return blocked("operation_lease_changed", bundle);
            }
            if let Some(previous) = self.leases.get_mut(&file) {
                previous.active = true;
            }
            return Ok(LeaseHandle { file });
        }
        if present(&file)? {
            return blocked("same_boot_helper_fence_required", bundle);
        }
        let nonce = self.uuid();
        let bytes = stringify(&obj([
            ("version", number(1.0)),
            ("operationId", s(operation_id)),
            ("boot", s(boot)),
            ("nonce", s(&nonce)),
        ]));
        self.write(&file, &bytes)?;
        let identity = read_recovery_file(&file, SMALL)?.identity;
        self.leases.insert(
            file.clone(),
            Lease {
                bytes,
                identity,
                active: true,
            },
        );
        Ok(LeaseHandle { file })
    }

    fn end_lease(&mut self, lease: &LeaseHandle, remove: bool) -> Result<()> {
        let Some(value) = self.leases.get_mut(&lease.file) else {
            return Ok(());
        };
        value.active = false;
        if !remove {
            return Ok(());
        }
        let (bytes, identity) = (value.bytes.clone(), value.identity.clone());
        let current = read_recovery_file(&lease.file, SMALL)?;
        let expected =
            base64::Engine::encode(&base64::engine::general_purpose::STANDARD, bytes.as_bytes());
        if current.identity != identity || current.bytes != expected {
            return blocked("operation_lease_changed", &lease.file);
        }
        std::fs::remove_file(&lease.file)?;
        self.leases.remove(&lease.file);
        self.sync(&fsio::dirname(&lease.file))
    }

    /// `finally { endLease(...) }`: an error from the cleanup replaces the original error.
    fn finish<T>(&mut self, lease: &LeaseHandle, remove: bool, result: Result<T>) -> Result<T> {
        match self.end_lease(lease, remove) {
            Ok(()) => result,
            Err(error) => Err(error),
        }
    }

    /// Explicit completion of a durable signed capture interrupted before/after gate publication.
    pub fn continue_capture(&mut self, bundle: &str) -> Result<String> {
        let capture = self.capture_record(bundle, false)?;
        let boot = self.boot()?;
        let lease = self.lease(bundle, &boot, true, &capture.operation_id)?;
        let result = self.continue_capture_inner(bundle, &capture, &boot);
        self.finish(&lease, true, result)
    }

    fn continue_capture_inner(
        &mut self,
        bundle: &str,
        capture: &CaptureRecord,
        boot: &str,
    ) -> Result<String> {
        let before = capture.challenge.intent.clone();
        let current = self.snapshot(&before.directory, bundle, false)?;
        if current["logicalDigest"].as_str() != Some(before.current_digest.as_str()) {
            return blocked("capture_source_changed", bundle);
        }
        if present(&join(bundle, "archive.json"))?
            || present(&join(&before.directory, "offline-recovery-operation.lock"))?
        {
            return blocked("release_continuation_required", bundle);
        }
        let raw = current["rawDigest"].as_str().unwrap_or_default().to_owned();
        let proposal = AdminIntent {
            current_boot: boot.to_owned(),
            current_digest: raw.clone(),
            ..before.clone()
        };
        let mut approval = self.approve(&proposal, &current, None)?;
        self.revalidate(&mut approval)?;
        let unchanged = |this: &mut Self| -> Result<bool> {
            Ok(this.boot()? == boot
                && this.snapshot(&before.directory, bundle, false)?["rawDigest"].as_str()
                    == Some(raw.as_str()))
        };
        if !unchanged(self)? {
            return blocked("capture_source_changed", bundle);
        }
        self.write(
            &join(
                bundle,
                &format!("capture-continuation-{}.json", approval.challenge.nonce),
            ),
            &stringify(&obj([
                ("challenge", approval.challenge.created()),
                ("signature", s(&approval.signature)),
            ])),
        )?;
        self.sync_file(&join(bundle, "snapshot.json"))?;
        self.sync_file(&join(bundle, "capture.json"))?;
        let gate_file = join(&before.directory, RECOVERY_GATE);
        self.revalidate(&mut approval)?;
        if !unchanged(self)? {
            return blocked("capture_source_changed", bundle);
        }
        self.assert_approval(&approval)?;
        let gate = gate_value(capture);
        if !present(&gate_file)? {
            self.write(&gate_file, &stringify(&gate))?;
        }
        exact(&gate_file, &gate)?;
        self.sync_file(&gate_file)?;
        if !unchanged(self)? {
            return blocked("capture_source_changed", bundle);
        }
        Ok(capture.operation_id.clone())
    }

    /// Explicit pre-release abort. Removes only this operation's controls, never active-pair.json.
    pub fn abort(&mut self, bundle: &str) -> Result<String> {
        let capture = self.capture_record(bundle, true)?;
        let boot = self.boot()?;
        let lease = self.lease(bundle, &boot, true, &capture.operation_id)?;
        let result = self.abort_inner(bundle, &capture, &boot);
        self.finish(&lease, true, result)
    }

    fn abort_inner(&mut self, bundle: &str, capture: &CaptureRecord, boot: &str) -> Result<String> {
        let before = capture.challenge.intent.clone();
        let directory = before.directory.clone();
        let gate_file = join(&directory, RECOVERY_GATE);
        let lock_file = join(&directory, "offline-recovery-operation.lock");
        let current = self.snapshot(&directory, bundle, false)?;
        let gate = gate_value(capture);
        let lock_value = obj([("operationId", s(&capture.operation_id))]);
        let assert_current = |this: &mut Self| -> Result<()> {
            if this.boot()? != boot
                || current["logicalDigest"].as_str() != Some(before.current_digest.as_str())
                || this.snapshot(&directory, bundle, false)?["rawDigest"] != current["rawDigest"]
            {
                return blocked("abort_source_changed", bundle);
            }
            exact(&gate_file, &gate)?;
            if present(&lock_file)? {
                exact(&lock_file, &lock_value)?;
            }
            for name in [
                "archive.json",
                "receipt-prepared.json",
                "receipt.json",
                "finalized.json",
            ] {
                if present(&join(bundle, name))? {
                    return blocked("abort_denied_after_release_effect", bundle);
                }
            }
            Ok(())
        };
        assert_current(self)?;
        let raw = current["rawDigest"].as_str().unwrap_or_default().to_owned();
        let proposal = AdminIntent {
            phase: "abort".into(),
            current_boot: boot.to_owned(),
            current_digest: raw.clone(),
            ..before.clone()
        };
        let transaction = obj([
            ("phase", s("pre_release_abort")),
            ("gate", gate.clone()),
            ("originalReservationPreserved", Value::Bool(true)),
        ]);
        let mut approval = self.approve(&proposal, &current, Some(&transaction))?;
        self.revalidate(&mut approval)?;
        assert_current(self)?;
        let aborted_file = join(bundle, "aborted.json");
        let record = obj([
            ("operationId", s(&capture.operation_id)),
            ("challenge", approval.challenge.created()),
            ("signature", s(&approval.signature)),
        ]);
        if !present(&aborted_file)? {
            self.write(&aborted_file, &stringify(&record))?;
        } else {
            let previous = source_json(&aborted_file, SMALL)?;
            let map = strict(&previous, &["operationId", "challenge", "signature"])?;
            let operation = schema::uuid(map.get("operationId"), "operationId")?;
            let proof = Challenge::parse(
                map.get("challenge").ok_or_else(|| invalid("challenge"))?,
                Some("abort"),
            )?;
            let signature = signature_field(map.get("signature"))?;
            let p = &proof.intent;
            if operation != capture.operation_id
                || p.operation_id != capture.operation_id
                || p.directory != directory
                || p.bundle != bundle
                || p.owner != before.owner
                || p.epoch != before.epoch
                || p.before_boot != before.before_boot
                || p.snapshot_digest != before.snapshot_digest
                || p.current_digest != raw
                || !verify(self.authority.public_key(), &proof, &signature)?
            {
                return blocked("untrusted_abort_record", bundle);
            }
            self.write(
                &join(
                    bundle,
                    &format!("abort-continuation-{}.json", approval.challenge.nonce),
                ),
                &stringify(&record),
            )?;
        }
        self.sync_file(&aborted_file)?;
        self.revalidate(&mut approval)?;
        assert_current(self)?;
        self.assert_approval(&approval)?;
        if present(&lock_file)? {
            std::fs::remove_file(&lock_file)?;
        }
        self.sync(&directory)?;
        self.assert_approval(&approval)?;
        std::fs::remove_file(&gate_file)?;
        self.sync(&directory)?;
        Ok(capture.operation_id.clone())
    }

    pub fn release(&mut self, bundle: &str) -> Result<ReleaseOutcome> {
        self.release_transaction(bundle, false)
    }

    /// A separate explicit native action, never called automatically after an error.
    pub fn continue_release(&mut self, bundle: &str) -> Result<ReleaseOutcome> {
        self.release_transaction(bundle, true)
    }

    fn release_transaction(&mut self, bundle: &str, continuation: bool) -> Result<ReleaseOutcome> {
        let capture = self.capture_record(bundle, false)?;
        let current_boot = self.boot()?;
        if current_boot == capture.challenge.intent.before_boot {
            return fail("Different kernel boot required");
        }
        let directory = capture.challenge.intent.directory.clone();
        tdir(&directory, true)?;
        exact(&join(&directory, RECOVERY_GATE), &gate_value(&capture))?;
        let lease = self.lease(bundle, &current_boot, continuation, &capture.operation_id)?;
        let mut effect = false;
        let result = self.release_inner(
            bundle,
            &capture,
            &current_boot,
            continuation,
            &directory,
            &mut effect,
        );
        let clean = match &result {
            Ok(_) => true,
            Err(_) => !effect && !present(&join(bundle, "archive.json")).unwrap_or(true),
        };
        self.finish(&lease, clean, result)
    }

    fn release_inner(
        &mut self,
        bundle: &str,
        capture: &CaptureRecord,
        current_boot: &str,
        continuation: bool,
        directory: &str,
        effect: &mut bool,
    ) -> Result<ReleaseOutcome> {
        let before = capture.challenge.intent.clone();
        let attempt = join(bundle, "release-attempt.json");
        let attempt_value = obj([
            ("version", number(2.0)),
            ("operationId", s(&capture.operation_id)),
        ]);
        if !present(&attempt)? {
            self.write(&attempt, &stringify(&attempt_value))?;
        } else if continuation {
            let value = source_json(&attempt, SMALL)?;
            if value.get("operationId") != Some(&s(&capture.operation_id))
                || value.get("version").and_then(Value::as_f64) != Some(2.0)
            {
                return blocked("legacy_or_partial_release_control", bundle);
            }
        } else {
            exact(&attempt, &attempt_value)?;
        }
        let lock = join(directory, "offline-recovery-operation.lock");
        let lock_value = obj([("operationId", s(&capture.operation_id))]);
        if !present(&lock)? {
            self.write(&lock, &stringify(&lock_value))?;
        }
        exact(&lock, &lock_value)?;
        let archive_path = join(bundle, "archive.json");
        let held = join(
            directory,
            &format!("recovered-{}.marker.json", capture.operation_id),
        );
        let gate = gate_value(capture);
        let gate_file = join(directory, RECOVERY_GATE);
        let mut approval_window: Option<Approval> = None;
        let continuing_archive = present(&archive_path)?;
        let archive = if continuing_archive {
            *effect = true;
            if !continuation {
                return blocked("explicit_release_continuation_required", bundle);
            }
            self.archive_record(bundle, capture)?
        } else {
            if present(&held)?
                || present(&join(bundle, "receipt-prepared.json"))?
                || present(&join(bundle, "receipt.json"))?
            {
                return blocked("release_phase_without_archive", bundle);
            }
            let current = self.snapshot(directory, bundle, true)?;
            if current["logicalDigest"].as_str() != Some(before.current_digest.as_str()) {
                return fail("Recovery logical snapshot changed");
            }
            let raw = current["rawDigest"].as_str().unwrap_or_default().to_owned();
            let proposal = AdminIntent {
                phase: "release".into(),
                current_boot: current_boot.to_owned(),
                current_digest: raw.clone(),
                ..before.clone()
            };
            let mut approval = self.approve(&proposal, &current, None)?;
            self.revalidate(&mut approval)?;
            exact(&gate_file, &gate)?;
            exact(&lock, &lock_value)?;
            if self.boot()? != current_boot
                || self.snapshot(directory, bundle, true)?["rawDigest"].as_str()
                    != Some(raw.as_str())
            {
                return fail("Recovery changed after fence/review");
            }
            let record = obj([
                ("version", number(1.0)),
                ("authority", s("administrative_recovery")),
                ("reason", s("non_dispatch")),
                ("fence", s("external_kernel_boot_fence")),
                ("operationId", s(&capture.operation_id)),
                ("capture", capture.schema_value()),
                ("current", current.clone()),
                ("challenge", approval.challenge.created()),
                ("signature", s(&approval.signature)),
            ]);
            self.assert_approval(&approval)?;
            approval_window = Some(approval);
            *effect = true;
            self.write(&archive_path, &stringify(&record))?;
            self.boundary("archive")?;
            self.archive_record(bundle, capture)?
        };
        let phase_current = if continuing_archive {
            self.snapshot(directory, bundle, true)?
        } else {
            archive.current.clone()
        };
        if phase_current["logicalDigest"].as_str() != Some(before.current_digest.as_str()) {
            return fail("Recovery logical snapshot changed");
        }
        let phase_raw = phase_current["rawDigest"].clone();
        let assert_current = |this: &mut Self| -> Result<()> {
            exact(&gate_file, &gate)?;
            exact(&lock, &lock_value)?;
            if this.boot()? != current_boot
                || present(&held)?
                || this.snapshot(directory, bundle, true)?["rawDigest"] != phase_raw
            {
                return fail("Recovery changed before final namespace commit");
            }
            Ok(())
        };
        assert_current(self)?;
        if continuation && continuing_archive {
            let marker_path = join(directory, "active-pair.json");
            let marker = read_recovery_file(&marker_path, SMALL)?;
            let prepared_path = join(bundle, "receipt-prepared.json");
            let receipt_path = join(bundle, "receipt.json");
            let transaction = obj([
                ("phase", s("archive_preparation_original_marker_retained")),
                (
                    "archiveHash",
                    s(&read_recovery_file(&archive_path, RECOVERY_LIMIT)?.sha256),
                ),
                ("historicalRelease", archive.challenge.schema_order()),
                (
                    "marker",
                    obj([
                        ("path", s(&marker_path)),
                        ("identity", fsio::identity_value(&marker.identity)),
                        ("sha256", s(&marker.sha256)),
                    ]),
                ),
                (
                    "preparedReceipt",
                    if present(&prepared_path)? {
                        source_json(&prepared_path, SMALL)?
                    } else {
                        Value::Null
                    },
                ),
                (
                    "completedReceipt",
                    if present(&receipt_path)? {
                        source_json(&receipt_path, SMALL)?
                    } else {
                        Value::Null
                    },
                ),
            ]);
            let digest = terminal_digest(
                stringify(&obj([
                    ("rawDigest", phase_raw.clone()),
                    ("transaction", transaction.clone()),
                ]))
                .as_bytes(),
            );
            let proposal = AdminIntent {
                phase: "release".into(),
                current_boot: current_boot.to_owned(),
                current_digest: digest,
                ..before.clone()
            };
            let mut approval = self.approve(&proposal, &phase_current, Some(&transaction))?;
            self.revalidate(&mut approval)?;
            assert_current(self)?;
            self.assert_approval(&approval)?;
            self.write(
                &join(
                    bundle,
                    &format!("release-continuation-{}.json", approval.challenge.nonce),
                ),
                &stringify(&obj([
                    ("challenge", approval.challenge.created()),
                    ("signature", s(&approval.signature)),
                    ("transaction", transaction),
                ])),
            )?;
            approval_window = Some(approval);
        }
        self.sync_file(&archive_path)?;
        let Some(mut window) = approval_window else {
            return fail("Fresh release approval required");
        };
        self.revalidate(&mut window)?;
        assert_current(self)?;
        self.assert_approval(&window)?;
        let prepared = obj([
            ("version", number(1.0)),
            ("operationId", s(&capture.operation_id)),
            ("status", s("archive_durable")),
            (
                "archiveHash",
                s(&read_recovery_file(&archive_path, RECOVERY_LIMIT)?.sha256),
            ),
            ("reason", s("non_dispatch")),
            ("fence", s("external_kernel_boot_fence")),
            ("owner", s(&before.owner)),
            ("epoch", s(&before.epoch)),
            ("beforeBoot", s(&before.before_boot)),
            ("currentBoot", s(&archive.challenge.intent.current_boot)),
        ]);
        let prepared_file = join(bundle, "receipt-prepared.json");
        self.assert_approval(&window)?;
        if !present(&prepared_file)? {
            self.write(&prepared_file, &stringify(&prepared))?;
        }
        exact(&prepared_file, &prepared)?;
        self.sync_file(&prepared_file)?;
        assert_current(self)?;
        let marker = source_marker(&archive.current, directory)?;
        let receipt = with(
            &prepared,
            &[
                ("version", number(2.0)),
                ("status", s("release_prepared")),
                ("sourceMarkerHash", s(&marker.sha256)),
                (
                    "sourceMarkerIdentity",
                    fsio::identity_value(&marker.identity),
                ),
            ],
        );
        let receipt_file = join(bundle, "receipt.json");
        self.assert_approval(&window)?;
        if !present(&receipt_file)? {
            self.write(&receipt_file, &stringify(&receipt))?;
        }
        exact(&receipt_file, &receipt)?;
        self.sync_file(&receipt_file)?;
        self.boundary("receipt")?;
        assert_current(self)?;
        self.assert_approval(&window)?;
        Ok(ReleaseOutcome {
            receipt,
            bundle: bundle.to_owned(),
        })
    }

    fn archive_record(&mut self, bundle: &str, capture: &CaptureRecord) -> Result<Archive> {
        let value = source_json(&join(bundle, "archive.json"), RECOVERY_LIMIT)?;
        let map = strict(
            &value,
            &[
                "version",
                "authority",
                "reason",
                "fence",
                "operationId",
                "capture",
                "current",
                "challenge",
                "signature",
            ],
        )?;
        schema::literal_number(map.get("version"), 1.0, "version")?;
        schema::literal_str(map.get("authority"), "administrative_recovery", "authority")?;
        schema::literal_str(map.get("reason"), "non_dispatch", "reason")?;
        schema::literal_str(map.get("fence"), "external_kernel_boot_fence", "fence")?;
        let operation = schema::uuid(map.get("operationId"), "operationId")?;
        let record_capture =
            CaptureRecord::parse(map.get("capture").ok_or_else(|| invalid("capture"))?)?;
        let current = schema::snapshot(map.get("current").ok_or_else(|| invalid("current"))?)?;
        let challenge = Challenge::parse(
            map.get("challenge").ok_or_else(|| invalid("challenge"))?,
            Some("release"),
        )?;
        let signature = signature_field(map.get("signature"))?;
        let before = &capture.challenge.intent;
        let c = &challenge.intent;
        if operation != capture.operation_id
            || stringify(&record_capture.schema_value()) != stringify(&capture.schema_value())
            || c.operation_id != capture.operation_id
            || c.owner != before.owner
            || c.epoch != before.epoch
            || c.bundle != bundle
            || c.directory != before.directory
            || c.before_boot != before.before_boot
            || c.current_boot == before.before_boot
            || c.snapshot_digest != before.snapshot_digest
            || Some(c.current_digest.as_str()) != current["rawDigest"].as_str()
            || current["logicalDigest"].as_str() != Some(before.current_digest.as_str())
            || !verify(self.authority.public_key(), &challenge, &signature)?
        {
            return blocked("untrusted_release_archive", bundle);
        }
        if Some(snapshot_raw_digest(&current).as_str()) != current["rawDigest"].as_str() {
            return blocked("archive_snapshot_changed", bundle);
        }
        Ok(Archive { current, challenge })
    }

    fn observed_held_marker(marker: &FileRecord, held: &str) -> Result<FileRecord> {
        let value = read_recovery_file(held, SMALL)?;
        if value.sha256 != marker.sha256 || value.identity[..6] != marker.identity[..6] {
            return fail("Recovery original held marker identity changed");
        }
        Ok(value)
    }

    /// Final namespace commit only after durable prepared records and a fresh phase signature.
    pub fn finalize(&mut self, bundle: &str) -> Result<FinalizeOutcome> {
        let capture = self.capture_record(bundle, false)?;
        let archive = self.archive_record(bundle, &capture)?;
        let before = capture.challenge.intent.clone();
        let directory = before.directory.clone();
        let current_boot = self.boot()?;
        if current_boot == before.before_boot {
            return fail("Different kernel boot required");
        }
        let marker = source_marker(&archive.current, &directory)?;
        let held_path = join(
            &directory,
            &format!("recovered-{}.marker.json", capture.operation_id),
        );
        let archive_hash =
            read_recovery_file(&join(bundle, "archive.json"), RECOVERY_LIMIT)?.sha256;
        let receipt = obj([
            ("version", number(2.0)),
            ("operationId", s(&capture.operation_id)),
            ("status", s("release_prepared")),
            ("archiveHash", s(&archive_hash)),
            ("reason", s("non_dispatch")),
            ("fence", s("external_kernel_boot_fence")),
            ("owner", s(&before.owner)),
            ("epoch", s(&before.epoch)),
            ("beforeBoot", s(&before.before_boot)),
            ("currentBoot", s(&archive.challenge.intent.current_boot)),
            ("sourceMarkerHash", s(&marker.sha256)),
            (
                "sourceMarkerIdentity",
                fsio::identity_value(&marker.identity),
            ),
        ]);
        exact(&join(bundle, "receipt.json"), &receipt)?;
        let receipt_hash = read_recovery_file(&join(bundle, "receipt.json"), SMALL)?.sha256;
        let lease = self.lease(bundle, &current_boot, true, &capture.operation_id)?;
        let mut state = FinalizeState::default();
        let context = FinalizeContext {
            bundle,
            capture: &capture,
            archive: &archive,
            directory: &directory,
            current_boot: &current_boot,
            marker: &marker,
            held_path: &held_path,
            archive_hash: &archive_hash,
            receipt_hash: &receipt_hash,
            receipt: &receipt,
            lease: &lease,
        };
        let result = self.finalize_inner(&context, &mut state);
        let result = match result {
            Ok(value) => Ok(value),
            Err(error) => {
                if !state.namespace_attempted {
                    state.clean = true;
                }
                if state.namespace_attempted && !error.is_blocked() {
                    blocked(
                        if state.namespace_observed {
                            "namespace_commit_observed_durability_or_cleanup_uncertain"
                        } else {
                            "namespace_commit_result_uncertain"
                        },
                        bundle,
                    )
                } else {
                    Err(error)
                }
            }
        };
        self.finish(&lease, state.clean, result)
    }
}

#[derive(Default)]
struct FinalizeState {
    clean: bool,
    namespace_attempted: bool,
    namespace_observed: bool,
}

struct FinalizeContext<'a> {
    bundle: &'a str,
    capture: &'a CaptureRecord,
    archive: &'a Archive,
    directory: &'a str,
    current_boot: &'a str,
    marker: &'a FileRecord,
    held_path: &'a str,
    archive_hash: &'a str,
    receipt_hash: &'a str,
    receipt: &'a Value,
    lease: &'a LeaseHandle,
}

struct Plan {
    value: Value,
    gate: FileRecord,
    lock: FileRecord,
}

fn parse_plan(value: &Value) -> Result<Plan> {
    let map = strict(
        value,
        &[
            "version",
            "status",
            "operationId",
            "archiveHash",
            "receiptHash",
            "marker",
            "heldPath",
            "controls",
        ],
    )?;
    schema::literal_number(map.get("version"), 2.0, "version")?;
    schema::literal_str(map.get("status"), "commit_prepared", "status")?;
    let operation = schema::uuid(map.get("operationId"), "operationId")?;
    let archive_hash = schema::string(map.get("archiveHash"), "archiveHash")?;
    let receipt_hash = schema::string(map.get("receiptHash"), "receiptHash")?;
    let marker = FileRecord::from_value(map.get("marker").ok_or_else(|| invalid("marker"))?)?;
    let held = schema::string(map.get("heldPath"), "heldPath")?;
    let controls = strict(
        map.get("controls").ok_or_else(|| invalid("controls"))?,
        &["gate", "lock"],
    )?;
    let gate = FileRecord::from_value(controls.get("gate").ok_or_else(|| invalid("gate"))?)?;
    let lock = FileRecord::from_value(controls.get("lock").ok_or_else(|| invalid("lock"))?)?;
    Ok(Plan {
        value: plan_value(
            &operation,
            &archive_hash,
            &receipt_hash,
            &marker,
            &held,
            &gate,
            &lock,
        ),
        gate,
        lock,
    })
}

fn plan_value(
    operation: &str,
    archive_hash: &str,
    receipt_hash: &str,
    marker: &FileRecord,
    held: &str,
    gate: &FileRecord,
    lock: &FileRecord,
) -> Value {
    obj([
        ("version", number(2.0)),
        ("status", s("commit_prepared")),
        ("operationId", s(operation)),
        ("archiveHash", s(archive_hash)),
        ("receiptHash", s(receipt_hash)),
        ("marker", marker.to_value()),
        ("heldPath", s(held)),
        (
            "controls",
            obj([("gate", gate.to_value()), ("lock", lock.to_value())]),
        ),
    ])
}

struct CommitIntent {
    plan: Plan,
    challenge_ok: bool,
}

fn source_marker(snapshot: &Value, directory: &str) -> Result<FileRecord> {
    let path = join(directory, "active-pair.json");
    let marker = snapshot["files"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|f| f["path"].as_str() == Some(path.as_str()));
    match marker {
        Some(m) => FileRecord::from_value(m),
        None => fail("Recovery signed original marker missing"),
    }
}

impl<A: NativeAdministrativeRecovery> OfflineReservationRecovery<A> {
    fn finalize_inner(
        &mut self,
        c: &FinalizeContext<'_>,
        state: &mut FinalizeState,
    ) -> Result<FinalizeOutcome> {
        let bundle = c.bundle;
        let capture = c.capture;
        let before = capture.challenge.intent.clone();
        let gate_file = join(c.directory, RECOVERY_GATE);
        let lock_file = join(c.directory, "offline-recovery-operation.lock");
        let intent_file = join(bundle, "finalized.json");
        let completion_file = join(bundle, "completion.json");
        let gate = gate_value(capture);
        let lock_value = obj([("operationId", s(&capture.operation_id))]);
        let mut intent: Option<CommitIntent> = None;
        if present(&intent_file)? {
            let parsed = (|| -> Result<(Plan, Challenge, String, Option<String>)> {
                let value = source_json(&intent_file, RECOVERY_LIMIT)?;
                let map = strict(
                    &value,
                    &["plan", "challenge", "signature", "currentRawDigest"],
                )?;
                let plan = parse_plan(map.get("plan").ok_or_else(|| invalid("plan"))?)?;
                let challenge = Challenge::parse(
                    map.get("challenge").ok_or_else(|| invalid("challenge"))?,
                    Some("finalize"),
                )?;
                let signature = signature_field(map.get("signature"))?;
                let raw = match map.get("currentRawDigest") {
                    None => None,
                    some => Some(schema::digest(some, "currentRawDigest")?),
                };
                Ok((plan, challenge, signature, raw))
            })();
            let Ok((plan, challenge, signature, raw)) = parsed else {
                return blocked("incomplete_or_legacy_commit_intent_preserve_marker", bundle);
            };
            let ch = &challenge.intent;
            let pv = &plan.value;
            let expected_digest = match &raw {
                Some(raw) => terminal_digest(
                    stringify(&obj([("plan", pv.clone()), ("rawDigest", s(raw))])).as_bytes(),
                ),
                None => terminal_digest(stringify(pv).as_bytes()),
            };
            let control_json = |record: &FileRecord| parse(&record.raw()).map(|v| stringify(&v));
            if pv["operationId"].as_str() != Some(capture.operation_id.as_str())
                || pv["archiveHash"].as_str() != Some(c.archive_hash)
                || pv["receiptHash"].as_str() != Some(c.receipt_hash)
                || pv["heldPath"].as_str() != Some(c.held_path)
                || stringify(&pv["marker"]) != stringify(&c.marker.to_value())
                || plan.gate.path != gate_file
                || plan.lock.path != lock_file
                || control_json(&plan.gate)? != stringify(&gate)
                || control_json(&plan.lock)? != stringify(&lock_value)
                || ch.operation_id != capture.operation_id
                || ch.owner != before.owner
                || ch.epoch != before.epoch
                || ch.directory != c.directory
                || ch.bundle != bundle
                || ch.before_boot != before.before_boot
                || ch.current_boot == before.before_boot
                || ch.snapshot_digest != before.snapshot_digest
                || ch.current_digest != expected_digest
                || !verify(self.authority.public_key(), &challenge, &signature)?
            {
                return blocked("untrusted_commit_intent", bundle);
            }
            intent = Some(CommitIntent {
                plan,
                challenge_ok: true,
            });
        }
        let held_before = present(c.held_path)?;
        if held_before && intent.is_none() {
            return blocked("held_marker_without_signed_final_commit", bundle);
        }
        if held_before {
            Self::observed_held_marker(c.marker, c.held_path)?;
            state.namespace_observed = true;
        }
        if present(&completion_file)? {
            let complete = (|| -> Result<Map<String, Value>> {
                let value = source_json(&completion_file, SMALL)?;
                let map = strict(
                    &value,
                    &[
                        "version",
                        "operationId",
                        "status",
                        "intentHash",
                        "observation",
                        "observationHash",
                        "cleanup",
                    ],
                )?
                .clone();
                schema::literal_number(map.get("version"), 1.0, "version")?;
                schema::uuid(map.get("operationId"), "operationId")?;
                schema::literal_str(map.get("status"), "finalized", "status")?;
                for key in ["intentHash", "observation", "observationHash"] {
                    schema::string(map.get(key), key)?;
                }
                let cleanup = schema::string(map.get("cleanup"), "cleanup")?;
                if !matches!(
                    cleanup.as_str(),
                    "old_controls_removed" | "changed_controls_preserved"
                ) {
                    return Err(invalid("cleanup"));
                }
                Ok(map)
            })();
            let Ok(complete) = complete else {
                return blocked("completion_record_uncertain_commit_preserved", bundle);
            };
            let observation = complete["observation"]
                .as_str()
                .unwrap_or_default()
                .to_owned();
            let prefix = join(bundle, "commit-observed-");
            let tail = observation.get(bundle.len() + 1..).unwrap_or_default();
            let tail_ok = tail.starts_with("commit-observed-")
                && tail.ends_with(".json")
                && tail.len() > "commit-observed-.json".len()
                && tail["commit-observed-".len()..tail.len() - 5]
                    .bytes()
                    .all(|b| matches!(b, b'a'..=b'f' | b'0'..=b'9' | b'-'));
            let mismatch = intent.is_none()
                || !held_before
                || complete["operationId"].as_str() != Some(capture.operation_id.as_str())
                || complete["intentHash"].as_str()
                    != Some(
                        read_recovery_file(&intent_file, RECOVERY_LIMIT)?
                            .sha256
                            .as_str(),
                    )
                || !observation.starts_with(&prefix)
                || !tail_ok
                || Some(read_recovery_file(&observation, SMALL)?.sha256.as_str())
                    != complete["observationHash"].as_str();
            if mismatch {
                return blocked("completion_record_uncertain_commit_preserved", bundle);
            }
            return blocked("already_finalized_original_commit_preserved", bundle);
        }
        let fresh = if held_before {
            c.archive.current.clone()
        } else {
            self.snapshot(c.directory, bundle, true)?
        };
        if fresh["logicalDigest"] != c.archive.current["logicalDigest"] {
            return blocked("pre_commit_logical_source_changed", bundle);
        }
        if !held_before && physical_records(&fresh) != physical_records(&c.archive.current) {
            return blocked("pre_commit_physical_source_changed", bundle);
        }
        let fresh_raw = fresh["rawDigest"].clone();
        let receipt_path = join(bundle, "receipt.json");
        let intent_controls = intent
            .as_ref()
            .map(|i| (i.plan.gate.clone(), i.plan.lock.clone()));
        let assert_prepared = |this: &mut Self| -> Result<()> {
            if this.boot()? != c.current_boot
                || present(c.held_path)?
                || this.snapshot(c.directory, bundle, true)?["rawDigest"] != fresh_raw
            {
                return blocked("pre_commit_source_changed", bundle);
            }
            exact(&gate_file, &gate)?;
            exact(&lock_file, &lock_value)?;
            exact(&receipt_path, c.receipt)?;
            if let Some((g, l)) = &intent_controls {
                if read_recovery_file(&gate_file, SMALL)? != *g
                    || read_recovery_file(&lock_file, SMALL)? != *l
                {
                    return blocked("pre_commit_control_identity_changed", bundle);
                }
            }
            Ok(())
        };
        let plan: Plan = match &intent {
            Some(i) => Plan {
                value: i.plan.value.clone(),
                gate: i.plan.gate.clone(),
                lock: i.plan.lock.clone(),
            },
            None => {
                assert_prepared(self)?;
                let gate_record = read_recovery_file(&gate_file, SMALL)?;
                let lock_record = read_recovery_file(&lock_file, SMALL)?;
                Plan {
                    value: plan_value(
                        &capture.operation_id,
                        c.archive_hash,
                        c.receipt_hash,
                        c.marker,
                        c.held_path,
                        &gate_record,
                        &lock_record,
                    ),
                    gate: gate_record,
                    lock: lock_record,
                }
            }
        };
        if !held_before {
            assert_prepared(self)?;
        }
        let bound =
            fresh.get("historicalBinding").is_some() || fresh.get("physicalDifference").is_some();
        let current_digest = if bound {
            terminal_digest(
                stringify(&obj([
                    ("plan", plan.value.clone()),
                    ("rawDigest", fresh_raw.clone()),
                ]))
                .as_bytes(),
            )
        } else {
            terminal_digest(stringify(&plan.value).as_bytes())
        };
        let proposal = AdminIntent {
            phase: "finalize".into(),
            current_boot: c.current_boot.to_owned(),
            current_digest,
            ..before.clone()
        };
        let held_marker = if held_before {
            Self::observed_held_marker(c.marker, c.held_path)?.to_value()
        } else {
            Value::Null
        };
        let transaction = obj([
            (
                "phase",
                s(if held_before {
                    "namespace_commit_observed_cleanup_only"
                } else {
                    "final_commit_original_marker_retained"
                }),
            ),
            ("snapshotScope", s("historical_pre_commit")),
            ("plan", plan.value.clone()),
            ("heldMarker", held_marker),
            (
                "actionAfterCommit",
                s("Never touch active-pair.json or revalidate future owner activity"),
            ),
        ]);
        let mut approval = self.approve(&proposal, &fresh, Some(&transaction))?;
        self.revalidate(&mut approval)?;
        if self.boot()? != c.current_boot {
            return fail("Recovery kernel boot changed");
        }
        if !held_before {
            assert_prepared(self)?;
        }
        self.assert_approval(&approval)?;
        let mut signed = Map::new();
        signed.insert("plan".into(), plan.value.clone());
        signed.insert("challenge".into(), approval.challenge.created());
        signed.insert("signature".into(), s(&approval.signature));
        if bound {
            signed.insert("currentRawDigest".into(), fresh_raw.clone());
        }
        let signed = Value::Object(signed);
        self.write(
            &join(
                bundle,
                &format!("finalization-approval-{}.json", approval.challenge.nonce),
            ),
            &stringify(&signed),
        )?;
        let controls = match &intent {
            Some(i) => (i.plan.gate.clone(), i.plan.lock.clone()),
            None => {
                self.write(&intent_file, &stringify(&signed))?;
                (plan.gate.clone(), plan.lock.clone())
            }
        };
        let _ = intent.as_ref().map(|i| i.challenge_ok);
        self.sync_file(&join(bundle, "archive.json"))?;
        self.sync_file(&join(bundle, "receipt-prepared.json"))?;
        self.sync_file(&join(bundle, "receipt.json"))?;
        self.sync_file(&intent_file)?;
        if !held_before {
            self.boundary("commit_prepared")?;
            assert_prepared(self)?;
            self.boundary("before_marker")?;
            self.revalidate(&mut approval)?;
            assert_prepared(self)?;
            let current_lease = read_recovery_file(&c.lease.file, SMALL)?;
            let lease = self.leases.get(&c.lease.file);
            let expected = lease.map(|l| {
                base64::Engine::encode(
                    &base64::engine::general_purpose::STANDARD,
                    l.bytes.as_bytes(),
                )
            });
            if Some(current_lease.bytes.clone()) != expected
                || Some(&current_lease.identity) != lease.map(|l| &l.identity)
            {
                return blocked("operation_lease_changed", bundle);
            }
            if !approval.deadline.is_finite() || approval.deadline <= self.now() {
                return blocked("final_commit_approval_expired", bundle);
            }
            state.namespace_attempted = true;
            std::fs::rename(&c.marker.path, c.held_path)?;
            state.namespace_observed = true;
            self.boundary("after_marker")?;
        }
        state.namespace_attempted = true;
        let held = Self::observed_held_marker(c.marker, c.held_path)?;
        self.sync(c.directory)?;
        let observation = join(bundle, &format!("commit-observed-{}.json", self.uuid()));
        self.write(
            &observation,
            &stringify(&obj([
                ("version", number(1.0)),
                ("operationId", s(&capture.operation_id)),
                ("status", s("release_committed")),
                ("authority", s("administrative_recovery")),
                ("reason", s("non_dispatch")),
                ("fence", s("external_kernel_boot_fence")),
                (
                    "intentHash",
                    s(&read_recovery_file(&intent_file, RECOVERY_LIMIT)?.sha256),
                ),
                ("observedBoot", s(c.current_boot)),
                ("heldMarkerHash", s(&held.sha256)),
                ("heldMarkerIdentity", fsio::identity_value(&held.identity)),
            ])),
        )?;
        self.boundary("commit_receipt")?;
        let mut changed = false;
        for (kind, control) in [("lock", &controls.1), ("gate", &controls.0)] {
            if !present(&control.path)? {
                continue;
            }
            let current = match read_recovery_file(&control.path, SMALL) {
                Ok(current) => current,
                Err(_) => {
                    changed = true;
                    continue;
                }
            };
            if current != *control {
                changed = true;
                continue;
            }
            if !approval.deadline.is_finite() || self.now() >= approval.deadline {
                changed = true;
                continue;
            }
            std::fs::remove_file(&control.path)?;
            self.boundary(if kind == "lock" {
                "after_lock"
            } else {
                "after_gate"
            })?;
            self.sync(c.directory)?;
        }
        self.sync(c.directory)?;
        let cleanup = if changed {
            "changed_controls_preserved"
        } else {
            "old_controls_removed"
        };
        self.write(
            &completion_file,
            &stringify(&obj([
                ("version", number(1.0)),
                ("operationId", s(&capture.operation_id)),
                ("status", s("finalized")),
                (
                    "intentHash",
                    s(&read_recovery_file(&intent_file, RECOVERY_LIMIT)?.sha256),
                ),
                ("observation", s(&observation)),
                (
                    "observationHash",
                    s(&read_recovery_file(&observation, SMALL)?.sha256),
                ),
                ("cleanup", s(cleanup)),
            ])),
        )?;
        state.clean = true;
        Ok(FinalizeOutcome {
            operation_id: capture.operation_id.clone(),
            cleanup: cleanup.into(),
        })
    }
}

/// Returns the (ordered) `receipt.json` value of a release outcome.
pub fn receipt_of(outcome: &ReleaseOutcome) -> &Value {
    &outcome.receipt
}

pub fn file_record_value(record: &FileRecord) -> Value {
    record.to_value()
}

pub use super::fsio::read_recovery_file as read_file;
