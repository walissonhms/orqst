//! Opens a SQLite file exactly like `@orqst/database` `Store` (index.ts constructor):
//! 0700 parent, symlink refusal, 0600 file, the same PRAGMAs, the same migrations under
//! `PRAGMA user_version`, and the `machineId` setting with its `machines` row.
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use std::fs;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

const MIGRATIONS: &str = include_str!("store-migrations.json");

pub fn migrations() -> Vec<String> {
    serde_json::from_str(MIGRATIONS).expect("embedded Store migrations")
}

pub struct Store {
    pub db: Connection,
    pub path: PathBuf,
    pub machine_id: String,
}

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// `new Date().toISOString()` for the current time.
pub fn iso_now() -> String {
    iso(crate::authority::now_ms())
}

pub fn iso(ms: i64) -> String {
    let (secs, millis) = (ms.div_euclid(1000), ms.rem_euclid(1000));
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Howard Hinnant's civil_from_days.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + i64::from(month <= 2);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.{millis:03}Z",
        rem / 3600,
        rem % 3600 / 60,
        rem % 60
    )
}

impl Store {
    pub fn open(file: &Path) -> Result<Store, String> {
        let parent = file.parent().ok_or("Invalid database path")?;
        fs::create_dir_all(parent).map_err(err)?;
        if fs::symlink_metadata(parent).map_err(err)?.file_type().is_symlink() {
            return Err("Data directory must not be a symlink".into());
        }
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700)).map_err(err)?;
        match fs::symlink_metadata(file) {
            Ok(meta) if meta.file_type().is_symlink() => {
                return Err("Database must not be a symlink".into())
            }
            Ok(_) => {}
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
            Err(e) => return Err(err(e)),
        }
        let mut db = Connection::open(file).map_err(err)?;
        fs::set_permissions(file, fs::Permissions::from_mode(0o600)).map_err(err)?;
        let path = fs::canonicalize(file).map_err(err)?;
        db.execute_batch(
            "PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA secure_delete=ON;",
        )
        .map_err(err)?;
        let all = migrations();
        let version: i64 = db.query_row("PRAGMA user_version", [], |r| r.get(0)).map_err(err)?;
        if version > all.len() as i64 {
            return Err("Database schema is newer than this application".into());
        }
        for index in version as usize..all.len() {
            let tx = db.transaction_with_behavior(TransactionBehavior::Immediate).map_err(err)?;
            tx.execute_batch(&all[index]).map_err(err)?;
            tx.execute_batch(&format!("PRAGMA user_version={}", index + 1)).map_err(err)?;
            tx.commit().map_err(err)?;
        }
        let existing: Option<String> = db
            .query_row("SELECT value FROM settings WHERE key=?", ["machineId"], |r| r.get(0))
            .optional()
            .map_err(err)?;
        let machine_id = match existing {
            Some(value) => serde_json::from_str::<String>(&value).map_err(err)?,
            None => {
                let id = uuid::Uuid::new_v4().to_string();
                db.execute(
                    "INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
                    params!["machineId", serde_json::to_string(&id).map_err(err)?],
                )
                .map_err(err)?;
                id
            }
        };
        db.execute("INSERT OR IGNORE INTO machines VALUES (?,?)", params![machine_id, iso_now()])
            .map_err(err)?;
        Ok(Store { db, path, machine_id })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_matches_to_iso_string() {
        assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso(1793995936662), "2026-11-06T20:12:16.662Z");
        assert_eq!(iso(951782400000), "2000-02-29T00:00:00.000Z");
    }
}
