//! Port of `mcpCommunicationJournal` (`mcp-communication.ts`): metadata-only audit of one
//! owned MCP pair, scoped to the Feature that owns both terminals. Any inconsistency (file
//! changed outside its producer, scope change, budget) makes it unavailable, never guessed.
use std::fs;
use std::io::{Read, Write};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

use serde::Serialize;

use crate::features::error::{store, Result};
use crate::features::model::{is_uuid, stable_id, FeatureStatus, WorkspaceFeature};
use crate::features::store::{getuid, private_mkdir, terminal_directory};

/// `McpTaskEvidence` (`mcp-task.ts`).
#[derive(Clone, Debug)]
pub struct McpTaskEvidence {
    pub grant_id: String,
    pub task_id: String,
    pub source_instance_id: String,
    pub target_instance_id: String,
    /// `delegation` or `result`.
    pub kind: &'static str,
    pub at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct Record {
    version: u8,
    epoch: String,
    workspace_id: String,
    feature_id: String,
    feature_revision: u64,
    id: String,
    from: String,
    to: String,
    source_instance_id: String,
    target_instance_id: String,
    grant_id: String,
    task_id: String,
    kind: &'static str,
    at: u64,
}

type FeatureSource = Box<dyn Fn() -> Result<Vec<WorkspaceFeature>> + Send + Sync>;

struct Inner {
    root: PathBuf,
    file: PathBuf,
    ino: u64,
    dev: u64,
    bytes: Vec<u8>,
    records: Vec<Record>,
    available: bool,
}

pub struct CommunicationJournal {
    inner: Arc<Mutex<Inner>>,
    epoch: String,
    workspace_id: String,
    terminal_ids: [String; 2],
    features: Arc<FeatureSource>,
}

/// One bound pair instance; `record` is the evidence callback of the task broker.
pub struct Binding {
    journal: Arc<CommunicationJournal>,
    source: String,
    target: String,
    feature_id: String,
    revision: u64,
}

fn mcp_id(epoch: &str, grant: &str, task: &str, kind: &str) -> String {
    let h = stable_id(&["mcp-communication", epoch, grant, task, kind]);
    format!(
        "{}-{}-5{}-a{}-{}",
        &h[0..8],
        &h[8..12],
        &h[13..16],
        &h[17..20],
        &h[20..32]
    )
}

fn fsync_dir(path: &Path) -> Result<()> {
    fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)?
        .sync_all()?;
    Ok(())
}

impl Inner {
    fn inspect(&self, file: &fs::File) -> Result<()> {
        let info = file.metadata()?;
        if info.ino() != self.ino
            || info.dev() != self.dev
            || info.nlink() != 1
            || info.size() != self.bytes.len() as u64
            || !info.is_file()
            || info.uid() != getuid()
            || info.mode() & 0o077 != 0
        {
            return Err(store("Unsafe MCP journal file"));
        }
        Ok(())
    }

    fn check(&self) -> Result<()> {
        terminal_directory(&self.root, true)?;
        let mut reader = fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
            .open(&self.file)?;
        self.inspect(&reader)?;
        let mut current = Vec::with_capacity(self.bytes.len() + 1);
        (&mut reader)
            .take(self.bytes.len() as u64 + 1)
            .read_to_end(&mut current)?;
        if current != self.bytes {
            return Err(store("MCP journal changed outside its producer"));
        }
        Ok(())
    }
}

