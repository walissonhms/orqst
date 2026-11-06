//! Filesystem primitives shared by lane L3. Ports `terminalDirectory` / `terminalFile`
//! (`terminal/codex-profile.ts`), `assertNoOfflineRecovery` (`offline-recovery-gate.ts`) and the
//! exclusive `writeFileSync(..., { flag: 'wx', mode: 0o600, flush: true })` + directory fsync.
use super::error::{AdmissionError, Result};
use std::fs::{self, File, Metadata, OpenOptions};
use std::io::{Read, Write};
use std::os::fd::AsRawFd;
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

pub const RECOVERY_GATE: &str = "offline-recovery.json";
pub const RECOVERY_LOCK: &str = "offline-recovery-operation.lock";
pub const DEFAULT_FILE_BUDGET: usize = 16 * 1024;

const S_IFMT: u32 = libc::S_IFMT as u32;
const S_IFREG: u32 = libc::S_IFREG as u32;
const S_IFDIR: u32 = libc::S_IFDIR as u32;

pub(crate) fn uid() -> u32 {
    // SAFETY: getuid has no preconditions and cannot fail.
    unsafe { libc::getuid() }
}

pub(crate) fn is_file(metadata: &Metadata) -> bool {
    metadata.mode() & S_IFMT == S_IFREG
}

pub(crate) fn is_dir(metadata: &Metadata) -> bool {
    metadata.mode() & S_IFMT == S_IFDIR
}

fn canonical(path: &Path) -> Result<bool> {
    Ok(path.is_absolute() && fs::canonicalize(path)?.as_os_str() == path.as_os_str())
}

fn ancestors_safe(path: &Path, message: &'static str) -> Result<()> {
    // Node: `while (ancestor !== parse(ancestor).root)` starting at dirname(path).
    let mut ancestor = path.parent();
    while let Some(current) = ancestor {
        if current.parent().is_none() {
            break;
        }
        let mode = fs::symlink_metadata(current)?.mode();
        if mode & 0o022 != 0 && mode & 0o1000 == 0 {
            return Err(AdmissionError::Rejected(message));
        }
        ancestor = current.parent();
    }
    Ok(())
}

/// `terminalDirectory(path, privateDirectory)`.
pub fn terminal_directory(path: &Path, private_directory: bool) -> Result<()> {
    if !canonical(path)? {
        return Err(AdmissionError::Rejected("Noncanonical directory"));
    }
    let info = fs::symlink_metadata(path)?;
    if !is_dir(&info) || info.uid() != uid() || info.mode() & 0o022 != 0 {
        return Err(AdmissionError::Rejected("Untrusted terminal directory"));
    }
    if private_directory && info.mode() & 0o077 != 0 {
        return Err(AdmissionError::Rejected("Terminal state is not private"));
    }
    ancestors_safe(path, "Terminal ancestor is writable by other users")
}

fn open_terminal_file(path: &Path, private_file: bool, maximum_bytes: usize) -> Result<File> {
    if !canonical(path)? {
        return Err(AdmissionError::Rejected("Noncanonical file"));
    }
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)?;
    let info = file.metadata()?;
    if !is_file(&info) || info.size() > maximum_bytes as u64 || info.mode() & 0o022 != 0 {
        return Err(AdmissionError::Rejected("Untrusted terminal file"));
    }
    if info.uid() != 0 && info.uid() != uid() {
        return Err(AdmissionError::Rejected("Untrusted file owner"));
    }
    if private_file && (info.uid() != uid() || info.mode() & 0o077 != 0) {
        return Err(AdmissionError::Rejected("Terminal file is not private"));
    }
    ancestors_safe(path, "Terminal file ancestor is writable by other users")?;
    Ok(file)
}

/// `terminalFile(path, privateFile, maximumBytes, expected)`: canonical, `O_NOFOLLOW`, owner and
/// mode checked, bounded read that also catches growth after `fstat`.
pub fn terminal_file(
    path: &Path,
    private_file: bool,
    maximum_bytes: usize,
    expected: Option<(u64, u64)>,
) -> Result<Vec<u8>> {
    let mut file = open_terminal_file(path, private_file, maximum_bytes)?;
    if let Some((dev, ino)) = expected {
        let opened = file.metadata()?;
        if opened.dev() != dev || opened.ino() != ino {
            return Err(AdmissionError::Rejected("Terminal file identity changed"));
        }
    }
    let mut buffer = Vec::with_capacity(maximum_bytes + 1);
    (&mut file)
        .take(maximum_bytes as u64 + 1)
        .read_to_end(&mut buffer)?;
    if buffer.len() > maximum_bytes {
        return Err(AdmissionError::Rejected(
            "Terminal file read budget exceeded",
        ));
    }
    Ok(buffer)
}

/// `terminalFile(...).toString('utf8')`.
pub fn terminal_text(path: &Path, private_file: bool, maximum_bytes: usize) -> Result<String> {
    Ok(
        String::from_utf8_lossy(&terminal_file(path, private_file, maximum_bytes, None)?)
            .into_owned(),
    )
}

/// Plain `fsync(2)` (Node `fsyncSync`), not `F_FULLFSYNC`.
pub(crate) fn fsync(file: &File) -> Result<()> {
    // SAFETY: the descriptor is owned by `file` and open for the duration of the call.
    if unsafe { libc::fsync(file.as_raw_fd()) } != 0 {
        return Err(std::io::Error::last_os_error().into());
    }
    Ok(())
}

/// `openSync(directory, O_RDONLY | O_DIRECTORY | O_NOFOLLOW)` + `fsyncSync`.
pub fn sync_directory(directory: &Path) -> Result<()> {
    let handle = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW)
        .open(directory)?;
    fsync(&handle)
}

/// `writeFileSync(path, bytes, { flag: 'wx', mode: 0o600, flush: true })`. A partial write is
/// retained, never removed.
pub fn write_exclusive(path: &Path, bytes: &[u8]) -> Result<()> {
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .truncate(true)
        .mode(0o600)
        .open(path)?;
    file.write_all(bytes)?;
    fsync(&file)
}

/// `assertNoOfflineRecovery(directory)`: deny-only; never parses or removes the gate or lock.
pub fn assert_no_offline_recovery(directory: &Path) -> Result<()> {
    for name in [RECOVERY_GATE, RECOVERY_LOCK] {
        match fs::symlink_metadata(directory.join(name)) {
            Ok(_) => {
                return Err(AdmissionError::Rejected(
                    "Desktop admission reserved for explicit offline recovery",
                ))
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
    }
    Ok(())
}

/// Node `path.join(dirname(p), basename(p)) === p` for an absolute path: no empty, `.` or `..`
/// segment and no trailing slash.
pub(crate) fn node_normalized(path: &Path) -> bool {
    let bytes = path.as_os_str().as_bytes();
    if bytes == b"/" {
        return true;
    }
    if bytes.first() != Some(&b'/') {
        return false;
    }
    bytes[1..]
        .split(|byte| *byte == b'/')
        .all(|segment| !matches!(segment, b"" | b"." | b".."))
}
