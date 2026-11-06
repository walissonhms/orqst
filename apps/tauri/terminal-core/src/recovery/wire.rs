//! Port of `apps/desktop/src/offline-recovery-wire.ts` (`AdministrativeReviewPipe`) for a
//! blocking helper: one owned pipe, one pending review, no queued/old ACK or inherited consent.
//! Waiting for an `answer` / `authorized` frame reads the next stdin line; any other frame, a
//! malformed frame or a timeout closes the pipe exactly where the TypeScript pipe closes.
use super::error::{fail, Result};
use super::js::{number, obj, s, stringify};
use super::schema::{self, strict};
use crate::authority::terminal_digest;
use serde_json::Value;

pub const ADMIN_REVIEW_BYTES: usize = 64 * 1024;
pub const ADMIN_FRAME_BYTES: usize = 128 * 1024;
pub const ADMIN_SESSION_BYTES: usize = 512 * 1024;
pub const SESSION_MS: f64 = 300_000.0;
pub const AUTHORIZE_MS: f64 = 30_000.0;
pub const ACTIONS: [&str; 7] = [
    "install",
    "capture",
    "continueCapture",
    "release",
    "continueRelease",
    "finalize",
    "abort",
];

/// Inbound result while the pipe waits for a native frame.
pub enum Inbound {
    Frame(Value),
    /// EOF, deadline, budget, pipelining or malformed input: the helper closes.
    Closed,
}

/// The helper's stdin/stdout and monotonic clock (milliseconds, `performance.now()`).
pub trait Transport {
    fn send(&mut self, value: &Value);
    fn recv(&mut self, deadline: f64) -> Inbound;
    fn now(&self) -> f64;
    fn close(&mut self);
}

#[derive(Clone, Debug)]
struct Consent {
    id: String,
    nonce: String,
    digest: String,
    binding: String,
}

pub struct ReviewPipe<T: Transport> {
    pub session: String,
    pub transport: T,
    live: bool,
    session_deadline: f64,
    bytes: usize,
    signed_challenge: Option<String>,
    consent: Option<Consent>,
    uuid: Box<dyn FnMut() -> String>,
}

/// Unicode general category Cf (format controls), Unicode 16.
fn is_format(c: char) -> bool {
    matches!(c as u32,
        0x00AD | 0x0600..=0x0605 | 0x061C | 0x06DD | 0x070F | 0x0890..=0x0891 | 0x08E2 | 0x180E
        | 0x200B..=0x200F | 0x202A..=0x202E | 0x2060..=0x2064 | 0x2066..=0x206F | 0xFEFF
        | 0xFFF9..=0xFFFB | 0x110BD | 0x110CD | 0x13430..=0x1343F | 0x1BCA0..=0x1BCA3
        | 0x1D173..=0x1D17A | 0xE0001 | 0xE0020..=0xE007F)
}

/// `detail.replace(/\p{Cf}/gu, c => `\\u{${hex}}`)`.
pub fn escape_format(detail: &str) -> String {
    let mut out = String::with_capacity(detail.len());
    for c in detail.chars() {
        if is_format(c) {
            out.push_str(&format!("\\u{{{:x}}}", c as u32));
        } else {
            out.push(c);
        }
    }
    out
}

impl<T: Transport> ReviewPipe<T> {
    pub fn new(transport: T, mut uuid: Box<dyn FnMut() -> String>) -> Self {
        let session = uuid();
        let session_deadline = transport.now() + SESSION_MS;
        ReviewPipe {
            session,
            transport,
            live: true,
            session_deadline,
            bytes: 0,
            signed_challenge: None,
            consent: None,
            uuid,
        }
    }
    pub fn current(&self) -> bool {
        self.live
    }
    pub fn now(&self) -> f64 {
        self.transport.now()
    }
    pub fn close(&mut self) {
        self.live = false;
        self.consent = None;
        self.transport.close();
    }

