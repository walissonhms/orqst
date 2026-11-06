//! Filesystem checks of `codex-profile.ts` (`terminalDirectory`, `terminalFile`,
//! `terminalExecutableSha256`) and Node `fs.realpathSync` (JavaScript implementation, which
//! keeps the given spelling and resolves symlinks component by component).
use super::nodepath::{dirname, is_absolute, resolve, root};
use super::{ProfileError, Result};
use sha2::{Digest, Sha256};
use std::fs::{File, Metadata, OpenOptions};
use std::io::Read;
use std::os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt};

pub fn getuid() -> u32 {
    // SAFETY: getuid has no preconditions and cannot fail.
    unsafe { libc::getuid() }
}

pub fn code_of(error: &std::io::Error) -> String {
    match error.raw_os_error() {
        Some(libc::ENOENT) => "ENOENT".into(),
        Some(libc::EACCES) => "EACCES".into(),
        Some(libc::EPERM) => "EPERM".into(),
        Some(libc::ENOTDIR) => "ENOTDIR".into(),
        Some(libc::ELOOP) => "ELOOP".into(),
        Some(libc::EISDIR) => "EISDIR".into(),
        Some(libc::ENAMETOOLONG) => "ENAMETOOLONG".into(),
        Some(libc::EMFILE) => "EMFILE".into(),
        Some(libc::EAGAIN) => "EAGAIN".into(),
        Some(libc::EIO) => "EIO".into(),
        Some(other) => format!("E{other}"),
        None if error.kind() == std::io::ErrorKind::InvalidInput => "ERR_INVALID_ARG_VALUE".into(),
        None => "EUNKNOWN".into(),
    }
}

pub fn io(error: std::io::Error) -> ProfileError {
    ProfileError::Io(code_of(&error))
}

fn check_path(path: &str) -> Result<()> {
    if path.contains('\0') {
        return Err(ProfileError::Io("ERR_INVALID_ARG_VALUE".into()));
    }
    Ok(())
}

pub fn lstat(path: &str) -> Result<Metadata> {
    check_path(path)?;
    std::fs::symlink_metadata(path).map_err(io)
}

/// `fs.realpathSync(path)` (JavaScript implementation).
pub fn realpath(path: &str) -> Result<String> {
    check_path(path)?;
    let mut pending: Vec<String> = resolve(path)
        .split('/')
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .collect();
    pending.reverse();
    let mut current = String::new();
    let mut links = 0;
    while let Some(segment) = pending.pop() {
        let next = format!("{current}/{segment}");
        let info = std::fs::symlink_metadata(&next).map_err(io)?;
        if !info.file_type().is_symlink() {
            current = next;
            continue;
        }
        links += 1;
        if links > 64 {
            return Err(ProfileError::Io("ELOOP".into()));
        }
        let target = std::fs::read_link(&next).map_err(io)?;
        let target = target.to_string_lossy().into_owned();
        let base = if current.is_empty() {
            "/".to_owned()
        } else {
            current.clone()
        };
        let resolved = if is_absolute(&target) {
            resolve(&target)
        } else {
            resolve(&format!("{base}/{target}"))
        };
        let mut parts: Vec<String> = resolved
            .split('/')
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .collect();
        parts.reverse();
        pending.extend(parts);
        current = String::new();
    }
    Ok(if current.is_empty() {
        "/".into()
    } else {
        current
    })
}

fn ancestors_not_writable(path: &str, message: &str) -> Result<()> {
    let mut ancestor = dirname(path);
    while ancestor != root(&ancestor) {
        let parent = lstat(&ancestor)?;
        if parent.mode() & 0o022 != 0 && parent.mode() & 0o1000 == 0 {
            return Err(ProfileError::refused(message));
        }
        ancestor = dirname(&ancestor);
    }
    Ok(())
}

/// `terminalDirectory`.
pub fn terminal_directory(path: &str, private_directory: bool) -> Result<()> {
    if !is_absolute(path) || realpath(path)? != path {
        return Err(ProfileError::refused("Noncanonical directory"));
    }
    let info = lstat(path)?;
    if !info.is_dir() || info.uid() != getuid() || info.mode() & 0o022 != 0 {
        return Err(ProfileError::refused("Untrusted terminal directory"));
    }
    if private_directory && info.mode() & 0o077 != 0 {
        return Err(ProfileError::refused("Terminal state is not private"));
    }
    ancestors_not_writable(path, "Terminal ancestor is writable by other users")
}

