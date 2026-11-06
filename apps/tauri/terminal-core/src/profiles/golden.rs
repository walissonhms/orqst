//! Golden equality with the TypeScript functions. `tests/profiles-golden.ts` evaluates them on
//! SYNTHETIC fixtures and writes `tests/golden/profiles.json`; this test recreates the same
//! synthetic tree from the recorded spec and requires byte-equal JSON outcomes.
use super::config::*;
use super::interactive::*;
use super::js::{self, Js};
use super::*;
use std::collections::HashMap;
use std::fs::{self, DirBuilder};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};

const GOLDEN: &str = include_str!("../../tests/golden/profiles.json");

fn materialize(root: &str, fixtures: &[Js]) {
    let _ = fs::remove_dir_all(root);
    DirBuilder::new().mode(0o755).create(root).unwrap();
    fs::set_permissions(root, fs::Permissions::from_mode(0o755)).unwrap();
    for entry in fixtures {
        let path = entry.get("path").and_then(Js::as_str).unwrap();
        let Js::Num(mode) = entry.get("mode").unwrap() else {
            panic!("mode")
        };
        match entry.get("base64").and_then(Js::as_str) {
            None => DirBuilder::new().create(path).unwrap(),
            Some(data) => {
                use base64::Engine;
                fs::write(
                    path,
                    base64::engine::general_purpose::STANDARD
                        .decode(data)
                        .unwrap(),
                )
                .unwrap()
            }
        }
        fs::set_permissions(path, fs::Permissions::from_mode(*mode as u32)).unwrap();
    }
}

fn outcome(result: Result<Js>) -> Js {
    match result {
        Ok(value) => Js::obj([("ok", value)]),
        Err(ProfileError::Schema(_)) => {
            Js::obj([("error", Js::obj([("kind", Js::str("schema"))]))])
        }
        Err(ProfileError::Refused(message)) => Js::obj([(
            "error",
            Js::obj([("kind", Js::str("refused")), ("message", Js::Str(message))]),
        )]),
        Err(ProfileError::Io(code)) => Js::obj([(
            "error",
            Js::obj([("kind", Js::str("io")), ("code", Js::Str(code))]),
        )]),
    }
}

fn s<'a>(input: &'a Js, key: &str) -> &'a str {
    input.get(key).and_then(Js::as_str).unwrap_or_default()
}

fn profiles_js(profiles: Vec<BuiltProfile>) -> Js {
    Js::Arr(
        profiles
            .iter()
            .map(|p| js::parse(&p.json).unwrap())
            .collect(),
    )
}

fn entries_js(env: Vec<(String, String)>) -> Js {
    Js::Arr(
        env.into_iter()
            .map(|(k, v)| Js::Arr(vec![Js::Str(k), Js::Str(v)]))
            .collect(),
    )
}

fn mcp_of(input: &Js) -> Result<Option<McpLaunch>> {
    input.get("mcp").map(parse_mcp_launch).transpose()
}

fn strings(value: Option<&Js>) -> Vec<String> {
    match value {
        Some(Js::Arr(items)) => items
            .iter()
            .filter_map(Js::as_str)
            .map(str::to_owned)
            .collect(),
        _ => Vec::new(),
    }
}

fn turn_js(turn: &hooks::HookTurn) -> Js {
    let mut entries = vec![("agentState".to_owned(), Js::str(turn.agent_state))];
    if let Some(id) = &turn.turn_id {
        entries.push(("turnId".to_owned(), Js::str(id)));
    }
    Js::Obj(entries)
}

