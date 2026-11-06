//! `JSON.parse` / `JSON.stringify` compatibility and the zod checks used by lane L3.
//! `serde_json` runs with `preserve_order`, so object keys keep insertion order like V8.
use super::error::{invalid, Result};
use serde_json::{Map, Value};

/// `JSON.parse(buffer.toString('utf8'))`: invalid UTF-8 becomes U+FFFD before parsing.
pub fn parse(bytes: &[u8]) -> Result<Value> {
    let text = String::from_utf8_lossy(bytes);
    serde_json::from_str(&text).map_err(|error| invalid(format!("SyntaxError: {error}")))
}

/// Byte-compatible `JSON.stringify` for JSON values (numbers use the ECMAScript format).
pub fn stringify(value: &Value) -> String {
    let mut out = String::new();
    write_value(&mut out, value);
    out
}

/// `JSON.stringify` of a serializable Rust value (field order = declaration order).
pub fn stringify_serialize<T: serde::Serialize>(value: &T) -> String {
    stringify(&serde_json::to_value(value).expect("serializable admission record"))
}

fn write_value(out: &mut String, value: &Value) {
    match value {
        Value::Null => out.push_str("null"),
        Value::Bool(flag) => out.push_str(if *flag { "true" } else { "false" }),
        Value::Number(number) => {
            if let Some(integer) = number.as_i64() {
                out.push_str(&js_number(integer as f64, Some(integer.to_string())));
            } else if let Some(integer) = number.as_u64() {
                out.push_str(&js_number(integer as f64, None));
            } else {
                out.push_str(&js_number(number.as_f64().unwrap_or(f64::NAN), None));
            }
        }
        Value::String(text) => {
            out.push_str(&serde_json::to_string(text).expect("string serialization"))
        }
        Value::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_value(out, item);
            }
            out.push(']');
        }
        Value::Object(map) => {
            out.push('{');
            for (index, (key, item)) in map.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                out.push_str(&serde_json::to_string(key).expect("key serialization"));
                out.push(':');
                write_value(out, item);
            }
            out.push('}');
        }
    }
}

/// ECMAScript `Number::toString` for finite values; non-finite values stringify as `null`.
pub fn js_number(value: f64, exact: Option<String>) -> String {
    if !value.is_finite() {
        return "null".into();
    }
    if value == 0.0 {
        return "0".into();
    }
    let magnitude = value.abs();
    if (1e-6..1e21).contains(&magnitude) {
        if value.fract() == 0.0 && magnitude <= 9_007_199_254_740_991.0 {
            if let Some(exact) = exact {
                return exact;
            }
        }
        // Rust's shortest round-trip digits, never in exponent form in this range.
        return format!("{value}");
    }
    let formatted = format!("{value:e}");
    match formatted.split_once('e') {
        Some((mantissa, exponent)) if !exponent.starts_with('-') => {
            format!("{mantissa}e+{exponent}")
        }
        _ => formatted,
    }
}

/// zod v4 `z.uuid()` (RFC 9562 variant/version, plus nil and max).
pub fn is_uuid(value: &str) -> bool {
    if value == "00000000-0000-0000-0000-000000000000"
        || value == "ffffffff-ffff-ffff-ffff-ffffffffffff"
    {
        return true;
    }
    let bytes = value.as_bytes();
    if bytes.len() != 36 {
        return false;
    }
    for (index, byte) in bytes.iter().enumerate() {
        let ok = match index {
            8 | 13 | 18 | 23 => *byte == b'-',
            14 => (b'1'..=b'8').contains(byte),
            19 => matches!(byte, b'8' | b'9' | b'a' | b'b' | b'A' | b'B'),
            _ => byte.is_ascii_hexdigit(),
        };
        if !ok {
            return false;
        }
    }
    true
}

/// `/^[a-f0-9]{64}$/`.
pub fn is_digest(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

/// zod `strictObject`: an object whose keys are all known. Required keys are checked by callers.
pub fn strict<'a>(value: &'a Value, keys: &[&str]) -> Result<&'a Map<String, Value>> {
    let map = value
        .as_object()
        .ok_or_else(|| invalid("expected object"))?;
    if let Some(key) = map.keys().find(|key| !keys.contains(&key.as_str())) {
        return Err(invalid(format!("unrecognized key {key}")));
    }
    Ok(map)
}

/// zod `object` (non-strict): unknown keys are stripped.
pub fn object(value: &Value) -> Result<&Map<String, Value>> {
    value.as_object().ok_or_else(|| invalid("expected object"))
}

pub fn string<'a>(map: &'a Map<String, Value>, key: &str) -> Result<&'a str> {
    map.get(key)
        .and_then(Value::as_str)
        .ok_or_else(|| invalid(format!("{key}: expected string")))
}

pub fn uuid(map: &Map<String, Value>, key: &str) -> Result<String> {
    let value = string(map, key)?;
    if !is_uuid(value) {
        return Err(invalid(format!("{key}: invalid uuid")));
    }
    Ok(value.to_owned())
}

/// `z.number().int()` within ±(2^53 - 1) (`.safe()`); returns the integer value.
pub fn safe_int(value: &Value) -> Option<i64> {
    let number = value.as_f64()?;
    if !number.is_finite() || number.fract() != 0.0 || number.abs() > 9_007_199_254_740_991.0 {
        return None;
    }
    Some(number as i64)
}

pub fn literal_one(value: Option<&Value>) -> bool {
    value.and_then(Value::as_f64) == Some(1.0)
}

/// Length in UTF-16 code units, as zod `.max()` counts JavaScript strings.
pub fn utf16_len(value: &str) -> usize {
    value.encode_utf16().count()
}
