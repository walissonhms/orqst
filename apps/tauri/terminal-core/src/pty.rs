//! Owned PTY, a port of `pty-host.ts` + node-pty 1.1.0 on macOS (`src/unix/pty.cc`
//! `pty_posix_spawn`, `spawn-helper.cc`): same termios, posix_spawn flags (SETSID,
//! CLOEXEC_DEFAULT, SETSIGDEF, SETSIGMASK), controlling-terminal helper, environment
//! (`PWD`, `TERM=xterm-256color`, nothing else injected), exact SIGTERM/SIGKILL to the pid,
//! numeric exit code and signal (node-pty `onExit`). No PID adoption.
use std::ffi::{CString, OsStr};
use std::io;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::sync::mpsc;
use std::time::Duration;

/// Bounded chunk size per data event (`pty-host.ts` splits at 16 KiB code units).
pub const CHUNK: usize = 16 * 1024;
/// Owned process deadline (`pty-host.ts` lifetime): SIGTERM, then SIGKILL after 5 s.
pub const LIFETIME: Duration = Duration::from_secs(30 * 60);
pub const ESCALATION: Duration = Duration::from_secs(5);
/// The helper argv marker. The Core binary re-executes itself as node-pty's spawn-helper.
pub const HELPER_ARG: &str = "--orqst-pty-helper";

#[derive(Debug, PartialEq, Eq)]
pub enum Event {
    /// Valid UTF-8 bytes (invalid input replaced, like node-pty's utf8 decoding).
    Data(Vec<u8>),
    /// node-pty semantics: `exit_code` from WEXITSTATUS (0 when signalled), `signal` from
    /// WTERMSIG (0 when it exited normally).
    Exit { exit_code: i32, signal: i32 },
}

pub struct Spawn<'a> {
    pub executable: &'a str,
    pub argv: &'a [String],
    pub cwd: &'a str,
    pub env: &'a [(String, String)],
    pub cols: u16,
    pub rows: u16,
}

pub struct Pty {
    pub pid: libc::pid_t,
    master: OwnedFd,
}

fn cstring(value: &[u8]) -> io::Result<CString> {
    CString::new(value).map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "NUL in argument"))
}

fn termios() -> libc::termios {
    // SAFETY: termios is plain data; every field used below is set explicitly.
    let mut t: libc::termios = unsafe { std::mem::zeroed() };
    t.c_iflag = libc::ICRNL | libc::IXON | libc::IXANY | libc::IMAXBEL | libc::BRKINT | libc::IUTF8;
    t.c_oflag = libc::OPOST | libc::ONLCR;
    t.c_cflag = libc::CREAD | libc::CS8 | libc::HUPCL;
    t.c_lflag = libc::ICANON
        | libc::ISIG
        | libc::IEXTEN
        | libc::ECHO
        | libc::ECHOE
        | libc::ECHOK
        | libc::ECHOKE
        | libc::ECHOCTL;
    let cc = &mut t.c_cc;
    cc[libc::VEOF] = 4;
    cc[libc::VEOL] = 0xff;
    cc[libc::VEOL2] = 0xff;
    cc[libc::VERASE] = 0x7f;
    cc[libc::VWERASE] = 23;
    cc[libc::VKILL] = 21;
    cc[libc::VREPRINT] = 18;
    cc[libc::VINTR] = 3;
    cc[libc::VQUIT] = 0x1c;
    cc[libc::VSUSP] = 26;
    cc[libc::VSTART] = 17;
    cc[libc::VSTOP] = 19;
    cc[libc::VLNEXT] = 22;
    cc[libc::VDISCARD] = 15;
    cc[libc::VMIN] = 1;
    cc[libc::VTIME] = 0;
    cc[libc::VDSUSP] = 25;
    cc[libc::VSTATUS] = 20;
    // SAFETY: valid termios pointer.
    unsafe {
        libc::cfsetispeed(&mut t, libc::B38400);
        libc::cfsetospeed(&mut t, libc::B38400);
    }
    t
}

fn winsize(cols: u16, rows: u16) -> libc::winsize {
    libc::winsize { ws_row: rows, ws_col: cols, ws_xpixel: 0, ws_ypixel: 0 }
}

fn check(result: libc::c_int) -> io::Result<libc::c_int> {
    if result == -1 {
        Err(io::Error::last_os_error())
    } else {
        Ok(result)
    }
}

