//! Provider identity checks; this module does not execute the candidate.

use std::path::Path;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Provider {
    Codex,
    Claude,
    OpenCode,
}

impl Provider {
    pub fn identity(self) -> (&'static str, &'static str) {
        match self {
            Self::Codex => ("2DC432GLL2", "codex"),
            Self::Claude => ("Q6L2SF6YDW", "com.anthropic.claude-code"),
            Self::OpenCode => ("5NZ4Q7NXJ4", "opencode"),
        }
    }
}

/// Rejects unknown providers and non-absolute or oversized paths at the private host boundary.
pub fn verify_provider(path: &str, provider: &str) -> bool {
    if path.len() > 2048 || path.contains('\0') || !Path::new(path).is_absolute() {
        return false;
    }
    let provider = match provider {
        "codex" => Provider::Codex,
        "claude" => Provider::Claude,
        "opencode" => Provider::OpenCode,
        _ => return false,
    };
    verify(Path::new(path), provider)
}

/// Returns false for unavailable, unsigned, invalid or differently signed code.
/// This verifies the code requirement, not notarization or behavior.
#[cfg(target_os = "macos")]
pub fn verify(path: &Path, provider: Provider) -> bool {
    let (team, identifier) = provider.identity();
    let requirement = format!("anchor apple generic and identifier \"{identifier}\" and certificate leaf[subject.OU] = \"{team}\"");
    verify_requirement(path, &requirement)
}

#[cfg(target_os = "macos")]
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

#[cfg(not(target_os = "macos"))]
pub fn verify(_path: &Path, _provider: Provider) -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn system_codesign_and_security_framework_agree_on_system_and_synthetic_code() {
        use std::process::Command;
        let path =
            std::env::temp_dir().join(format!("orqst-unsigned-equivalence-{}", std::process::id()));
        std::fs::write(&path, b"synthetic unsigned executable").unwrap();
        let check = |file: &Path, requirement: &str| {
            let status = Command::new("/usr/bin/codesign")
                .args(["--verify", "--strict", "--all-architectures"])
                .arg(format!("-R={requirement}"))
                .arg(file)
                .env_clear()
                .env("PATH", "/usr/bin:/bin")
                .env("LANG", "C")
                .output()
                .unwrap();
            assert_eq!(
                status.status.success(),
                verify_requirement(file, requirement)
            );
            status.status.success()
        };
        assert!(check(Path::new("/usr/bin/codesign"), "anchor apple"));
        assert!(!check(&path, "anchor apple"));
        for provider in [Provider::Codex, Provider::Claude, Provider::OpenCode] {
            let (team, identifier) = provider.identity();
            let requirement = format!("anchor apple generic and identifier \"{identifier}\" and certificate leaf[subject.OU] = \"{team}\"");
            assert!(!check(Path::new("/usr/bin/codesign"), &requirement));
            assert!(!check(&path, &requirement));
        }
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn missing_and_unsigned_files_are_rejected() {
        let path = std::env::temp_dir().join(format!("orqst-unsigned-{}", std::process::id()));
        std::fs::write(&path, b"synthetic unsigned executable").unwrap();
        for provider in [Provider::Codex, Provider::Claude, Provider::OpenCode] {
            assert!(!verify(&path, provider));
            assert!(!verify(Path::new("relative"), provider));
        }
        std::fs::remove_file(&path).unwrap();
        assert!(!verify(&path, Provider::Codex));
        assert!(!verify_provider("relative", "codex"));
        assert!(!verify_provider("/synthetic", "unknown"));
    }
}
