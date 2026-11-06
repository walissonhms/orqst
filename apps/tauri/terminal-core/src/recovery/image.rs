//! Port of `packages/database/src/offline-terminal-journal.ts`: a pure committed-WAL overlay and
//! the immutable inspection of a private derived copy. The live journal, its WAL and its SHM are
//! never opened by SQLite here.
use super::error::{fail, invalid, Result};
use super::js::{number, obj, s};
use super::schema;
use crate::admission::json::is_uuid;
use rusqlite::config::DbConfig;
use rusqlite::types::ValueRef;
use rusqlite::{Connection, OpenFlags};
use serde_json::{Map, Value};
use std::collections::HashMap;

pub const OFFLINE_JOURNAL_BYTES: usize = super::fsio::OFFLINE_JOURNAL_BYTES;
const ATTEMPT_LIMIT: usize = crate::journal::ATTEMPTS as usize;

fn be32(bytes: &[u8], at: usize) -> u32 {
    u32::from_be_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}
fn le32(bytes: &[u8], at: usize) -> u32 {
    u32::from_le_bytes([bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]])
}

/// `committedTerminalImage(base, wal)`.
pub fn committed_terminal_image(base: &[u8], wal: Option<&[u8]>) -> Result<Vec<u8>> {
    if base.len() < 100 || base.len() > OFFLINE_JOURNAL_BYTES || &base[..16] != b"SQLite format 3\0"
    {
        return fail("Invalid offline database");
    }
    let raw = u16::from_be_bytes([base[16], base[17]]) as usize;
    let size = if raw == 1 { 65536 } else { raw };
    if !(512..=65536).contains(&size) || size & (size - 1) != 0 || base.len() % size != 0 {
        return fail("Invalid offline page size");
    }
    let mut result = base.to_vec();
    if let Some(wal) = wal.filter(|wal| !wal.is_empty()) {
        if wal.len() < 32 {
            return fail("Invalid offline WAL");
        }
        let magic = be32(wal, 0);
        if wal.len() > OFFLINE_JOURNAL_BYTES
            || ![0x377f0682, 0x377f0683].contains(&magic)
            || be32(wal, 4) != 3007000
            || be32(wal, 8) as usize != size
            || (wal.len() - 32) % (size + 24) != 0
        {
            return fail("Invalid offline WAL");
        }
        let little = magic == 0x377f0682;
        let (mut first, mut second) = (0u32, 0u32);
        let checksum = |bytes: &[u8], first: &mut u32, second: &mut u32| {
            let mut offset = 0;
            while offset < bytes.len() {
                let (a, b) = if little {
                    (le32(bytes, offset), le32(bytes, offset + 4))
                } else {
                    (be32(bytes, offset), be32(bytes, offset + 4))
                };
                *first = first.wrapping_add(a).wrapping_add(*second);
                *second = second.wrapping_add(b).wrapping_add(*first);
                offset += 8;
            }
        };
        checksum(&wal[..24], &mut first, &mut second);
        if first != be32(wal, 24) || second != be32(wal, 28) {
            return fail("Offline WAL header checksum");
        }
        let mut pages: HashMap<u32, &[u8]> = HashMap::new();
        let mut order: Vec<u32> = Vec::new();
        let mut committed_pages = 0usize;
        let mut last_commit = 32usize;
        let mut offset = 32usize;
        while offset < wal.len() {
            let page = be32(wal, offset);
            let end = be32(wal, offset + 4);
            if page == 0
                || page as usize * size > OFFLINE_JOURNAL_BYTES
                || end as usize * size > OFFLINE_JOURNAL_BYTES
                || wal[offset + 8..offset + 16] != wal[16..24]
            {
                return fail("Offline WAL frame binding");
            }
            checksum(&wal[offset..offset + 8], &mut first, &mut second);
            checksum(
                &wal[offset + 24..offset + 24 + size],
                &mut first,
                &mut second,
            );
            if first != be32(wal, offset + 16) || second != be32(wal, offset + 20) {
                return fail("Offline WAL frame checksum");
            }
            if !pages.contains_key(&page) {
                order.push(page);
            }
            pages.insert(page, &wal[offset + 24..offset + 24 + size]);
            if end != 0 {
                committed_pages = end as usize;
                last_commit = offset + size + 24;
            }
            offset += size + 24;
        }
        if last_commit != wal.len() {
            return fail("Uncommitted offline WAL tail");
        }
        if committed_pages != 0 {
            let mut image = vec![0u8; committed_pages * size];
            let copy = base.len().min(image.len());
            image[..copy].copy_from_slice(&base[..copy]);
            for page in order {
                let bytes = pages[&page];
                if page as usize <= committed_pages {
                    let at = (page as usize - 1) * size;
                    image[at..at + size].copy_from_slice(bytes);
                }
            }
            result = image;
        }
    }
    result[18] = 1;
    result[19] = 1;
    Ok(result)
}

fn column(value: ValueRef<'_>) -> Result<Value> {
    Ok(match value {
        ValueRef::Null => Value::Null,
        ValueRef::Integer(i) => number(i as f64),
        ValueRef::Real(f) => number(f),
        ValueRef::Text(t) => s(&String::from_utf8_lossy(t)),
        ValueRef::Blob(_) => return Err(invalid("blob column")),
    })
}