/// The node-pty spawn-helper, run as `<core> --orqst-pty-helper <cwd> <file> <args...>`:
/// opening the slave without O_NOCTTY makes it the controlling terminal of the new session.
pub fn helper_main(args: &[std::ffi::OsString]) -> ! {
    // SAFETY: plain libc calls on our own fds before exec; failure exits like spawn-helper.
    unsafe {
        let slave = libc::ttyname(libc::STDIN_FILENO);
        if !slave.is_null() {
            libc::close(libc::open(slave, libc::O_RDWR));
        }
        let (Some(cwd), Some(file)) = (args.first(), args.get(1)) else {
            libc::_exit(1);
        };
        if !cwd.is_empty() {
            let Ok(cwd) = cstring(cwd.as_bytes()) else { libc::_exit(1) };
            if libc::chdir(cwd.as_ptr()) == -1 {
                libc::_exit(1);
            }
        }
        let Ok(file_c) = cstring(file.as_bytes()) else { libc::_exit(1) };
        let mut argv: Vec<CString> = Vec::new();
        for arg in &args[1..] {
            let Ok(arg) = cstring(arg.as_bytes()) else { libc::_exit(1) };
            argv.push(arg);
        }
        let mut ptrs: Vec<*const libc::c_char> = argv.iter().map(|a| a.as_ptr()).collect();
        ptrs.push(std::ptr::null());
        libc::execvp(file_c.as_ptr(), ptrs.as_ptr());
        libc::_exit(1);
    }
}

