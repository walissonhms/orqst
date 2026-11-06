//! Port of `authority.ts`. Native signer proofs over exact challenge bytes; consumed once.
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use base64::Engine;
use ed25519_dalek::{Signature, Verifier, VerifyingKey};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::HashMap;

pub const OPERATIONS: [&str; 7] = ["start", "attach", "input", "paste", "stop", "retire", "delegate"];

pub fn terminal_digest(value: &[u8]) -> String {
    let hash = Sha256::digest(value);
    hash.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn is_digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Binding {
    pub operation: String,
    pub target: String,
    pub digest: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Challenge {
    pub version: u8,
    pub epoch: String,
    pub client_id: String,
    pub challenge_id: String,
    pub expires_at: i64,
    pub operation: String,
    pub target: String,
    pub digest: String,
}

/// `terminalChallengeBytes`: JSON.stringify of the fixed tuple.
pub fn challenge_bytes(c: &Challenge) -> Vec<u8> {
    serde_json::to_vec(&serde_json::json!([
        "orqst.terminal",
        c.version,
        c.epoch,
        c.client_id,
        c.challenge_id,
        c.expires_at,
        c.operation,
        c.target,
        c.digest
    ]))
    .expect("challenge bytes")
}

/// Ed25519 SPKI DER (RFC 8410): fixed 12-byte prefix plus the 32-byte key.
pub fn ed25519_spki(der: &[u8]) -> Result<VerifyingKey, &'static str> {
    const PREFIX: [u8; 12] = [0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
    if der.len() != 44 || der[..12] != PREFIX {
        return Err("Invalid terminal client");
    }
    let key: [u8; 32] = der[12..].try_into().map_err(|_| "Invalid terminal client")?;
    VerifyingKey::from_bytes(&key).map_err(|_| "Invalid terminal client")
}

pub fn now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

pub struct Authority {
    pub epoch: String,
    clients: HashMap<String, VerifyingKey>,
    pending: HashMap<String, Challenge>,
    now: fn() -> i64,
}

impl Authority {
    pub fn new(clients: Vec<(String, VerifyingKey)>, now: fn() -> i64) -> Result<Self, &'static str> {
        if clients.len() > 8 {
            return Err("Terminal client limit exceeded");
        }
        let mut map = HashMap::new();
        for (id, key) in clients {
            if id.is_empty() || id.chars().count() > 128 {
                return Err("Invalid terminal client");
            }
            map.insert(id, key);
        }
        Ok(Self { epoch: uuid::Uuid::new_v4().to_string(), clients: map, pending: HashMap::new(), now })
    }

    pub fn now(&self) -> i64 {
        (self.now)()
    }

    pub fn is_enrolled(&self, client: &str) -> bool {
        self.clients.contains_key(client)
    }

    pub fn revoke(&mut self, client: &str) {
        self.clients.remove(client);
        self.pending.retain(|_, c| c.client_id != client);
    }

    pub fn prepare(&mut self, client: &str, binding: &Binding) -> Result<Challenge, &'static str> {
        if !self.is_enrolled(client) {
            return Err("Terminal client is not enrolled");
        }
        if !OPERATIONS.contains(&binding.operation.as_str())
            || binding.target.is_empty()
            || binding.target.chars().count() > 128
            || !is_digest(&binding.digest)
        {
            return Err("Invalid terminal binding");
        }
        let now = self.now();
        self.pending.retain(|_, c| c.expires_at > now);
        if self.pending.len() >= 128 {
            return Err("Terminal challenge limit exceeded");
        }
        let challenge = Challenge {
            version: 1,
            epoch: self.epoch.clone(),
            client_id: client.to_owned(),
            challenge_id: uuid::Uuid::new_v4().to_string(),
            expires_at: now + 30_000,
            operation: binding.operation.clone(),
            target: binding.target.clone(),
            digest: binding.digest.clone(),
        };
        self.pending.insert(challenge.challenge_id.clone(), challenge.clone());
        Ok(challenge)
    }

    /// Consumed before side effects. A failed operation never retries this proof.
    pub fn consume(&mut self, proof: &serde_json::Value, binding: &Binding) -> Result<String, &'static str> {
        let object = proof.as_object().ok_or("Invalid terminal proof")?;
        let (Some(id), Some(signature)) = (
            object.get("challengeId").and_then(|v| v.as_str()),
            object.get("signature").and_then(|v| v.as_str()),
        ) else {
            return Err("Invalid terminal proof");
        };
        if object.len() != 2
            || signature.len() != 86
            || !signature.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        {
            return Err("Invalid terminal proof");
        }
        let denied = "Terminal authorization denied";
        let challenge = self.pending.get(id).ok_or(denied)?;
        let key = self.clients.get(&challenge.client_id).ok_or(denied)?;
        let bytes = URL_SAFE_NO_PAD.decode(signature).map_err(|_| denied)?;
        let signature = Signature::from_slice(&bytes).map_err(|_| denied)?;
        if challenge.expires_at <= self.now()
            || challenge.operation != binding.operation
            || challenge.target != binding.target
            || challenge.digest != binding.digest
            || key.verify(&challenge_bytes(challenge), &signature).is_err()
        {
            return Err(denied);
        }
        let client = challenge.client_id.clone();
        self.pending.remove(id);
        Ok(client)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ed25519_dalek::{Signer, SigningKey};

    fn signer() -> SigningKey {
        SigningKey::from_bytes(&[7u8; 32])
    }
    fn binding() -> Binding {
        Binding { operation: "start".into(), target: "t".into(), digest: "a".repeat(64) }
    }

    #[test]
    fn challenge_bytes_match_json_stringify() {
        let c = Challenge {
            version: 1,
            epoch: "e".into(),
            client_id: "desktop-managed".into(),
            challenge_id: "c".into(),
            expires_at: 1793995936662,
            operation: "start".into(),
            target: "t".into(),
            digest: "d".into(),
        };
        assert_eq!(
            String::from_utf8(challenge_bytes(&c)).unwrap(),
            r#"["orqst.terminal",1,"e","desktop-managed","c",1793995936662,"start","t","d"]"#
        );
    }

    #[test]
    fn a_signed_proof_is_consumed_once_and_bound_to_its_operation() {
        let key = signer();
        let mut authority =
            Authority::new(vec![("desktop-managed".into(), key.verifying_key())], now_ms).unwrap();
        let challenge = authority.prepare("desktop-managed", &binding()).unwrap();
        let signature = URL_SAFE_NO_PAD.encode(key.sign(&challenge_bytes(&challenge)).to_bytes());
        let proof = serde_json::json!({"challengeId": challenge.challenge_id, "signature": signature});
        let other = Binding { operation: "stop".into(), ..binding() };
        assert!(authority.consume(&proof, &other).is_err());
        assert_eq!(authority.consume(&proof, &binding()).unwrap(), "desktop-managed");
        assert!(authority.consume(&proof, &binding()).is_err());
    }

    #[test]
    fn spki_parsing_accepts_only_ed25519() {
        let mut der = vec![0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00];
        der.extend_from_slice(signer().verifying_key().as_bytes());
        assert!(ed25519_spki(&der).is_ok());
        der[6] = 0;
        assert!(ed25519_spki(&der).is_err());
    }
}
