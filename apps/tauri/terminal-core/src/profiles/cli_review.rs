//! Native executable review evidence shared with the Node provisioning helper.
use super::config::{Binary, PreparationBinding};
use super::fsx::{
    getuid, lstat, realpath, terminal_directory, terminal_executable_sha256, terminal_file,
};
use super::nodepath::resolve;
use serde::Deserialize;
use std::os::unix::fs::MetadataExt;
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
    SignatureContinuityVersionDir,
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
    launcher: Option<String>,
    install_root: Option<String>,
    previous_path: Option<String>,
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

fn absolute_path(path: &str) -> bool {
    (2..=2048).contains(&path.len())
        && path.starts_with('/')
        && !path.contains('\0')
        && resolve(path) == path
}

fn version_directory<'a>(root: &str, path: &'a str) -> Option<&'a str> {
    if !absolute_path(root) || !absolute_path(path) {
        return None;
    }
    let (directory, _) = path.strip_prefix(root)?.strip_prefix('/')?.split_once('/')?;
    version_label(directory).then_some(directory)
}

fn directory_matches_version(directory: &str, version: &str) -> bool {
    directory == version
        || directory.strip_prefix(version).is_some_and(|tail| tail.starts_with('-'))
}

fn version_directory_move(
    root: &str,
    previous_path: &str,
    path: &str,
    launcher: &str,
    previous_version: Option<&str>,
    next_version: Option<&str>,
) -> bool {
    let Some(from) = version_directory(root, previous_path) else {
        return false;
    };
    let Some(to) = version_directory(root, path) else {
        return false;
    };
    if from == to
        || previous_version.is_some_and(|version| !directory_matches_version(from, version))
        || next_version.is_some_and(|version| !directory_matches_version(to, version))
        || !absolute_path(launcher)
        || !std::fs::canonicalize(launcher).is_ok_and(|target| target.as_os_str() == path)
        || !std::fs::canonicalize(path).is_ok_and(|target| target.as_os_str() == path)
    {
        return false;
    }
    let uid = getuid();
    for dir in Path::new(path).ancestors().skip(1) {
        let Ok(info) = std::fs::symlink_metadata(dir) else {
            return false;
        };
        if !info.is_dir() || (info.uid() != 0 && info.uid() != uid) || info.mode() & 0o022 != 0 {
            return false;
        }
        if dir.as_os_str() == root {
            return true;
        }
    }
    false
}

fn valid_recorded_version_move(review: &Review) -> bool {
    let (Some(root), Some(previous), Some(launcher)) =
        (&review.install_root, &review.previous_path, &review.launcher)
    else {
        return false;
    };
    version_directory_move(
        root,
        previous,
        &review.path,
        launcher,
        None,
        Some(&review.version),
    )
}