fn rows(db: &Connection, sql: &str) -> Result<Vec<Map<String, Value>>> {
    let sqlerr = |e: rusqlite::Error| super::error::RecoveryError::Failed(e.to_string());
    let mut statement = db.prepare(sql).map_err(sqlerr)?;
    let names: Vec<String> = statement
        .column_names()
        .iter()
        .map(|n| (*n).to_owned())
        .collect();
    let mut query = statement.query([]).map_err(sqlerr)?;
    let mut out = Vec::new();
    while let Some(row) = query.next().map_err(sqlerr)? {
        let mut map = Map::new();
        for (index, name) in names.iter().enumerate() {
            map.insert(name.clone(), column(row.get_ref(index).map_err(sqlerr)?)?);
        }
        out.push(map);
    }
    Ok(out)
}

fn open(uri: &str, flags: OpenFlags) -> Result<Connection> {
    let db = Connection::open_with_flags(uri, flags)
        .map_err(|e| super::error::RecoveryError::Failed(e.to_string()))?;
    let _ = db.set_db_config(DbConfig::SQLITE_DBCONFIG_DQS_DML, false);
    let _ = db.set_db_config(DbConfig::SQLITE_DBCONFIG_DQS_DDL, false);
    Ok(db)
}

const DEFINITIONS: &str = "SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name GLOB 'terminal_*' OR tbl_name GLOB 'terminal_*' ORDER BY type,name";

/// `inspectOfflineTerminalImage(file)`: the caller supplies its private, immutable derived copy.
pub fn inspect_offline_terminal_image(file: &str) -> Result<Value> {
    if file.contains(['%', '?', '#', '\n']) {
        return fail("Unsupported offline image path");
    }
    let db = open(
        &format!("file:{file}?immutable=1"),
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    let sqlerr = |e: rusqlite::Error| super::error::RecoveryError::Failed(e.to_string());
    db.execute_batch("PRAGMA trusted_schema=OFF; PRAGMA query_only=ON")
        .map_err(sqlerr)?;
    let integrity = rows(&db, "PRAGMA integrity_check")?;
    if integrity.first().and_then(|row| row.get("integrity_check")) != Some(&s("ok")) {
        return fail("Corrupt offline journal");
    }
    let schema_rows = rows(&db, "SELECT * FROM terminal_schema")?;
    let owners = rows(&db, "SELECT * FROM terminal_owner")?;
    let one = Some(&number(1.0));
    let epoch = owners
        .first()
        .and_then(|o| o.get("epoch"))
        .and_then(Value::as_str)
        .map(str::to_owned);
    if schema_rows.len() != 1
        || schema_rows[0].get("singleton") != one
        || schema_rows[0].get("version") != Some(&number(2.0))
        || owners.len() != 1
        || owners[0].get("singleton") != one
        || epoch.is_none()
    {
        return fail("Unsupported offline journal owner/schema");
    }
    let epoch = epoch.unwrap_or_default();
    if !is_uuid(&epoch) {
        return Err(invalid("epoch"));
    }
    let definitions: Vec<Value> = rows(&db, DEFINITIONS)?
        .into_iter()
        .map(Value::Object)
        .collect();
    let reference = Connection::open_in_memory().map_err(sqlerr)?;
    reference
        .execute_batch(crate::journal::MIGRATION)
        .map_err(sqlerr)?;
    let expected: Vec<Value> = rows(&reference, DEFINITIONS)?
        .into_iter()
        .map(Value::Object)
        .collect();
    drop(reference);
    if super::js::stringify(&Value::Array(definitions.clone()))
        != super::js::stringify(&Value::Array(expected))
    {
        return fail("Unsupported offline journal definition");
    }
    let attempt_rows = rows(
        &db,
        &format!(
            "SELECT * FROM terminal_attempts ORDER BY instance_id LIMIT {}",
            ATTEMPT_LIMIT + 1
        ),
    )?;
    if attempt_rows.len() > ATTEMPT_LIMIT {
        return fail("Offline attempt budget");
    }
    let mut attempts = Vec::new();
    for row in attempt_rows {
        let metadata = row
            .get("metadata")
            .and_then(Value::as_str)
            .filter(|m| crate::admission::json::utf16_len(m) <= 2048)
            .ok_or_else(|| {
                super::error::RecoveryError::Failed("Invalid offline attempt metadata".into())
            })?;
        let attempt = schema::attempt(&super::js::parse(metadata.as_bytes())?)?;
        let field = |key: &str| attempt.get(key).cloned().unwrap_or(Value::Null);
        if field("instanceId") != row.get("instance_id").cloned().unwrap_or(Value::Null)
            || field("epoch") != row.get("epoch").cloned().unwrap_or(Value::Null)
            || field("projectId") != row.get("project_id").cloned().unwrap_or(Value::Null)
            || field("state") != row.get("state").cloned().unwrap_or(Value::Null)
            || field("updatedAt") != row.get("updated_at").cloned().unwrap_or(Value::Null)
            || field("epoch") != s(&epoch)
            || field("state") != s("prepared")
            || attempt.get("exit").is_some()
        {
            return fail("Offline non-dispatch proof denied");
        }
        attempts.push(attempt);
    }
    Ok(obj([
        ("schemaVersion", number(2.0)),
        ("epoch", s(&epoch)),
        ("definitions", Value::Array(definitions)),
        ("attempts", Value::Array(attempts)),
    ]))
}
