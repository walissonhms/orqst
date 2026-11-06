//! zod primitives used by the profile schemas. Lengths are UTF-16 code units, as in zod.
use super::js::{js_len, Js};
use super::{ProfileError, Result};
use regex::Regex;
use std::sync::OnceLock;

macro_rules! pattern {
    ($name:ident, $source:expr) => {
        pub fn $name() -> &'static Regex {
            static CELL: OnceLock<Regex> = OnceLock::new();
            CELL.get_or_init(|| Regex::new($source).expect("static pattern"))
        }
    };
}

pattern!(hex64_pattern, r"^[a-f0-9]{64}$");
// zod 4.6.7 `z.uuid()`.
pattern!(
    uuid_pattern,
    r"^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
);
// zod 4.6.7 `z.iso.datetime({ offset: true })` with `\d` spelled as ASCII digits.
pattern!(
    datetime_pattern,
    r"^(?:(?:[0-9][0-9][2468][048]|[0-9][0-9][13579][26]|[0-9][0-9]0[48]|[02468][048]00|[13579][26]00)-02-29|[0-9]{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12][0-9]|3[01])|(?:0[469]|11)-(?:0[1-9]|[12][0-9]|30)|(?:02)-(?:0[1-9]|1[0-9]|2[0-8])))T(?:(?:[01][0-9]|2[0-3]):[0-5][0-9]:[0-5][0-9](?:\.[0-9]+)?(?:Z|([+-](?:[01][0-9]|2[0-3]):[0-5][0-9])))$"
);

pub fn schema<T>(detail: &str) -> Result<T> {
    Err(ProfileError::schema(detail))
}

pub fn string<'a>(value: &'a Js, field: &str) -> Result<&'a str> {
    value
        .as_str()
        .ok_or_else(|| ProfileError::schema(format!("{field}: expected string")))
}

pub fn bounded<'a>(value: &'a Js, field: &str, min: usize, max: usize) -> Result<&'a str> {
    let s = string(value, field)?;
    let len = js_len(s);
    if len < min || len > max {
        return schema(&format!("{field}: length"));
    }
    Ok(s)
}

pub fn hex64(value: &Js, field: &str) -> Result<String> {
    let s = string(value, field)?;
    if !hex64_pattern().is_match(s) {
        return schema(&format!("{field}: sha256"));
    }
    Ok(s.to_owned())
}

pub fn uuid(value: &Js, field: &str) -> Result<String> {
    let s = string(value, field)?;
    if !uuid_pattern().is_match(s) {
        return schema(&format!("{field}: uuid"));
    }
    Ok(s.to_owned())
}

pub fn literal_str(value: &Js, field: &str, expected: &str) -> Result<()> {
    if value.as_str() != Some(expected) {
        return schema(&format!("{field}: literal"));
    }
    Ok(())
}

pub fn literal_true(value: &Js, field: &str) -> Result<bool> {
    if *value != Js::Bool(true) {
        return schema(&format!("{field}: literal true"));
    }
    Ok(true)
}

pub fn boolean(value: &Js, field: &str) -> Result<bool> {
    match value {
        Js::Bool(b) => Ok(*b),
        _ => schema(&format!("{field}: boolean")),
    }
}

/// A plain JSON object (zod `z.object`), returning its entries.
pub fn object<'a>(value: &'a Js, field: &str) -> Result<&'a [(String, Js)]> {
    match value {
        Js::Obj(entries) => Ok(entries),
        _ => schema(&format!("{field}: expected object")),
    }
}

/// zod `z.strictObject`: unknown keys are refused.
pub fn strict<'a>(value: &'a Js, field: &str, keys: &[&str]) -> Result<&'a Js> {
    for (key, _) in object(value, field)? {
        if !keys.contains(&key.as_str()) {
            return schema(&format!("{field}: unrecognized key {key}"));
        }
    }
    Ok(value)
}

pub fn required<'a>(value: &'a Js, key: &str) -> Result<&'a Js> {
    value
        .get(key)
        .ok_or_else(|| ProfileError::schema(format!("{key}: required")))
}

/// `z.number().int().positive().safe()`.
pub fn positive_safe_int(value: &Js, field: &str) -> Result<f64> {
    match value {
        Js::Num(n) if n.fract() == 0.0 && *n > 0.0 && *n <= 9_007_199_254_740_991.0 => Ok(*n),
        _ => schema(&format!("{field}: positive safe integer")),
    }
}

/// `z.string().min(1).max(2048).startsWith('/').refine(no NUL)` (Claude/OpenCode paths).
pub fn slash_path(value: &Js, field: &str) -> Result<String> {
    let s = bounded(value, field, 1, 2048)?;
    if !s.starts_with('/') || s.contains('\0') {
        return schema(&format!("{field}: path"));
    }
    Ok(s.to_owned())
}

/// `z.string().min(1).max(2048).refine(isAbsolute)` (Codex paths; NUL is not refused).
pub fn absolute_path(value: &Js, field: &str) -> Result<String> {
    let s = bounded(value, field, 1, 2048)?;
    if !s.starts_with('/') {
        return schema(&format!("{field}: path"));
    }
    Ok(s.to_owned())
}

/// `Date.parse` for strings already accepted by [`datetime_pattern`].
pub fn date_parse(value: &str) -> Option<f64> {
    let b = value.as_bytes();
    let num =
        |from: usize, len: usize| -> i64 { value[from..from + len].parse::<i64>().unwrap_or(0) };
    let (year, month, day) = (num(0, 4), num(5, 2), num(8, 2));
    let (hour, minute, second) = (num(11, 2), num(14, 2), num(17, 2));
    let mut index = 19;
    let mut millis = 0i64;
    if b.get(index) == Some(&b'.') {
        index += 1;
        let start = index;
        while index < b.len() && b[index].is_ascii_digit() {
            index += 1;
        }
        let digits = &value[start..index];
        let padded: String = digits.chars().chain("000".chars()).take(3).collect();
        millis = padded.parse().unwrap_or(0);
    }
    let offset_minutes = match b.get(index) {
        Some(b'Z') => 0,
        Some(sign @ (b'+' | b'-')) => {
            let minutes = num(index + 1, 2) * 60 + num(index + 4, 2);
            if *sign == b'+' {
                minutes
            } else {
                -minutes
            }
        }
        _ => return None,
    };
    let days = days_from_civil(year, month, day);
    let ms = ((days * 24 + hour) * 60 + minute - offset_minutes) * 60_000 + second * 1000 + millis;
    Some(ms as f64)
}

fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn iso_dates() {
        assert!(datetime_pattern().is_match("2026-11-06T10:00:00.5+02:00"));
        assert!(!datetime_pattern().is_match("2026-11-06T10:00Z"));
        assert_eq!(date_parse("1970-01-01T00:00:00Z"), Some(0.0));
        assert_eq!(
            date_parse("2026-11-06T10:00:00.1239Z"),
            Some(1_793_959_200_123.0)
        );
        assert_eq!(
            date_parse("2026-11-06T12:00:00+02:00"),
            Some(1_793_959_200_000.0)
        );
    }
}
