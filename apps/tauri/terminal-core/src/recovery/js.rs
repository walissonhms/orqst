//! `JSON.parse` / `JSON.stringify` semantics over ordered `serde_json::Value`s.
//! Parsing goes through [`crate::profiles::js`] so object keys keep ECMAScript property order.
use super::error::{invalid, Result};
use crate::admission::json as ajson;
use crate::profiles::js::{self, Js};
use serde_json::{Map, Number, Value};

fn from_js(value: Js) -> Value {
    match value {
        Js::Null => Value::Null,
        Js::Bool(b) => Value::Bool(b),
        Js::Num(n) => {
            if n.is_finite()
                && n.fract() == 0.0
                && n.abs() <= 9_007_199_254_740_991.0
                && !(n == 0.0 && n.is_sign_negative())
            {
                Value::Number(Number::from(n as i64))
            } else {
                Number::from_f64(n).map_or(Value::Null, Value::Number)
            }
        }
        Js::Str(s) => Value::String(s),
        Js::Arr(items) => Value::Array(items.into_iter().map(from_js).collect()),
        Js::Obj(entries) => {
            let mut map = Map::new();
            for (key, item) in entries {
                map.insert(key, from_js(item));
            }
            Value::Object(map)
        }
    }
}

/// `JSON.parse(Buffer.from(bytes).toString('utf8'))`.
pub fn parse(bytes: &[u8]) -> Result<Value> {
    js::parse_bytes(bytes)
        .map(from_js)
        .map_err(|error| invalid(format!("SyntaxError: {error}")))
}

/// `JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))`.
pub fn parse_fatal(bytes: &[u8]) -> Result<Value> {
    let text = std::str::from_utf8(bytes).map_err(|_| invalid("TypeError: invalid utf-8"))?;
    parse(text.as_bytes())
}

/// `JSON.stringify(value)`.
pub fn stringify(value: &Value) -> String {
    ajson::stringify(value)
}

/// `JSON.stringify(value, null, 2)`.
pub fn pretty(value: &Value) -> String {
    let mut out = String::new();
    write_pretty(&mut out, value, 0);
    out
}

fn indent(out: &mut String, depth: usize) {
    out.push('\n');
    for _ in 0..depth {
        out.push_str("  ");
    }
}

fn write_pretty(out: &mut String, value: &Value, depth: usize) {
    match value {
        Value::Array(items) if !items.is_empty() => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                indent(out, depth + 1);
                write_pretty(out, item, depth + 1);
            }
            indent(out, depth);
            out.push(']');
        }
        Value::Object(map) if !map.is_empty() => {
            out.push('{');
            for (index, (key, item)) in map.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                indent(out, depth + 1);
                out.push_str(&ajson::stringify(&Value::String(key.clone())));
                out.push_str(": ");
                write_pretty(out, item, depth + 1);
            }
            indent(out, depth);
            out.push('}');
        }
        other => out.push_str(&ajson::stringify(other)),
    }
}

/// Number value for an `f64` (integers keep their exact `i64` form).
pub fn number(value: f64) -> Value {
    if value.is_finite() && value.fract() == 0.0 && value.abs() <= 9_007_199_254_740_991.0 {
        Value::Number(Number::from(value as i64))
    } else {
        Number::from_f64(value).map_or(Value::Null, Value::Number)
    }
}

/// Ordered object literal.
pub fn obj<const N: usize>(entries: [(&str, Value); N]) -> Value {
    let mut map = Map::new();
    for (key, value) in entries {
        map.insert(key.to_owned(), value);
    }
    Value::Object(map)
}

/// Object spread `{ ...base, key: value }` preserving V8 order (existing keys keep position).
pub fn with(base: &Value, entries: &[(&str, Value)]) -> Value {
    let mut map = base.as_object().cloned().unwrap_or_default();
    for (key, value) in entries {
        map.insert((*key).to_owned(), value.clone());
    }
    Value::Object(map)
}

pub fn s(value: &str) -> Value {
    Value::String(value.to_owned())
}

/// JavaScript default `Array.prototype.sort` for strings (UTF-16 code unit order).
pub fn sort_js(values: &mut [String]) {
    values.sort_by(|a, b| a.encode_utf16().cmp(b.encode_utf16()));
}
