//! Private exact-marker namespace operation; never exposed to renderer or HTTP.
use sha2::{Digest, Sha256};
use std::ffi::{c_char, c_int, CString};
use std::fs::{File, OpenOptions};
use std::io::{self, Read};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

const O_NOFOLLOW: c_int = 0x100;
const O_DIRECTORY: c_int = 0x100000;
const O_CLOEXEC: c_int = 0x1000000;
const RENAME_EXCL: u32 = 4;
const MARKER_LIMIT: u64 = 16 * 1024;
extern "C" {
    fn openat(fd: c_int, path: *const c_char, flags: c_int, ...) -> c_int;
    fn renameatx_np(
        fromfd: c_int,
        from: *const c_char,
        tofd: c_int,
        to: *const c_char,
        flags: u32,
    ) -> c_int;
    fn geteuid() -> u32;
}
#[derive(Debug, PartialEq, Eq)]
pub struct MarkerIdentity {
    pub dev: u64,
    pub inode: u64,
    pub sha256: String,
}
fn read_marker(dir: &File, name: &CString) -> io::Result<MarkerIdentity> {
    // SAFETY: dir is open and name is a NUL-terminated relative name.
    let raw = unsafe { openat(dir.as_raw_fd(), name.as_ptr(), O_NOFOLLOW | O_CLOEXEC) };
    if raw < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: openat returned a new owned descriptor.
    let mut file = unsafe { File::from_raw_fd(raw) };
    let before = file.metadata()?;
    // SAFETY: geteuid has no preconditions.
    if !before.is_file()
        || before.uid() != unsafe { geteuid() }
        || before.mode() & 0o077 != 0
        || before.nlink() != 1
        || before.len() > MARKER_LIMIT
    {
        return Err(io::Error::other("Untrusted marker"));
    }
    let mut bytes = Vec::new();
    (&mut file).take(MARKER_LIMIT + 1).read_to_end(&mut bytes)?;
    let after = file.metadata()?;
    if bytes.len() as u64 != before.len()
        || before.dev() != after.dev()
        || before.ino() != after.ino()
        || before.len() != after.len()
        || before.uid() != after.uid()
        || before.mode() != after.mode()
        || before.nlink() != after.nlink()
        || before.mtime() != after.mtime()
        || before.mtime_nsec() != after.mtime_nsec()
        || before.ctime() != after.ctime()
        || before.ctime_nsec() != after.ctime_nsec()
    {
        return Err(io::Error::other("Marker changed while reading"));
    }
    let sha256 = Sha256::digest(&bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok(MarkerIdentity {
        dev: before.dev(),
        inode: before.ino(),
        sha256,
    })
}

/// Call only after a bound native review and producer/session verification.
pub fn rename_marker(
    directory: &Path,
    destination: &str,
    expected: &MarkerIdentity,
) -> io::Result<()> {
    let Some(id) = destination
        .strip_prefix("released-marker-")
        .and_then(|value| value.strip_suffix(".json"))
    else {
        return Err(io::Error::other("Invalid destination"));
    };
    if id.len() != 36
        || !id.bytes().enumerate().all(|(i, byte)| match i {
            8 | 13 | 18 | 23 => byte == b'-',
            _ => byte.is_ascii_hexdigit(),
        })
    {
        return Err(io::Error::other("Invalid destination"));
    }
    if !directory.is_absolute() || directory.canonicalize()? != directory {
        return Err(io::Error::other("Noncanonical admission directory"));
    }
    let dir = OpenOptions::new()
        .read(true)
        .custom_flags(O_NOFOLLOW | O_DIRECTORY)
        .open(directory)?;
    let held = dir.metadata()?;
    let named = std::fs::symlink_metadata(directory)?;
    // SAFETY: geteuid has no preconditions.
    if !held.is_dir()
        || held.uid() != unsafe { geteuid() }
        || held.mode() & 0o077 != 0
        || held.dev() != named.dev()
        || held.ino() != named.ino()
    {
        return Err(io::Error::other("Untrusted admission directory"));
    }
    let source = c"active-pair.json";
    let destination =
        CString::new(destination).map_err(|_| io::Error::other("Invalid destination"))?;
    if read_marker(&dir, &source.to_owned())? != *expected {
        return Err(io::Error::other("Marker identity changed"));
    }
    // SAFETY: both names are relative C strings and dir is an open validated directory.
    if unsafe {
        renameatx_np(
            dir.as_raw_fd(),
            source.as_ptr(),
            dir.as_raw_fd(),
            destination.as_ptr(),
            RENAME_EXCL,
        )
    } != 0
    {
        return Err(io::Error::last_os_error());
    }
    if read_marker(&dir, &destination)? != *expected {
        return Err(io::Error::other("Renamed marker identity uncertain"));
    }
    dir.sync_all()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    #[test]
    fn exclusive_rename_keeps_original_inode_and_refuses_replacement() {
        let root = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("orqst-rename-{}", std::process::id()));
        std::fs::create_dir(&root).unwrap();
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
        let source = root.join("active-pair.json");
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&source)
            .unwrap();
        use std::io::Write;
        file.write_all(b"SYNTHETIC").unwrap();
        file.sync_all().unwrap();
        let dir = File::open(&root).unwrap();
        let expected = read_marker(&dir, &c"active-pair.json".to_owned()).unwrap();
        let destination = "released-marker-12345678-1234-4123-8123-123456789abc.json";
        rename_marker(&root, destination, &expected).unwrap();
        assert!(!source.exists());
        assert_eq!(
            read_marker(&dir, &CString::new(destination).unwrap()).unwrap(),
            expected
        );
        let mut next = OpenOptions::new()
            .write(true)
            .create_new(true)
            .mode(0o600)
            .open(&source)
            .unwrap();
        next.write_all(b"NEW OWNER").unwrap();
        next.sync_all().unwrap();
        assert!(rename_marker(
            &root,
            "released-marker-abcdefab-1234-4123-8123-123456789abc.json",
            &expected
        )
        .is_err());
        assert_eq!(std::fs::read(&source).unwrap(), b"NEW OWNER");
        std::fs::remove_file(source).unwrap();
        std::fs::remove_file(root.join(destination)).unwrap();
        std::fs::remove_dir(root).unwrap();
    }
}
