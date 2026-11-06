//! JavaScript value semantics needed for byte-equal digests: an ordered object model
//! (ECMAScript property order), `JSON.parse` and `JSON.stringify`.
use serde::de::{self, Deserializer, MapAccess, SeqAccess, Visitor};
use std::fmt;

/// A parsed JSON value with ECMAScript own-property order (array-index keys ascending first,
/// then insertion order; a duplicate key keeps its first position and the last value).
#[derive(Clone, Debug, PartialEq)]
pub enum Js {
    Null,
    Bool(bool),
    Num(f64),
    Str(String),
    Arr(Vec<Js>),
    Obj(Vec<(String, Js)>),
}

fn array_index(key: &str) -> Option<u64> {
    if key.is_empty() || key.len() > 10 || !key.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    if key.len() > 1 && key.starts_with('0') {
        return None;
    }
    let value: u64 = key.parse().ok()?;
    (value < 4_294_967_295).then_some(value)
}

/// `object[key] = value` with JavaScript ordering.
pub fn obj_set(entries: &mut Vec<(String, Js)>, key: &str, value: Js) {
    if let Some(entry) = entries.iter_mut().find(|(k, _)| k == key) {
        entry.1 = value;
        return;
    }
    if let Some(index) = array_index(key) {
        let at = entries
            .iter()
            .position(|(k, _)| array_index(k).is_none_or(|other| other > index))
            .unwrap_or(entries.len());
        entries.insert(at, (key.to_owned(), value));
    } else {
        entries.push((key.to_owned(), value));
    }
}

impl Js {
    pub fn str(value: &str) -> Js {
        Js::Str(value.to_owned())
    }
    pub fn strs<I: IntoIterator<Item = S>, S: AsRef<str>>(values: I) -> Js {
        Js::Arr(values.into_iter().map(|v| Js::str(v.as_ref())).collect())
    }
    /// Object literal in source order (keys are assigned in this order).
    pub fn obj<I: IntoIterator<Item = (S, Js)>, S: AsRef<str>>(entries: I) -> Js {
        let mut out = Vec::new();
        for (k, v) in entries {
            obj_set(&mut out, k.as_ref(), v);
        }
        Js::Obj(out)
    }
    pub fn get(&self, key: &str) -> Option<&Js> {
        match self {
            Js::Obj(entries) => entries.iter().find(|(k, _)| k == key).map(|(_, v)| v),
            _ => None,
        }
    }
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Js::Str(s) => Some(s),
            _ => None,
        }
    }
    pub fn is_object(&self) -> bool {
        matches!(self, Js::Obj(_))
    }

    /// `JSON.stringify(value)`.
    pub fn stringify(&self) -> String {
        let mut out = String::new();
        self.write(&mut out);
        out
    }

    fn write(&self, out: &mut String) {
        match self {
            Js::Null => out.push_str("null"),
            Js::Bool(b) => out.push_str(if *b { "true" } else { "false" }),
            Js::Num(n) => out.push_str(&number(*n)),
            Js::Str(s) => quote_into(s, out),
            Js::Arr(items) => {
                out.push('[');
                for (i, item) in items.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    item.write(out);
                }
                out.push(']');
            }
            Js::Obj(entries) => {
                out.push('{');
                for (i, (k, v)) in entries.iter().enumerate() {
                    if i > 0 {
                        out.push(',');
                    }
                    quote_into(k, out);
                    out.push(':');
                    v.write(out);
                }
                out.push('}');
            }
        }
    }
}

/// `Number.prototype.toString()` as used by `JSON.stringify`.
pub fn number(n: f64) -> String {
    if !n.is_finite() {
        return "null".into();
    }
    if n == 0.0 {
        return "0".into();
    }
    let abs = n.abs();
    if (1e-6..1e21).contains(&abs) {
        return format!("{n}");
    }
    let formatted = format!("{n:e}");
    match formatted.split_once('e') {
        Some((mantissa, exponent)) if !exponent.starts_with('-') => {
            format!("{mantissa}e+{exponent}")
        }
        _ => formatted,
    }
}

/// `JSON.stringify(string)`.
pub fn quote(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 2);
    quote_into(value, &mut out);
    out
}

fn quote_into(value: &str, out: &mut String) {
    out.push('"');
    for c in value.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
}

/// `JSON.parse(text)`. Lone UTF-16 surrogate escapes are refused (JavaScript accepts them).
pub fn parse(text: &str) -> Result<Js, String> {
    serde_json::from_str::<Js>(text).map_err(|error| error.to_string())
}

/// `JSON.parse(buffer.toString('utf8'))`.
pub fn parse_bytes(bytes: &[u8]) -> Result<Js, String> {
    parse(&String::from_utf8_lossy(bytes))
}

/// JavaScript `string.length` (UTF-16 code units).
pub fn js_len(value: &str) -> usize {
    value.encode_utf16().count()
}

impl<'de> serde::Deserialize<'de> for Js {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Js, D::Error> {
        struct JsVisitor;
        impl<'de> Visitor<'de> for JsVisitor {
            type Value = Js;
            fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
                f.write_str("a JSON value")
            }
            fn visit_bool<E>(self, v: bool) -> Result<Js, E> {
                Ok(Js::Bool(v))
            }
            fn visit_i64<E>(self, v: i64) -> Result<Js, E> {
                Ok(Js::Num(v as f64))
            }
            fn visit_u64<E>(self, v: u64) -> Result<Js, E> {
                Ok(Js::Num(v as f64))
            }
            fn visit_f64<E>(self, v: f64) -> Result<Js, E> {
                Ok(Js::Num(v))
            }
            fn visit_str<E: de::Error>(self, v: &str) -> Result<Js, E> {
                Ok(Js::str(v))
            }
            fn visit_string<E>(self, v: String) -> Result<Js, E> {
                Ok(Js::Str(v))
            }
            fn visit_unit<E>(self) -> Result<Js, E> {
                Ok(Js::Null)
            }
            fn visit_none<E>(self) -> Result<Js, E> {
                Ok(Js::Null)
            }
            fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Js, A::Error> {
                let mut items = Vec::new();
                while let Some(item) = seq.next_element()? {
                    items.push(item);
                }
                Ok(Js::Arr(items))
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Js, A::Error> {
                let mut entries = Vec::new();
                while let Some((k, v)) = map.next_entry::<String, Js>()? {
                    obj_set(&mut entries, &k, v);
                }
                Ok(Js::Obj(entries))
            }
        }
        deserializer.deserialize_any(JsVisitor)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn javascript_property_order_and_escaping() {
        let value = parse(r#"{"b":1,"2":2,"a":3,"1":4,"b":5,"01":6}"#).unwrap();
        assert_eq!(value.stringify(), r#"{"1":4,"2":2,"b":5,"a":3,"01":6}"#);
        assert_eq!(
            quote("\u{1}\u{7f}\u{2028}é\"\\\n"),
            "\"\\u0001\u{7f}\u{2028}é\\\"\\\\\\n\""
        );
        assert_eq!(number(1e21), "1e+21");
        assert_eq!(number(1.5e-7), "1.5e-7");
        assert_eq!(number(1_700_000_000_000.0), "1700000000000");
        assert_eq!(number(0.5), "0.5");
    }
}
