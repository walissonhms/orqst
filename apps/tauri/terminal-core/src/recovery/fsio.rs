//! Filesystem primitives of `offline-recovery-files.ts`: bounded private reads with identity
//! re-checks, exclusive durable writes and directory listings. Never follows a symlink.
use super::error::{fail, RecoveryError, Result};
use super::js::{obj, s, sort_js};
use crate::admission::fs::{terminal_directory, terminal_file};
use crate::authority::terminal_digest;
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::Value;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::fd::{AsRawFd, RawFd};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;
use std::rc::Rc;

pub const RECOVERY_LIMIT: usize = 64 * 1024 * 1024;
pub const OFFLINE_JOURNAL_BYTES: usize = 16 * 1024 * 1024;
pub const RECOVERY_GATE: &str = crate::admission::fs::RECOVERY_GATE;
pub const RECOVERY_LOCK: &str = crate::admission::fs::RECOVERY_LOCK;

/// Injected `fsyncSync` (fixtures may observe or fail durability boundaries).
pub type Sync = Rc<dyn Fn(RawFd) -> std::io::Result<()>>;

pub fn native_sync() -> Sync {
    Rc::new(|fd| {
        // SAFETY: the caller owns `fd` for the duration of the call.
        if unsafe { libc::fsync(fd) } != 0 {
            return Err(std::io::Error::last_os_error());
        }
        Ok(())
    })
}

pub fn dirname(path: &str) -> String {
    match Path::new(path).parent() {
        Some(parent) if !parent.as_os_str().is_empty() => parent.to_string_lossy().into_owned(),
        _ => "/".into(),
    }
}

pub fn join(directory: &str, name: &str) -> String {
    if directory.ends_with('/') {
        format!("{directory}{name}")
    } else {
        format!("{directory}/{name}")
    }
}

pub fn tdir(path: &str, private: bool) -> Result<()> {
    Ok(terminal_directory(Path::new(path), private)?)
}

fn uid() -> u32 {
    // SAFETY: getuid cannot fail.
    unsafe { libc::getuid() }
}

/// `directoryNames(directory)`: private canonical directory, at most 256 entries, JS-sorted.
pub fn directory_names(directory: &str) -> Result<Vec<String>> {
    tdir(directory, true)?;
    let mut names = Vec::new();
    for entry in fs::read_dir(directory)? {
        names.push(entry?.file_name().to_string_lossy().into_owned());
        if names.len() > 256 {
            return fail("Recovery directory entry budget");
        }
    }
    sort_js(&mut names);
    Ok(names)
}

/// `recoveryIdentity(file)`: bigint `lstat` dev/ino/size/mode/uid/mtimeNs/ctimeNs.
pub fn recovery_identity(file: &str) -> Result<Vec<String>> {
    let info = fs::symlink_metadata(file)?;
    if !info.file_type().is_file()
        || info.nlink() != 1
        || info.uid() != uid()
        || info.mode() & 0o077 != 0
    {
        return fail("Untrusted recovery file");
    }
    let ns = |sec: i64, nsec: i64| (sec as i128 * 1_000_000_000 + nsec as i128).to_string();
    Ok(vec![
        info.dev().to_string(),
        info.ino().to_string(),
        info.size().to_string(),
        info.mode().to_string(),
        info.uid().to_string(),
        ns(info.mtime(), info.mtime_nsec()),
        ns(info.ctime(), info.ctime_nsec()),
    ])
}

pub fn identity_value(identity: &[String]) -> Value {
    Value::Array(identity.iter().map(|v| s(v)).collect())
}

/// One `readRecoveryFile` record `{ path, identity, sha256, bytes }`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FileRecord {
    pub path: String,
    pub identity: Vec<String>,
    pub sha256: String,
    pub bytes: String,
}

impl FileRecord {
    pub fn to_value(&self) -> Value {
        obj([
            ("path", s(&self.path)),
            ("identity", identity_value(&self.identity)),
            ("sha256", s(&self.sha256)),
            ("bytes", s(&self.bytes)),
        ])
    }
    pub fn raw(&self) -> Vec<u8> {
        STANDARD.decode(&self.bytes).unwrap_or_default()
    }
    pub fn from_value(value: &Value) -> Result<FileRecord> {
        let map = super::schema::strict(value, &["path", "identity", "sha256", "bytes"])?;
        let path = super::schema::abs_path(map.get("path"), "path")?;
        let identity = super::schema::string_tuple(map.get("identity"), 7, "identity")?;
        let sha256 = super::schema::digest(map.get("sha256"), "sha256")?;
        let bytes = super::schema::string(map.get("bytes"), "bytes")?;
        if crate::admission::json::utf16_len(&bytes) > RECOVERY_LIMIT {
            return Err(super::error::invalid("bytes"));
        }
        Ok(FileRecord {
            path,
            identity,
            sha256,
            bytes,
        })
    }
}

