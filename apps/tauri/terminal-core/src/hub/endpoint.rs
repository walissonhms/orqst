//! Port of `openHubEndpoint` (`mcp-hub-socket.ts`): one private Unix endpoint per terminal
//! slot. Same rules as the pair transport: 0700 directory from `mkdtemp`, 0600 socket and
//! capability file (43-char base64url secret), sha256 + constant-time comparison, one
//! authenticated connection per endpoint lifetime, 2 s to authenticate, at most 16 attempts,
//! one call at a time. The unchanged Node relay (`mcp-relay.ts`, `connectMcpInstance`) is
//! the client.
use std::ffi::{CString, OsStr};
use std::fs;
use std::io::{ErrorKind, Read, Write};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};

use super::framing::LineReader;
use super::hub::{HubError, TerminalMessageHub};
use crate::features::model::is_uuid;
use crate::features::store::terminal_directory;

/// Instructive refusal text for the agent (Anywh roomManager.ts:1334-1336 style).
pub fn refusal_text(code: &str) -> &'static str {
    match code {
        "unknown_terminal" => {
            "No such terminal in your Feature. Use list_terminals; other Features and yourself are not reachable."
        }
        "inbox_full" => "That terminal has too many unread messages. Try later.",
        "rate_limited" => "Too many messages this minute. Wait before sending more.",
        "chain_too_deep" => "This conversation chain reached its limit of three hops. Report back to the owner instead.",
        "unknown_task" => "No such task for you.",
        "already_submitted" => "This task already has a result.",
        "too_many_tasks" => "Too many open tasks. Finish some first.",
        "not_member" => "This terminal is not active in ORQST.",
        "unavailable" => "ORQST messaging is unavailable right now.",
        _ => "Refused.",
    }
}

/// The bound terminal id, or a lookup for endpoints opened ahead for slots that enroll later.
#[derive(Clone)]
pub enum TerminalBinding {
    Fixed(String),
    Lookup(Arc<dyn Fn() -> Option<String> + Send + Sync>),
}

impl TerminalBinding {
    fn current(&self) -> Option<String> {
        match self {
            Self::Fixed(id) => Some(id.clone()),
            Self::Lookup(lookup) => lookup(),
        }
    }
}

fn sha(secret: &[u8]) -> [u8; 32] {
    Sha256::digest(secret).into()
}

/// `crypto.timingSafeEqual` over equal-length digests.
pub fn timing_safe_equal(a: &[u8; 32], b: &[u8; 32]) -> bool {
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b) {
        diff |= x ^ y;
    }
    // Keep the comparison from being short-circuited by the optimizer.
    std::hint::black_box(diff) == 0
}

/// `/^[A-Za-z0-9_-]{43}$/`
pub fn is_secret(value: &str) -> bool {
    value.len() == 43
        && value
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
}

fn random_bytes<const N: usize>() -> std::io::Result<[u8; N]> {
    let mut bytes = [0u8; N];
    // SAFETY: valid buffer of N <= 256 bytes.
    if unsafe { libc::getentropy(bytes.as_mut_ptr().cast(), N) } != 0 {
        return Err(std::io::Error::last_os_error());
    }
    Ok(bytes)
}

fn mkdtemp(parent: &Path, prefix: &str) -> std::io::Result<PathBuf> {
    let template = parent.join(format!("{prefix}XXXXXX"));
    let c = CString::new(template.as_os_str().as_bytes()).map_err(|_| ErrorKind::InvalidInput)?;
    let raw = c.into_raw();
    // SAFETY: `raw` is a writable NUL-terminated template owned until from_raw below.
    let result = unsafe { libc::mkdtemp(raw) };
    // SAFETY: reclaims the pointer produced by into_raw.
    let owned = unsafe { CString::from_raw(raw) };
    if result.is_null() {
        return Err(std::io::Error::last_os_error());
    }
    Ok(PathBuf::from(OsStr::from_bytes(owned.as_bytes())))
}

