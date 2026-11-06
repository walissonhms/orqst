//! Administrative intent/challenge records of `offline-recovery.ts`: the fixed intent bytes, the
//! intent digest, the signed challenge tuple and the zod output orders of every serialization.
use super::error::{invalid, Result};
use super::js::{number, s, stringify};
use super::schema::{self, strict};
use crate::admission::json::{is_digest, is_uuid};
use crate::authority::terminal_digest;
use base64::alphabet::URL_SAFE;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde_json::{Map, Value};

pub const DOMAIN: &str = "orqst.administrative-recovery";
pub const PHASES: [&str; 4] = ["capture", "release", "finalize", "abort"];

/// `administrativeIntentSchema` (version 2).
#[derive(Clone, Debug, PartialEq)]
pub struct AdminIntent {
    pub operation_id: String,
    pub phase: String,
    pub owner: String,
    pub epoch: String,
    pub before_boot: String,
    pub current_boot: String,
    pub snapshot_digest: String,
    pub current_digest: String,
    pub directory: String,
    pub bundle: String,
}

impl AdminIntent {
    pub fn validate(&self) -> Result<()> {
        let ok = [
            &self.operation_id,
            &self.owner,
            &self.epoch,
            &self.before_boot,
            &self.current_boot,
        ]
        .iter()
        .all(|v| is_uuid(v))
            && PHASES.contains(&self.phase.as_str())
            && is_digest(&self.snapshot_digest)
            && is_digest(&self.current_digest)
            && self.directory.starts_with('/')
            && self.bundle.starts_with('/');
        if ok {
            Ok(())
        } else {
            Err(invalid("administrative intent"))
        }
    }
    fn entries(&self) -> Vec<(&'static str, Value)> {
        vec![
            ("domain", s(DOMAIN)),
            ("version", number(2.0)),
            ("operationId", s(&self.operation_id)),
            ("phase", s(&self.phase)),
            ("owner", s(&self.owner)),
            ("epoch", s(&self.epoch)),
            ("beforeBoot", s(&self.before_boot)),
            ("currentBoot", s(&self.current_boot)),
            ("snapshotDigest", s(&self.snapshot_digest)),
            ("currentDigest", s(&self.current_digest)),
            ("directory", s(&self.directory)),
            ("bundle", s(&self.bundle)),
        ]
    }
    pub fn to_value(&self) -> Value {
        let mut map = Map::new();
        for (k, v) in self.entries() {
            map.insert(k.into(), v);
        }
        Value::Object(map)
    }
    /// `administrativeIntentBytes(intent)`.
    pub fn bytes(&self) -> String {
        let mut items = vec![s("orqst.administrative-recovery-intent"), number(1.0)];
        items.extend(self.entries().into_iter().map(|(_, v)| v));
        stringify(&Value::Array(items))
    }
    /// `administrativeIntentDigest(intent, fullReview)`.
    pub fn digest(&self, full_review: &str) -> String {
        terminal_digest(stringify(&Value::Array(vec![s(&self.bytes()), s(full_review)])).as_bytes())
    }
}

/// `AdministrativeRecoveryChallenge`.
#[derive(Clone, Debug, PartialEq)]
pub struct Challenge {
    pub version: u8,
    pub intent_digest: Option<String>,
    pub nonce: String,
    pub expires_at: f64,
    pub intent: AdminIntent,
}