fn open_terminal_file(path: &str, private_file: bool, maximum_bytes: u64) -> Result<File> {
    if !is_absolute(path) || realpath(path)? != path {
        return Err(ProfileError::refused("Noncanonical file"));
    }
    let file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
        .map_err(io)?;
    let info = file.metadata().map_err(io)?;
    if !info.is_file() || info.size() > maximum_bytes || info.mode() & 0o022 != 0 {
        return Err(ProfileError::refused("Untrusted terminal file"));
    }
    if info.uid() != 0 && info.uid() != getuid() {
        return Err(ProfileError::refused("Untrusted file owner"));
    }
    if private_file && (info.uid() != getuid() || info.mode() & 0o077 != 0) {
        return Err(ProfileError::refused("Terminal file is not private"));
    }
    ancestors_not_writable(path, "Terminal file ancestor is writable by other users")?;
    Ok(file)
}

/// `terminalFile(path, privateFile, maximumBytes, expected)`. Default budget 16 KiB.
pub fn terminal_file(
    path: &str,
    private_file: bool,
    maximum_bytes: u64,
    expected: Option<(u64, u64)>,
) -> Result<Vec<u8>> {
    let mut file = open_terminal_file(path, private_file, maximum_bytes)?;
    if let Some((dev, ino)) = expected {
        let opened = file.metadata().map_err(io)?;
        if opened.dev() != dev || opened.ino() != ino {
            return Err(ProfileError::refused("Terminal file identity changed"));
        }
    }
    let mut buffer = Vec::new();
    (&mut file)
        .take(maximum_bytes + 1)
        .read_to_end(&mut buffer)
        .map_err(io)?;
    if buffer.len() as u64 > maximum_bytes {
        return Err(ProfileError::refused("Terminal file read budget exceeded"));
    }
    Ok(buffer)
}

pub const DEFAULT_FILE_BUDGET: u64 = 16 * 1024;
/// `terminalExecutableMaximumBytes`.
pub const TERMINAL_EXECUTABLE_MAXIMUM_BYTES: u64 = 512 * 1024 * 1024;

const MACH_O_MAGIC: [u32; 8] = [
    0xfeedface, 0xcefaedfe, 0xfeedfacf, 0xcffaedfe, 0xcafebabe, 0xbebafeca, 0xcafebabf, 0xbfbafeca,
];

/// `terminalExecutableSha256`. Never executes the file.
pub fn terminal_executable_sha256(path: &str) -> Result<String> {
    let mut file = open_terminal_file(path, false, TERMINAL_EXECUTABLE_MAXIMUM_BYTES)?;
    if file.metadata().map_err(io)?.mode() & 0o111 == 0 {
        return Err(ProfileError::refused("Terminal file is not executable"));
    }
    let mut chunk = vec![0u8; 64 * 1024];
    let mut hash = Sha256::new();
    let mut position: u64 = 0;
    loop {
        let bytes = file.read(&mut chunk).map_err(io)?;
        if bytes == 0 {
            break;
        }
        if position == 0 && cfg!(target_os = "macos") {
            let magic = u32::from_be_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
            if !MACH_O_MAGIC.contains(&magic) {
                return Err(ProfileError::refused(
                    "Select a native Mach-O executable, not a shell or JavaScript shim",
                ));
            }
        }
        hash.update(&chunk[..bytes]);
        position += bytes as u64;
        if position > TERMINAL_EXECUTABLE_MAXIMUM_BYTES {
            return Err(ProfileError::refused("Terminal executable too large"));
        }
    }
    if position == 0 {
        return Err(ProfileError::refused("Empty terminal executable"));
    }
    Ok(super::hex(&hash.finalize()))
}

pub fn is_file_or_symlink(info: &Metadata) -> bool {
    info.is_file() || info.file_type().is_symlink()
}

pub fn is_fifo(info: &Metadata) -> bool {
    info.file_type().is_fifo()
}