#[derive(Serialize)]
struct Reply<'a, T: Serialize> {
    id: &'a str,
    ok: bool,
    value: T,
}
#[derive(Serialize)]
struct Denied<'a> {
    id: &'a str,
    ok: bool,
}
#[derive(Serialize)]
struct Refusal<'a> {
    refused: &'a str,
    message: &'a str,
}

struct Shared {
    closed: AtomicBool,
    claimed: AtomicBool,
    attempts: AtomicU32,
    active: AtomicU32,
    sockets: Mutex<Vec<UnixStream>>,
}

pub struct HubEndpoint {
    pub socket_path: PathBuf,
    pub capability_file: PathBuf,
    directory: PathBuf,
    shared: Arc<Shared>,
    accept: Option<JoinHandle<()>>,
}

/// Opens one endpoint under `parent` (Node default `/tmp`).
pub fn open_hub_endpoint(
    hub: Arc<TerminalMessageHub>,
    terminal: TerminalBinding,
    parent: &Path,
) -> Result<HubEndpoint, crate::features::FeatureError> {
    use crate::features::error::store;
    if let TerminalBinding::Fixed(id) = &terminal {
        if !is_uuid(id) {
            return Err(store("Invalid hub terminal"));
        }
    }
    let directory = fs::canonicalize(mkdtemp(&fs::canonicalize(parent)?, "orqst-hub-")?)?;
    fs::set_permissions(&directory, fs::Permissions::from_mode(0o700))?;
    let cleanup = |error: crate::features::FeatureError| {
        let _ = fs::remove_file(directory.join("terminal.sock"));
        let _ = fs::remove_file(directory.join("terminal.cap"));
        let _ = fs::remove_dir(&directory);
        error
    };
    terminal_directory(&directory, true).map_err(cleanup)?;
    let socket_path = directory.join("terminal.sock");
    if socket_path.as_os_str().len() > 100 {
        return Err(cleanup(store("Unix socket path too long")));
    }
    let capability_file = directory.join("terminal.cap");
    let secret = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .encode(random_bytes::<32>().map_err(|e| cleanup(e.into()))?);
    let expected = sha(secret.as_bytes());
    let written = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&capability_file)
        .and_then(|mut file| {
            file.write_all(secret.as_bytes())?;
            file.sync_all()
        });
    written.map_err(|e| cleanup(e.into()))?;
    let listener = UnixListener::bind(&socket_path).map_err(|e| cleanup(e.into()))?;
    fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600))
        .map_err(|e| cleanup(e.into()))?;
    let shared = Arc::new(Shared {
        closed: AtomicBool::new(false),
        claimed: AtomicBool::new(false),
        attempts: AtomicU32::new(0),
        active: AtomicU32::new(0),
        sockets: Mutex::new(Vec::new()),
    });
    let accept_shared = shared.clone();
    let accept = std::thread::Builder::new()
        .name("orqst-hub-endpoint".into())
        .spawn(move || {
            for stream in listener.incoming() {
                let shared = accept_shared.clone();
                if shared.closed.load(Ordering::SeqCst) {
                    break;
                }
                let Ok(stream) = stream else { continue };
                // `server.maxConnections = 2`, one claim, at most 16 attempts.
                if shared.claimed.load(Ordering::SeqCst)
                    || shared.attempts.fetch_add(1, Ordering::SeqCst) + 1 > 16
                    || shared.active.load(Ordering::SeqCst) >= 2
                {
                    let _ = stream.shutdown(std::net::Shutdown::Both);
                    continue;
                }
                if let Ok(clone) = stream.try_clone() {
                    shared
                        .sockets
                        .lock()
                        .unwrap_or_else(|p| p.into_inner())
                        .push(clone);
                }
                shared.active.fetch_add(1, Ordering::SeqCst);
                let (hub, terminal) = (hub.clone(), terminal.clone());
                let _ = std::thread::Builder::new()
                    .name("orqst-hub-connection".into())
                    .spawn(move || {
                        serve(stream, &shared, hub, terminal, expected);
                        shared.active.fetch_sub(1, Ordering::SeqCst);
                    });
            }
        })
        .map_err(|e| cleanup(e.into()))?;
    Ok(HubEndpoint {
        socket_path,
        capability_file,
        directory,
        shared,
        accept: Some(accept),
    })
}

