//! Private macOS process identity primitives. No renderer or HTTP authority.

use std::ffi::{c_char, c_int, c_void, CStr};
use std::io;
use std::mem::{size_of, MaybeUninit};

const PROC_PIDTBSDINFO: c_int = 3;

#[repr(C)]
#[derive(Clone, Copy)]
struct ProcBsdInfo {
    flags: u32,
    status: u32,
    xstatus: u32,
    pid: u32,
    ppid: u32,
    uid: u32,
    gid: u32,
    ruid: u32,
    rgid: u32,
    svuid: u32,
    svgid: u32,
    reserved: u32,
    comm: [c_char; 16],
    name: [c_char; 32],
    nfiles: u32,
    pgid: u32,
    pjobc: u32,
    tdev: u32,
    tpgid: u32,
    nice: i32,
    start_sec: u64,
    start_usec: u64,
}

extern "C" {
    fn proc_pidinfo(pid: c_int, flavor: c_int, arg: u64, buffer: *mut c_void, size: c_int)
        -> c_int;
    fn getsid(pid: c_int) -> c_int;
    fn getpgid(pid: c_int) -> c_int;
    fn sysctlbyname(
        name: *const c_char,
        oldp: *mut c_void,
        oldlenp: *mut usize,
        newp: *mut c_void,
        newlen: usize,
    ) -> c_int;
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct KernelIdentity {
    pub boot: String,
    pub pid: u32,
    pub ppid: u32,
    pub uid: u32,
    pub start_sec: u64,
    pub start_usec: u64,
    pub sid: u32,
    pub pgid: u32,
}

fn boot_uuid() -> io::Result<String> {
    let mut data = [0_u8; 64];
    let mut len = data.len();
    // SAFETY: name and output buffer are valid for the duration of the call.
    let result = unsafe {
        sysctlbyname(
            c"kern.bootsessionuuid".as_ptr(),
            data.as_mut_ptr().cast(),
            &mut len,
            std::ptr::null_mut(),
            0,
        )
    };
    if result != 0 {
        return Err(io::Error::last_os_error());
    }
    if len != 37 || data[36] != 0 {
        return Err(io::Error::other("Invalid kernel boot UUID"));
    }
    let value = CStr::from_bytes_with_nul(&data[..len])
        .map_err(|_| io::Error::other("Invalid kernel boot UUID"))?
        .to_str()
        .map_err(|_| io::Error::other("Invalid kernel boot UUID"))?;
    if !value.bytes().enumerate().all(|(i, byte)| match i {
        8 | 13 | 18 | 23 => byte == b'-',
        _ => byte.is_ascii_hexdigit(),
    }) {
        return Err(io::Error::other("Invalid kernel boot UUID"));
    }
    Ok(value.to_ascii_lowercase())
}

fn bsd_info(pid: c_int) -> io::Result<ProcBsdInfo> {
    let mut data = MaybeUninit::<ProcBsdInfo>::uninit();
    // SAFETY: proc_pidinfo writes no more than the explicitly supplied buffer size.
    let count = unsafe {
        proc_pidinfo(
            pid,
            PROC_PIDTBSDINFO,
            0,
            data.as_mut_ptr().cast(),
            size_of::<ProcBsdInfo>() as c_int,
        )
    };
    if count != size_of::<ProcBsdInfo>() as c_int {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: the exact successful return size means the entire structure was written.
    Ok(unsafe { data.assume_init() })
}

/// Recheck the kernel record around SID/PGID queries. Errors never mean absence.
pub fn read_process(pid: u32) -> io::Result<KernelIdentity> {
    let pid = c_int::try_from(pid)
        .ok()
        .filter(|pid| *pid > 0)
        .ok_or_else(|| io::Error::other("Invalid process ID"))?;
    let boot = boot_uuid()?;
    let first = bsd_info(pid)?;
    // SAFETY: these calls only query the supplied positive process ID.
    let (sid, pgid) = unsafe { (getsid(pid), getpgid(pid)) };
    if sid <= 0 || pgid <= 0 {
        return Err(io::Error::last_os_error());
    }
    let last = bsd_info(pid)?;
    if first.pid != pid as u32
        || first.pid != last.pid
        || first.ppid != last.ppid
        || first.uid != last.uid
        || first.start_sec != last.start_sec
        || first.start_usec != last.start_usec
        || first.pgid != pgid as u32
        || first.pgid != last.pgid
        || first.start_usec >= 1_000_000
        || boot != boot_uuid()?
    {
        return Err(io::Error::other("Process identity changed"));
    }
    // Re-query the session after the second identity read to reject a changed SID.
    // SAFETY: getsid only queries the supplied positive process ID.
    if unsafe { getsid(pid) } != sid {
        return Err(io::Error::other("Process session changed"));
    }
    let final_info = bsd_info(pid)?;
    if first.pid != final_info.pid
        || first.ppid != final_info.ppid
        || first.uid != final_info.uid
        || first.pgid != final_info.pgid
        || first.start_sec != final_info.start_sec
        || first.start_usec != final_info.start_usec
    {
        return Err(io::Error::other("Process identity changed"));
    }
    Ok(KernelIdentity {
        boot,
        pid: first.pid,
        ppid: first.ppid,
        uid: first.uid,
        start_sec: first.start_sec,
        start_usec: first.start_usec,
        sid: sid as u32,
        pgid: pgid as u32,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn current_process_has_stable_kernel_identity() {
        let current = read_process(std::process::id()).unwrap();
        assert_eq!(current.pid, std::process::id());
        assert!(current.start_sec > 0);
        assert!(current.sid > 0);
        assert!(current.pgid > 0);
        assert_eq!(current.boot.len(), 36);
        assert_eq!(current, read_process(std::process::id()).unwrap());
    }

    #[test]
    fn native_layout_matches_the_macos_sdk() {
        assert_eq!(size_of::<ProcBsdInfo>(), 136);
        assert_eq!(std::mem::offset_of!(ProcBsdInfo, pid), 12);
        assert_eq!(std::mem::offset_of!(ProcBsdInfo, ppid), 16);
        assert_eq!(std::mem::offset_of!(ProcBsdInfo, uid), 20);
        assert_eq!(std::mem::offset_of!(ProcBsdInfo, pgid), 100);
        assert_eq!(std::mem::offset_of!(ProcBsdInfo, start_sec), 120);
        assert_eq!(std::mem::offset_of!(ProcBsdInfo, start_usec), 128);
    }

    #[test]
    fn owned_child_has_kernel_reported_parent() {
        let mut child = std::process::Command::new("/bin/sleep")
            .arg("1")
            .spawn()
            .unwrap();
        let identity = read_process(child.id()).unwrap();
        assert_eq!(identity.ppid, std::process::id());
        assert!(child.wait().unwrap().success());
    }

    #[test]
    fn invalid_pid_is_not_interpreted_as_absence() {
        assert!(read_process(0).is_err());
        assert!(read_process(u32::MAX).is_err());
    }
}