impl Pty {
    /// Spawn through `helper` (normally the current executable). Returns the master and pid;
    /// events arrive on the returned receiver: data chunks, then exactly one exit.
    pub fn spawn(spec: &Spawn, helper: &OsStr) -> io::Result<(Pty, mpsc::Receiver<Event>)> {
        if !spec.executable.starts_with('/') {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "Executable must be absolute"));
        }
        // SAFETY: each call is checked; fds are wrapped in OwnedFd as soon as they exist.
        unsafe {
            let master = OwnedFd::from_raw_fd(check(libc::posix_openpt(libc::O_RDWR | libc::O_NOCTTY))?);
            check(libc::grantpt(master.as_raw_fd()))?;
            check(libc::unlockpt(master.as_raw_fd()))?;
            let mut name = [0 as libc::c_char; 128];
            check(libc::ioctl(master.as_raw_fd(), libc::TIOCPTYGNAME as _, name.as_mut_ptr()))?;
            let slave = OwnedFd::from_raw_fd(check(libc::open(name.as_ptr(), libc::O_RDWR | libc::O_NOCTTY))?);
            let term = termios();
            check(libc::tcsetattr(slave.as_raw_fd(), libc::TCSANOW, &term))?;
            let size = winsize(spec.cols, spec.rows);
            check(libc::ioctl(slave.as_raw_fd(), libc::TIOCSWINSZ, &size))?;

            let mut argv: Vec<CString> = vec![
                cstring(helper.as_bytes())?,
                cstring(HELPER_ARG.as_bytes())?,
                cstring(spec.cwd.as_bytes())?,
                cstring(spec.executable.as_bytes())?,
            ];
            for arg in spec.argv {
                argv.push(cstring(arg.as_bytes())?);
            }
            let mut argp: Vec<*mut libc::c_char> = argv.iter().map(|a| a.as_ptr() as *mut _).collect();
            argp.push(std::ptr::null_mut());
            let env: Vec<CString> = environment(spec)
                .iter()
                .map(|(k, v)| cstring(format!("{k}={v}").as_bytes()))
                .collect::<io::Result<_>>()?;
            let mut envp: Vec<*mut libc::c_char> = env.iter().map(|e| e.as_ptr() as *mut _).collect();
            envp.push(std::ptr::null_mut());

            let mut acts: libc::posix_spawn_file_actions_t = std::ptr::null_mut();
            libc::posix_spawn_file_actions_init(&mut acts);
            for fd in [libc::STDIN_FILENO, libc::STDOUT_FILENO, libc::STDERR_FILENO] {
                libc::posix_spawn_file_actions_adddup2(&mut acts, slave.as_raw_fd(), fd);
            }
            libc::posix_spawn_file_actions_addclose(&mut acts, slave.as_raw_fd());
            libc::posix_spawn_file_actions_addclose(&mut acts, master.as_raw_fd());
            let mut attrs: libc::posix_spawnattr_t = std::ptr::null_mut();
            libc::posix_spawnattr_init(&mut attrs);
            const POSIX_SPAWN_SETSID: libc::c_short = 0x0400;
            let flags = libc::POSIX_SPAWN_CLOEXEC_DEFAULT as libc::c_short
                | libc::POSIX_SPAWN_SETSIGDEF as libc::c_short
                | libc::POSIX_SPAWN_SETSIGMASK as libc::c_short
                | POSIX_SPAWN_SETSID;
            let mut err = libc::posix_spawnattr_setflags(&mut attrs, flags);
            let mut set: libc::sigset_t = std::mem::zeroed();
            if err == 0 {
                libc::sigfillset(&mut set);
                err = libc::posix_spawnattr_setsigdefault(&mut attrs, &set);
            }
            if err == 0 {
                libc::sigemptyset(&mut set);
                err = libc::posix_spawnattr_setsigmask(&mut attrs, &set);
            }
            let mut pid: libc::pid_t = 0;
            if err == 0 {
                loop {
                    err = libc::posix_spawn(&mut pid, argv[0].as_ptr(), &acts, &attrs, argp.as_ptr(), envp.as_ptr());
                    if err != libc::EINTR {
                        break;
                    }
                }
            }
            libc::posix_spawn_file_actions_destroy(&mut acts);
            libc::posix_spawnattr_destroy(&mut attrs);
            drop(slave);
            if err != 0 {
                return Err(io::Error::from_raw_os_error(err));
            }
            let pty = Pty { pid, master };
            let receiver = pty.watch()?;
            Ok((pty, receiver))
        }
    }

    fn watch(&self) -> io::Result<mpsc::Receiver<Event>> {
        // Bounded: a flooding CLI blocks on its PTY instead of growing memory (node-pty pause).
        let (sender, receiver) = mpsc::sync_channel::<Event>(64);
        let reader = self.master.try_clone()?;
        let pid = self.pid;
        let data = sender.clone();
        let reading = std::thread::spawn(move || {
            let mut decoder = Utf8Chunks::default();
            let mut buffer = vec![0u8; CHUNK];
            loop {
                // SAFETY: reading into our own buffer from our own fd.
                let n = unsafe { libc::read(reader.as_raw_fd(), buffer.as_mut_ptr().cast(), buffer.len()) };
                if n < 0 && io::Error::last_os_error().kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                if n <= 0 {
                    break; // EIO once the slave side is closed.
                }
                let text = decoder.push(&buffer[..n as usize]);
                if !text.is_empty() && data.send(Event::Data(text)).is_err() {
                    break;
                }
            }
            let tail = decoder.finish();
            if !tail.is_empty() {
                let _ = data.send(Event::Data(tail));
            }
        });
        std::thread::spawn(move || {
            let mut status = 0;
            loop {
                // SAFETY: waits only for the child we spawned.
                let r = unsafe { libc::waitpid(pid, &mut status, 0) };
                if r == -1 && io::Error::last_os_error().kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                break;
            }
            // Drain output first, like node-pty waiting for the socket to close.
            let _ = reading.join();
            let (exit_code, signal) = if libc::WIFSIGNALED(status) {
                (0, libc::WTERMSIG(status))
            } else {
                (libc::WEXITSTATUS(status), 0)
            };
            let _ = sender.send(Event::Exit { exit_code, signal });
        });
        Ok(receiver)
    }

    pub fn write(&self, bytes: &[u8]) -> io::Result<()> {
        let mut rest = bytes;
        while !rest.is_empty() {
            // SAFETY: writing our own buffer to our own fd.
            let n = unsafe { libc::write(self.master.as_raw_fd(), rest.as_ptr().cast(), rest.len()) };
            if n < 0 {
                let error = io::Error::last_os_error();
                if error.kind() == io::ErrorKind::Interrupted {
                    continue;
                }
                return Err(error);
            }
            rest = &rest[n as usize..];
        }
        Ok(())
    }

    pub fn resize(&self, cols: u16, rows: u16) -> io::Result<()> {
        let size = winsize(cols, rows);
        // SAFETY: TIOCSWINSZ on our master; the kernel signals the foreground group.
        check(unsafe { libc::ioctl(self.master.as_raw_fd(), libc::TIOCSWINSZ, &size) }).map(|_| ())
    }

    /// Exactly SIGTERM or SIGKILL to the owned pid (node-pty `kill(signal)`), never the group.
    pub fn signal(&self, name: &str) -> io::Result<()> {
        let signal = match name {
            "SIGTERM" => libc::SIGTERM,
            "SIGKILL" => libc::SIGKILL,
            _ => return Err(io::Error::new(io::ErrorKind::InvalidInput, "Unsupported signal")),
        };
        // SAFETY: plain kill(2) on the child we spawned and have not reaped.
        check(unsafe { libc::kill(self.pid, signal) }).map(|_| ())
    }
}