fn serve(
    stream: UnixStream,
    shared: &Shared,
    hub: Arc<TerminalMessageHub>,
    terminal: TerminalBinding,
    expected: [u8; 32],
) {
    let destroyed = Arc::new(AtomicBool::new(false));
    let Ok(writer) = stream.try_clone() else {
        return;
    };
    let writer = Arc::new(Mutex::new(writer));
    let destroy = {
        let (destroyed, writer) = (destroyed.clone(), writer.clone());
        move || {
            destroyed.store(true, Ordering::SeqCst);
            if let Ok(w) = writer.lock() {
                let _ = w.shutdown(std::net::Shutdown::Both);
            }
        }
    };
    let deadline = Instant::now() + Duration::from_secs(2);
    let busy = Arc::new(AtomicBool::new(false));
    let mut authenticated = false;
    let mut reader = LineReader::default();
    let mut stream = stream;
    let mut buffer = vec![0u8; 65_536];
    loop {
        if destroyed.load(Ordering::SeqCst) || shared.closed.load(Ordering::SeqCst) {
            break;
        }
        if !authenticated {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() || stream.set_read_timeout(Some(left)).is_err() {
                break;
            }
        }
        let count = match stream.read(&mut buffer) {
            Ok(0) => {
                let _ = reader.end();
                break;
            }
            Ok(count) => count,
            Err(error) if error.kind() == ErrorKind::Interrupted => continue,
            Err(_) => break,
        };
        let fed = reader.feed(&buffer[..count], |raw| {
            if !authenticated {
                let secret = raw
                    .as_object()
                    .filter(|m| m.len() == 1)
                    .and_then(|m| m.get("secret"))
                    .and_then(Value::as_str)
                    .filter(|s| is_secret(s));
                let Some(secret) = secret else { return false };
                if !timing_safe_equal(&expected, &sha(secret.as_bytes()))
                    || shared
                        .claimed
                        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                        .is_err()
                {
                    return false;
                }
                authenticated = true;
                if stream.set_read_timeout(None).is_err() {
                    return false;
                }
                return write_line(
                    &writer,
                    &destroyed,
                    r#"{"authenticated":true,"role":"terminal"}"#.into(),
                );
            }
            let request = raw
                .as_object()
                .filter(|m| m.keys().all(|k| k == "id" || k == "call"));
            let id = request
                .and_then(|m| m.get("id"))
                .and_then(Value::as_str)
                .filter(|id| is_uuid(id));
            // One call at a time per terminal, like the CLI's own tool loop.
            let (Some(request), Some(id)) = (request, id) else {
                return false;
            };
            if busy.swap(true, Ordering::SeqCst) {
                return false;
            }
            let (id, call) = (
                id.to_owned(),
                request.get("call").cloned().unwrap_or(Value::Null),
            );
            let (hub, terminal, writer, destroyed, busy) = (
                hub.clone(),
                terminal.clone(),
                writer.clone(),
                destroyed.clone(),
                busy.clone(),
            );
            let spawned = std::thread::Builder::new()
                .name("orqst-hub-call".into())
                .spawn(move || {
                    let result = match terminal.current() {
                        Some(terminal_id) => hub.call(&terminal_id, &call),
                        None => Err(HubError::Refused("not_member")),
                    };
                    let line = match result {
                        Ok(value) => serde_json::to_string(&Reply {
                            id: &id,
                            ok: true,
                            value,
                        }),
                        Err(HubError::Refused(code)) => serde_json::to_string(&Reply {
                            id: &id,
                            ok: true,
                            value: Refusal {
                                refused: code,
                                message: refusal_text(code),
                            },
                        }),
                        Err(HubError::Failed) => {
                            serde_json::to_string(&Denied { id: &id, ok: false })
                        }
                    };
                    if let Ok(line) = line {
                        write_line(&writer, &destroyed, line);
                    }
                    busy.store(false, Ordering::SeqCst);
                });
            spawned.is_ok()
        });
        if fed.is_err() || destroyed.load(Ordering::SeqCst) {
            break;
        }
        // A consumer refusal marks the reader failed without an error.
        if reader.feed(&[], |_| true).is_err() {
            break;
        }
    }
    destroy();
}

