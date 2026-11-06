//! POSIX `node:path` semantics (`join`, `dirname`, `relative`, `resolve`, `isAbsolute`).

pub fn is_absolute(path: &str) -> bool {
    path.starts_with('/')
}

/// `parse(path).root`.
pub fn root(path: &str) -> &'static str {
    if is_absolute(path) {
        "/"
    } else {
        ""
    }
}

fn normalize_string(path: &str, allow_above_root: bool) -> String {
    let mut stack: Vec<&str> = Vec::new();
    for segment in path.split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                if stack.last().is_some_and(|top| *top != "..") {
                    stack.pop();
                } else if allow_above_root {
                    stack.push("..");
                }
            }
            other => stack.push(other),
        }
    }
    stack.join("/")
}

pub fn normalize(path: &str) -> String {
    if path.is_empty() {
        return ".".into();
    }
    let absolute = is_absolute(path);
    let trailing = path.ends_with('/');
    let mut out = normalize_string(path, !absolute);
    if out.is_empty() {
        if absolute {
            return "/".into();
        }
        return if trailing { "./".into() } else { ".".into() };
    }
    if trailing {
        out.push('/');
    }
    if absolute {
        format!("/{out}")
    } else {
        out
    }
}

pub fn join(parts: &[&str]) -> String {
    let joined = parts
        .iter()
        .filter(|p| !p.is_empty())
        .copied()
        .collect::<Vec<_>>()
        .join("/");
    if joined.is_empty() {
        return ".".into();
    }
    normalize(&joined)
}

pub fn join2(a: &str, b: &str) -> String {
    join(&[a, b])
}

pub fn dirname(path: &str) -> String {
    let bytes = path.as_bytes();
    if bytes.is_empty() {
        return ".".into();
    }
    let has_root = bytes[0] == b'/';
    let mut end: Option<usize> = None;
    let mut matched_slash = true;
    for i in (1..bytes.len()).rev() {
        if bytes[i] == b'/' {
            if !matched_slash {
                end = Some(i);
                break;
            }
        } else {
            matched_slash = false;
        }
    }
    match end {
        None => {
            if has_root {
                "/".into()
            } else {
                ".".into()
            }
        }
        Some(1) if has_root => "//".into(),
        Some(end) => path[..end].to_owned(),
    }
}

pub fn resolve(path: &str) -> String {
    let full = if is_absolute(path) {
        path.to_owned()
    } else {
        let cwd = std::env::current_dir()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or_else(|_| "/".into());
        format!("{cwd}/{path}")
    };
    format!("/{}", normalize_string(&full, false))
}

pub fn relative(from: &str, to: &str) -> String {
    if from == to {
        return String::new();
    }
    let from = resolve(from);
    let to = resolve(to);
    if from == to {
        return String::new();
    }
    let (f, t) = (from.as_bytes(), to.as_bytes());
    let from_len = f.len() - 1;
    let to_len = t.len() - 1;
    let length = from_len.min(to_len);
    let mut last_common_sep: isize = -1;
    let mut i = 0;
    while i < length {
        let code = f[1 + i];
        if code != t[1 + i] {
            break;
        } else if code == b'/' {
            last_common_sep = i as isize;
        }
        i += 1;
    }
    if i == length {
        if to_len > length {
            if t[1 + i] == b'/' {
                return to[1 + i + 1..].to_owned();
            }
            if i == 0 {
                return to[1 + i..].to_owned();
            }
        } else if from_len > length {
            if f[1 + i] == b'/' {
                last_common_sep = i as isize;
            } else if i == 0 {
                last_common_sep = 0;
            }
        }
    }
    let mut out = String::new();
    let start = (1 + last_common_sep + 1) as usize;
    for j in start..=f.len() {
        if j == f.len() || f[j] == b'/' {
            out.push_str(if out.is_empty() { ".." } else { "/.." });
        }
    }
    let tail_start = (1 + last_common_sep) as usize;
    format!("{out}{}", &to[tail_start..])
}

/// `inside !== '..' && !inside.startsWith('../')`: `path` is `base` or below it.
pub fn contains(base: &str, path: &str) -> bool {
    let inside = relative(base, path);
    inside != ".." && !inside.starts_with("../")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_node_posix_path() {
        assert_eq!(join(&["/a/", "tmp"]), "/a/tmp");
        assert_eq!(join(&["/a", "b/"]), "/a/b/");
        assert_eq!(join(&["/a", "home/.config"]), "/a/home/.config");
        assert_eq!(dirname("/a/b/"), "/a");
        assert_eq!(dirname("/a"), "/");
        assert_eq!(dirname("//a"), "//");
        assert_eq!(relative("/a/b", "/a/b/c"), "c");
        assert_eq!(relative("/a/b/c", "/a/b"), "..");
        assert_eq!(relative("/a/b", "/a/bc"), "../bc");
        assert_eq!(relative("/a", "/b/c"), "../b/c");
        assert_eq!(relative("/", "/b"), "b");
        assert_eq!(relative("/b", "/"), "..");
        assert_eq!(relative("/a/b/", "/a/b"), "");
        assert!(contains("/a", "/a/b"));
        assert!(contains("/a", "/a"));
        assert!(!contains("/a/b", "/a"));
    }
}
