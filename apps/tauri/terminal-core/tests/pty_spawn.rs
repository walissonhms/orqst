//! Synthetic PTY checks with system programs only (no provider CLI, no user data).
use orqst_terminal_core::pty::{Event, Pty, Spawn};
use std::ffi::OsStr;
use std::time::Duration;

fn helper() -> &'static OsStr {
    OsStr::new(env!("CARGO_BIN_EXE_orqst-terminal-core"))
}

fn run(argv: &[&str], cwd: &str, cols: u16, rows: u16) -> (Pty, std::sync::mpsc::Receiver<Event>) {
    let argv: Vec<String> = argv.iter().map(|s| s.to_string()).collect();
    let env = vec![("PATH".to_owned(), "/usr/bin:/bin".to_owned())];
    let spec = Spawn {
        executable: "/bin/sh",
        argv: &argv,
        cwd,
        env: &env,
        cols,
        rows,
    };
    Pty::spawn(&spec, helper()).expect("spawn")
}

fn collect(events: std::sync::mpsc::Receiver<Event>) -> (String, i32, i32) {
    let mut text = Vec::new();
    loop {
        match events.recv_timeout(Duration::from_secs(10)).expect("event") {
            Event::Data(bytes) => text.extend(bytes),
            Event::Exit { exit_code, signal } => {
                return (String::from_utf8(text).unwrap(), exit_code, signal);
            }
        }
    }
}

#[test]
fn output_size_cwd_controlling_tty_env_and_exit_code() {
    let (_pty, events) = run(
        &["-c", "stty size; pwd; [ -t 0 ] && echo tty; echo T=$TERM; ps -o tpgid= -p $$ | tr -d ' '; echo P=$$; exit 3"],
        "/tmp",
        100,
        30,
    );
    let (text, code, signal) = collect(events);
    assert!(text.contains("30 100"), "{text}");
    assert!(
        text.contains("/tmp") || text.contains("/private/tmp"),
        "{text}"
    );
    assert!(text.contains("tty"), "{text}");
    assert!(text.contains("T=xterm-256color"), "{text}");
    // The shell is the session leader and owns the controlling terminal's foreground group.
    let pid = text
        .lines()
        .find_map(|l| l.trim().strip_prefix("P="))
        .unwrap()
        .trim()
        .to_owned();
    assert!(text.lines().any(|l| l.trim() == pid), "{text}");
    assert_eq!((code, signal), (3, 0));
}

#[test]
fn sigterm_reports_the_numeric_signal() {
    let (pty, events) = run(&["-c", "echo ready; sleep 30"], "/tmp", 80, 24);
    match events.recv_timeout(Duration::from_secs(10)).unwrap() {
        Event::Data(bytes) => assert!(String::from_utf8_lossy(&bytes).contains("ready")),
        other => panic!("{other:?}"),
    }
    pty.signal("SIGTERM").unwrap();
    let (_text, code, signal) = collect(events);
    assert_eq!((code, signal), (0, 15));
}

#[test]
fn resize_reaches_the_child_and_input_is_echoed() {
    let (pty, events) = run(
        &["-c", "read line; stty size; echo got=$line"],
        "/tmp",
        80,
        24,
    );
    std::thread::sleep(Duration::from_millis(200));
    pty.resize(120, 40).unwrap();
    pty.write(b"hello\r").unwrap();
    let (text, code, _) = collect(events);
    assert!(text.contains("40 120"), "{text}");
    assert!(text.contains("got=hello"), "{text}");
    assert_eq!(code, 0);
}

#[test]
fn an_invalid_cwd_fails_without_falling_back_to_home() {
    let (_pty, events) = run(&["-c", "echo ran"], "/nonexistent-orqst-synthetic", 80, 24);
    let (text, code, _) = collect(events);
    assert!(!text.contains("ran"), "{text}");
    assert_eq!(code, 1);
}

#[test]
fn pty_crash_fixture() {
    if std::env::var_os("ORQST_TEST_PTY_OWNER").is_none() {
        return;
    }
    let (_pty, events) = run(
        &["-c", "trap '' HUP TERM; sleep 30 & echo SYNTHETIC_PIDS=$$,$!; wait"],
        "/tmp",
        80,
        24,
    );
    for event in events {
        if let Event::Data(text) = event {
            print!("{}", String::from_utf8_lossy(&text));
            std::io::Write::flush(&mut std::io::stdout()).unwrap();
        }
    }
}

#[test]
fn sigkill_of_the_pty_owner_ends_the_cli_and_its_descendants() {
    use std::io::{BufRead, BufReader};
    use std::process::{Command, Stdio};
    use std::time::Instant;

    let mut host = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "pty_crash_fixture", "--nocapture"])
        .env("ORQST_TEST_PTY_OWNER", "1")
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let stdout = host.stdout.take().unwrap();
    let (sender, receiver) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if let Some((_, pids)) = line.trim().split_once("SYNTHETIC_PIDS=") {
                let ids: Option<Vec<i32>> = pids.split(',').map(|pid| pid.parse().ok()).collect();
                let _ = sender.send(ids.unwrap_or_default());
                break;
            }
        }
    });
    let reported = receiver.recv_timeout(Duration::from_secs(5));
    let start = Instant::now();
    host.kill().unwrap();
    host.wait().unwrap();
    let pids = reported.unwrap();
    assert_eq!(pids.len(), 2);
    assert!(pids.iter().all(|pid| *pid > 1));
    loop {
        let survivors: Vec<_> = pids.iter().filter(|pid| unsafe { libc::kill(**pid, 0) == 0 }).collect();
        if survivors.is_empty() {
            break;
        }
        assert!(start.elapsed() < Duration::from_secs(2), "surviving PIDs: {survivors:?}");
        std::thread::sleep(Duration::from_millis(20));
    }
}
