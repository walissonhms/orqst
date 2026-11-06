//! Port of `apps/desktop/src/offline-recovery-anchor.ts`: the native-owned administrative
//! Ed25519 trust anchor in AppData. A failed/partial installation is preserved, never repaired,
//! rotated or adopted. Keys use the exact Node PEM encodings (SPKI / PKCS#8 v1).
use super::error::{fail, invalid, Result};
use super::fsio::{
    self, join, read_recovery_file, sync_recovery_directory, tdir, write_recovery_file, FileRecord,
    Sync,
};
use super::intent::{base64url_lenient, signature_field};
use super::js::{number, obj, parse, pretty, s, stringify};
use super::schema::{self, strict};
use crate::authority::{ed25519_spki, terminal_digest};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use ed25519_dalek::{Signature, Signer, SigningKey, Verifier, VerifyingKey};
use serde_json::Value;
use std::os::unix::fs::MetadataExt;

const SPKI_PREFIX: [u8; 12] = [
    0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
];
const PKCS8_PREFIX: [u8; 16] = [
    0x30, 0x2e, 0x02, 0x01, 0x00, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x04, 0x22, 0x04, 0x20,
];

pub struct Locations {
    pub root: String,
    pub anchor: String,
    pub bundles: String,
    pub admission: String,
}

/// `recoveryLocations(parent)`.
pub fn recovery_locations(parent: &str) -> Result<Locations> {
    tdir(parent, true)?;
    let root = join(parent, "administrative-recovery");
    Ok(Locations {
        anchor: join(&root, "anchor"),
        bundles: join(&root, "bundles"),
        admission: join(parent, "managed-agents"),
        root,
    })
}

pub fn spki_der(key: &VerifyingKey) -> Vec<u8> {
    let mut der = SPKI_PREFIX.to_vec();
    der.extend_from_slice(key.as_bytes());
    der
}

fn pem(label: &str, der: &[u8]) -> String {
    let body = STANDARD.encode(der);
    let lines: Vec<&str> = body
        .as_bytes()
        .chunks(64)
        .map(|c| std::str::from_utf8(c).unwrap_or_default())
        .collect();
    format!(
        "-----BEGIN {label}-----\n{}\n-----END {label}-----\n",
        lines.join("\n")
    )
}

pub fn public_pem(key: &VerifyingKey) -> String {
    pem("PUBLIC KEY", &spki_der(key))
}

pub fn private_pem(key: &SigningKey) -> String {
    let mut der = PKCS8_PREFIX.to_vec();
    der.extend_from_slice(&key.to_bytes());
    pem("PRIVATE KEY", &der)
}

fn pem_der(text: &str, label: &str) -> Result<Vec<u8>> {
    let begin = format!("-----BEGIN {label}-----");
    let end = format!("-----END {label}-----");
    let body = text
        .trim()
        .strip_prefix(&begin)
        .and_then(|rest| rest.strip_suffix(&end))
        .ok_or_else(|| invalid("pem"))?;
    let compact: String = body.chars().filter(|c| !c.is_whitespace()).collect();
    STANDARD.decode(compact).map_err(|_| invalid("pem"))
}

/// `createPublicKey(pem)` restricted to Ed25519 SPKI.
pub fn parse_public_pem(text: &str) -> Result<VerifyingKey> {
    ed25519_spki(&pem_der(text, "PUBLIC KEY")?).map_err(|_| invalid("public key"))
}

/// `createPrivateKey(pem)` restricted to Ed25519 PKCS#8 v1 (the Node export format).
pub fn parse_private_pem(text: &str) -> Result<SigningKey> {
    let der = pem_der(text, "PRIVATE KEY")?;
    if der.len() != 48 || der[..16] != PKCS8_PREFIX {
        return Err(invalid("private key"));
    }
    let mut seed = [0u8; 32];
    seed.copy_from_slice(&der[16..]);
    Ok(SigningKey::from_bytes(&seed))
}

pub fn generate_key() -> SigningKey {
    let mut seed = [0u8; 32];
    // SAFETY: arc4random_buf fills the owned buffer and cannot fail.
    unsafe { libc::arc4random_buf(seed.as_mut_ptr().cast(), seed.len()) };
    SigningKey::from_bytes(&seed)
}

