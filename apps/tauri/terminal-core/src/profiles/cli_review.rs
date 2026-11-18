//! Native executable review evidence shared with the Node provisioning helper.
use super::config::{Binary, PreparationBinding};
use super::fsx::{lstat, realpath, terminal_directory, terminal_executable_sha256, terminal_file};
use serde::Deserialize;
use std::os::unix::fs::MetadataExt;
#[cfg(target_os = "macos")]
use std::path::Path;

#[derive(Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Signature {
    team_id: String,
    identifier: String,
    notarized: bool,
}

#[derive(PartialEq, Deserialize)]
#[serde(rename_all = "snake_case")]
enum Source {
    PackagedPin,
    SignatureContinuity,
    NativeReview,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Review {
    path: String,
    sha256: String,
    version: String,
    source: Source,
    signature: Option<Signature>,
    previous_sha256: Option<String>,
}

fn identity(provider: &str) -> Option<(&'static str, &'static str)> {
    match provider {
        "codex" => Some(("2DC432GLL2", "codex")),
        "claude" => Some(("Q6L2SF6YDW", "com.anthropic.claude-code")),
        "opencode" => Some(("5NZ4Q7NXJ4", "opencode")),
        "antigravity" => Some(("EQHXZ8M8AV", "cli")),
        _ => None,
    }
}

pub(super) fn version_label(version: &str) -> bool {
    let (base, suffix) = version.split_once('-').unwrap_or((version, ""));
    version.len() <= 40
        && base.split('.').count() == 3
        && base.split('.').all(|part| !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()))
        && (!version.contains('-') || (!suffix.is_empty() && suffix.bytes().all(|b|
            b.is_ascii_alphanumeric() || b == b'.' || b == b'-')))
}