impl CommunicationJournal {
    pub fn open(
        directory: &Path,
        epoch: &str,
        workspace_id: &str,
        terminal_ids: [String; 2],
        features: impl Fn() -> Result<Vec<WorkspaceFeature>> + Send + Sync + 'static,
    ) -> Result<Arc<Self>> {
        if !is_uuid(epoch) || !terminal_ids.iter().all(|id| is_uuid(id)) {
            return Err(store("Invalid MCP journal identity"));
        }
        if terminal_ids[0] == terminal_ids[1] {
            return Err(store("Ambiguous MCP terminals"));
        }
        terminal_directory(directory, true)?;
        let root = directory.join("mcp-communication");
        private_mkdir(&root)?;
        terminal_directory(&root, true)?;
        let file = root.join(format!("{epoch}.jsonl"));
        let created = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW)
            .open(&file)?;
        let identity = created.metadata()?;
        created.sync_all()?;
        drop(created);
        fsync_dir(&root)?;
        Ok(Arc::new(Self {
            inner: Arc::new(Mutex::new(Inner {
                root,
                file,
                ino: identity.ino(),
                dev: identity.dev(),
                bytes: Vec::new(),
                records: Vec::new(),
                available: true,
            })),
            epoch: epoch.to_owned(),
            workspace_id: workspace_id.to_owned(),
            terminal_ids,
            features: Arc::new(Box::new(features)),
        }))
    }

    fn scope(&self) -> Result<Option<WorkspaceFeature>> {
        let features = (self.features)()?;
        let owners: Vec<WorkspaceFeature> = features
            .into_iter()
            .filter(|f| {
                self.terminal_ids
                    .iter()
                    .any(|id| f.terminal_ids.contains(id))
            })
            .collect();
        Ok(match owners.as_slice() {
            [feature]
                if feature.workspace_id == self.workspace_id
                    && feature.status != FeatureStatus::Archived
                    && self
                        .terminal_ids
                        .iter()
                        .all(|id| feature.terminal_ids.contains(id)) =>
            {
                Some(feature.clone())
            }
            _ => None,
        })
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(|p| p.into_inner())
    }

    pub fn bind(
        self: &Arc<Self>,
        source_instance_id: &str,
        target_instance_id: &str,
    ) -> Option<Binding> {
        let attempt = || -> Result<Option<Binding>> {
            self.lock().check()?;
            if !is_uuid(source_instance_id) || !is_uuid(target_instance_id) {
                return Err(store("Invalid instance"));
            }
            let feature = self.scope()?;
            if !self.lock().available {
                return Ok(None);
            }
            Ok(feature.map(|f| Binding {
                journal: self.clone(),
                source: source_instance_id.to_owned(),
                target: target_instance_id.to_owned(),
                feature_id: f.feature_id,
                revision: f.revision,
            }))
        };
        attempt().unwrap_or_else(|_| {
            self.lock().available = false;
            None
        })
    }

    /// `communicationProjection` reply JSON, or `None` (Node `undefined`) when unavailable.
    pub fn project(&self, feature_id: Option<&str>) -> Option<String> {
        let attempt = || -> Result<String> {
            if !self.lock().available {
                return Err(store("unavailable"));
            }
            self.lock().check()?;
            let feature = self.scope()?;
            let inner = self.lock();
            #[derive(Serialize)]
            struct Event<'a> {
                id: &'a str,
                from: &'a str,
                to: &'a str,
                kind: &'a str,
                at: u64,
            }
            let events: Vec<Event> = match &feature {
                Some(f) if Some(f.feature_id.as_str()) == feature_id => {
                    let matching: Vec<&Record> = inner
                        .records
                        .iter()
                        .filter(|r| Some(r.feature_id.as_str()) == feature_id)
                        .collect();
                    matching[matching.len().saturating_sub(50)..]
                        .iter()
                        .map(|r| Event {
                            id: &r.id,
                            from: &r.from,
                            to: &r.to,
                            kind: r.kind,
                            at: r.at,
                        })
                        .collect()
                }
                _ => Vec::new(),
            };
            Ok(format!(
                r#"{{"events":{}}}"#,
                serde_json::to_string(&events).map_err(|_| store("json"))?
            ))
        };
        attempt().map_err(|_| self.lock().available = false).ok()
    }
}

impl Binding {
    pub fn record(&self, event: &McpTaskEvidence) {
        let journal = &self.journal;
        let attempt = || -> Result<()> {
            if !journal.lock().available {
                return Ok(());
            }
            journal.lock().check()?;
            let current = journal.scope()?;
            if !current
                .is_some_and(|c| c.feature_id == self.feature_id && c.revision == self.revision)
                || event.source_instance_id != self.source
                || event.target_instance_id != self.target
            {
                return Ok(());
            }
            let delegation = event.kind == "delegation";
            if !delegation && event.kind != "result" {
                return Err(store("Invalid MCP evidence kind"));
            }
            for id in [&event.grant_id, &event.task_id] {
                if !is_uuid(id) {
                    return Err(store("Invalid MCP evidence"));
                }
            }
            let record = Record {
                version: 1,
                epoch: journal.epoch.clone(),
                workspace_id: journal.workspace_id.clone(),
                feature_id: self.feature_id.clone(),
                feature_revision: self.revision,
                id: mcp_id(&journal.epoch, &event.grant_id, &event.task_id, event.kind),
                from: journal.terminal_ids[if delegation { 0 } else { 1 }].clone(),
                to: journal.terminal_ids[if delegation { 1 } else { 0 }].clone(),
                source_instance_id: event.source_instance_id.clone(),
                target_instance_id: event.target_instance_id.clone(),
                grant_id: event.grant_id.clone(),
                task_id: event.task_id.clone(),
                kind: event.kind,
                at: event.at,
            };
            if record.workspace_id.is_empty()
                || record.workspace_id.chars().count() > 128
                || record.feature_revision == 0
            {
                return Err(store("Invalid MCP record"));
            }
            let mut inner = journal.lock();
            let prior = inner
                .records
                .iter()
                .find(|p| p.grant_id == record.grant_id && p.kind == "delegation");
            if inner.records.iter().any(|p| p.id == record.id)
                || (record.kind == "result"
                    && !prior.is_some_and(|d| {
                        d.task_id == record.task_id
                            && d.source_instance_id == self.source
                            && d.target_instance_id == self.target
                            && d.feature_id == record.feature_id
                    }))
            {
                return Ok(());
            }
            if inner.records.len() >= 32 {
                return Err(store("MCP pair audit capacity"));
            }
            let mut line = serde_json::to_vec(&record).map_err(|_| store("json"))?;
            line.push(b'\n');
            if inner.bytes.len() + line.len() > 64 * 1024 {
                return Err(store("MCP audit byte budget"));
            }
            let mut writer = fs::OpenOptions::new()
                .append(true)
                .custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK)
                .open(&inner.file)?;
            inner.inspect(&writer)?;
            writer.write_all(&line)?;
            writer.sync_all()?;
            inner.bytes.extend_from_slice(&line);
            inner.records.push(record);
            Ok(())
        };
        if attempt().is_err() {
            journal.lock().available = false;
        }
    }
}
