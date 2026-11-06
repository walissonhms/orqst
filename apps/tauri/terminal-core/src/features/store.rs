//! Private preferences Store access (`withTerminalPreferences`, `layout-database.ts`) and the
//! opt-in metadata table setup of `@orqst/database`. The Store itself is opened by
//! `crate::store::Store` (lane L1), byte-compatible with the Node `Store` constructor.
use std::cell::Cell;
use std::fs;
use std::io::ErrorKind;
use std::os::unix::fs::{DirBuilderExt, MetadataExt, OpenOptionsExt};
use std::path::{Path, PathBuf};

use rusqlite::Connection;

use super::error::{refused, store, Result};

const MAX_DATABASE_BYTES: u64 = 64 * 1024 * 1024;

pub fn getuid() -> u32 {
    // SAFETY: getuid has no preconditions and cannot fail.
    unsafe { libc::getuid() }
}

/// `terminalDirectory` (`codex-profile.ts`): canonical, owned, not group/world writable,
/// optionally private, and no ancestor writable by others without the sticky bit.
pub fn terminal_directory(path: &Path, private: bool) -> Result<()> {
    if !path.is_absolute() || fs::canonicalize(path)? != path {
        return Err(store("Noncanonical directory"));
    }
    let info = fs::symlink_metadata(path)?;
    if !info.is_dir() || info.uid() != getuid() || info.mode() & 0o022 != 0 {
        return Err(store("Untrusted terminal directory"));
    }
    if private && info.mode() & 0o077 != 0 {
        return Err(store("Terminal state is not private"));
    }
    let mut ancestor = path.parent();
    while let Some(dir) = ancestor {
        if dir.parent().is_none() {
            break;
        }
        let parent = fs::symlink_metadata(dir)?;
        if parent.mode() & 0o022 != 0 && parent.mode() & 0o1000 == 0 {
            return Err(store("Terminal ancestor is writable by other users"));
        }
        ancestor = dir.parent();
    }
    Ok(())
}

/// `mkdirSync(path, { mode: 0o700 })`, tolerating an existing entry.
pub fn private_mkdir(path: &Path) -> Result<()> {
    match fs::DirBuilder::new().mode(0o700).create(path) {
        Err(error) if error.kind() != ErrorKind::AlreadyExists => Err(error.into()),
        _ => Ok(()),
    }
}

fn check_file(path: &Path) -> Result<()> {
    let info = match fs::symlink_metadata(path) {
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        other => other?,
    };
    let canonical = match fs::canonicalize(path) {
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        other => other?,
    };
    if !info.is_file()
        || info.size() > MAX_DATABASE_BYTES
        || info.nlink() != 1
        || info.uid() != getuid()
        || info.mode() & 0o077 != 0
        || canonical != path
    {
        return Err(store("Unsafe layout database"));
    }
    let file = match fs::OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_NOFOLLOW)
        .open(path)
    {
        Err(error) if error.kind() == ErrorKind::NotFound => return Ok(()),
        other => other?,
    };
    let opened = file.metadata()?;
    if opened.ino() != info.ino() || opened.dev() != info.dev() {
        return Err(store("Changed layout database"));
    }
    Ok(())
}

/// `<realpath(userData)>/terminal-layouts/preferences.sqlite`, after the same file checks.
pub fn preferences_file(user_data: &Path) -> Result<PathBuf> {
    let directory = fs::canonicalize(user_data)?.join("terminal-layouts");
    private_mkdir(&directory)?;
    terminal_directory(&directory, true)?;
    let file = directory.join("preferences.sqlite");
    for suffix in ["", "-wal", "-shm", "-journal"] {
        let mut name = file.clone().into_os_string();
        name.push(suffix);
        check_file(Path::new(&name))?;
    }
    Ok(file)
}

/// One Store connection with `Store.transaction` semantics (nested calls run inline).
pub struct Db {
    pub conn: Connection,
    depth: Cell<u32>,
}

impl Db {
    /// Opens the Store through `crate::store::Store::open` (the exact Node `Store`
    /// constructor: modes, PRAGMAs, migrations, machineId).
    pub fn open(file: &Path) -> Result<Self> {
        let opened = crate::store::Store::open(file).map_err(store)?;
        Ok(Self {
            conn: opened.db,
            depth: Cell::new(0),
        })
    }