fn digest(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

fn matches_review(
    review: &Review,
    provider: &str,
    executable: &Binary,
    version: &str,
    verify: impl FnOnce(&str, &Signature) -> bool,
) -> bool {
    if review.path != executable.path || review.sha256 != executable.sha256
        || review.version != version || !version_label(version) || !digest(&review.sha256)
    {
        return false;
    }
    match review.source {
        Source::NativeReview => true,
        Source::PackagedPin => false,
        Source::SignatureContinuity => {
            let Some(signature) = &review.signature else { return false };
            let Some((team_id, identifier)) = identity(provider) else { return false };
            review.previous_sha256.as_deref().is_some_and(|previous| digest(previous) && previous != review.sha256)
                && signature.team_id == team_id && signature.identifier == identifier
                && verify(&executable.path, signature)
        }
    }
}

pub(super) fn accepted_review(
    provider: &str,
    executable: &Binary,
    version: &str,
    preparation: Option<&PreparationBinding>,
) -> bool {
    let Some(preparation) = preparation else { return false };
    if identity(provider).is_none() { return false; }
    let directory = format!("{}/cli-executable-reviews", preparation.preferences_directory);
    let file = format!("{directory}/{provider}.json");
    if terminal_directory(&preparation.preferences_directory, true).is_err()
        || terminal_directory(&directory, true).is_err()
    {
        return false;
    }
    let Ok(metadata) = lstat(&file) else {
        return false;
    };
    if metadata.nlink() != 1 {
        return false;
    }
    let Ok(bytes) = terminal_file(&file, true, 4096, Some((metadata.dev(), metadata.ino()))) else {
        return false;
    };
    let Ok(review) = serde_json::from_slice::<Review>(&bytes) else { return false };
    if !realpath(&executable.path).is_ok_and(|path| path == executable.path) {
        return false;
    }
    matches_review(&review, provider, executable, version, |path, signature| {
        let Ok(before) = lstat(path) else { return false };
        if !terminal_executable_sha256(path).is_ok_and(|sha| sha == executable.sha256)
            || !verify_signature(path, signature)
        {
            return false;
        }
        realpath(path).is_ok_and(|canonical| canonical == path)
            && lstat(path).is_ok_and(|after| same_file(&before, &after))
    })
}

fn same_file(before: &std::fs::Metadata, after: &std::fs::Metadata) -> bool {
    before.dev() == after.dev()
        && before.ino() == after.ino()
        && before.len() == after.len()
        && before.modified().ok() == after.modified().ok()
        && before.ctime() == after.ctime()
        && before.ctime_nsec() == after.ctime_nsec()
        && before.mode() == after.mode()
        && before.uid() == after.uid()
        && before.gid() == after.gid()
}

#[cfg(not(target_os = "macos"))]
fn verify_signature(_path: &str, _signature: &Signature) -> bool {
    false
}

#[cfg(target_os = "macos")]
fn verify_signature(path: &str, signature: &Signature) -> bool {
    let team = &signature.team_id;
    let identifier = &signature.identifier;
    let notarization = if signature.notarized { " and notarized" } else { "" };
    let requirement = format!(
        "anchor apple generic and certificate 1[field.1.2.840.113635.100.6.2.6] exists \
         and certificate leaf[field.1.2.840.113635.100.6.1.13] exists \
         and certificate leaf[subject.OU] = \"{team}\" and identifier \"{identifier}\"{notarization}"
    );
    verify_requirement(Path::new(path), &requirement)
}

#[cfg(target_os = "macos")]
// Adapted from the Security.framework verifier in ORQST 4ad5e36.
fn verify_requirement(path: &Path, requirement: &str) -> bool {
    use std::ffi::{c_char, c_void, CString};
    use std::os::unix::ffi::OsStrExt;
    use std::ptr;

    type Ref = *const c_void;
    #[link(name = "CoreFoundation", kind = "framework")]
    extern "C" {
        fn CFURLCreateFromFileSystemRepresentation(
            allocator: Ref,
            bytes: *const u8,
            length: isize,
            is_directory: u8,
        ) -> Ref;
        fn CFStringCreateWithCString(allocator: Ref, bytes: *const c_char, encoding: u32) -> Ref;
        fn CFRelease(value: Ref);
    }
    #[link(name = "Security", kind = "framework")]
    extern "C" {
        fn SecStaticCodeCreateWithPath(path: Ref, flags: u32, code: *mut Ref) -> i32;
        fn SecRequirementCreateWithString(text: Ref, flags: u32, requirement: *mut Ref) -> i32;
        fn SecStaticCodeCheckValidity(code: Ref, flags: u32, requirement: Ref) -> i32;
    }
    if !path.is_absolute() || path.as_os_str().as_bytes().contains(&0) {
        return false;
    }
    let bytes = path.as_os_str().as_bytes();
    let Ok(length) = isize::try_from(bytes.len()) else {
        return false;
    };
    let Ok(requirement_text) = CString::new(requirement) else {
        return false;
    };
    // All CoreFoundation objects returned by Create are released exactly once.
    unsafe {
        let url = CFURLCreateFromFileSystemRepresentation(ptr::null(), bytes.as_ptr(), length, 0);
        if url.is_null() {
            return false;
        }
        let mut code = ptr::null();
        let code_status = SecStaticCodeCreateWithPath(url, 0, &mut code);
        CFRelease(url);
        if code_status != 0 || code.is_null() {
            return false;
        }
        let text = CFStringCreateWithCString(ptr::null(), requirement_text.as_ptr(), 0x0800_0100);
        if text.is_null() {
            CFRelease(code);
            return false;
        }
        let mut requirement = ptr::null();
        let requirement_status = SecRequirementCreateWithString(text, 0, &mut requirement);
        CFRelease(text);
        let valid = requirement_status == 0
            && !requirement.is_null()
            // All architectures plus strict validation, from SecStaticCode.h.
            && SecStaticCodeCheckValidity(code, (1 << 0) | (1 << 4), requirement) == 0;
        if !requirement.is_null() {
            CFRelease(requirement);
        }
        CFRelease(code);
        valid
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "read-only check for the four installed macOS CLIs"]
    fn installed_cli_developer_id_and_notarization() {
        let home = std::env::var("HOME").unwrap();
        for (provider, launcher) in [
            ("antigravity", ".local/bin/agy"),
            ("codex", ".local/bin/codex"),
            ("opencode", ".opencode/bin/opencode"),
            ("claude", ".local/bin/claude"),
        ] {
            let (team, identifier) = identity(provider).unwrap();
            let path = realpath(&format!("{home}/{launcher}")).unwrap();
            assert!(verify_signature(
                &path,
                &Signature { team_id: team.into(), identifier: identifier.into(), notarized: true },
            ), "Developer ID and notarization for {provider}");
        }
    }

    #[test]
    fn continuity_requires_the_same_canonical_path_digest_and_developer_identity() {
        let executable = Binary { path: "/private/synthetic/agy".into(), sha256: "b".repeat(64) };
        let mut review = Review {
            path: executable.path.clone(),
            sha256: executable.sha256.clone(),
            version: "1.5.11".into(),
            source: Source::SignatureContinuity,
            signature: Some(Signature {
                team_id: "EQHXZ8M8AV".into(), identifier: "cli".into(), notarized: true,
            }),
            previous_sha256: Some("a".repeat(64)),
        };
        assert!(matches_review(&review, "antigravity", &executable, "1.5.11", |_, signature| signature.notarized));
        assert!(!matches_review(&review, "antigravity", &executable, "1.5.11", |_, _| false));
        review.signature.as_mut().unwrap().team_id = "AAAAAAAAAA".into();
        assert!(!matches_review(&review, "antigravity", &executable, "1.5.11", |_, _| panic!("foreign team")));
        review.signature = None;
        assert!(!matches_review(&review, "antigravity", &executable, "1.5.11", |_, _| panic!("unsigned")));
        review.source = Source::NativeReview;
        assert!(matches_review(&review, "antigravity", &executable, "1.5.11", |_, _| panic!("exact manual review")));
        let moved = Binary { path: "/private/synthetic/moved/agy".into(), ..executable.clone() };
        assert!(!matches_review(&review, "antigravity", &moved, "1.5.11", |_, _| true));
        let modified = Binary { sha256: "c".repeat(64), ..executable };
        assert!(!matches_review(&review, "antigravity", &modified, "1.5.11", |_, _| true));
    }
}
