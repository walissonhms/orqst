//! Port of `model-selection.ts`. Passive CLI-owned catalogue/configuration evidence; never
//! executes a provider or inspects authentication.
//!
//! `decodeOpenCodeState`/`openCodeStateDigest` adapt (via the TypeScript port) OpenCode's
//! MIT-licensed `packages/tui/src/model-preference.ts` at
//! 9bbb8ce18c80f099e0e448775f59d965ead40a21. Copyright (c) 2025 opencode. MIT license and
//! full attribution: root NOTICE.
use super::config::{model_value, ModelSelection};
use super::fsx::terminal_file;
use super::js::{self, js_len, obj_set, Js};
use super::nodepath::join2;
use super::validate::{date_parse, datetime_pattern};
use super::{now_ms, terminal_digest, ProfileError, Result};
use regex::Regex;
use std::collections::HashMap;
use std::sync::OnceLock;

const MAXIMUM_BYTES: u64 = 2 * 1024 * 1024;
const CHANGED: &str = "CLI model catalogue changed; reload the terminal picker";
const EXPIRED: &str = "CLI model catalogue expired; reload the terminal picker";

fn changed() -> ProfileError {
    ProfileError::refused(CHANGED)
}

fn read(path: &str) -> Result<Option<Vec<u8>>> {
    match terminal_file(path, false, MAXIMUM_BYTES, None) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.io_code() == Some("ENOENT") => Ok(None),
        Err(error) => Err(error),
    }
}

struct CacheModel {
    slug: String,
    display_name: Option<String>,
    visibility: String,
}

struct CodexCache {
    client_version: String,
    models: Vec<CacheModel>,
    expires_at: f64,
}

fn parse_codex_cache(bytes: &[u8]) -> Option<(String, String, Vec<CacheModel>)> {
    let value = js::parse_bytes(bytes).ok()?;
    if !value.is_object() {
        return None;
    }
    let client = value.get("client_version")?.as_str()?;
    if client != "0.162.1" {
        return None;
    }
    let fetched = value.get("fetched_at")?.as_str()?;
    if !datetime_pattern().is_match(fetched) {
        return None;
    }
    let Js::Arr(items) = value.get("models")? else {
        return None;
    };
    if items.len() > 128 {
        return None;
    }
    let mut models = Vec::new();
    for item in items {
        if !item.is_object() {
            return None;
        }
        let slug = item.get("slug")?.as_str()?.to_owned();
        let display_name = match item.get("display_name") {
            None => None,
            Some(v) => Some(v.as_str()?.to_owned()),
        };
        let visibility = item.get("visibility")?.as_str()?;
        if !["list", "hide", "none"].contains(&visibility) {
            return None;
        }
        models.push(CacheModel {
            slug,
            display_name,
            visibility: visibility.to_owned(),
        });
    }
    Some((client.to_owned(), fetched.to_owned(), models))
}

fn codex_cache(bytes: &[u8]) -> Result<CodexCache> {
    let (client_version, fetched, models) = parse_codex_cache(bytes).ok_or_else(changed)?;
    let fetched_at = date_parse(&fetched).ok_or_else(changed)?;
    let expires_at = fetched_at + 300_000.0;
    let now = now_ms();
    if fetched_at > now || expires_at <= now {
        return Err(ProfileError::refused(EXPIRED));
    }
    Ok(CodexCache {
        client_version,
        models,
        expires_at,
    })
}

fn cached_model_digest(cache: &CodexCache, value: &str) -> Result<String> {
    let matches: Vec<&CacheModel> = cache.models.iter().filter(|m| m.slug == value).collect();
    if matches.len() != 1 || matches[0].visibility != "list" {
        return Err(changed());
    }
    let model = matches[0];
    Ok(terminal_digest(
        Js::strs([
            cache.client_version.as_str(),
            &model.slug,
            model.display_name.as_deref().unwrap_or(&model.slug),
            &model.visibility,
        ])
        .stringify(),
    ))
}

struct StateEntry {
    provider: String,
    model: String,
    variant: Option<String>,
}

fn bounded_str(value: Option<&Js>, max: usize) -> Result<&str> {
    match value.and_then(Js::as_str) {
        Some(s) if !s.is_empty() && js_len(s) <= max => Ok(s),
        _ => Err(ProfileError::schema("opencode model state")),
    }
}

