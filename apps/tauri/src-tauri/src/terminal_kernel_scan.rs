//! Private macOS process enumeration; errors are never treated as absence.
use std::ffi::{c_int, c_void};
use std::io;
use std::mem::size_of;

const CTL_KERN: c_int = 1;
const KERN_PROC: c_int = 14;
const KERN_PROC_ALL: c_int = 0;
const KERN_PROC_PID: c_int = 1;
// Darwin arm64 SDK kinfo_proc ABI. Verify against the current process before use.
const RECORD_SIZE: usize = 648;
const START_SEC: usize = 0;
const START_USEC: usize = 8;
const PID: usize = 40;
const UID: usize = 420;
const PPID: usize = 560;
const PGID: usize = 564;
const MAX_RECORDS: usize = 65_536;

extern "C" {
    fn sysctl(
        name: *mut c_int,
        namelen: u32,
        oldp: *mut c_void,
        oldlenp: *mut usize,
        newp: *mut c_void,
        newlen: usize,
    ) -> c_int;
    fn getsid(pid: c_int) -> c_int;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Process {
    pub pid: u32,
    pub ppid: u32,
    pub uid: u32,
    pub start_sec: u64,
    pub start_usec: u64,
    pub sid: u32,
    pub pgid: u32,
}
fn int32(bytes: &[u8], offset: usize) -> u32 {
    u32::from_ne_bytes(bytes[offset..offset + 4].try_into().expect("record layout"))
}
fn int64(bytes: &[u8], offset: usize) -> u64 {
    u64::from_ne_bytes(bytes[offset..offset + 8].try_into().expect("record layout"))
}
fn raw_proc(bytes: &[u8]) -> Process {
    Process {
        pid: int32(bytes, PID),
        ppid: int32(bytes, PPID),
        uid: int32(bytes, UID),
        start_sec: int64(bytes, START_SEC),
        start_usec: int32(bytes, START_USEC) as u64,
        sid: 0,
        pgid: int32(bytes, PGID),
    }
}
fn query(mib: &mut [c_int], output: Option<&mut [u8]>, size: &mut usize) -> io::Result<()> {
    let ptr = output.map_or(std::ptr::null_mut(), |bytes| bytes.as_mut_ptr().cast());
    // SAFETY: mib and optional buffer are valid, with the output size supplied by the caller.
    if unsafe {
        sysctl(
            mib.as_mut_ptr(),
            mib.len() as u32,
            ptr,
            size,
            std::ptr::null_mut(),
            0,
        )
    } != 0
    {
        return Err(io::Error::last_os_error());
    }
    Ok(())
}
fn one_optional(pid: u32) -> io::Result<Option<Process>> {
    let mut mib = [CTL_KERN, KERN_PROC, KERN_PROC_PID, pid as c_int];
    let mut bytes = [0_u8; RECORD_SIZE];
    let mut size = bytes.len();
    query(&mut mib, Some(&mut bytes), &mut size)?;
    if size == 0 {
        return Ok(None);
    }
    if size != RECORD_SIZE {
        return Err(io::Error::other("Process lookup ABI changed"));
    }
    let record = raw_proc(&bytes);
    if record.pid != pid {
        return Err(io::Error::other("Process lookup changed"));
    }
    Ok(Some(record))
}
fn one(pid: u32) -> io::Result<Process> {
    one_optional(pid)?.ok_or_else(|| io::Error::other("Process disappeared"))
}

fn checked_inventory_size(size: usize, capacity: usize) -> io::Result<()> {
    if size == 0 || size >= capacity || size % RECORD_SIZE != 0 {
        return Err(io::Error::other("Truncated kernel inventory"));
    }
    Ok(())
}

/// A failed query never establishes absence; a different boot is outside this mechanism.
pub fn recorded_identity_exists(
    identity: &crate::terminal_kernel_identity::KernelIdentity,
) -> io::Result<bool> {
    if identity.pid == 0 || identity.pid > i32::MAX as u32 {
        return Err(io::Error::other("Invalid recorded identity"));
    }
    if crate::terminal_kernel_identity::read_process(std::process::id())?.boot != identity.boot {
        return Err(io::Error::other("Kernel boot differs"));
    }
    let Some(current) = one_optional(identity.pid)? else {
        return Ok(false);
    };
    if current.start_usec >= 1_000_000 {
        return Err(io::Error::other("Invalid kernel process start"));
    }
    if current.start_sec != identity.start_sec || current.start_usec != identity.start_usec {
        return Ok(false);
    }
    if current.uid != identity.uid {
        return Err(io::Error::other("Kernel identity contradiction"));
    }
    Ok(true)
}

/// Unlike a reservation proof, a mutation holder from a different boot cannot
/// still execute a pending filesystem operation in this kernel.
pub fn mutation_owner_exists(
    identity: &crate::terminal_kernel_identity::KernelIdentity,
) -> io::Result<bool> {
    if identity.pid == 0 || identity.pid > i32::MAX as u32 || identity.sid == 0 {
        return Err(io::Error::other("Invalid mutation owner identity"));
    }
    if crate::terminal_kernel_identity::read_process(std::process::id())?.boot != identity.boot {
        return Ok(false);
    }
    recorded_identity_exists(identity)
}

/// Return a fully checked inventory, or refuse if any record disappears or changes.
pub fn scan() -> io::Result<Vec<Process>> {
    let own = crate::terminal_kernel_identity::read_process(std::process::id())?;
    let mut mib = [CTL_KERN, KERN_PROC, KERN_PROC_ALL, 0];
    let mut estimated = 0;
    query(&mut mib, None, &mut estimated)?;
    if estimated == 0 || estimated > MAX_RECORDS * RECORD_SIZE {
        return Err(io::Error::other("Kernel inventory size unavailable"));
    }
    let capacity = estimated
        .checked_add(1024 * RECORD_SIZE)
        .filter(|size| *size <= MAX_RECORDS * RECORD_SIZE)
        .ok_or_else(|| io::Error::other("Kernel inventory limit"))?;
    let mut bytes = vec![0_u8; capacity];
    let mut size = bytes.len();
    query(&mut mib, Some(&mut bytes), &mut size)?;
    checked_inventory_size(size, capacity)?;
    let records: Vec<_> = bytes[..size]
        .as_chunks::<RECORD_SIZE>()
        .0
        .iter()
        .map(|chunk| raw_proc(chunk))
        .collect();
    let this = records
        .iter()
        .find(|p| p.pid == own.pid)
        .ok_or_else(|| io::Error::other("Kernel inventory missing current process"))?;
    if this.ppid != own.ppid
        || this.uid != own.uid
        || this.start_sec != own.start_sec
        || this.start_usec != own.start_usec
        || this.pgid != own.pgid
        || size_of::<usize>() != 8
    {
        return Err(io::Error::other("Kernel inventory ABI mismatch"));
    }
    let mut result = Vec::with_capacity(records.len());
    let mut seen = std::collections::HashSet::new();
    for mut process in records {
        if process.pid == 0 {
            continue;
        }
        if !seen.insert(process.pid)
            || process.pid > i32::MAX as u32
            || process.start_usec >= 1_000_000
        {
            return Err(io::Error::other("Invalid kernel process record"));
        }
        // SAFETY: getsid reads kernel state for a positive PID.
        let sid = unsafe { getsid(process.pid as c_int) };
        if sid <= 0 {
            return Err(io::Error::last_os_error());
        }
        let current = one(process.pid)?;
        if current != process {
            return Err(io::Error::other("Kernel process changed during scan"));
        }
        // SAFETY: getsid reads kernel state for a positive PID.
        if unsafe { getsid(process.pid as c_int) } != sid {
            return Err(io::Error::other("Kernel session changed during scan"));
        }
        process.sid = sid as u32;
        result.push(process);
    }
    Ok(result)
}

/// Conservative scan result; it is not a descendant or exit proof.
#[derive(Debug, PartialEq, Eq)]
pub struct SessionEvidence {
    pub process_count: usize,
    pub interval_ms: u64,
}
const SCAN_INTERVAL_MS: u64 = 100;

fn compare_scans(
    first: &[Process],
    second: &[Process],
    sessions: &[u32],
) -> io::Result<SessionEvidence> {
    if first.len() != second.len() {
        return Err(io::Error::other("Kernel process count changed"));
    }
    if first
        .iter()
        .chain(second)
        .any(|process| sessions.contains(&process.sid))
    {
        return Err(io::Error::other("Recorded session still has processes"));
    }
    Ok(SessionEvidence {
        process_count: first.len(),
        interval_ms: SCAN_INTERVAL_MS,
    })
}

/// The caller must separately fence producers and bind identities to the reviewed reservation.
pub fn verify_sessions(
    identities: &[crate::terminal_kernel_identity::KernelIdentity],
    sessions: &[u32],
) -> io::Result<SessionEvidence> {
    if identities.is_empty()
        || identities.len() > 384
        || sessions.is_empty()
        || sessions.len() > 128
        || sessions.contains(&0)
    {
        return Err(io::Error::other("Invalid kernel evidence scope"));
    }
    for identity in identities {
        if recorded_identity_exists(identity)? {
            return Err(io::Error::other("Recorded process is still alive"));
        }
    }
    let first = scan()?;
    std::thread::sleep(std::time::Duration::from_millis(SCAN_INTERVAL_MS));
    let second = scan()?;
    let evidence = compare_scans(&first, &second, sessions)?;
    for identity in identities {
        if recorded_identity_exists(identity)? {
            return Err(io::Error::other("Recorded process is still alive"));
        }
    }
    Ok(evidence)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inventory_truncation_and_unaligned_results_are_refused() {
        assert!(checked_inventory_size(0, RECORD_SIZE * 2).is_err());
        assert!(checked_inventory_size(RECORD_SIZE * 2, RECORD_SIZE * 2).is_err());
        assert!(checked_inventory_size(RECORD_SIZE + 1, RECORD_SIZE * 3).is_err());
        assert!(checked_inventory_size(RECORD_SIZE, RECORD_SIZE * 3).is_ok());
    }
    #[test]
    fn mutation_owner_distinguishes_alive_and_old_boot() {
        let mut identity =
            crate::terminal_kernel_identity::read_process(std::process::id()).unwrap();
        assert!(mutation_owner_exists(&identity).unwrap());
        identity.boot = "00000000-0000-4000-8000-000000000000".to_string();
        assert!(!mutation_owner_exists(&identity).unwrap());
        identity.pid = 0;
        assert!(mutation_owner_exists(&identity).is_err());
    }
    #[test]
    fn mutation_owner_tracks_a_real_child_until_reaped() {
        let mut child = std::process::Command::new("/bin/sleep")
            .arg("60")
            .spawn()
            .unwrap();
        let identity = crate::terminal_kernel_identity::read_process(child.id()).unwrap();
        assert!(mutation_owner_exists(&identity).unwrap());
        child.kill().unwrap();
        child.wait().unwrap();
        assert!(!mutation_owner_exists(&identity).unwrap());
    }
    #[test]
    fn dead_session_leader_with_live_child_never_proves_absence() {
        use std::io::{BufRead, BufReader};
        use std::os::unix::process::CommandExt;
        use std::process::{Command, Stdio};
        extern "C" {
            fn setsid() -> i32;
        }
        let mut command = Command::new("/bin/sh");
        command
            .args(["-c", "sleep 10 & echo $!; wait"])
            .stdout(Stdio::piped());
        // SAFETY: setsid is async-signal-safe and touches no shared Rust state.
        unsafe {
            command.pre_exec(|| {
                if setsid() < 0 {
                    Err(io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
        let mut leader = command.spawn().unwrap();
        let mut line = String::new();
        BufReader::new(leader.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let child: u32 = line.trim().parse().unwrap();
        let identity = crate::terminal_kernel_identity::read_process(leader.id()).unwrap();
        let child_identity = crate::terminal_kernel_identity::read_process(child).unwrap();
        assert_eq!(child_identity.sid, identity.sid);
        leader.kill().unwrap();
        leader.wait().unwrap();
        assert!(!recorded_identity_exists(&identity).unwrap());
        assert!(scan()
            .unwrap()
            .iter()
            .any(|process| process.pid == child && process.sid == identity.sid));
        let outcome = verify_sessions(&[identity.clone()], &[identity.sid]);
        assert!(outcome.is_err());
    }
    #[test]
    fn forked_group_and_setsid_escape_have_distinct_kernel_scope() {
        use std::io::{BufRead, BufReader};
        use std::os::unix::process::CommandExt;
        use std::process::{Command, Stdio};
        extern "C" {
            fn setsid() -> i32;
        }
        let program = r#"import os,time
children=[]
for escape in (False,True):
 r,w=os.pipe(); p=os.fork()
 if p==0:
  os.close(r)
  os.setsid() if escape else os.setpgid(0,0)
  os.write(w,b'x'); time.sleep(10); os._exit(0)
 os.close(w); os.read(r,1); children.append(p)
print(*children,flush=True)
time.sleep(60)
"#;
        let mut command = Command::new("/usr/bin/python3");
        command.args(["-c", program]).stdout(Stdio::piped());
        // SAFETY: setsid is async-signal-safe and touches no shared Rust state.
        unsafe {
            command.pre_exec(|| {
                if setsid() < 0 {
                    Err(io::Error::last_os_error())
                } else {
                    Ok(())
                }
            });
        }
        let mut leader = command.spawn().unwrap();
        let mut line = String::new();
        BufReader::new(leader.stdout.take().unwrap())
            .read_line(&mut line)
            .unwrap();
        let children: Vec<u32> = line
            .split_whitespace()
            .map(|v| v.parse().unwrap())
            .collect();
        assert_eq!(children.len(), 2);
        let original = crate::terminal_kernel_identity::read_process(leader.id()).unwrap();
        let group = crate::terminal_kernel_identity::read_process(children[0]).unwrap();
        let escaped = crate::terminal_kernel_identity::read_process(children[1]).unwrap();
        assert_eq!(group.sid, original.sid);
        assert_ne!(group.pgid, original.pgid);
        assert_ne!(escaped.sid, original.sid);
        leader.kill().unwrap();
        leader.wait().unwrap();
        let inventory = scan().unwrap();
        assert!(inventory
            .iter()
            .any(|p| p.pid == group.pid && p.sid == original.sid));
        assert!(inventory
            .iter()
            .any(|p| p.pid == escaped.pid && p.sid == escaped.sid));
        assert!(verify_sessions(&[original.clone()], &[original.sid]).is_err());
    }
    #[test]
    fn comparison_refuses_count_changes_and_original_session_members() {
        let entry = Process {
            pid: 7,
            ppid: 1,
            uid: 501,
            start_sec: 123,
            start_usec: 42,
            sid: 7,
            pgid: 7,
        };
        assert!(compare_scans(std::slice::from_ref(&entry), &[], &[99]).is_err());
        assert!(compare_scans(
            std::slice::from_ref(&entry),
            std::slice::from_ref(&entry),
            &[7]
        )
        .is_err());
        assert_eq!(
            compare_scans(
                std::slice::from_ref(&entry),
                std::slice::from_ref(&entry),
                &[99]
            )
            .unwrap()
            .process_count,
            1
        );
    }

    #[test]
    fn current_owner_never_proves_absence() {
        let identity = crate::terminal_kernel_identity::read_process(std::process::id()).unwrap();
        assert!(verify_sessions(&[identity], &[999_999]).is_err());
    }

    #[test]
    fn same_pid_with_different_start_is_not_the_recorded_process() {
        let identity = crate::terminal_kernel_identity::read_process(std::process::id()).unwrap();
        assert!(recorded_identity_exists(&identity).unwrap());
        let mut old = identity;
        old.start_sec = old.start_sec.saturating_sub(1);
        assert!(!recorded_identity_exists(&old).unwrap());
        old.boot = "00000000-0000-4000-8000-000000000000".into();
        assert!(recorded_identity_exists(&old).is_err());
    }

    #[test]
    fn sdk_record_offsets_match_own_process() {
        let expected = crate::terminal_kernel_identity::read_process(std::process::id()).unwrap();
        let actual = one(expected.pid).unwrap();
        assert_eq!(
            (
                actual.pid,
                actual.ppid,
                actual.uid,
                actual.start_sec,
                actual.start_usec,
                actual.pgid
            ),
            (
                expected.pid,
                expected.ppid,
                expected.uid,
                expected.start_sec,
                expected.start_usec,
                expected.pgid
            )
        );
    }
}
