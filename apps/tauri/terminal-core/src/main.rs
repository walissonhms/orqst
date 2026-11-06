fn main() {
    let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
    if args.get(1).map(|a| a == orqst_terminal_core::pty::HELPER_ARG).unwrap_or(false) {
        orqst_terminal_core::pty::helper_main(&args[2..]);
    }
    std::process::exit(1);
}