/// `decodeOpenCodeState`: `favorite` precedes `recent`; saved variants add their references.
fn decode_open_code_state(bytes: &[u8]) -> Result<Vec<StateEntry>> {
    let document = js::parse_bytes(bytes).map_err(ProfileError::schema)?;
    let bad = || ProfileError::schema("opencode model state");
    if !document.is_object() {
        return Err(bad());
    }
    let list = |key: &str| -> Result<Vec<(String, String)>> {
        match document.get(key) {
            None => Ok(Vec::new()),
            Some(Js::Arr(items)) if items.len() <= 64 => items
                .iter()
                .map(|item| {
                    if !item.is_object() {
                        return Err(bad());
                    }
                    Ok((
                        bounded_str(item.get("providerID"), 160)?.to_owned(),
                        bounded_str(item.get("modelID"), 160)?.to_owned(),
                    ))
                })
                .collect(),
            Some(_) => Err(bad()),
        }
    };
    let recent = list("recent")?;
    let favorite = list("favorite")?;
    let variant: Vec<(String, String)> = match document.get("variant") {
        None => Vec::new(),
        Some(Js::Obj(entries)) => {
            let mut out = Vec::new();
            for (k, v) in entries {
                let value = v.as_str().ok_or_else(bad)?;
                if js_len(k) > 322 || js_len(value) > 160 {
                    return Err(bad());
                }
                out.push((k.clone(), value.to_owned()));
            }
            if out.len() > 128 {
                return Err(bad());
            }
            out
        }
        Some(_) => return Err(bad()),
    };
    let mut entries: Vec<StateEntry> = Vec::new();
    let mut add = |provider: &str, model: &str| {
        if entries
            .iter()
            .any(|e| e.provider == provider && e.model == model)
        {
            return;
        }
        let key = format!("{provider}/{model}");
        let saved = variant
            .iter()
            .find(|(k, _)| *k == key)
            .map(|(_, v)| v.as_str());
        entries.push(StateEntry {
            provider: provider.to_owned(),
            model: model.to_owned(),
            variant: saved
                .filter(|v| !v.is_empty() && *v != "default")
                .map(str::to_owned),
        });
    };
    for (provider, model) in favorite.iter().chain(recent.iter()) {
        add(provider, model);
    }
    for (key, _) in &variant {
        if let Some(end) = key.find('/') {
            if end > 0 {
                add(&key[..end], &key[end + 1..]);
            }
        }
    }
    Ok(entries)
}

/// `openCodeStateDigest`: source evidence is the chosen reference only.
fn open_code_state_digest(state: Option<&[StateEntry]>, value: &str) -> Option<String> {
    let state = state?;
    // `value` passed the model-value grammar, so it is ASCII; `slice(0, -1)` when no slash.
    let (provider_id, rest) = match value.find('/') {
        Some(end) => (&value[..end], &value[end + 1..]),
        None => (&value[..value.len().saturating_sub(1)], value),
    };
    let (model_id, variant) = match rest.find('#') {
        Some(hash) => (&rest[..hash], Some(&rest[hash + 1..])),
        None => (rest, None),
    };
    let entry = state
        .iter()
        .find(|e| e.provider == provider_id && e.model == model_id)?;
    if entry.variant.as_deref() != variant {
        return None;
    }
    Some(terminal_digest(
        Js::Arr(vec![
            Js::str("opencode-model-state"),
            Js::str(provider_id),
            Js::str(model_id),
            entry.variant.as_deref().map_or(Js::Null, Js::str),
        ])
        .stringify(),
    ))
}