fn write_line(writer: &Arc<Mutex<UnixStream>>, destroyed: &AtomicBool, mut line: String) -> bool {
    if destroyed.load(Ordering::SeqCst) {
        return false;
    }
    line.push('\n');
    let Ok(mut w) = writer.lock() else {
        return false;
    };
    w.write_all(line.as_bytes()).is_ok()
}

impl HubEndpoint {
    pub fn close(&mut self) {
        if self.shared.closed.swap(true, Ordering::SeqCst) {
            return;
        }
        for socket in self
            .shared
            .sockets
            .lock()
            .unwrap_or_else(|p| p.into_inner())
            .drain(..)
        {
            let _ = socket.shutdown(std::net::Shutdown::Both);
        }
        // Wake the accept loop so it observes `closed`.
        let _ = UnixStream::connect(&self.socket_path);
        if let Some(handle) = self.accept.take() {
            let _ = handle.join();
        }
        for file in [&self.socket_path, &self.capability_file] {
            let _ = fs::remove_file(file);
        }
        let _ = fs::remove_dir(&self.directory);
    }
}

impl Drop for HubEndpoint {
    fn drop(&mut self) {
        self.close();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::hub::hub::HubMember;

    #[test]
    fn wrong_secret_is_disconnected_and_claim_is_not_spent() {
        let hub = Arc::new(TerminalMessageHub::new(
            || Ok(Vec::<HubMember>::new()),
            |_| {},
        ));
        let parent = fs::canonicalize(std::env::temp_dir()).unwrap();
        let mut endpoint =
            open_hub_endpoint(hub, TerminalBinding::Lookup(Arc::new(|| None)), &parent).unwrap();
        let mut bad = UnixStream::connect(&endpoint.socket_path).unwrap();
        bad.write_all(format!("{{\"secret\":\"{}\"}}\n", "A".repeat(43)).as_bytes())
            .unwrap();
        let mut out = Vec::new();
        bad.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let _ = bad.read_to_end(&mut out);
        assert!(out.is_empty());
        // The real secret still authenticates; an unbound slot refuses calls as not_member.
        let secret = fs::read_to_string(&endpoint.capability_file).unwrap();
        let mut good = UnixStream::connect(&endpoint.socket_path).unwrap();
        good.write_all(format!("{{\"secret\":\"{secret}\"}}\n{{\"id\":\"00000000-0000-4000-8000-000000000001\",\"call\":{{\"name\":\"list_terminals\",\"arguments\":{{}}}}}}\n").as_bytes()).unwrap();
        good.set_read_timeout(Some(Duration::from_secs(3))).unwrap();
        let mut text = String::new();
        let mut buffer = [0u8; 1024];
        while text.matches('\n').count() < 2 {
            let n = good.read(&mut buffer).unwrap();
            assert!(n > 0);
            text.push_str(std::str::from_utf8(&buffer[..n]).unwrap());
        }
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines[0], r#"{"authenticated":true,"role":"terminal"}"#);
        assert_eq!(
            lines[1],
            r#"{"id":"00000000-0000-4000-8000-000000000001","ok":true,"value":{"refused":"not_member","message":"This terminal is not active in ORQST."}}"#
        );
        endpoint.close();
    }
}