fn run(fn_name: &str, input: &Js, root: &str) -> Result<Js> {
    let prep = NoPreparationStore;
    match fn_name {
        "identity" => {
            let (id, alias) = identity::terminal_identity(
                s(input, "state"),
                input.get("identity").and_then(Js::as_str),
            );
            Ok(Js::obj([
                ("terminalId", Js::Str(id)),
                ("alias", Js::Str(alias)),
            ]))
        }
        "codexSettings" => Ok(Js::Str(codex::managed_codex_settings(&parse_codex_config(
            input.get("config").unwrap(),
        )?))),
        "codexProfiles" => {
            let config = parse_codex_config(input.get("config").unwrap())?;
            Ok(profiles_js(codex::managed_codex_profiles(
                &config,
                mcp_of(input)?.as_ref(),
                &prep,
            )?))
        }
        "codexEnvironment" => Ok(entries_js(codex::managed_codex_environment(
            &parse_codex_config(input.get("config").unwrap())?,
        )?)),
        "structuredCodexArguments" => Ok(Js::strs(codex::structured_codex_arguments(
            &parse_codex_config(input.get("config").unwrap())?,
        ))),
        "interactiveProfiles" => {
            let config = parse_interactive_config(input.get("config").unwrap())?;
            Ok(profiles_js(interactive_terminal_profiles(
                &config,
                mcp_of(input)?.as_ref(),
                &prep,
            )?))
        }
        "interactiveEnvironment" => {
            let config = parse_interactive_config(input.get("config").unwrap())?;
            Ok(entries_js(interactive_terminal_environment(
                &config,
                mcp_of(input)?.as_ref(),
            )?))
        }
        "readProfiles" => {
            let config = read_interactive_terminal_config(s(input, "file"), &prep)?;
            Ok(profiles_js(interactive_terminal_profiles(
                &config, None, &prep,
            )?))
        }
        "claudeMcp" | "opencodeMcp" => {
            let raw = input.get("raw").unwrap();
            let mcp = parse_mcp_launch(raw.get("mcp").unwrap())?;
            let review = mcp::McpReviewInput {
                executable_version: s(raw, "executableVersion"),
                executable_sha256: s(raw, "executableSha256"),
                node_path: s(raw, "nodePath"),
                mcp: &mcp,
            };
            if fn_name == "claudeMcp" {
                Ok(mcp::claude_interactive_mcp_configuration(&review, s(raw, "sessionId"))?.json)
            } else {
                Ok(mcp::opencode_interactive_mcp_configuration(&review)?.json)
            }
        }
        "opencodeLaunchPlan" => {
            let raw = input.get("raw").unwrap();
            let identity = parse_native_identity(raw.get("nativeIdentity").unwrap())?;
            let mcp = mcp_of(raw)?;
            let plan =
                opencode::opencode_interactive_launch_plan(&opencode::OpenCodeLaunchInput {
                    executable: s(raw, "executable"),
                    executable_version: s(raw, "executableVersion"),
                    executable_sha256: s(raw, "executableSha256"),
                    project: s(raw, "project"),
                    native_identity: &identity,
                    node_path: s(raw, "nodePath"),
                    mcp: mcp.as_ref(),
                })?;
            Ok(plan.0)
        }
        "pathDirectories" => Ok(local_cli_path::local_cli_path_directories(
            s(input, "searchPath"),
            input.get("home").and_then(Js::as_str),
            &strings(input.get("selected")),
        )?
        .to_js()),
        "discoverClis" => {
            let found = local_cli::discover_local_clis(
                s(input, "searchPath"),
                input.get("home").and_then(Js::as_str),
                &strings(input.get("selected")),
            )?;
            Ok(Js::Arr(
                found
                    .iter()
                    .map(|d| Js::Arr(vec![d.to_js(), local_cli::local_cli_integration_plan(d)]))
                    .collect(),
            ))
        }
        "toolPath" => {
            local_cli_path::terminal_tool_path(input.get("reviewed").and_then(Js::as_str))
                .map(Js::Str)
        }
        "cliStatus" => Ok(adapters::interactive_cli_status(s(input, "provider"))),
        "adapter" => adapters::interactive_cli_adapter(
            s(input, "provider"),
            s(input, "authentication"),
            input.get("ack") == Some(&Js::Bool(true)),
        )
        .map(|_| Js::Null),
        "discoverModels" => {
            let env: HashMap<String, String> = match input.get("environment") {
                Some(Js::Obj(entries)) => entries
                    .iter()
                    .map(|(k, v)| (k.clone(), v.as_str().unwrap().to_owned()))
                    .collect(),
                _ => HashMap::new(),
            };
            model::discover_terminal_models(
                s(input, "provider"),
                s(input, "project"),
                s(input, "home"),
                &env,
            )
        }
        "validateModel" => {
            let selection = parse_model_selection(input.get("selection").unwrap())?;
            model::validate_terminal_model_selection(Some(&selection)).map(|_| Js::Null)
        }
        "modelArguments" => {
            let selection = parse_model_selection(input.get("selection").unwrap())?;
            model::terminal_model_arguments(Some(&selection)).map(Js::strs)
        }
        "openCodeModel" => {
            let selection = parse_model_selection(input.get("selection").unwrap())?;
            Ok(model::open_code_model_configuration(Some(&selection))?
                .map_or(Js::Null, |m| m.to_js()))
        }
        "hookFiles" => {
            let config = parse_claude_config(input.get("config").unwrap())?;
            Ok(entries_js(hooks::claude_owned_hook_files(&config)))
        }
        "inspectFiles" => {
            let limit = match input.get("limit") {
                Some(Js::Num(n)) => Some(*n as u32),
                _ => None,
            };
            let selection = managed_files::inspect_managed_terminal_files(
                &strings(input.get("files")),
                limit,
                &prep,
            )?;
            Ok(Js::Arr(
                selection
                    .iter()
                    .map(|item| {
                        let (id, _) = identity::terminal_identity(
                            item.config.state(),
                            item.config.identity(),
                        );
                        Js::obj([
                            ("provider", Js::str(interactive_provider(&item.config))),
                            ("terminalId", Js::Str(id)),
                            ("blocker", item.blocker.map_or(Js::Null, Js::str)),
                        ])
                    })
                    .collect(),
            ))
        }
        "hookEvidence" => {
            let config = parse_claude_config(input.get("config").unwrap())?;
            let channel = nodepath::join2(&config.state, hooks::CHANNEL_NAME);
            fs::write(&channel, "").unwrap();
            let mut results = Vec::new();
            if let Ok(mut evidence) = hooks::OwnedHookEvidence::new(&config) {
                for step in strings(input.get("steps")) {
                    fs::write(&channel, step).unwrap();
                    results.push(turn_js(&evidence.poll()));
                }
            }
            fs::write(&channel, "").unwrap();
            Ok(Js::Arr(results))
        }
        "claudeSession" => {
            let config = parse_claude_config(input.get("config").unwrap())?;
            let b = input.get("binding").unwrap();
            let binding = session::LifecycleBinding {
                instance_id: s(b, "instanceId").into(),
                epoch: s(b, "epoch").into(),
                manifest_digest: s(b, "manifestDigest").into(),
                config_digest: s(b, "configDigest").into(),
            };
            let mut reader = session::OwnedClaudeSession::new(&config, &binding);
            let home = &config.authentication.home;
            let dir = nodepath::join(&[
                home,
                ".claude/projects",
                &hooks::sanitize_project(&config.project),
            ]);
            DirBuilder::new()
                .recursive(true)
                .mode(0o755)
                .create(&dir)
                .unwrap();
            let file = nodepath::join2(&dir, &format!("{}.jsonl", config.session_id));
            let mut results = Vec::new();
            let Some(Js::Arr(steps)) = input.get("steps") else {
                panic!("steps")
            };
            for step in steps {
                if let Some(text) = step.as_str() {
                    use std::io::Write;
                    let mut f = fs::OpenOptions::new()
                        .write(true)
                        .create(true)
                        .truncate(true)
                        .mode(0o600)
                        .open(&file)
                        .unwrap();
                    f.write_all(text.as_bytes()).unwrap();
                }
                results.push(match &mut reader {
                    None => Js::str("no-reader"),
                    Some(reader) => reader.poll().map_or(Js::Null, |snapshot| snapshot.to_js()),
                });
            }
            let _ = fs::remove_dir_all(nodepath::join2(home, ".claude/projects"));
            let _ = fs::remove_file(nodepath::join2(
                &config.state,
                &format!("session-binding-{}.json", binding.instance_id),
            ));
            Ok(Js::Arr(results))
        }
        "backendValidate" => {
            let backend = backend::ManagedProfileBackend::new(s(input, "file"), None, &prep)?;
            Ok(Js::Bool(backend.validate(s(input, "profile"), &prep)))
        }
        other => panic!("unknown golden function {other} under {root}"),
    }
}

#[test]
fn typescript_golden_equality() {
    let golden = js::parse(GOLDEN).unwrap();
    assert_eq!(golden.get("synthetic"), Some(&Js::Bool(true)));
    let root = s(&golden, "root").to_owned();
    let Some(Js::Num(now)) = golden.get("now") else {
        panic!("now")
    };
    pin_now(Some(*now));
    let Some(Js::Arr(fixtures)) = golden.get("fixtures") else {
        panic!("fixtures")
    };
    materialize(&root, fixtures);
    let Some(Js::Arr(cases)) = golden.get("cases") else {
        panic!("cases")
    };
    let mut failures = Vec::new();
    for case in cases {
        let name = s(case, "name");
        let actual = outcome(run(s(case, "fn"), case.get("input").unwrap(), &root)).stringify();
        let expected = case.get("output").unwrap().stringify();
        if actual != expected {
            failures.push(format!(
                "{name}\n  expected {expected}\n  actual   {actual}"
            ));
        }
    }
    let _ = fs::remove_dir_all(&root);
    pin_now(None);
    assert!(
        failures.is_empty(),
        "{} of {} golden cases differ:\n{}",
        failures.len(),
        cases.len(),
        failures.join("\n")
    );
}
