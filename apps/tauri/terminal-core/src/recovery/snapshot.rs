//! Port of `snapshotOfflineReservation` and `assertHeldRecoverySnapshot`
//! (`offline-recovery-files.ts`). No Store, live SQLite connection, provider file, executable or
//! auth configuration is opened; journals are inspected through a private derived image.
use super::binding::{
    compare_physical_files, enrollment_binding, historical_identity, model_source_paths,
    offline_binding_metadata, offline_model_source_metadata, physical_binding_digest,
    sources_value, verify_historical_binding, Binding, DeviceDifference, SourceMetadata,
};
use super::error::{fail, RecoveryError, Result};
use super::fsio::{
    directory_names, dirname, join, read_recovery_file, recovery_identity, tdir,
    write_recovery_file, FileRecord, Sync, OFFLINE_JOURNAL_BYTES, RECOVERY_LIMIT,
};
use super::image::{committed_terminal_image, inspect_offline_terminal_image};
use super::js::{number, obj, parse, s, stringify, with};
use super::schema;
use crate::authority::terminal_digest;
use serde_json::{Map, Value};

/// Historical binding evidence copied into the bundle.
#[derive(Clone, Debug)]
pub struct HistoricalEvidence {
    pub evidence: Value,
    pub sha256: String,
    pub bytes: String,
    pub record: FileRecord,
}

fn json(record: &FileRecord) -> Result<Value> {
    parse(&record.raw())
}

/// Node `path.relative(from, to)` for absolute normalized paths.
pub fn relative(from: &str, to: &str) -> String {
    let split = |p: &str| {
        p.split('/')
            .filter(|x| !x.is_empty())
            .map(str::to_owned)
            .collect::<Vec<_>>()
    };
    let (a, b) = (split(from), split(to));
    let common = a.iter().zip(&b).take_while(|(x, y)| x == y).count();
    let mut parts: Vec<String> = vec!["..".into(); a.len() - common];
    parts.extend(b[common..].iter().cloned());
    parts.join("/")
}

fn inside(relative: &str) -> bool {
    relative.is_empty() || (relative != ".." && !relative.starts_with("../"))
}

fn raw_digest(
    files: &Value,
    journals: &Value,
    membership: &Value,
    historical: Option<&Value>,
    physical: Option<&Value>,
) -> String {
    let mut map = Map::new();
    map.insert("files".into(), files.clone());
    map.insert("journals".into(), journals.clone());
    map.insert("membership".into(), membership.clone());
    if let Some(h) = historical {
        map.insert("historicalBinding".into(), h.clone());
    }
    if let Some(p) = physical {
        map.insert("physicalDifference".into(), p.clone());
    }
    terminal_digest(stringify(&Value::Object(map)).as_bytes())
}

/// Recompute the RAW projection of a parsed snapshot.
pub fn snapshot_raw_digest(snapshot: &Value) -> String {
    raw_digest(
        &snapshot["files"],
        &snapshot["journals"],
        &snapshot["membership"],
        snapshot.get("historicalBinding"),
        snapshot.get("physicalDifference"),
    )
}

fn names_value(names: &[String]) -> Value {
    Value::Array(names.iter().map(|n| s(n)).collect())
}