/// `validateTerminalModelSelection`: evidence is checked again immediately before dispatch.
pub fn validate_terminal_model_selection(selection: Option<&ModelSelection>) -> Result<()> {
    let Some(selection) = selection else {
        return Ok(());
    };
    if let Some(expires_at) = selection.expires_at {
        if now_ms() >= expires_at {
            return Err(ProfileError::refused(EXPIRED));
        }
    }
    for file in &selection.files {
        let bytes = read(&file.path)?;
        let cache = match (&file.codex_model, &bytes) {
            (Some(_), Some(bytes)) => Some(codex_cache(bytes)?),
            _ => None,
        };
        if let Some(codex_model) = &file.codex_model {
            let stale = match &cache {
                None => true,
                Some(cache) => {
                    selection.value.as_deref() != Some(codex_model.as_str())
                        || selection.source != "cli-cache"
                        || selection.expires_at.is_none_or(|e| cache.expires_at < e)
                }
            };
            if stale {
                return Err(changed());
            }
        }
        let digest = if let Some(cache) = &cache {
            Some(cached_model_digest(
                cache,
                file.codex_model.as_deref().unwrap_or_default(),
            )?)
        } else if let Some(open_code_model) = &file.open_code_model {
            let state = match &bytes {
                None => None,
                Some(bytes) => Some(decode_open_code_state(bytes)?),
            };
            open_code_state_digest(state.as_deref(), open_code_model)
        } else {
            bytes.as_ref().map(terminal_digest)
        };
        if let Some(open_code_model) = &file.open_code_model {
            if selection.source != "native-state"
                || selection.value.as_deref() != Some(open_code_model.as_str())
                || digest.is_none()
            {
                return Err(changed());
            }
        }
        if digest != file.sha256 {
            return Err(changed());
        }
    }
    Ok(())
}

/// `terminalModelArguments`.
pub fn terminal_model_arguments(selection: Option<&ModelSelection>) -> Result<Vec<String>> {
    validate_terminal_model_selection(selection)?;
    Ok(match selection.and_then(|s| s.value.as_ref()) {
        Some(value) => vec!["--model".into(), value.clone()],
        None => Vec::new(),
    })
}

/// OpenCode `{ providerID, model, variant? }` (`openCodeConfiguredModelSchema`).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OpenCodeModel {
    pub provider_id: String,
    pub model: String,
    pub variant: Option<String>,
}

impl OpenCodeModel {
    pub fn to_js(&self) -> Js {
        let mut entries = vec![
            ("providerID".to_owned(), Js::str(&self.provider_id)),
            ("model".to_owned(), Js::str(&self.model)),
        ];
        if let Some(variant) = &self.variant {
            entries.push(("variant".to_owned(), Js::str(variant)));
        }
        Js::Obj(entries)
    }
}

fn open_code_value_ok(value: &str) -> bool {
    // `/^[^/#]+\/[^#]+(?:#[^#]+)?$/u`
    let Some(slash) = value.find('/') else {
        return false;
    };
    if slash == 0 || value[..slash].contains('#') {
        return false;
    }
    let rest = &value[slash + 1..];
    match rest.split_once('#') {
        None => !rest.is_empty(),
        Some((model, variant)) => {
            !model.is_empty() && !variant.is_empty() && !variant.contains('#')
        }
    }
}

fn open_code_part_ok(value: &str) -> bool {
    !value.is_empty()
        && js_len(value) <= 160
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:/@+-".contains(&b))
}

fn configured_model(
    provider_id: &str,
    model: &str,
    variant: Option<&str>,
) -> Result<OpenCodeModel> {
    model_value(&Js::str(provider_id), "providerID")?;
    if provider_id.contains('/') || provider_id.contains('#') {
        return Err(ProfileError::schema("providerID"));
    }
    if !open_code_part_ok(model) || variant.is_some_and(|v| !open_code_part_ok(v)) {
        return Err(ProfileError::schema("model"));
    }
    Ok(OpenCodeModel {
        provider_id: provider_id.to_owned(),
        model: model.to_owned(),
        variant: variant.map(str::to_owned),
    })
}

/// `openCodeModelConfiguration`: the native V2 inline default (full TUI has no `--model`).
pub fn open_code_model_configuration(
    selection: Option<&ModelSelection>,
) -> Result<Option<OpenCodeModel>> {
    validate_terminal_model_selection(selection)?;
    let Some(value) = selection.and_then(|s| s.value.as_deref()) else {
        return Ok(None);
    };
    if !open_code_value_ok(value) {
        return Err(ProfileError::schema("opencode model value"));
    }
    let (reference, variant) = match value.split_once('#') {
        Some((reference, variant)) => (reference, Some(variant)),
        None => (value, None),
    };
    let end = reference.find('/').unwrap_or(0);
    configured_model(
        &reference[..end],
        &reference[end + 1..],
        variant.filter(|v| !v.is_empty()),
    )
    .map(Some)
}

