//! Dashboard document paths, matching protocol/src/dashboard-routes.ts.
//! Origin, credentials, query and the exact unavailable document stay with the caller.

pub fn dashboard_path_allowed(path: &str) -> bool {
    if matches!(
        path,
        "/" | "/overview"
            | "/studio"
            | "/workspaces"
            | "/agents"
            | "/models"
            | "/artifacts"
            | "/settings"
    ) {
        return true;
    }
    if path.len() > 1820 {
        return false;
    }
    let Some(segment) = path.strip_prefix("/overview/sessions/") else {
        return false;
    };
    let mut decoded = Vec::with_capacity(segment.len());
    let mut bytes = segment.bytes();
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let Some(high) = bytes.next().and_then(uppercase_hex) else {
                return false;
            };
            let Some(low) = bytes.next().and_then(uppercase_hex) else {
                return false;
            };
            let byte = high * 16 + low;
            // encodeURIComponent leaves these bytes literal, never percent-encoded.
            if component_literal(byte) {
                return false;
            }
            decoded.push(byte);
        } else if component_literal(byte) {
            decoded.push(byte);
        } else {
            return false;
        }
    }
    let Ok(id) = std::str::from_utf8(&decoded) else {
        return false;
    };
    !id.is_empty()
        && id.encode_utf16().count() <= 200
        && id != "."
        && id != ".."
        && !id.chars().any(|c| {
            matches!(c, '\\' | '/' | '%') || (c as u32) < 32 || (127..=159).contains(&(c as u32))
        })
}

fn component_literal(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&byte)
}

fn uppercase_hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bootstrap_and_every_current_spa_view_are_documents() {
        for path in [
            "/",
            "/overview",
            "/studio",
            "/workspaces",
            "/agents",
            "/models",
            "/artifacts",
            "/settings",
        ] {
            assert!(dashboard_path_allowed(path), "{path}");
        }
    }

    #[test]
    fn api_assets_and_nearby_paths_are_not_documents() {
        for path in [
            "",
            "/api/snapshot",
            "/api/bootstrap",
            "/ws",
            "/assets/app.js",
            "/index.html",
            "/settings/",
            "/studio/nested",
            "/%73ettings",
            "/Overview",
            "/arbitrary",
        ] {
            assert!(!dashboard_path_allowed(path), "{path}");
        }
    }

    #[test]
    fn session_ids_preserve_canonical_component_encoding() {
        for id in [
            "synthetic",
            "a-b_c.!~*'()",
            "a%20b",
            "a%3Ab",
            "%C3%A9",
            "%F0%9F%98%80",
        ] {
            assert!(
                dashboard_path_allowed(&format!("/overview/sessions/{id}")),
                "{id}"
            );
        }
        for id in [
            "", ".", "..", "a/b", "%2F", "%5C", "%25", "%00", "%1F", "%7F", "%C2%80", "%C2%9F",
            "%61", "%2E", "%c3%a9", "%", "%A", "%GG", "%FF", "%C0%AF", "é", "a:b", "a b", "a?b",
            "a#b", "a\\b", "a%252Fb",
        ] {
            assert!(
                !dashboard_path_allowed(&format!("/overview/sessions/{id}")),
                "{id}"
            );
        }
    }

    #[test]
    fn session_id_limit_counts_javascript_utf16_units() {
        for id in [
            "a".repeat(200),
            "%C3%A9".repeat(200),
            "%F0%9F%98%80".repeat(100),
        ] {
            assert!(dashboard_path_allowed(&format!("/overview/sessions/{id}")));
        }
        for id in [
            "a".repeat(201),
            "%C3%A9".repeat(201),
            "%F0%9F%98%80".repeat(101),
        ] {
            assert!(!dashboard_path_allowed(&format!("/overview/sessions/{id}")));
        }
    }
}
