//! Metadata-only private query helper for the legacy Electron host.
#[cfg(target_os = "macos")]
#[allow(dead_code)]
#[path = "terminal_kernel_identity.rs"]
mod terminal_kernel_identity;
#[cfg(target_os = "macos")]
#[allow(dead_code)]
#[path = "terminal_kernel_scan.rs"]
mod terminal_kernel_scan;
#[cfg(target_os = "macos")]
mod features {
    pub fn uuid(value: &serde_json::Value) -> bool {
        value.as_str().is_some_and(|value| {
            value.len() == 36
                && value.bytes().enumerate().all(|(i, byte)| match i {
                    8 | 13 | 18 | 23 => byte == b'-',
                    _ => byte.is_ascii_hexdigit(),
                })
        })
    }
}

#[cfg(target_os = "macos")]
fn main() {
    use std::io::Read;
    let mut input = String::new();
    if std::io::stdin()
        .take(8193)
        .read_to_string(&mut input)
        .is_err()
        || input.len() > 8192
    {
        std::process::exit(1);
    }
    let Ok(request) = serde_json::from_str::<serde_json::Value>(&input) else {
        std::process::exit(1)
    };
    let value = match request["operation"].as_str() {
        Some("identity") => request["pid"]
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .and_then(|pid| terminal_kernel_identity::read_process(pid).ok())
            .map(|v| v.as_json()),
        Some("exists") => terminal_kernel_identity::KernelIdentity::from_json(&request["identity"])
            .and_then(|v| terminal_kernel_scan::mutation_owner_exists(&v).ok())
            .map(serde_json::Value::Bool),
        _ => None,
    };
    println!("{}", value.unwrap_or(serde_json::Value::Null));
}

#[cfg(not(target_os = "macos"))]
fn main() {
    std::process::exit(1);
}
