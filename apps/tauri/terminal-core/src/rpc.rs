//! Strict parsing of `terminalRPCSchema` (rpc.ts). Unknown keys, wrong types or out-of-range
//! values are refusals, exactly like the zod strict objects.
use serde_json::{Map, Value};

pub fn is_uuid(value: &Value) -> bool {
    // zod 4 `z.string().uuid()`: RFC 9562 variant/version shape, any case.
    value.as_str().is_some_and(|s| {
        let b = s.as_bytes();
        b.len() == 36
            && [8, 13, 18, 23].iter().all(|&i| b[i] == b'-')
            && b.iter().enumerate().all(|(i, c)| [8, 13, 18, 23].contains(&i) || c.is_ascii_hexdigit())
            && matches!(b[14], b'1'..=b'8')
            && matches!(b[19], b'8' | b'9' | b'a' | b'b' | b'A' | b'B')
    }) || value.as_str().is_some_and(|s| s == "00000000-0000-0000-0000-000000000000" || s.eq_ignore_ascii_case("ffffffff-ffff-ffff-ffff-ffffffffffff"))
}

pub fn safe_nonnegative(value: &Value) -> Option<u64> {
    value.as_u64().filter(|n| *n <= 9_007_199_254_740_991).filter(|_| value.is_u64())
}

fn text(value: &Value, max: usize) -> Option<String> {
    value.as_str().filter(|s| {
        let units = s.encode_utf16().count();
        units >= 1 && units <= max
    }).map(str::to_owned)
}

fn proof(value: &Value) -> bool {
    value.as_object().is_some_and(|o| {
        o.len() == 2
            && o.get("challengeId").is_some_and(is_uuid)
            && o.get("signature").and_then(Value::as_str).is_some_and(|s| (1..=128).contains(&s.encode_utf16().count()))
    })
}

fn signal(value: &Value) -> bool {
    matches!(value.as_str(), Some("SIGTERM" | "SIGKILL"))
}

pub const PROFILES: [&str; 4] = ["codex-login-v1", "codex-terminal-v1", "claude-terminal-v1", "opencode-terminal-v1"];

/// A validated terminal request: `{ id, operation, args }`.
#[derive(Debug, Clone)]
pub struct Request {
    pub id: String,
    pub operation: String,
    pub args: Vec<Value>,
}

pub fn parse(raw: &Value) -> Option<Request> {
    let o: &Map<String, Value> = raw.as_object()?;
    if o.len() != 3 || !o.get("id").is_some_and(is_uuid) {
        return None;
    }
    let operation = o.get("operation")?.as_str()?;
    let args = o.get("args")?.as_array()?;
    let a = |i: usize| args.get(i).unwrap_or(&Value::Null);
    let client = |i: usize| a(i).as_str() == Some("desktop-managed");
    let n = |count: usize| args.len() == count;
    let ok = match operation {
        "prepare" => n(2) && client(0) && a(1).as_str().is_some_and(|p| PROFILES.contains(&p)),
        "launch" | "attach" => n(2) && is_uuid(a(0)) && proof(a(1)),
        "snapshot" | "canvasSessionEvidence" => n(1) && is_uuid(a(0)),
        "requestAttach" => n(2) && client(0) && is_uuid(a(1)),
        "requestInput" | "detach" | "revokeInput" => n(2) && is_uuid(a(0)) && is_uuid(a(1)),
        "enableInput" => n(3) && is_uuid(a(0)) && is_uuid(a(1)) && proof(a(2)),
        "requestPaste" => {
            n(5) && (0..3).all(|i| is_uuid(a(i))) && safe_nonnegative(a(3)).is_some() && text(a(4), 16 * 1024).is_some()
        }
        "paste" => {
            n(6) && (0..3).all(|i| is_uuid(a(i)))
                && safe_nonnegative(a(3)).is_some()
                && text(a(4), 16 * 1024).is_some()
                && proof(a(5))
        }
        "requestStop" => n(3) && client(0) && is_uuid(a(1)) && signal(a(2)),
        "stop" => n(3) && is_uuid(a(0)) && signal(a(1)) && proof(a(2)),
        "write" => {
            n(5) && (0..3).all(|i| is_uuid(a(i))) && safe_nonnegative(a(3)).is_some() && text(a(4), 4096).is_some()
        }
        "resize" => {
            n(4) && is_uuid(a(0)) && is_uuid(a(1))
                && a(2).as_u64().is_some_and(|c| (20..=300).contains(&c))
                && a(3).as_u64().is_some_and(|r| (5..=100).contains(&r))
        }
        "read" => n(3) && is_uuid(a(0)) && is_uuid(a(1)) && safe_nonnegative(a(2)).is_some(),
        _ => false,
    };
    ok.then(|| Request { id: o["id"].as_str().unwrap().to_owned(), operation: operation.to_owned(), args: args.clone() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    const U: &str = "00000000-0000-4000-8000-000000000001";

    #[test]
    fn strict_shapes() {
        assert!(parse(&json!({"id": U, "operation": "snapshot", "args": [U]})).is_some());
        assert!(parse(&json!({"id": U, "operation": "snapshot", "args": [U], "x": 1})).is_none());
        assert!(parse(&json!({"id": U, "operation": "resize", "args": [U, U, 19, 24]})).is_none());
        assert!(parse(&json!({"id": U, "operation": "write", "args": [U, U, U, 0, ""]})).is_none());
        assert!(parse(&json!({"id": U, "operation": "write", "args": [U, U, U, -1, "a"]})).is_none());
        assert!(parse(&json!({"id": U, "operation": "stop", "args": [U, "SIGHUP", {"challengeId": U, "signature": "s"}]})).is_none());
        assert!(parse(&json!({"id": U, "operation": "prepare", "args": ["desktop-managed", "claude-terminal-v1"]})).is_some());
        assert!(parse(&json!({"id": "not-a-uuid", "operation": "snapshot", "args": [U]})).is_none());
    }
}