    /// `Store.transaction`: `BEGIN IMMEDIATE` at the outermost level, inline when nested.
    pub fn transaction<T>(&self, action: impl FnOnce() -> Result<T>) -> Result<T> {
        if self.depth.get() > 0 || !self.conn.is_autocommit() {
            self.depth.set(self.depth.get() + 1);
            let result = action();
            self.depth.set(self.depth.get() - 1);
            return result;
        }
        self.conn.execute_batch("BEGIN IMMEDIATE")?;
        self.depth.set(1);
        let result = action();
        self.depth.set(0);
        match result {
            Ok(value) => match self.conn.execute_batch("COMMIT") {
                Ok(()) => Ok(value),
                Err(error) => {
                    let _ = self.conn.execute_batch("ROLLBACK");
                    Err(error.into())
                }
            },
            Err(error) => {
                let _ = self.conn.execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    pub fn count(&self, sql: &str) -> Result<u64> {
        let n: i64 = self.conn.query_row(sql, [], |row| row.get(0))?;
        Ok(n.max(0) as u64)
    }

    /// Opt-in metadata table: same `CREATE TABLE IF NOT EXISTS` statements Node runs on each
    /// accessor (additive, `user_version` untouched), then the singleton version check.
    pub fn ensure_extension(
        &self,
        setup: &str,
        version_table: &str,
        tables: &str,
        what: &str,
    ) -> Result<()> {
        self.transaction(|| {
            self.conn.execute_batch(setup)?;
            let version: Option<i64> = self
                .conn
                .query_row(
                    &format!("SELECT version FROM {version_table} WHERE singleton=1"),
                    [],
                    |row| row.get(0),
                )
                .ok();
            if version != Some(1) {
                return Err(refused(format!("Unsupported {what} schema")));
            }
            if !tables.is_empty() {
                self.conn.execute_batch(tables)?;
            }
            Ok(())
        })
    }
}

/// `withTerminalPreferences`: validated private file, one connection per call.
pub fn with_terminal_preferences<T>(
    user_data: &Path,
    action: impl FnOnce(&Db) -> Result<T>,
) -> Result<T> {
    let file = preferences_file(user_data)?;
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .custom_flags(libc::O_NOFOLLOW)
        .open(&file)
    {
        Err(error) if error.kind() != ErrorKind::AlreadyExists => return Err(error.into()),
        _ => {}
    }
    let db = Db::open(&file)?;
    action(&db)
}

pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    fn temp() -> PathBuf {
        let dir =
            std::env::temp_dir().join(format!("orqst-synthetic-prefs-{}", uuid::Uuid::new_v4()));
        fs::DirBuilder::new().mode(0o700).create(&dir).unwrap();
        fs::canonicalize(dir).unwrap()
    }

    #[test]
    fn refuses_unsafe_database_files() {
        let dir = temp();
        let file = preferences_file(&dir).unwrap();
        fs::write(&file, b"").unwrap();
        fs::set_permissions(&file, fs::Permissions::from_mode(0o644)).unwrap();
        assert!(preferences_file(&dir).is_err());
        fs::set_permissions(&file, fs::Permissions::from_mode(0o600)).unwrap();
        fs::hard_link(&file, dir.join("second-link")).unwrap();
        assert!(preferences_file(&dir).is_err());
        fs::remove_file(dir.join("second-link")).unwrap();
        assert!(preferences_file(&dir).is_ok());
        let wal = dir.join("terminal-layouts/preferences.sqlite-wal");
        std::os::unix::fs::symlink(&file, &wal).unwrap();
        assert!(preferences_file(&dir).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn refuses_a_shared_preferences_directory() {
        let dir = temp();
        let layouts = dir.join("terminal-layouts");
        fs::create_dir(&layouts).unwrap();
        fs::set_permissions(&layouts, fs::Permissions::from_mode(0o750)).unwrap();
        assert!(preferences_file(&dir).is_err());
        fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn nested_transactions_roll_back_together() {
        let dir = temp();
        let result: Result<()> = with_terminal_preferences(&dir, |db| {
            db.transaction(|| {
                db.conn
                    .execute_batch("CREATE TABLE synthetic (x INTEGER)")?;
                db.transaction(|| Err(refused("synthetic failure")))
            })
        });
        assert!(result.is_err());
        let exists = with_terminal_preferences(&dir, |db| {
            db.count("SELECT COUNT(*) FROM sqlite_master WHERE name='synthetic'")
        })
        .unwrap();
        assert_eq!(exists, 0);
        fs::remove_dir_all(dir).unwrap();
    }
}