    /// `review(action, detail, binding)`: resolves `false` on denial, close or deadline.
    pub fn review(&mut self, action: &str, detail: &str, binding: &str) -> Result<bool> {
        let detail = escape_format(detail);
        if !self.live || self.now() >= self.session_deadline || detail.len() > ADMIN_REVIEW_BYTES {
            return fail("Administrative review unavailable");
        }
        self.consent = None;
        self.signed_challenge = None;
        let id = (self.uuid)();
        let nonce = (self.uuid)();
        let digest = terminal_digest(
            stringify(&Value::Array(vec![
                s(&self.session),
                s(&id),
                s(&nonce),
                s(action),
                s(binding),
                s(&detail),
            ]))
            .as_bytes(),
        );
        let frame = obj([
            ("kind", s("review")),
            ("session", s(&self.session)),
            ("id", s(&id)),
            ("nonce", s(&nonce)),
            ("digest", s(&digest)),
            ("action", s(action)),
            ("binding", s(binding)),
            ("detail", s(&detail)),
        ]);
        let length = stringify(&frame).len();
        self.bytes += length + 1;
        if length > ADMIN_FRAME_BYTES || self.bytes > ADMIN_SESSION_BYTES {
            return fail("Administrative wire budget");
        }
        self.transport.send(&frame);
        let deadline = self.session_deadline;
        let value = match self.transport.recv(deadline) {
            Inbound::Frame(value) => value,
            Inbound::Closed => {
                self.close();
                return Ok(false);
            }
        };
        let valid = value.get("kind") == Some(&s("answer"))
            && (|| -> Result<bool> {
                let map = strict(
                    &value,
                    &["kind", "session", "id", "nonce", "digest", "approved"],
                )?;
                schema::uuid(map.get("session"), "session")?;
                schema::uuid(map.get("id"), "id")?;
                schema::uuid(map.get("nonce"), "nonce")?;
                schema::digest(map.get("digest"), "digest")?;
                map.get("approved")
                    .and_then(Value::as_bool)
                    .ok_or_else(|| super::error::invalid("approved"))?;
                Ok(map.get("session") == Some(&s(&self.session))
                    && map.get("id") == Some(&s(&id))
                    && map.get("nonce") == Some(&s(&nonce))
                    && map.get("digest") == Some(&s(&digest)))
            })()
            .unwrap_or(false);
        if !self.live || !valid {
            self.close();
            return Ok(false);
        }
        let accepted = value["approved"] == Value::Bool(true) && self.now() < self.session_deadline;
        if accepted {
            self.consent = Some(Consent {
                id,
                nonce,
                digest,
                binding: binding.to_owned(),
            });
        }
        Ok(accepted)
    }

    /// `authorize(binding, challenge, check)`: sign consumes permission once; check can only
    /// narrow the original native lease. Returns the native deadline or `None`.
    pub fn authorize(&mut self, binding: &str, challenge: &str, check: bool) -> Option<f64> {
        let consent = self.consent.clone();
        let Some(consent) = consent
            .filter(|c| self.live && self.now() < self.session_deadline && c.binding == binding)
        else {
            self.close();
            return None;
        };
        let mismatch = if check {
            self.signed_challenge.as_deref() != Some(challenge)
        } else {
            self.signed_challenge.is_some()
        };
        if mismatch {
            self.close();
            return None;
        }
        if !check {
            self.signed_challenge = Some(challenge.to_owned());
        }
        let request_nonce = (self.uuid)();
        let proof_digest = terminal_digest(
            stringify(&Value::Array(vec![
                s(&self.session),
                s(&consent.id),
                s(&consent.nonce),
                s(&consent.digest),
                s(binding),
                s(challenge),
                Value::Bool(check),
                s(&request_nonce),
            ]))
            .as_bytes(),
        );
        let frame = obj([
            ("kind", s("authorize")),
            ("session", s(&self.session)),
            ("id", s(&consent.id)),
            ("nonce", s(&consent.nonce)),
            ("digest", s(&consent.digest)),
            ("binding", s(&consent.binding)),
            ("challenge", s(challenge)),
            ("proofDigest", s(&proof_digest)),
            ("check", Value::Bool(check)),
            ("requestNonce", s(&request_nonce)),
        ]);
        let line = stringify(&frame);
        self.bytes += line.len() + 1;
        if line.len() > ADMIN_FRAME_BYTES || self.bytes > ADMIN_SESSION_BYTES {
            self.close();
            return None;
        }
        let sent_at = self.now();
        self.transport.send(&frame);
        let value = match self.transport.recv(sent_at + AUTHORIZE_MS) {
            Inbound::Frame(value) => value,
            Inbound::Closed => {
                self.close();
                return None;
            }
        };
        let remaining = (|| -> Result<Option<f64>> {
            if value.get("kind") != Some(&s("authorized")) {
                return Ok(None);
            }
            let map = strict(
                &value,
                &[
                    "kind",
                    "session",
                    "id",
                    "nonce",
                    "digest",
                    "requestNonce",
                    "proofDigest",
                    "remainingMs",
                ],
            )?;
            for key in ["session", "id", "nonce", "requestNonce"] {
                schema::uuid(map.get(key), key)?;
            }
            schema::digest(map.get("digest"), "digest")?;
            schema::digest(map.get("proofDigest"), "proofDigest")?;
            let remaining = schema::int(map.get("remainingMs"), "remainingMs", 0, 30_000)?;
            let ok = map.get("session") == Some(&s(&self.session))
                && map.get("id") == Some(&s(&consent.id))
                && map.get("nonce") == Some(&s(&consent.nonce))
                && map.get("digest") == Some(&s(&consent.digest))
                && map.get("requestNonce") == Some(&s(&request_nonce))
                && map.get("proofDigest") == Some(&s(&proof_digest));
            Ok(ok.then_some(remaining as f64))
        })()
        .ok()
        .flatten();
        let Some(remaining) = remaining.filter(|_| self.live) else {
            self.close();
            return None;
        };
        let deadline = self.session_deadline.min(sent_at + remaining);
        (self.now() < deadline).then_some(deadline)
    }

    /// An unsolicited `answer` / `authorized` frame with nothing pending closes the pipe.
    pub fn unsolicited(&mut self) {
        self.close();
    }
}

pub fn ready_frame(session: &str) -> Value {
    obj([
        ("kind", s("ready")),
        ("version", number(2.0)),
        ("session", s(session)),
    ])
}