/// `readRecoveryFile(file, limit)`.
pub fn read_recovery_file(file: &str, limit: usize) -> Result<FileRecord> {
    tdir(&dirname(file), true)?;
    let before = recovery_identity(file)?;
    let dev: u64 = before[0]
        .parse()
        .map_err(|_| RecoveryError::Failed("identity".into()))?;
    let ino: u64 = before[1]
        .parse()
        .map_err(|_| RecoveryError::Failed("identity".into()))?;
    let bytes = terminal_file(Path::new(file), true, limit, Some((dev, ino)))?;
    if before != recovery_identity(file)? {
        return fail("Recovery source changed during read");
    }
    Ok(FileRecord {
        path: file.to_owned(),
        identity: before,
        sha256: terminal_digest(&bytes),
        bytes: STANDARD.encode(&bytes),
    })
}

fn open_directory(directory: &str) -> Result<File> {
    Ok(OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(directory)?)
}

/// `syncRecoveryDirectory(directory, sync)`.
pub fn sync_recovery_directory(directory: &str, sync: &Sync) -> Result<()> {
    tdir(directory, true)?;
    let handle = open_directory(directory)?;
    sync(handle.as_raw_fd())?;
    Ok(())
}

/// `writeRecoveryFile(file, bytes, sync)`: `O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW`, 0600, fsync,
/// then the parent directory. A failed exclusive write is retained, never removed.
pub fn write_recovery_file(file: &str, bytes: &[u8], sync: &Sync) -> Result<()> {
    tdir(&dirname(file), true)?;
    if bytes.len() > RECOVERY_LIMIT {
        return fail("Recovery write budget");
    }
    let mut handle = OpenOptions::new()
        .write(true)
        .create_new(true)
        .custom_flags(libc::O_NOFOLLOW)
        .mode(0o600)
        .open(file)?;
    handle.write_all(bytes)?;
    sync(handle.as_raw_fd())?;
    drop(handle);
    sync_recovery_directory(&dirname(file), sync)
}

/// `syncRecoveryFile(file, sync)`.
pub fn sync_recovery_file(file: &str, sync: &Sync) -> Result<()> {
    let before = read_recovery_file(file, RECOVERY_LIMIT)?;
    let handle = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(file)?;
    let info = handle.metadata()?;
    if info.dev().to_string() != before.identity[0] || info.ino().to_string() != before.identity[1]
    {
        return fail("Recovery file changed before durability confirmation");
    }
    sync(handle.as_raw_fd())?;
    drop(handle);
    if read_recovery_file(file, RECOVERY_LIMIT)? != before {
        return fail("Recovery file changed during durability confirmation");
    }
    sync_recovery_directory(&dirname(file), sync)
}

/// `lstatSync` presence: `ENOENT` is absence, every other error propagates.
pub fn present(file: &str) -> Result<bool> {
    match fs::symlink_metadata(file) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(error.into()),
    }
}

/// `mkdtempSync(prefix)`: a new private directory `prefix` + 6 random characters.
pub fn mkdtemp(prefix: &str) -> Result<String> {
    let mut template = format!("{prefix}XXXXXX").into_bytes();
    template.push(0);
    // SAFETY: `template` is a writable NUL-terminated buffer owned for the call.
    let result = unsafe { libc::mkdtemp(template.as_mut_ptr().cast()) };
    if result.is_null() {
        return Err(std::io::Error::last_os_error().into());
    }
    template.pop();
    Ok(String::from_utf8_lossy(&template).into_owned())
}

/// `mkdirSync(path, { mode: 0o700 })`.
pub fn mkdir_private(path: &str) -> Result<()> {
    use std::os::unix::fs::DirBuilderExt;
    fs::DirBuilder::new().mode(0o700).create(path)?;
    Ok(())
}