impl Challenge {
    /// `administrativeRecoveryIntent(challenge)`.
    pub fn admin_intent(&self) -> AdminIntent {
        self.intent.clone()
    }
    /// Creation order: `{ ...intent, phase, nonce, expiresAt, intentDigest }`.
    pub fn created(&self) -> Value {
        let mut map = Map::new();
        for (k, v) in self.intent.entries() {
            map.insert(k.into(), v);
        }
        map.insert("version".into(), number(self.version as f64));
        map.insert("nonce".into(), s(&self.nonce));
        map.insert("expiresAt".into(), number(self.expires_at));
        if let Some(digest) = &self.intent_digest {
            map.insert("intentDigest".into(), s(digest));
        }
        Value::Object(map)
    }
    /// zod `captureSchema.shape.challenge` output order.
    pub fn schema_order(&self) -> Value {
        let i = &self.intent;
        let mut map = Map::new();
        map.insert("domain".into(), s(DOMAIN));
        map.insert("version".into(), number(self.version as f64));
        if let Some(digest) = &self.intent_digest {
            map.insert("intentDigest".into(), s(digest));
        }
        map.insert("operationId".into(), s(&i.operation_id));
        map.insert("phase".into(), s(&i.phase));
        map.insert("nonce".into(), s(&self.nonce));
        map.insert("expiresAt".into(), number(self.expires_at));
        for (k, v) in [
            ("owner", &i.owner),
            ("epoch", &i.epoch),
            ("beforeBoot", &i.before_boot),
            ("currentBoot", &i.current_boot),
            ("snapshotDigest", &i.snapshot_digest),
            ("currentDigest", &i.current_digest),
            ("directory", &i.directory),
            ("bundle", &i.bundle),
        ] {
            map.insert(k.into(), s(v));
        }
        Value::Object(map)
    }
    /// `administrativeRecoveryBytes(challenge)`.
    pub fn bytes(&self) -> Result<Vec<u8>> {
        let valid = match self.version {
            2 => self.intent_digest.as_deref().is_some_and(is_digest),
            1 => self.intent_digest.is_none(),
            _ => false,
        };
        if !valid {
            return Err(super::error::RecoveryError::Failed(
                "Invalid administrative challenge version/binding".into(),
            ));
        }
        let i = &self.intent;
        let mut items = vec![
            s(DOMAIN),
            number(self.version as f64),
            s(&i.operation_id),
            s(&i.phase),
            s(&self.nonce),
            number(self.expires_at),
            s(&i.owner),
            s(&i.epoch),
            s(&i.before_boot),
            s(&i.current_boot),
            s(&i.snapshot_digest),
            s(&i.current_digest),
            s(&i.directory),
            s(&i.bundle),
        ];
        if self.version == 2 {
            items.push(s(self.intent_digest.as_deref().unwrap_or_default()));
        }
        Ok(stringify(&Value::Array(items)).into_bytes())
    }
    /// `captureSchema.shape.challenge` (optionally `.extend({ phase: z.literal(phase) })`).
    pub fn parse(value: &Value, phase: Option<&str>) -> Result<Challenge> {
        let map = strict(
            value,
            &[
                "domain",
                "version",
                "intentDigest",
                "operationId",
                "phase",
                "nonce",
                "expiresAt",
                "owner",
                "epoch",
                "beforeBoot",
                "currentBoot",
                "snapshotDigest",
                "currentDigest",
                "directory",
                "bundle",
            ],
        )?;
        schema::literal_str(map.get("domain"), DOMAIN, "domain")?;
        let version = match map.get("version").and_then(Value::as_f64) {
            Some(v) if v == 1.0 => 1,
            Some(v) if v == 2.0 => 2,
            _ => return Err(invalid("version")),
        };
        let intent_digest = match map.get("intentDigest") {
            None => None,
            some => Some(schema::digest(some, "intentDigest")?),
        };
        let phase_value = schema::string(map.get("phase"), "phase")?;
        if phase.map_or(!PHASES.contains(&phase_value.as_str()), |p| {
            p != phase_value
        }) {
            return Err(invalid("phase"));
        }
        let expires_at = map
            .get("expiresAt")
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite())
            .ok_or_else(|| invalid("expiresAt"))?;
        let path = |key: &str| -> Result<String> {
            let text = schema::string(map.get(key), key)?;
            if !text.starts_with('/') {
                return Err(invalid(key.to_owned()));
            }
            Ok(text)
        };
        Ok(Challenge {
            version,
            intent_digest,
            nonce: schema::uuid(map.get("nonce"), "nonce")?,
            expires_at,
            intent: AdminIntent {
                operation_id: schema::uuid(map.get("operationId"), "operationId")?,
                phase: phase_value,
                owner: schema::uuid(map.get("owner"), "owner")?,
                epoch: schema::uuid(map.get("epoch"), "epoch")?,
                before_boot: schema::uuid(map.get("beforeBoot"), "beforeBoot")?,
                current_boot: schema::uuid(map.get("currentBoot"), "currentBoot")?,
                snapshot_digest: schema::digest(map.get("snapshotDigest"), "snapshotDigest")?,
                current_digest: schema::digest(map.get("currentDigest"), "currentDigest")?,
                directory: path("directory")?,
                bundle: path("bundle")?,
            },
        })
    }
}

/// `/^[A-Za-z0-9_-]{86}$/`.
pub fn signature_shape(value: &str) -> bool {
    value.len() == 86
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

pub fn signature_field(value: Option<&Value>) -> Result<String> {
    let text = schema::string(value, "signature")?;
    if !signature_shape(&text) {
        return Err(invalid("signature"));
    }
    Ok(text)
}

/// Node `Buffer.from(signature, 'base64url')` (lenient trailing bits).
pub fn base64url_lenient(value: &str) -> Vec<u8> {
    let engine = GeneralPurpose::new(
        &URL_SAFE,
        GeneralPurposeConfig::new()
            .with_decode_allow_trailing_bits(true)
            .with_decode_padding_mode(DecodePaddingMode::Indifferent),
    );
    engine.decode(value).unwrap_or_default()
}

/// `verify(null, bytes, publicKey, Buffer.from(signature, 'base64url'))`.
pub fn verify(key: &VerifyingKey, challenge: &Challenge, signature: &str) -> Result<bool> {
    let bytes = challenge.bytes()?;
    let raw = base64url_lenient(signature);
    let Ok(signature) = Signature::from_slice(&raw) else {
        return Ok(false);
    };
    Ok(key.verify(&bytes, &signature).is_ok())
}