pub struct Anchor {
    pub public_key: VerifyingKey,
    pub private_key: SigningKey,
    pub installation: Value,
    pub source: FileRecord,
}

fn installation(value: &Value) -> Result<Value> {
    let map = strict(
        value,
        &[
            "domain",
            "version",
            "id",
            "directory",
            "fingerprint",
            "nonce",
            "expiresAt",
        ],
    )?;
    schema::literal_str(
        map.get("domain"),
        "orqst.administrative-anchor-installation",
        "domain",
    )?;
    schema::literal_number(map.get("version"), 1.0, "version")?;
    let expires = map
        .get("expiresAt")
        .and_then(Value::as_f64)
        .filter(|v| v.is_finite())
        .ok_or_else(|| invalid("expiresAt"))?;
    Ok(obj([
        ("domain", s("orqst.administrative-anchor-installation")),
        ("version", number(1.0)),
        ("id", s(&schema::uuid(map.get("id"), "id")?)),
        (
            "directory",
            s(&schema::abs_path(map.get("directory"), "directory")?),
        ),
        (
            "fingerprint",
            s(&schema::digest(map.get("fingerprint"), "fingerprint")?),
        ),
        ("nonce", s(&schema::uuid(map.get("nonce"), "nonce")?)),
        ("expiresAt", number(expires)),
    ]))
}

fn key_text(value: Option<&Value>, name: &str) -> Result<String> {
    let text = schema::string(value, name)?;
    let length = crate::admission::json::utf16_len(&text);
    if !(1..=1024).contains(&length) {
        return Err(invalid(name.to_owned()));
    }
    Ok(text)
}

/// `loadAdministrativeAnchor(parent)`.
pub fn load_administrative_anchor(parent: &str) -> Result<Anchor> {
    let paths = recovery_locations(parent)?;
    tdir(&paths.root, true)?;
    tdir(&paths.anchor, true)?;
    if std::fs::symlink_metadata(&paths.anchor)?.mode() & 0o777 != 0o700 {
        return fail("Administrative anchor directory mode");
    }
    let source = read_recovery_file(&join(&paths.anchor, "identity.json"), 8192)?;
    if source.identity[3].parse::<u64>().unwrap_or(0) & 0o777 != 0o600 {
        return fail("Administrative anchor file mode");
    }
    let envelope = parse(&source.raw())?;
    let map = strict(
        &envelope,
        &["installation", "publicKey", "privateKey", "signature"],
    )?;
    let installation = installation(
        map.get("installation")
            .ok_or_else(|| invalid("installation"))?,
    )?;
    let public_text = key_text(map.get("publicKey"), "publicKey")?;
    let private_text = key_text(map.get("privateKey"), "privateKey")?;
    let signature = signature_field(map.get("signature"))?;
    let private_key = parse_private_pem(&private_text)?;
    let public_key = parse_public_pem(&public_text)?;
    let raw = base64url_lenient(&signature);
    let verified = Signature::from_slice(&raw)
        .map(|sig| {
            public_key
                .verify(stringify(&installation).as_bytes(), &sig)
                .is_ok()
        })
        .unwrap_or(false);
    if private_key.verifying_key() != public_key
        || installation["directory"].as_str() != Some(paths.anchor.as_str())
        || Some(terminal_digest(&spki_der(&public_key)).as_str())
            != installation["fingerprint"].as_str()
        || !verified
    {
        return fail("Untrusted administrative anchor");
    }
    Ok(Anchor {
        public_key,
        private_key,
        installation,
        source,
    })
}

/// `assertAdministrativeAnchor(parent, expected)`.
pub fn assert_administrative_anchor(parent: &str, expected: &Anchor) -> Result<()> {
    let current = load_administrative_anchor(parent)?;
    if current.source.bytes != expected.source.bytes
        || current.source.identity != expected.source.identity
    {
        return fail("Administrative anchor changed");
    }
    Ok(())
}

