//! Private admission-directory lock with a durable in-flight dispatch record.
use std::ffi::{c_char, c_int, CString};
use std::fs::{File, OpenOptions};
use std::io::{self, Write};
use std::os::fd::{AsRawFd, FromRawFd};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::path::Path;

const O_NOFOLLOW: c_int = 0x100;
const O_DIRECTORY: c_int = 0x100000;
const O_WRONLY: c_int = 1;
const O_CREAT: c_int = 0x200;
const O_EXCL: c_int = 0x800;
const O_CLOEXEC: c_int = 0x1000000;
const LOCK_SH: c_int = 1;
const LOCK_EX: c_int = 2;
const LOCK_NB: c_int = 4;
const RENAME_EXCL: u32 = 4;

extern "C" {
    fn flock(fd: c_int, operation: c_int) -> c_int;
    fn renameatx_np(
        fromfd: c_int,
        from: *const c_char,
        tofd: c_int,
        to: *const c_char,
        flags: u32,
    ) -> c_int;
    fn geteuid() -> u32;
    fn openat(fd: c_int, path: *const c_char, flags: c_int, ...) -> c_int;
}

fn directory(path: &Path) -> io::Result<File> {
    if !path.is_absolute() || path.canonicalize()? != path {
        return Err(io::Error::other("Noncanonical admission directory"));
    }
    let dir = OpenOptions::new()
        .read(true)
        .custom_flags(O_NOFOLLOW | O_DIRECTORY)
        .open(path)?;
    let meta = dir.metadata()?;
    let path_meta = std::fs::symlink_metadata(path)?;
    if meta.dev() != path_meta.dev() || meta.ino() != path_meta.ino() {
        return Err(io::Error::other("Admission directory changed"));
    }
    // SAFETY: geteuid has no preconditions and returns the current process UID.
    if !meta.is_dir() || meta.uid() != unsafe { geteuid() } || meta.mode() & 0o077 != 0 {
        return Err(io::Error::other("Untrusted admission directory"));
    }
    Ok(dir)
}
fn lock(fd: &File, exclusive: bool) -> io::Result<()> {
    let mode = if exclusive { LOCK_EX } else { LOCK_SH };
    // SAFETY: fd stays open while the lock is held.
    if unsafe { flock(fd.as_raw_fd(), mode | LOCK_NB) } != 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}

/// A pending marker remains durable if the process or transport disappears.
pub struct DispatchLock {
    directory: File,
    pending: CString,
    completed: CString,
}
impl DispatchLock {
    pub fn acquire(path: &Path, id: &str, owner: &str, epoch: &str) -> io::Result<Self> {
        if ![id, owner, epoch].iter().all(|value| {
            value.len() == 36 && value.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
        }) {
            return Err(io::Error::other("Invalid dispatch identity"));
        }
        let directory = directory(path)?;
        lock(&directory, false)?;
        let pending_name = format!("kernel-dispatch-{id}.pending");
        let completed_name = format!("kernel-dispatch-{id}.complete");
        let pending = CString::new(pending_name).map_err(|_| io::Error::other("Invalid path"))?;
        // SAFETY: pending is a valid relative C string; the directory descriptor remains open.
        let raw = unsafe {
            openat(
                directory.as_raw_fd(),
                pending.as_ptr(),
                O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC,
                0o600,
            )
        };
        if raw < 0 {
            return Err(io::Error::last_os_error());
        }
        // SAFETY: openat returned a new owned descriptor.
        let mut marker = unsafe { File::from_raw_fd(raw) };
        let metadata = marker.metadata()?;
        // SAFETY: geteuid has no preconditions.
        if !metadata.is_file()
            || metadata.uid() != unsafe { geteuid() }
            || metadata.nlink() != 1
            || metadata.mode() & 0o077 != 0
        {
            return Err(io::Error::other("Untrusted dispatch marker"));
        }
        writeln!(marker, "{id} {owner} {epoch}")?;
        marker.sync_all()?;
        directory.sync_all()?;
        Ok(Self {
            directory,
            pending,
            completed: CString::new(completed_name)
                .map_err(|_| io::Error::other("Invalid path"))?,
        })
    }
    /// Preserve the exact marker; any failure keeps recovery uncertain.
    pub fn complete(self) -> io::Result<()> {
        // SAFETY: names are NUL-terminated, relative to the still-open directory descriptor.
        let result = unsafe {
            renameatx_np(
                self.directory.as_raw_fd(),
                self.pending.as_ptr(),
                self.directory.as_raw_fd(),
                self.completed.as_ptr(),
                RENAME_EXCL,
            )
        };
        if result != 0 {
            return Err(io::Error::last_os_error());
        }
        self.directory.sync_all()
    }
}

/// Held across the entire recovery review and marker rename.
pub fn exclusive(path: &Path) -> io::Result<File> {
    let dir = directory(path)?;
    lock(&dir, true)?;
    for entry in std::fs::read_dir(path)? {
        let name = entry?
            .file_name()
            .into_string()
            .map_err(|_| io::Error::other("Invalid admission entry"))?;
        if name.starts_with("kernel-dispatch-") && name.ends_with(".pending") {
            return Err(io::Error::other("Unconfirmed dispatch remains"));
        }
    }
    let current = std::fs::symlink_metadata(path)?;
    let held = dir.metadata()?;
    if current.dev() != held.dev() || current.ino() != held.ino() {
        return Err(io::Error::other("Admission directory changed"));
    }
    Ok(dir)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::sync::atomic::{AtomicUsize, Ordering};
    #[test]
    fn completed_dispatch_preserves_the_original_inode_and_contents() {
        let dir = std::env::temp_dir()
            .canonicalize()
            .unwrap()
            .join(format!("orqst-lock-complete-{}", std::process::id()));
        std::fs::create_dir(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        let id = "12345678-1234-4123-8123-123456789abc";
        let guard = DispatchLock::acquire(&dir, id, id, id).unwrap();
        let pending = dir.join(format!("kernel-dispatch-{id}.pending"));
        let done = dir.join(format!("kernel-dispatch-{id}.complete"));
        let inode = std::fs::metadata(&pending).unwrap().ino();
        let bytes = std::fs::read(&pending).unwrap();
        guard.complete().unwrap();
        assert!(!pending.exists());
        assert_eq!(std::fs::metadata(&done).unwrap().ino(), inode);
        assert_eq!(std::fs::read(&done).unwrap(), bytes);
        drop(exclusive(&dir).unwrap());
        std::fs::remove_file(done).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }

    #[test]
    fn shared_dispatch_blocks_exclusive_and_preserves_inflight_marker_on_drop() {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let dir = std::env::temp_dir().canonicalize().unwrap().join(format!(
            "orqst-lock-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&dir).unwrap();
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700)).unwrap();
        let id = "12345678-1234-4123-8123-123456789abc";
        let guard = DispatchLock::acquire(&dir, id, id, id).unwrap();
        assert!(exclusive(&dir).is_err());
        drop(guard);
        let pending = dir.join(format!("kernel-dispatch-{id}.pending"));
        assert!(pending.is_file());
        assert!(exclusive(&dir).is_err());
        std::fs::remove_file(pending).unwrap();
        drop(exclusive(&dir).unwrap());
        std::fs::remove_dir(dir).unwrap();
    }
}