/// `assertHeldRecoverySnapshot(directory, value)`.
pub fn assert_held_recovery_snapshot(directory: &str, value: &Value) -> Result<Value> {
    let snapshot = schema::snapshot(value)?;
    if snapshot_raw_digest(&snapshot) != snapshot["rawDigest"].as_str().unwrap_or_default() {
        return fail("Recovery archived snapshot digest changed");
    }
    if let Some(historical) = snapshot.get("historicalBinding") {
        let paths: Vec<String> = historical["currentSources"]
            .as_array()
            .map(|a| {
                a.iter()
                    .map(|x| x["path"].as_str().unwrap_or_default().to_owned())
                    .collect()
            })
            .unwrap_or_default();
        if stringify(&sources_value(&offline_model_source_metadata(&paths)?))
            != stringify(&historical["currentSources"])
        {
            return fail("Recovery held model source metadata changed");
        }
    }
    let marker = join(directory, "active-pair.json");
    for file in snapshot["files"].as_array().into_iter().flatten() {
        let path = file["path"].as_str().unwrap_or_default();
        if path == marker {
            continue;
        }
        if stringify(&read_recovery_file(path, OFFLINE_JOURNAL_BYTES)?.to_value())
            != stringify(file)
        {
            return fail("Recovery held source changed");
        }
    }
    let mut enrollment: Vec<String> = directory_names(directory)?
        .into_iter()
        .filter(|n| n.starts_with("enrollment-"))
        .collect();
    super::js::sort_js(&mut enrollment);
    if stringify(&names_value(&enrollment)) != stringify(&snapshot["membership"]) {
        return fail("Recovery held enrollment changed");
    }
    for journal in snapshot["journals"].as_array().into_iter().flatten() {
        let path = journal["path"].as_str().unwrap_or_default();
        if stringify(&names_value(&directory_names(&dirname(path))?))
            != stringify(&journal["stateNames"])
        {
            return fail("Recovery held journal directory changed");
        }
        if !journal["shmIdentity"].is_null()
            && stringify(&super::fsio::identity_value(&recovery_identity(&format!(
                "{path}-shm"
            ))?))
                != stringify(&journal["shmIdentity"])
        {
            return fail("Recovery held SHM changed");
        }
    }
    Ok(snapshot)
}

struct JournalEntry {
    path: String,
    slot: usize,
    terminal_id: String,
    binding_digest: String,
    database_identity: Vec<String>,
    state_names: Vec<String>,
    shm_identity: Option<Vec<String>>,
    logical: Value,
}

impl JournalEntry {
    fn to_value(&self) -> Value {
        obj([
            ("path", s(&self.path)),
            ("slot", number(self.slot as f64)),
            ("terminalId", s(&self.terminal_id)),
            ("bindingDigest", s(&self.binding_digest)),
            ("databaseIdentity", names_value(&self.database_identity)),
            ("stateNames", names_value(&self.state_names)),
            (
                "shmIdentity",
                self.shm_identity
                    .as_ref()
                    .map_or(Value::Null, |i| names_value(i)),
            ),
            ("logical", self.logical.clone()),
        ])
    }
}

