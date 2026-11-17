//! Seccomp filter for the CDM thread. It is installed before the module is loaded, so every thread
//! the closed module starts inherits it. The module may compute and allocate, but this thread and
//! its children cannot open network sockets, start programs, create processes, trace other
//! processes or open files for writing. Denied calls fail with an errno instead of killing izumi.
//! This is defence in depth, not a boundary: the module still shares izumi's address space.
//!
//! `IZUMI_WIDEVINE_SECCOMP=log` reports would-be denials to the kernel log instead, and `off` skips
//! the filter, both for diagnosis only.
//!
//! seccomp is a Linux kernel feature; on other platforms `confine_current_thread` is a no-op and
//! the CDM thread runs unconfined. Windows uses the module only to decrypt-save, not for playback.

#[cfg(not(target_os = "linux"))]
pub fn confine_current_thread() -> Result<&'static str, String> {
    Ok("unconfined (seccomp is Linux-only)")
}

#[cfg(target_os = "linux")]
pub use linux::confine_current_thread;

#[cfg(target_os = "linux")]
mod linux {
const AUDIT_ARCH_X86_64: u32 = 0xC000_003E;
// struct seccomp_data offsets.
const NR: u32 = 0;
const ARCH: u32 = 4;
const fn arg_lo(n: u32) -> u32 {
    16 + 8 * n
}

const LD_W_ABS: u16 = 0x00 | 0x00 | 0x20; // BPF_LD | BPF_W | BPF_ABS
const JEQ_K: u16 = 0x05 | 0x10; // BPF_JMP | BPF_JEQ | BPF_K
const JSET_K: u16 = 0x05 | 0x40; // BPF_JMP | BPF_JSET | BPF_K
const RET_K: u16 = 0x06; // BPF_RET | BPF_K

fn stmt(code: u16, k: u32) -> libc::sock_filter {
    libc::sock_filter { code, jt: 0, jf: 0, k }
}
fn jump(code: u16, k: u32, jt: u8, jf: u8) -> libc::sock_filter {
    libc::sock_filter { code, jt, jf, k }
}

/// Syscalls refused outright, with the errno they fail with.
fn denied() -> Vec<(i64, i32)> {
    vec![
        (libc::SYS_socket, libc::EACCES),
        (libc::SYS_socketpair, libc::EACCES),
        (libc::SYS_connect, libc::EACCES),
        (libc::SYS_bind, libc::EACCES),
        (libc::SYS_execve, libc::EACCES),
        (libc::SYS_execveat, libc::EACCES),
        (libc::SYS_fork, libc::EACCES),
        (libc::SYS_vfork, libc::EACCES),
        (libc::SYS_ptrace, libc::EPERM),
        (libc::SYS_process_vm_readv, libc::EPERM),
        (libc::SYS_process_vm_writev, libc::EPERM),
        // glibc falls back to clone() for threads when clone3 is unavailable; clone() is checked below.
        (libc::SYS_clone3, libc::ENOSYS),
        // openat2's flags live behind a pointer the filter cannot read; glibc does not use it for open().
        (libc::SYS_openat2, libc::ENOSYS),
        (libc::SYS_creat, libc::EACCES),
        (libc::SYS_unlink, libc::EACCES),
        (libc::SYS_unlinkat, libc::EACCES),
        (libc::SYS_rename, libc::EACCES),
        (libc::SYS_renameat, libc::EACCES),
        (libc::SYS_renameat2, libc::EACCES),
        (libc::SYS_mkdir, libc::EACCES),
        (libc::SYS_mkdirat, libc::EACCES),
        (libc::SYS_truncate, libc::EACCES),
    ]
}

fn program(deny: u32) -> Vec<libc::sock_filter> {
    let write_flags = (libc::O_WRONLY | libc::O_RDWR | libc::O_CREAT | libc::O_TRUNC | libc::O_APPEND) as u32;
    let errno = |e: i32| stmt(RET_K, deny | (e as u32 & 0xffff));
    let mut p = vec![
        // Wrong architecture: refuse everything rather than mis-read syscall numbers.
        stmt(LD_W_ABS, ARCH),
        jump(JEQ_K, AUDIT_ARCH_X86_64, 1, 0),
        errno(libc::ENOSYS),
        stmt(LD_W_ABS, NR),
    ];
    for (nr, e) in denied() {
        p.push(jump(JEQ_K, nr as u32, 0, 1));
        p.push(errno(e));
    }
    // clone(): threads (CLONE_THREAD) are fine; anything that would make a new process is not.
    p.push(jump(JEQ_K, libc::SYS_clone as u32, 0, 4));
    p.push(stmt(LD_W_ABS, arg_lo(0)));
    p.push(jump(JSET_K, libc::CLONE_THREAD as u32, 1, 0));
    p.push(errno(libc::EACCES));
    p.push(stmt(RET_K, libc::SECCOMP_RET_ALLOW));
    // open(path, flags) and openat(dir, path, flags): read-only opens only.
    for (nr, flags_arg) in [(libc::SYS_open, 1), (libc::SYS_openat, 2)] {
        p.push(stmt(LD_W_ABS, NR));
        p.push(jump(JEQ_K, nr as u32, 0, 4));
        p.push(stmt(LD_W_ABS, arg_lo(flags_arg)));
        p.push(jump(JSET_K, write_flags, 0, 1));
        p.push(errno(libc::EACCES));
        p.push(stmt(RET_K, libc::SECCOMP_RET_ALLOW));
    }
    p.push(stmt(RET_K, libc::SECCOMP_RET_ALLOW));
    p
}

/// Installs the filter on the calling thread only. Returns a description for the log.
pub fn confine_current_thread() -> Result<&'static str, String> {
    let mode = std::env::var("IZUMI_WIDEVINE_SECCOMP").unwrap_or_default();
    let deny = match mode.as_str() {
        "off" => return Ok("off (IZUMI_WIDEVINE_SECCOMP=off)"),
        "log" => libc::SECCOMP_RET_LOG,
        _ => libc::SECCOMP_RET_ERRNO,
    };
    let mut filter = program(deny);
    if deny == libc::SECCOMP_RET_LOG {
        // RET_LOG carries no errno; strip the data bits so the instruction is valid.
        for ins in filter.iter_mut().filter(|i| i.code == RET_K && i.k & 0xffff_0000 == libc::SECCOMP_RET_LOG) {
            ins.k = libc::SECCOMP_RET_LOG;
        }
    }
    let prog = libc::sock_fprog { len: filter.len() as u16, filter: filter.as_mut_ptr() };
    // SAFETY: prctl/seccomp take plain integers and a pointer to `prog`, which outlives the calls.
    unsafe {
        if libc::prctl(libc::PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) != 0 {
            return Err(format!("PR_SET_NO_NEW_PRIVS failed: {}", std::io::Error::last_os_error()));
        }
        // No SECCOMP_FILTER_FLAG_TSYNC: only this thread (and threads it creates) is filtered.
        if libc::syscall(libc::SYS_seccomp, libc::SECCOMP_SET_MODE_FILTER, 0, &prog as *const libc::sock_fprog) != 0 {
            return Err(format!("seccomp filter refused: {}", std::io::Error::last_os_error()));
        }
    }
    Ok(if deny == libc::SECCOMP_RET_LOG { "log only" } else { "enforcing" })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn filtered_thread_can_read_and_make_threads_but_not_write_connect_or_spawn() {
        let dir = std::env::temp_dir().join(format!("izumi-seccomp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let readable = dir.join("readable");
        std::fs::write(&readable, b"ok").unwrap();
        let blocked = dir.join("blocked");
        let r = readable.clone();
        let b = blocked.clone();
        let outcome = std::thread::spawn(move || {
            std::env::remove_var("IZUMI_WIDEVINE_SECCOMP");
            assert_eq!(confine_current_thread().unwrap(), "enforcing");
            let read_ok = std::fs::read(&r).is_ok();
            let write_denied = std::fs::write(&b, b"x").is_err();
            let socket_denied = std::net::TcpStream::connect("127.0.0.1:9").is_err_and(|e| e.raw_os_error() == Some(libc::EACCES));
            let thread_ok = std::thread::spawn(|| 2 + 2).join().is_ok();
            let spawn_denied = std::process::Command::new("/bin/true").status().is_err();
            (read_ok, write_denied, socket_denied, thread_ok, spawn_denied)
        })
        .join()
        .unwrap();
        assert_eq!(outcome, (true, true, true, true, true));
        assert!(!blocked.exists());
        // The rest of the process is unaffected.
        std::fs::write(&blocked, b"x").unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
} // mod linux