fn label_pattern() -> &'static Regex {
    static CELL: OnceLock<Regex> = OnceLock::new();
    CELL.get_or_init(|| Regex::new(r"^[^\p{Cc}\p{Cf}]{1,160}$").expect("static pattern"))
}

fn js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{b}' | '\u{c}' | '\r' | ' ' | '\u{a0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200a}'
                | '\u{2028}'
                | '\u{2029}'
                | '\u{202f}'
                | '\u{205f}'
                | '\u{3000}'
                | '\u{feff}'
    )
}

fn line_terminator(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

/// `text.matchAll(/^\s*model\s*=\s*("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/gm)` capture group 1.
fn toml_model_strings(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    let mut found = Vec::new();
    let mut p = 0;
    while p <= chars.len() {
        if p == 0 || line_terminator(chars[p - 1]) {
            if let Some((literal, end)) = toml_match_at(&chars, p) {
                found.push(literal);
                p = end.max(p + 1);
                continue;
            }
        }
        p += 1;
    }
    found
}

fn toml_match_at(chars: &[char], start: usize) -> Option<(String, usize)> {
    let mut i = start;
    let skip = |mut i: usize| {
        while i < chars.len() && js_space(chars[i]) {
            i += 1;
        }
        i
    };
    i = skip(i);
    if chars.get(i..i + 5)? != ['m', 'o', 'd', 'e', 'l'] {
        return None;
    }
    i = skip(i + 5);
    if chars.get(i) != Some(&'=') {
        return None;
    }
    i = skip(i + 1);
    if chars.get(i) != Some(&'"') {
        return None;
    }
    let open = i;
    i += 1;
    loop {
        match chars.get(i)? {
            '"' => break,
            '\\' => {
                let next = chars.get(i + 1)?;
                if line_terminator(*next) {
                    return None;
                }
                i += 2;
            }
            _ => i += 1,
        }
    }
    let close = i + 1;
    // `\s*(?:#.*)?$` succeeds if the whitespace run holds a terminator, ends the text, or is
    // followed by `#`. Matches cannot start inside that tail, so scanning resumes after it.
    let run_end = skip(close);
    let ok = chars[close..run_end].iter().any(|c| line_terminator(*c))
        || run_end == chars.len()
        || chars[run_end] == '#';
    ok.then(|| (chars[open..close].iter().collect(), close))
}

/// `discoverTerminalModels(provider, project, home, environment)`.
pub fn discover_terminal_models(
    provider: &str,
    project: &str,
    home: &str,
    environment: &HashMap<String, String>,
) -> Result<Js> {
    let env = |key: &str| environment.get(key).cloned();
    let codex_home = env("CODEX_HOME").unwrap_or_else(|| join2(home, ".codex"));
    let claude_home = env("CLAUDE_CONFIG_DIR").unwrap_or_else(|| join2(home, ".claude"));
    let opencode_home = env("OPENCODE_CONFIG_DIR").unwrap_or_else(|| {
        join2(
            &env("XDG_CONFIG_HOME").unwrap_or_else(|| join2(home, ".config")),
            "opencode",
        )
    });
    let paths: Vec<String> = match provider {
        "codex" => vec![
            join2(&codex_home, "config.toml"),
            join2(project, ".codex/config.toml"),
            join2(&codex_home, "models_cache.json"),
        ],
        "claude" => vec![
            join2(&claude_home, "settings.json"),
            join2(project, ".claude/settings.json"),
            join2(project, ".claude/settings.local.json"),
        ],
        _ => vec![
            join2(&opencode_home, "opencode.json"),
            join2(&opencode_home, "opencode.jsonc"),
            join2(project, "opencode.json"),
            join2(project, "opencode.jsonc"),
        ],
    };
    let state_path = (provider == "opencode").then(|| {
        super::nodepath::join(&[
            &env("XDG_STATE_HOME")
                .unwrap_or_else(|| super::nodepath::join(&[home, ".local", "state"])),
            "opencode",
            "model.json",
        ])
    });
    let mut sources = Vec::new();
    for path in &paths {
        let bytes = read(path)?;
        let sha256 = bytes.as_ref().map(terminal_digest);
        sources.push((path.clone(), bytes, sha256));
    }
    let state_bytes = match &state_path {
        Some(path) => read(path)?,
        None => None,
    };
    let native_state = state_bytes
        .as_deref()
        .and_then(|b| decode_open_code_state(b).ok());
    let sha = |s: &Option<String>| s.as_deref().map_or(Js::Null, Js::str);
    let files: Vec<Js> = sources
        .iter()
        .filter(|(path, _, _)| !path.ends_with("models_cache.json"))
        .map(|(path, _, sha256)| Js::obj([("path", Js::str(path)), ("sha256", sha(sha256))]))
        .collect();
    let mut options: Vec<(String, Js, Option<String>)> = vec![(
        "CLI default".into(),
        Js::obj([
            ("value", Js::Null),
            ("source", Js::str("cli-default")),
            ("files", Js::Arr(files.clone())),
        ]),
        None,
    )];
    let mut limited = true;
    let add = |options: &mut Vec<(String, Js, Option<String>)>,
               value: Option<&Js>,
               source: &str,
               label: Option<&Js>,
               expires_at: Option<f64>,
               cache_file: Option<Js>| {
        let Some(parsed) = value.and_then(|v| model_value(v, "model").ok()) else {
            return;
        };
        if (provider == "opencode" && !open_code_value_ok(&parsed))
            || options.len() >= 128
            || options
                .iter()
                .any(|(_, _, v)| v.as_deref() == Some(parsed.as_str()))
        {
            return;
        }
        let label = match label.and_then(Js::as_str) {
            Some(label) if label_pattern().is_match(label) => label.to_owned(),
            _ => parsed.clone(),
        };
        let mut selected = files.clone();
        if let Some(cache_file) = cache_file {
            selected.push(cache_file);
        }
        let mut selection = vec![
            ("value".to_owned(), Js::str(&parsed)),
            ("source".to_owned(), Js::str(source)),
            ("files".to_owned(), Js::Arr(selected)),
        ];
        if let Some(expires_at) = expires_at.filter(|e| *e != 0.0 && !e.is_nan()) {
            selection.push(("expiresAt".to_owned(), Js::Num(expires_at)));
        }
        options.push((label, Js::Obj(selection), Some(parsed)));
    };
    if provider == "claude" {
        for alias in ["sonnet", "opus", "haiku"] {
            add(
                &mut options,
                Some(&Js::str(alias)),
                "official-alias",
                None,
                None,
                None,
            );
        }
        limited = false;
    }
    for (path, bytes, _) in &sources {
        let Some(bytes) = bytes else { continue };
        let text = String::from_utf8_lossy(bytes).into_owned();
        // Unknown CLI configuration remains CLI-owned; a failure ends this file only.
        let _ = (|| -> Result<()> {
            if path.ends_with("models_cache.json") {
                let cache = codex_cache(bytes)?;
                for model in &cache.models {
                    if model.visibility == "list" {
                        let digest = cached_model_digest(&cache, &model.slug)?;
                        let file = Js::obj([
                            ("path", Js::str(path)),
                            ("codexModel", Js::str(&model.slug)),
                            ("sha256", Js::str(&digest)),
                        ]);
                        let label = model.display_name.as_deref().map(Js::str);
                        add(
                            &mut options,
                            Some(&Js::str(&model.slug)),
                            "cli-cache",
                            label.as_ref(),
                            Some(cache.expires_at),
                            Some(file),
                        );
                    }
                }
                if options
                    .iter()
                    .any(|(_, s, _)| s.get("source").and_then(Js::as_str) == Some("cli-cache"))
                {
                    limited = false;
                }
            } else if path.ends_with(".toml") {
                for literal in toml_model_strings(&text) {
                    let value = js::parse(&literal).map_err(ProfileError::schema)?;
                    add(
                        &mut options,
                        Some(&value),
                        "native-config",
                        None,
                        None,
                        None,
                    );
                }
            } else {
                let document = js::parse(&text).map_err(ProfileError::schema)?;
                if !document.is_object() {
                    return Err(ProfileError::schema("config"));
                }
                add(
                    &mut options,
                    document.get("model"),
                    "native-config",
                    None,
                    None,
                    None,
                );
                if provider == "opencode" {
                    let bad = || ProfileError::schema("opencode config");
                    let group = |key: &str| -> Result<Vec<(String, Js)>> {
                        match document.get(key) {
                            None => Ok(Vec::new()),
                            Some(Js::Obj(entries)) => {
                                for (_, configuration) in entries {
                                    if !configuration.is_object() {
                                        return Err(bad());
                                    }
                                    match configuration.get("models") {
                                        None => {}
                                        Some(Js::Obj(models)) => {
                                            for (_, model) in models {
                                                if !model.is_object() {
                                                    return Err(bad());
                                                }
                                                if let Some(d) = model.get("disabled") {
                                                    if !matches!(d, Js::Bool(_)) {
                                                        return Err(bad());
                                                    }
                                                }
                                            }
                                        }
                                        Some(_) => return Err(bad()),
                                    }
                                }
                                Ok(entries.clone())
                            }
                            Some(_) => Err(bad()),
                        }
                    };
                    let providers = group("providers")?;
                    let legacy = group("provider")?;
                    let chosen = match document.get("model") {
                        None | Some(Js::Str(_)) => None,
                        Some(model @ Js::Obj(_)) => {
                            let get = |k: &str| model.get(k).and_then(Js::as_str);
                            let (Some(p), Some(m)) = (get("providerID"), get("model")) else {
                                return Err(bad());
                            };
                            let variant = match model.get("variant") {
                                None => None,
                                Some(Js::Str(v)) => Some(v.as_str()),
                                Some(_) => return Err(bad()),
                            };
                            Some(configured_model(p, m, variant)?)
                        }
                        Some(_) => return Err(bad()),
                    };
                    if let Some(chosen) = chosen {
                        let suffix = chosen.variant.as_deref().filter(|v| !v.is_empty());
                        let value = format!(
                            "{}/{}{}",
                            chosen.provider_id,
                            chosen.model,
                            suffix.map(|v| format!("#{v}")).unwrap_or_default()
                        );
                        add(
                            &mut options,
                            Some(&Js::Str(value)),
                            "native-config",
                            None,
                            None,
                            None,
                        );
                    }
                    let mut merged = legacy;
                    for (k, v) in providers {
                        obj_set(&mut merged, &k, v);
                    }
                    for (provider_id, configuration) in &merged {
                        if let Some(Js::Obj(models)) = configuration.get("models") {
                            for (model_id, model) in models {
                                if model.get("disabled") != Some(&Js::Bool(true)) {
                                    let value = Js::Str(format!("{provider_id}/{model_id}"));
                                    add(
                                        &mut options,
                                        Some(&value),
                                        "native-config",
                                        None,
                                        None,
                                        None,
                                    );
                                }
                            }
                        }
                    }
                }
            }
            Ok(())
        })();
    }
    if let (Some(state), Some(state_path)) = (&native_state, &state_path) {
        for entry in state {
            let value = format!(
                "{}/{}{}",
                entry.provider,
                entry.model,
                entry
                    .variant
                    .as_deref()
                    .map(|v| format!("#{v}"))
                    .unwrap_or_default()
            );
            let digest = open_code_state_digest(Some(state), &value);
            let file = Js::obj([
                ("path", Js::str(state_path)),
                ("openCodeModel", Js::str(&value)),
                ("sha256", sha(&digest)),
            ]);
            add(
                &mut options,
                Some(&Js::Str(value)),
                "native-state",
                None,
                None,
                Some(file),
            );
        }
    }
    let options: Vec<Js> = options
        .into_iter()
        .map(|(label, selection, _)| {
            let id =
                terminal_digest(Js::Arr(vec![Js::str(provider), selection.clone()]).stringify());
            Js::obj([
                ("label", Js::Str(label)),
                ("selection", selection),
                ("id", Js::Str(id)),
            ])
        })
        .collect();
    Ok(Js::obj([
        ("limited", Js::Bool(limited)),
        ("options", Js::Arr(options)),
    ]))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn toml_scan_follows_the_javascript_pattern() {
        let text = "model = \"a\"\n  model=\"b\" # c\nmodel = \"c\" x\n\n model = \"d\\\"e\"\r\nmodel=\"f\"";
        assert_eq!(
            toml_model_strings(text),
            ["\"a\"", "\"b\"", "\"d\\\"e\"", "\"f\""]
        );
    }
}