/// `snapshotOfflineReservation(directory, scratch, historical, signedHistorical)`.
pub fn snapshot_offline_reservation(
    directory: &str,
    scratch: &str,
    historical: Option<&HistoricalEvidence>,
    signed_historical: Option<&Value>,
    sync: &Sync,
) -> Result<Value> {
    tdir(directory, true)?;
    tdir(scratch, true)?;
    if directory == scratch {
        return fail("Recovery scratch overlaps source");
    }
    let names = || -> Result<Vec<String>> {
        let mut entries: Vec<String> = directory_names(directory)?
            .into_iter()
            .filter(|n| n.starts_with("enrollment-"))
            .collect();
        super::js::sort_js(&mut entries);
        if entries.len() > 256 {
            return fail("Recovery enrollment budget");
        }
        Ok(entries)
    };
    let difference: Option<DeviceDifference> = match signed_historical {
        Some(saved) => compare_physical_files(saved, &mut |path| {
            read_recovery_file(path, OFFLINE_JOURNAL_BYTES)
        })?,
        None => None,
    };
    let mut physical_bindings: Vec<Value> = Vec::new();
    let mut captured = 0usize;
    let take = |file: &str, limit: usize, captured: &mut usize| -> Result<FileRecord> {
        let record = read_recovery_file(file, limit.min(RECOVERY_LIMIT.saturating_sub(*captured)))?;
        *captured += record.raw().len();
        Ok(record)
    };
    const SMALL: usize = 16 * 1024;
    let membership = names()?;
    let mut files: Vec<FileRecord> = vec![take(
        &join(directory, "active-pair.json"),
        SMALL,
        &mut captured,
    )?];
    let marker = schema::marker(&json(&files[0])?)?;
    if let Some(h) = historical {
        files.push(h.record.clone());
    }
    let mut unique = marker.manifests.clone();
    unique.sort();
    unique.dedup();
    if marker.manifests.is_empty() || unique.len() != marker.manifests.len() {
        return fail("Recovery initial manifests incomplete");
    }
    if directory_names(directory)?
        .iter()
        .any(|n| n.starts_with(&format!("retired-{}-", marker.owner)))
    {
        return fail("Recovery prior archive effect uncertain");
    }
    let prefix = format!("enrollment-{}-", marker.owner);
    let enrollment_files: Vec<String> = membership
        .iter()
        .filter(|n| n.starts_with(&prefix))
        .cloned()
        .collect();
    let mut intents = Vec::new();
    for name in enrollment_files
        .iter()
        .filter(|n| !n.ends_with(".receipt.json"))
    {
        let source = take(&join(directory, name), SMALL, &mut captured)?;
        files.push(source.clone());
        let intent = schema::enrollment_intent(&json(&source)?)?;
        if intent.owner != marker.owner
            || *name != format!("enrollment-{}-{}.json", marker.owner, intent.input.op_id)
        {
            return fail("Recovery enrollment owner/name");
        }
        let result_name = format!(
            "{}.receipt.json",
            name.strip_suffix(".json").unwrap_or(name)
        );
        if !enrollment_files.contains(&result_name) {
            return fail("Recovery enrollment incomplete");
        }
        let receipt_file = take(&join(directory, &result_name), SMALL, &mut captured)?;
        files.push(receipt_file.clone());
        let result = schema::enrollment_receipt(&json(&receipt_file)?)?;
        if result.owner != marker.owner || result.status != "ready" {
            return fail("Recovery enrollment uncertain");
        }
        if intent.input != result.input {
            return fail("Recovery enrollment binding");
        }
        let receipt_member = result.member.as_ref().map(|m| m.to_value(&m.status));
        if Some(stringify(&intent.member.to_value("ready")))
            != receipt_member.map(|v| stringify(&v))
        {
            return fail("Recovery enrollment member changed");
        }
        intents.push(intent);
    }
    intents.sort_by_key(|i| i.member.admission_revision);
    if enrollment_files.len() != intents.len() * 2 {
        return fail("Recovery orphan enrollment receipt");
    }
    let mut paths = marker.manifests.clone();
    for (index, intent) in intents.iter().enumerate() {
        if intent.input.expected_revision != index as i64
            || intent.member.admission_revision != index as i64 + 1
            || intent.member.slot != (marker.manifests.len() + index) as i64
            || intent.member.status != "uncertain"
        {
            return fail("Recovery enrollment revision/slot gap");
        }
        paths.push(intent.manifest_file.clone());
    }
    let mut unique_paths = paths.clone();
    unique_paths.sort();
    unique_paths.dedup();
    if paths.len() > 8 || unique_paths.len() != paths.len() {
        return fail("Recovery member budget/duplicate");
    }
    let mut seen_states: Vec<String> = Vec::new();
    let mut seen_terminals: Vec<String> = Vec::new();
    let mut selected_project: Option<String> = None;
    let mut historical_binding: Option<Value> = None;
    let mut bindings: Vec<Binding> = Vec::new();
    let mut journals: Vec<JournalEntry> = Vec::new();
    for (slot, path) in paths.iter().enumerate() {
        let manifest = take(path, SMALL, &mut captured)?;
        files.push(manifest.clone());
        let config = schema::interactive_config(&json(&manifest)?)?;
        let project = config["project"].as_str().unwrap_or_default().to_owned();
        let state = config["state"].as_str().unwrap_or_default().to_owned();
        tdir(&project, false)?;
        crate::profiles::codex::assert_separate_terminal_state(&project, &state)?;
        if selected_project.as_ref().is_some_and(|p| *p != project) {
            return fail("Recovery mixed selection workspace");
        }
        selected_project = Some(project.clone());
        let terminal_id = config
            .pointer("/identity/terminalId")
            .and_then(Value::as_str)
            .map(str::to_owned);
        let Some(terminal_id) =
            terminal_id.filter(|t| !seen_states.contains(&state) && !seen_terminals.contains(t))
        else {
            return fail("Recovery ambiguous member");
        };
        seen_states.push(state.clone());
        seen_terminals.push(terminal_id.clone());
        tdir(&state, true)?;
        for selected in seen_states.iter().filter(|x| **x != state) {
            for rel in [relative(selected, &state), relative(&state, selected)] {
                if inside(&rel) {
                    return fail("Recovery overlapping member state");
                }
            }
        }
        for source in [directory, state.as_str()] {
            if inside(&relative(source, scratch)) {
                return fail("Recovery scratch overlaps source");
            }
        }
        let state_names = directory_names(&state)?;
        if state_names
            .iter()
            .any(|n| n.starts_with("lifecycle-") || n == "terminal.sqlite-journal")
        {
            return fail("Recovery lifecycle/rollback uncertainty");
        }
        let binding = enrollment_binding(path, &config)?;
        bindings.push(binding.clone());
        let intent = intents.iter().find(|i| i.member.slot == slot as i64);
        if difference.is_some() {
            let identities = offline_binding_metadata(&binding)?;
            physical_bindings.push(obj([
                ("slot", number(slot as f64)),
                ("identities", sources_value(&identities)),
            ]));
        }
        let mut binding_digest = match &difference {
            Some(d) => physical_binding_digest(&binding, &manifest.raw(), d)?,
            None => binding.binding_digest.clone(),
        };
        if let Some(h) =
            historical.filter(|h| h.evidence["member"]["slot"].as_u64() == Some(slot as u64))
        {
            let evidence = &h.evidence;
            let op = evidence["enrollment"]["opId"].as_str().unwrap_or_default();
            let intent_source = files.iter().find(|f| {
                f.path == join(directory, &format!("enrollment-{}-{op}.json", marker.owner))
            });
            let receipt_source = files.iter().find(|f| {
                f.path
                    == join(
                        directory,
                        &format!("enrollment-{}-{op}.receipt.json", marker.owner),
                    )
            });
            let manifest_identity = historical_identity(
                Some(&format!(
                    "{}:{}",
                    manifest.identity[0], manifest.identity[1]
                )),
                difference.as_ref(),
            );
            let field = |a: &str, b: &str| evidence[a][b].as_str().unwrap_or_default().to_owned();
            let Some(intent) = intent else {
                return Err(RecoveryError::BindingChanged);
            };
            if field("marker", "owner") != marker.owner
                || field("marker", "sha256") != files[0].sha256
                || field("enrollment", "opId") != intent.input.op_id
                || field("enrollment", "epoch") != intent.input.epoch
                || Some(field("enrollment", "intentSha256"))
                    != intent_source.map(|f| f.sha256.clone())
                || Some(field("enrollment", "receiptSha256"))
                    != receipt_source.map(|f| f.sha256.clone())
                || field("member", "terminalId") != terminal_id
                || field("member", "manifestSha256") != manifest.sha256
                || Some(field("member", "manifestIdentity")) != manifest_identity
                || field("member", "frozenBindingDigest") != intent.member.binding_digest
            {
                return Err(RecoveryError::BindingChanged);
            }
            let current_sources = offline_model_source_metadata(&model_source_paths(&config))?;
            if let Some(d) = &difference {
                let mismatch = current_sources.iter().enumerate().any(|(index, source)| {
                    let original = evidence["modelSources"][index]["identity"].as_str();
                    let (Some(original), Some(identity)) = (original, source.identity.as_ref())
                    else {
                        return false;
                    };
                    let device = original.split(':').next().unwrap_or_default();
                    let expected = if device == d.historical_device {
                        d.current_device.as_str()
                    } else {
                        device
                    };
                    identity[0] != expected
                });
                if mismatch {
                    return Err(RecoveryError::BindingChanged);
                }
            }
            let projected: Vec<SourceMetadata> = current_sources
                .iter()
                .map(|source| SourceMetadata {
                    path: source.path.clone(),
                    identity: source.identity.as_ref().map(|i| {
                        let mapped = historical_identity(
                            Some(&format!("{}:{}", i[0], i[1])),
                            difference.as_ref(),
                        )
                        .unwrap_or_default();
                        let mut out = vec![mapped.split(':').next().unwrap_or_default().to_owned()];
                        out.extend(i[1..].iter().cloned());
                        out
                    }),
                })
                .collect();
            let identities: Vec<Option<String>> = binding
                .identities
                .iter()
                .map(|i| historical_identity(i.as_deref(), difference.as_ref()))
                .collect();
            if let Err(error) =
                verify_historical_binding(evidence, &binding, &projected, &identities)
            {
                if difference.is_some() {
                    return Err(RecoveryError::BindingChanged);
                }
                return Err(error);
            }
            historical_binding = Some(obj([
                ("evidenceSha256", s(&h.sha256)),
                ("evidence", evidence.clone()),
                ("currentSources", sources_value(&current_sources)),
            ]));
            binding_digest = field("member", "frozenBindingDigest");
        }
        if difference.is_some()
            && signed_historical.and_then(|h| h["journals"][slot]["bindingDigest"].as_str())
                != Some(binding_digest.as_str())
        {
            return Err(RecoveryError::BindingChanged);
        }
        if let Some(intent) = intent {
            if intent.member.binding_digest != binding_digest {
                return Err(RecoveryError::BindingChanged);
            }
            let provider = if config["version"].as_f64() == Some(1.0) {
                "codex".to_owned()
            } else {
                config["provider"].as_str().unwrap_or_default().to_owned()
            };
            let workspace = crate::profiles::terminal_digest(stringify(&Value::Array(vec![
                s("workspace"),
                s(&project),
            ])));
            let preparation = config.get("preparation");
            let requested: Option<Option<String>> = Some(
                config
                    .pointer("/model/value")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            );
            let requested_model_matches =
                match (&intent.member.requested_model, config.get("model")) {
                    (None, None) => true,
                    (None, Some(_)) => false,
                    (Some(member), Some(_)) => Some(member.clone()) == requested,
                    (Some(_), None) => false,
                };
            if intent.member.terminal_id != terminal_id
                || intent.member.provider != provider
                || intent.member.workspace_id != workspace
                || Some(intent.member.workspace_id.as_str())
                    != preparation.and_then(|p| p["workspaceId"].as_str())
                || Some(
                    intent
                        .member
                        .feature_id
                        .clone()
                        .map_or(Value::Null, |f| s(&f)),
                ) != preparation.map(|p| p["featureId"].clone())
                || !requested_model_matches
            {
                return fail("Recovery manifest enrollment binding");
            }
        }
        let base = take(
            &join(&state, "terminal.sqlite"),
            OFFLINE_JOURNAL_BYTES,
            &mut captured,
        )?;
        let wal = match take(
            &format!("{}-wal", base.path),
            OFFLINE_JOURNAL_BYTES,
            &mut captured,
        ) {
            Ok(record) => Some(record),
            Err(error) if error.is_not_found() => None,
            Err(error) => return Err(error),
        };
        let shm_identity = if state_names.iter().any(|n| n == "terminal.sqlite-shm") {
            Some(recovery_identity(&format!("{}-shm", base.path))?)
        } else {
            None
        };
        files.push(base.clone());
        if let Some(w) = &wal {
            files.push(w.clone());
        }
        let image =
            committed_terminal_image(&base.raw(), wal.as_ref().map(|w| w.raw()).as_deref())?;
        let derived = join(scratch, &format!("derived-{slot}.sqlite"));
        write_recovery_file(&derived, &image, sync)?;
        let logical = inspect_offline_terminal_image(&derived)?;
        let epoch = logical["epoch"].as_str().unwrap_or_default().to_owned();
        let project_id = crate::profiles::terminal_digest(project.as_bytes());
        if marker.epoch.as_ref().is_some_and(|e| *e != epoch)
            || intents.iter().any(|i| i.input.epoch != epoch)
            || logical["attempts"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|a| a["projectId"].as_str() != Some(project_id.as_str()))
        {
            return fail("Recovery journal epoch/project mismatch");
        }
        journals.push(JournalEntry {
            path: base.path.clone(),
            slot,
            terminal_id,
            binding_digest,
            database_identity: vec![
                base.identity[0].clone(),
                base.identity[1].clone(),
                base.identity[3].clone(),
                base.identity[4].clone(),
            ],
            state_names,
            shm_identity,
            logical,
        });
    }
    if historical.is_some() && historical_binding.is_none() {
        return Err(RecoveryError::BindingChanged);
    }
    let mut epochs: Vec<&str> = journals
        .iter()
        .map(|j| j.logical["epoch"].as_str().unwrap_or_default())
        .collect();
    epochs.dedup();
    if epochs.len() != 1 {
        let mut all = epochs.clone();
        all.sort();
        all.dedup();
        if all.len() != 1 {
            return fail("Recovery mixed journal owners");
        }
    }
    for file in &files {
        if read_recovery_file(&file.path, OFFLINE_JOURNAL_BYTES)? != *file {
            return fail("Recovery source changed after inspection");
        }
    }
    if membership != names()? {
        return fail("Recovery enrollment race");
    }
    for journal in &journals {
        if directory_names(&dirname(&journal.path))? != journal.state_names {
            return fail("Recovery journal directory changed");
        }
        if let Some(shm) = &journal.shm_identity {
            if recovery_identity(&format!("{}-shm", journal.path))? != *shm {
                return fail("Recovery SHM metadata changed");
            }
        }
    }
    if let Some(h) = &historical_binding {
        let paths: Vec<String> = h["currentSources"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|x| x["path"].as_str().unwrap_or_default().to_owned())
            .collect();
        if stringify(&sources_value(&offline_model_source_metadata(&paths)?))
            != stringify(&h["currentSources"])
        {
            return fail("Recovery model source metadata changed");
        }
    }
    let historical_file = |file: &FileRecord| -> Value {
        match &difference {
            Some(d) => {
                let mut f = file.clone();
                f.identity[0] = d.historical_device.clone();
                f.to_value()
            }
            None => file.to_value(),
        }
    };
    let is_journal = |path: &str| {
        journals
            .iter()
            .any(|j| path == j.path || path == format!("{}-wal", j.path))
    };
    let mut logical = Map::new();
    if let Some(h) = &historical_binding {
        logical.insert(
            "historicalBinding".into(),
            obj([
                ("evidenceSha256", h["evidenceSha256"].clone()),
                ("evidence", h["evidence"].clone()),
            ]),
        );
    }
    logical.insert("marker".into(), marker.value.clone());
    logical.insert("membership".into(), names_value(&membership));
    logical.insert(
        "immutable".into(),
        Value::Array(
            files
                .iter()
                .filter(|f| !is_journal(&f.path))
                .map(historical_file)
                .collect(),
        ),
    );
    logical.insert(
        "journals".into(),
        Value::Array(
            journals
                .iter()
                .map(|j| {
                    let mut database = j.database_identity.clone();
                    if let Some(d) = &difference {
                        database[0] = d.historical_device.clone();
                    }
                    obj([
                        ("path", s(&j.path)),
                        ("slot", number(j.slot as f64)),
                        ("terminalId", s(&j.terminal_id)),
                        ("bindingDigest", s(&j.binding_digest)),
                        ("databaseIdentity", names_value(&database)),
                        ("logical", j.logical.clone()),
                    ])
                })
                .collect(),
        ),
    );
    let logical_digest = terminal_digest(stringify(&Value::Object(logical)).as_bytes());
    let physical = difference.as_ref().map(|d| {
        obj([
            ("kind", s("administrative_device_difference")),
            ("historicalDevice", s(&d.historical_device)),
            ("currentDevice", s(&d.current_device)),
            ("bindings", Value::Array(physical_bindings.clone())),
        ])
    });
    if let Some(p) = &physical {
        for entry in p["bindings"].as_array().into_iter().flatten() {
            let slot = entry["slot"].as_u64().unwrap_or(0) as usize;
            if stringify(&sources_value(&offline_binding_metadata(&bindings[slot])?))
                != stringify(&entry["identities"])
            {
                return fail("Recovery enrollment metadata changed during inspection");
            }
        }
        if Some(logical_digest.as_str())
            != signed_historical.and_then(|h| h["logicalDigest"].as_str())
        {
            return fail("Recovery historical logical projection changed");
        }
    }
    let files_value = Value::Array(files.iter().map(FileRecord::to_value).collect());
    let journals_value = Value::Array(journals.iter().map(JournalEntry::to_value).collect());
    let membership_value = names_value(&membership);
    let raw = raw_digest(
        &files_value,
        &journals_value,
        &membership_value,
        historical_binding.as_ref(),
        physical.as_ref(),
    );
    let mut out = Map::new();
    out.insert("version".into(), number(1.0));
    out.insert("files".into(), files_value);
    out.insert("journals".into(), journals_value);
    out.insert("membership".into(), membership_value);
    if let Some(h) = historical_binding {
        out.insert("historicalBinding".into(), h);
    }
    if let Some(p) = physical {
        out.insert("physicalDifference".into(), p);
    }
    out.insert("logicalDigest".into(), s(&logical_digest));
    out.insert("rawDigest".into(), s(&raw));
    schema::snapshot(&Value::Object(out))
}

pub fn with_value(base: &Value, entries: &[(&str, Value)]) -> Value {
    with(base, entries)
}
