//! The Core event loop, a port of the `process.on('message')` handler in `host.ts`.
//! One thread owns every supervisor; PTY threads and the IPC reader only deliver events.
use crate::backend::Delivery;
use crate::ipc::{spawn_reader, Channel, Inbound};
use crate::pair::Pair;
use crate::rpc;
use serde_json::{json, Value};
use std::sync::mpsc::{channel, Receiver, RecvTimeoutError, Sender};
use std::time::Duration;

type R<T> = Result<T, String>;

pub enum CoreEvent {
    Ipc(Inbound),
    Backend(Delivery),
}

/// Pair-RPC kinds owned by other modules (features, hub, enrollment, preserved exits).
/// Return `None` for a kind it does not own.
pub trait Extensions {
    fn handle(&mut self, kind: &str, request: &Value, pair: &mut Pair, draining: bool) -> Option<R<Option<Value>>>;
    /// Called on disconnect and on retirement (close hub endpoints, journals).
    fn close(&mut self) {}
    /// `closeSlot` side effects (MCP invalidation). The hub inbox survives.
    fn slot_closed(&mut self, _slot: usize) {}
}

pub struct NoExtensions;
impl Extensions for NoExtensions {
    fn handle(&mut self, _: &str, _: &Value, _: &mut Pair, _: bool) -> Option<R<Option<Value>>> {
        None
    }
}

pub struct Startup {
    pub ready: Value,
    pub pair: Pair,
    /// OpenCode (manifest version 3) blocks retirement: descendant exit is unvalidated.
    pub opencode: bool,
}

/// Terminal operations still allowed while the owned shutdown drains.
const DRAIN_TERMINAL: [&str; 6] = ["snapshot", "read", "requestStop", "stop", "revokeInput", "detach"];
const DRAIN_KINDS: [&str; 4] = ["beginOwnedShutdown", "preserveOwnedShutdown", "prepareRetire", "retire"];

pub fn events() -> (Sender<CoreEvent>, Receiver<CoreEvent>) {
    channel()
}

fn uuid_field(request: &Value, key: &str) -> bool {
    request.get(key).is_some_and(rpc::is_uuid)
}

pub struct Core {
    pair: Pair,
    extensions: Box<dyn Extensions>,
    draining: bool,
    closed: bool,
    opencode: bool,
}

impl Core {
    pub fn new(startup: Startup, extensions: Box<dyn Extensions>) -> Core {
        Core { pair: startup.pair, extensions, draining: false, closed: false, opencode: startup.opencode }
    }

    fn shutdown(&mut self) {
        if self.closed {
            return;
        }
        self.closed = true;
        self.pair.close();
        self.extensions.close();
    }

    /// One inbound pair-RPC. Returns the reply, or `None` when the message is invalid
    /// (the caller then shuts down, like `safeParse` failure in host.ts).
    pub fn handle(&mut self, raw: &Value) -> Option<Value> {
        let kind = raw.get("kind")?.as_str()?.to_owned();
        let (id, terminal) = if kind == "terminal" {
            let object = raw.as_object()?;
            let slot = raw.get("slot")?.as_u64().filter(|s| *s < 8)? as usize;
            if object.len() != 3 {
                return None;
            }
            let request = rpc::parse(raw.get("request")?)?;
            (request.id.clone(), Some((slot, request)))
        } else {
            if !uuid_field(raw, "id") {
                return None;
            }
            (raw["id"].as_str()?.to_owned(), None)
        };
        let result = self.dispatch(&kind, raw, terminal);
        Some(match result {
            Some(Ok(value)) => json!({"id": id, "ok": true, "value": value.unwrap_or(Value::Null)}),
            Some(Err(_)) => json!({"id": id, "ok": false}),
            None => return None,
        })
    }

    fn dispatch(&mut self, kind: &str, raw: &Value, terminal: Option<(usize, rpc::Request)>) -> Option<R<Option<Value>>> {
        if self.draining
            && !DRAIN_KINDS.contains(&kind)
            && !terminal.as_ref().is_some_and(|(_, r)| DRAIN_TERMINAL.contains(&r.operation.as_str()))
        {
            return Some(Err("Owned Core shutdown in progress".into()));
        }
        let exact = |keys: &[&str]| raw.as_object().is_some_and(|o| o.len() == keys.len() && keys.iter().all(|k| o.contains_key(*k)));
        match kind {
            "terminal" => {
                let (slot, request) = terminal?;
                Some(self.pair.dispatch(slot, &request))
            }
            "closeSlot" => {
                let slot = raw.get("slot")?.as_u64().filter(|s| *s < 8)? as usize;
                if !exact(&["kind", "id", "slot"]) {
                    return None;
                }
                self.extensions.slot_closed(slot);
                self.pair.close_slot(slot);
                Some(Ok(None))
            }
            "beginOwnedShutdown" => {
                if !exact(&["kind", "id"]) {
                    return None;
                }
                self.draining = true;
                // A preserved pending exit (extensions) answers first when present.
                if let Some(result) = self.extensions.handle(kind, raw, &mut self.pair, true) {
                    return Some(result);
                }
                Some(self.pair.owned_shutdown_inventory().map(Some))
            }
            "prepareRetire" => {
                if !exact(&["kind", "id"]) {
                    return None;
                }
                if self.opencode {
                    return Some(Err("OpenCode descendant exit unvalidated; capacity remains reserved".into()));
                }
                Some(self.pair.prepare_retire().map(Some))
            }
            "retire" => {
                if !exact(&["kind", "id", "proof"]) {
                    return None;
                }
                if self.opencode {
                    return Some(Err("OpenCode descendant exit unvalidated; capacity remains reserved".into()));
                }
                let result = self.pair.retire(&raw["proof"]).map(|_| None);
                if result.is_ok() {
                    self.extensions.close();
                }
                Some(result)
            }
            _ => self.extensions.handle(kind, raw, &mut self.pair, self.draining),
        }
    }

    pub fn backend(&mut self, delivery: Delivery) {
        if let Some(supervisor) = self.pair.supervisor_mut(delivery.slot) {
            supervisor.event(&delivery.instance, delivery.event);
        }
    }

    pub fn tick(&mut self) {
        for slot in 0..self.pair.len() {
            if let Some(supervisor) = self.pair.supervisor_mut(slot) {
                supervisor.tick();
            }
        }
    }

    /// Runs until the host disconnects. Sends `ready` first.
    pub fn run(mut self, mut channel: Channel, reader: std::fs::File, ready: &Value, sender: Sender<CoreEvent>, events: Receiver<CoreEvent>) {
        spawn_reader(reader, sender, CoreEvent::Ipc);
        if channel.send(ready).is_err() {
            return self.shutdown();
        }
        loop {
            match events.recv_timeout(Duration::from_millis(250)) {
                Ok(CoreEvent::Ipc(Inbound::Message(value))) => match self.handle(&value) {
                    Some(reply) => {
                        if channel.send(&reply).is_err() {
                            break;
                        }
                    }
                    None => break,
                },
                Ok(CoreEvent::Ipc(Inbound::Closed)) => break,
                Ok(CoreEvent::Backend(delivery)) => self.backend(delivery),
                Err(RecvTimeoutError::Timeout) => {}
                Err(RecvTimeoutError::Disconnected) => break,
            }
            self.tick();
        }
        self.shutdown();
        channel.disconnect();
    }
}