/// node-pty: the given environment plus `PWD=cwd` and `TERM=xterm-256color`, in order.
pub fn environment(spec: &Spawn) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = spec.env.to_vec();
    for (key, value) in [("PWD", spec.cwd), ("TERM", "xterm-256color")] {
        match env.iter_mut().find(|(k, _)| k == key) {
            Some(entry) => entry.1 = value.to_owned(),
            None => env.push((key.to_owned(), value.to_owned())),
        }
    }
    env
}

/// Signal number to name for receipts (`os.constants.signals` on macOS).
pub fn signal_name(signal: i32) -> Option<&'static str> {
    Some(match signal {
        1 => "SIGHUP",
        2 => "SIGINT",
        3 => "SIGQUIT",
        4 => "SIGILL",
        5 => "SIGTRAP",
        6 => "SIGABRT",
        7 => "SIGEMT",
        8 => "SIGFPE",
        9 => "SIGKILL",
        10 => "SIGBUS",
        11 => "SIGSEGV",
        12 => "SIGSYS",
        13 => "SIGPIPE",
        14 => "SIGALRM",
        15 => "SIGTERM",
        16 => "SIGURG",
        17 => "SIGSTOP",
        18 => "SIGTSTP",
        19 => "SIGCONT",
        20 => "SIGCHLD",
        21 => "SIGTTIN",
        22 => "SIGTTOU",
        23 => "SIGIO",
        24 => "SIGXCPU",
        25 => "SIGXFSZ",
        26 => "SIGVTALRM",
        27 => "SIGPROF",
        28 => "SIGWINCH",
        29 => "SIGINFO",
        30 => "SIGUSR1",
        31 => "SIGUSR2",
        _ => return None,
    })
}

/// Streaming UTF-8 decode with replacement, like Node's StringDecoder('utf8').
#[derive(Default)]
pub struct Utf8Chunks {
    pending: Vec<u8>,
}

impl Utf8Chunks {
    pub fn push(&mut self, bytes: &[u8]) -> Vec<u8> {
        self.pending.extend_from_slice(bytes);
        let keep = incomplete_tail(&self.pending);
        let split = self.pending.len() - keep;
        let text = String::from_utf8_lossy(&self.pending[..split]).into_owned().into_bytes();
        self.pending.drain(..split);
        text
    }

    pub fn finish(&mut self) -> Vec<u8> {
        let text = String::from_utf8_lossy(&self.pending).into_owned().into_bytes();
        self.pending.clear();
        text
    }
}

/// Length of a trailing, still-possible incomplete UTF-8 sequence (at most 3 bytes).
fn incomplete_tail(bytes: &[u8]) -> usize {
    for back in 1..=3.min(bytes.len()) {
        let b = bytes[bytes.len() - back];
        if b & 0xc0 == 0x80 {
            continue;
        }
        let need = if b & 0xe0 == 0xc0 {
            2
        } else if b & 0xf0 == 0xe0 {
            3
        } else if b & 0xf8 == 0xf0 {
            4
        } else {
            return 0;
        };
        return if need > back { back } else { 0 };
    }
    0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf8_split_sequences_are_joined_and_invalid_bytes_replaced() {
        let mut d = Utf8Chunks::default();
        let euro = "€".as_bytes();
        assert_eq!(d.push(&[b'a', euro[0]]), b"a");
        assert_eq!(d.push(&euro[1..]), euro);
        assert_eq!(d.push(&[0xff, b'b']), "\u{fffd}b".as_bytes());
        assert_eq!(d.push(&[0xe2]), b"");
        assert_eq!(d.finish(), "\u{fffd}".as_bytes());
    }

    #[test]
    fn environment_adds_only_pwd_and_term() {
        let env = vec![("HOME".to_owned(), "/h".to_owned()), ("TERM".to_owned(), "dumb".to_owned())];
        let spec = Spawn { executable: "/bin/sh", argv: &[], cwd: "/tmp", env: &env, cols: 80, rows: 24 };
        assert_eq!(
            environment(&spec),
            vec![
                ("HOME".to_owned(), "/h".to_owned()),
                ("TERM".to_owned(), "xterm-256color".to_owned()),
                ("PWD".to_owned(), "/tmp".to_owned()),
            ]
        );
    }

    #[test]
    fn signal_names_match_macos() {
        assert_eq!(signal_name(15), Some("SIGTERM"));
        assert_eq!(signal_name(9), Some("SIGKILL"));
        assert_eq!(signal_name(0), None);
    }
}