fn private_directory(path: &str, sync: &Sync) -> Result<()> {
    match fsio::mkdir_private(path) {
        Ok(()) => {}
        Err(super::error::RecoveryError::Io(error))
            if error.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(error) => return Err(error),
    }
    tdir(path, true)?;
    sync_recovery_directory(path, sync)
}

/// Callbacks of `installAdministrativeAnchor`.
pub trait InstallPorts {
    fn review(&mut self, detail: &str, binding: &str) -> Result<bool>;
    fn current(&self) -> bool;
    fn authorize(&mut self, challenge: &str, binding: &str, check: bool) -> Option<f64>;
    fn now(&self) -> f64;
    fn uuid(&mut self) -> String;
}

/// `installAdministrativeAnchor(parent, review, current, authorize, now)`.
pub fn install_administrative_anchor(
    parent: &str,
    ports: &mut dyn InstallPorts,
    sync: &Sync,
) -> Result<Value> {
    let paths = recovery_locations(parent)?;
    match std::fs::symlink_metadata(&paths.anchor) {
        Ok(_) => return fail("Administrative anchor already exists; preserve it"),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(error.into()),
    }
    let keys = generate_key();
    let public = keys.verifying_key();
    let id = ports.uuid();
    let intent = obj([
        ("domain", s("orqst.administrative-anchor-installation")),
        ("version", number(1.0)),
        ("id", s(&id)),
        ("directory", s(&paths.anchor)),
        ("fingerprint", s(&terminal_digest(&spki_der(&public)))),
    ]);
    let detail = pretty(&intent);
    let fingerprint = terminal_digest(
        stringify(&Value::Array(vec![
            s("orqst.administrative-anchor-intent"),
            number(1.0),
            intent["domain"].clone(),
            intent["version"].clone(),
            intent["id"].clone(),
            intent["directory"].clone(),
            intent["fingerprint"].clone(),
            s(&detail),
        ]))
        .as_bytes(),
    );
    let binding = stringify(&obj([
        ("intent", intent.clone()),
        ("fingerprint", s(&fingerprint)),
    ]));
    let shown = pretty(&obj([
        ("intentFingerprint", s(&fingerprint)),
        ("review", intent.clone()),
    ]));
    if !ports.current() || !ports.review(&shown, &binding)? || !ports.current() {
        return fail("Administrative anchor installation denied");
    }
    let nonce = ports.uuid();
    let mut entries = intent.as_object().cloned().unwrap_or_default();
    entries.insert("nonce".into(), s(&nonce));
    entries.insert("expiresAt".into(), number(ports.now() + 30_000.0));
    let installation = installation(&Value::Object(entries))?;
    let challenge = stringify(&installation);
    let granted = ports.authorize(&challenge, &binding, false);
    let expires = installation["expiresAt"]
        .as_f64()
        .unwrap_or(f64::NEG_INFINITY);
    let mut deadline = expires.min(
        granted
            .filter(|g| g.is_finite())
            .unwrap_or(f64::NEG_INFINITY),
    );
    if !ports.current() || ports.now() >= deadline {
        return fail("Administrative anchor installation denied/expired");
    }
    let signature = URL_SAFE_NO_PAD.encode(keys.sign(challenge.as_bytes()).to_bytes());
    private_directory(&paths.root, sync)?;
    fsio::mkdir_private(&paths.anchor)?;
    sync_recovery_directory(&paths.root, sync)?;
    let checked = ports.authorize(&challenge, &binding, true);
    deadline = deadline.min(
        checked
            .filter(|g| g.is_finite())
            .unwrap_or(f64::NEG_INFINITY),
    );
    if !ports.current() || ports.now() >= deadline {
        return fail("Administrative anchor installation denied/expired");
    }
    write_recovery_file(
        &join(&paths.anchor, "identity.json"),
        stringify(&obj([
            ("installation", installation),
            ("publicKey", s(&public_pem(&public))),
            ("privateKey", s(&private_pem(&keys))),
            ("signature", s(&signature)),
        ]))
        .as_bytes(),
        sync,
    )?;
    private_directory(&paths.bundles, sync)?;
    sync_recovery_directory(parent, sync)?;
    Ok(load_administrative_anchor(parent)?.installation)
}
