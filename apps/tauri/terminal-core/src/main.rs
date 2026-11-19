fn main() {
    let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
    if args
        .get(1)
        .map(|a| a == orqst_terminal_core::pty::HELPER_ARG)
        .unwrap_or(false)
    {
        orqst_terminal_core::pty::helper_main(&args[2..]);
    }
    if args.get(1).is_some_and(|arg| arg == orqst_terminal_core::pty::OWNED_EXEC_ARG) {
        if let Some(owner) = args.get(2) {
            orqst_terminal_core::pty::owned_exec(owner, None, &args[3..]);
        }
        std::process::exit(1);
    }
    // `recovery` (offline recovery host) never collides with the Core: its argv[1] is JSON.
    if args.get(1).map(|a| a == "recovery").unwrap_or(false) {
        let rest: Option<Vec<String>> = args[2..]
            .iter()
            .map(|a| a.clone().into_string().ok())
            .collect();
        std::process::exit(rest.map_or(1, |rest| {
            orqst_terminal_core::recovery::host::main_entry(&rest)
        }));
    }
    std::process::exit(orqst_terminal_core::startup::run());
}
