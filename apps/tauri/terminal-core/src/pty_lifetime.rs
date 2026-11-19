//! A PTY exec helper arms a macOS kernel watch before it can run the CLI.
//! There is no dependency on JavaScript, the Rust Core event loop, or a Quit hook.
use libc::{c_int, pid_t};

extern "C" {
    fn proc_listallpids(buffer: *mut libc::c_void, size: c_int) -> c_int;
}

/// Called by the single-threaded helper while it is the PTY session leader.
/// The watcher leaves the session and closes the slave before acknowledging the watch.
pub fn watch(owner: pid_t) -> bool {
    // SAFETY: POSIX operations on private descriptors and a fresh, single-threaded process.
    unsafe {
        let leader = libc::getpid();
        if owner <= 1 || libc::getppid() != owner || libc::getsid(0) != leader {
            return false;
        }
        let mut ready = [-1; 2];
        if libc::pipe(ready.as_mut_ptr()) == -1 {
            return false;
        }
        let watcher = libc::fork();
        if watcher == 0 {
            libc::close(ready[0]);
            run_watcher(owner, leader, ready[1]);
        }
        libc::close(ready[1]);
        let mut ack = 0u8;
        let ok = watcher > 0
            && read_ack(ready[0], &mut ack)
            && ack == 1
            && libc::getppid() == owner;
        libc::close(ready[0]);
        ok
    }
}

unsafe fn read_ack(fd: c_int, ack: &mut u8) -> bool {
    loop {
        let bytes = libc::read(fd, (ack as *mut u8).cast(), 1);
        if bytes != -1 || std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
            return bytes == 1;
        }
    }
}

unsafe fn run_watcher(owner: pid_t, leader: pid_t, ready: c_int) -> ! {
    if libc::setsid() == -1 {
        libc::_exit(1);
    }
    for fd in 0..=2 {
        libc::close(fd);
    }
    let queue = libc::kqueue();
    if queue == -1 {
        libc::_exit(1);
    }
    let changes = [owner, leader].map(|pid| libc::kevent {
        ident: pid as libc::uintptr_t,
        filter: libc::EVFILT_PROC,
        flags: libc::EV_ADD | libc::EV_ONESHOT,
        fflags: libc::NOTE_EXIT,
        data: 0,
        udata: std::ptr::null_mut(),
    });
    if libc::kevent(queue, changes.as_ptr(), 2, std::ptr::null_mut(), 0, std::ptr::null()) == -1 {
        libc::_exit(1);
    }
    let ack = 1u8;
    if libc::write(ready, (&ack as *const u8).cast(), 1) != 1 {
        libc::_exit(1);
    }
    libc::close(ready);
    let mut event = std::mem::zeroed::<libc::kevent>();
    loop {
        if libc::kevent(queue, std::ptr::null(), 0, &mut event, 1, std::ptr::null()) == 1 {
            break;
        }
        if std::io::Error::last_os_error().kind() != std::io::ErrorKind::Interrupted {
            break;
        }
    }
    kill_session(leader);
    libc::_exit(0);
}

unsafe fn kill_session(leader: pid_t) {
    // Stop the group before inspecting other jobs in the same controlling session.
    // A shell can put its foreground and background jobs in separate process groups.
    if libc::getsid(leader) == leader {
        libc::kill(-leader, libc::SIGSTOP);
    }
    for _ in 0..4 {
        let capacity = proc_listallpids(std::ptr::null_mut(), 0);
        if capacity <= 0 {
            break;
        }
        let mut pids = vec![0; capacity as usize + 64];
        let bytes = (pids.len() * std::mem::size_of::<pid_t>()) as c_int;
        let count = proc_listallpids(pids.as_mut_ptr().cast(), bytes);
        let mut found = false;
        for pid in pids.into_iter().take(count.max(0) as usize) {
            if pid > 1 && libc::getsid(pid) == leader {
                found |= libc::kill(pid, libc::SIGKILL) == 0;
            }
        }
        if !found {
            break;
        }
    }
    // Handles the normal single-process-group case even if the inventory was unavailable.
    if libc::getsid(leader) == leader {
        libc::kill(-leader, libc::SIGKILL);
    }
}