fn publisher_matches(provider: &str, signature: &Signature) -> bool {
    identity(provider).is_some_and(|(team, identifier)| {
        signature.team_id == team && signature.identifier == identifier
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct VersionCandidate {
    path: String,
    sha256: String,
    launcher: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct VersionDirectoryUpdate {
    provider: String,
    candidate: VersionCandidate,
}

fn verify_version_directory_update(
    previous: &Review,
    update: &VersionDirectoryUpdate,
    verify: impl FnOnce(&str, &Signature) -> bool,
) -> bool {
    let candidate = &update.candidate;
    let (Some(root), Some(launcher), Some(signature)) =
        (&previous.install_root, &previous.launcher, &previous.signature)
    else {
        return false;
    };
    let path_matches = || {
        version_directory_move(
            root,
            &previous.path,
            &candidate.path,
            launcher,
            Some(&previous.version),
            None,
        )
    };
    launcher == &candidate.launcher
        && version_label(&previous.version)
        && digest(&previous.sha256)
        && digest(&candidate.sha256)
        && publisher_matches(&update.provider, signature)
        && path_matches()
        && verify(&candidate.path, signature)
        && path_matches()
}

/// Called by the native shell at its committed, focused CLI evidence gate.
pub fn verify_cli_version_directory_update(preferences: &Path, update: serde_json::Value) -> bool {
    let Ok(update) = serde_json::from_value::<VersionDirectoryUpdate>(update) else {
        return false;
    };
    let Some(previous) = preferences
        .to_str()
        .and_then(|path| read_review(path, &update.provider))
    else {
        return false;
    };
    verify_version_directory_update(&previous, &update, |path, signature| {
        verify_executable(path, &update.candidate.sha256, signature)
    })
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
        Source::SignatureContinuity | Source::SignatureContinuityVersionDir => {
            let Some(signature) = &review.signature else {
                return false;
            };
            let version_move = review.source == Source::SignatureContinuityVersionDir;
            let trusted_path = || !version_move || valid_recorded_version_move(review);
            review.previous_sha256.as_deref().is_some_and(|previous| {
                digest(previous) && (version_move || previous != review.sha256)
            })
                && publisher_matches(provider, signature)
                && trusted_path()
                && verify(&executable.path, signature)
                && trusted_path()
        }
    }
}

fn read_review(preferences: &str, provider: &str) -> Option<Review> {
    identity(provider)?;
    let directory = format!("{preferences}/cli-executable-reviews");
    let file = format!("{directory}/{provider}.json");
    terminal_directory(preferences, true).ok()?;
    terminal_directory(&directory, true).ok()?;
    let metadata = lstat(&file).ok()?;
    if metadata.nlink() != 1 {
        return None;
    }
    let bytes = terminal_file(&file, true, 32 * 1024, Some((metadata.dev(), metadata.ino()))).ok()?;
    serde_json::from_slice(&bytes).ok()
}

pub(super) fn accepted_review(
    provider: &str,
    executable: &Binary,
    version: &str,
    preparation: Option<&PreparationBinding>,
) -> bool {
    let Some(review) =
        preparation.and_then(|value| read_review(&value.preferences_directory, provider))
    else {
        return false;
    };
    if !realpath(&executable.path).is_ok_and(|path| path == executable.path) {
        return false;
    }
    matches_review(&review, provider, executable, version, |path, signature| {
        verify_executable(path, &executable.sha256, signature)
    })
}

fn verify_executable(path: &str, sha256: &str, signature: &Signature) -> bool {
    let Ok(before) = lstat(path) else { return false };
    if !terminal_executable_sha256(path).is_ok_and(|sha| sha == sha256)
        || !verify_signature(path, signature)
    {
        return false;
    }
    realpath(path).is_ok_and(|canonical| canonical == path)
        && lstat(path).is_ok_and(|after| same_file(&before, &after))
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
    fn version_directory_update_requires_the_reviewed_launcher_trust_chain_and_publisher() {
        use std::fs::{self, Permissions};
        use std::os::unix::fs::{symlink, PermissionsExt};

        let root = std::env::temp_dir().canonicalize().unwrap()
            .join(format!("orqst-synthetic-cli-versions-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&root).unwrap();
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).unwrap();
            }
        }
        let _cleanup = Cleanup(root.clone());
        let install_root = root.join("releases");
        let old_path = install_root.join("0.162.1-aarch64-apple-darwin/bin/codex");
        let new_bin = install_root.join("0.169.0-aarch64-apple-darwin/bin");
        fs::create_dir_all(&new_bin).unwrap();
        let new_path = new_bin.join("codex");
        fs::write(&new_path, b"synthetic").unwrap();
        let launcher = root.join("codex");
        symlink(&new_path, &launcher).unwrap();
        let string = |path: &Path| path.to_str().unwrap().to_owned();
        let previous = Review {
            path: string(&old_path),
            sha256: "a".repeat(64),
            version: "0.162.1".into(),
            source: Source::PackagedPin,
            signature: Some(Signature {
                team_id: "2DC432GLL2".into(),
                identifier: "codex".into(),
                notarized: true,
            }),
            previous_sha256: None,
            launcher: Some(string(&launcher)),
            install_root: Some(string(&install_root)),
            previous_path: None,
        };
        let mut update = VersionDirectoryUpdate {
            provider: "codex".into(),
            candidate: VersionCandidate {
                path: string(&new_path),
                sha256: "b".repeat(64),
                launcher: string(&launcher),
            },
        };
        let verify = |_: &str, expected: &Signature| {
            expected.team_id == "2DC432GLL2" && expected.identifier == "codex" && expected.notarized
        };
        assert!(verify_version_directory_update(&previous, &update, verify));
        assert!(!verify_version_directory_update(&previous, &update, |_, expected| {
            expected.team_id == "AAAAAAAAAA"
        }));
        assert!(!verify_version_directory_update(&previous, &update, |_, expected| {
            expected.identifier == "other"
        }));
        assert!(!verify_version_directory_update(&previous, &update, |_, expected| !expected.notarized));

        let receipt = Review {
            path: update.candidate.path.clone(),
            sha256: update.candidate.sha256.clone(),
            version: "0.169.0".into(),
            source: Source::SignatureContinuityVersionDir,
            signature: Some(Signature { team_id: "2DC432GLL2".into(), identifier: "codex".into(), notarized: true }),
            previous_sha256: Some(previous.sha256.clone()),
            launcher: previous.launcher.clone(),
            install_root: previous.install_root.clone(),
            previous_path: Some(previous.path.clone()),
        };
        let binary = Binary { path: receipt.path.clone(), sha256: receipt.sha256.clone() };
        assert!(matches_review(&receipt, "codex", &binary, "0.169.0", verify));

        let alternate = root.join("alias");
        symlink(&new_path, &alternate).unwrap();
        update.candidate.launcher = string(&alternate);
        assert!(!verify_version_directory_update(&previous, &update, verify));
        update.candidate.launcher = string(&launcher);

        fs::set_permissions(&new_bin, Permissions::from_mode(0o775)).unwrap();
        assert!(!verify_version_directory_update(&previous, &update, verify));
        assert!(!matches_review(&receipt, "codex", &binary, "0.169.0", verify));
        fs::set_permissions(&new_bin, Permissions::from_mode(0o755)).unwrap();

        let outside = root.join("releases-other/0.170.0");
        fs::create_dir_all(outside.join("bin")).unwrap();
        let outside_path = outside.join("bin/codex");
        fs::write(&outside_path, b"synthetic").unwrap();
        let escape = install_root.join("0.170.0");
        symlink(outside, &escape).unwrap();
        fs::remove_file(&launcher).unwrap();
        symlink(escape.join("bin/codex"), &launcher).unwrap();
        update.candidate.path = string(&outside_path);
        assert!(!verify_version_directory_update(&previous, &update, verify));
        update.candidate.path = string(&escape.join("bin/codex"));
        assert!(!verify_version_directory_update(&previous, &update, verify));
        assert!(!matches_review(&receipt, "codex", &binary, "0.169.0", verify));
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
            launcher: None,
            install_root: None,
            previous_path: None,
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
