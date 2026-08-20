pub(crate) fn java_runtime_jvm_args(os: &str) -> Vec<&'static str> {
    let mut args = vec![
        "-Dfile.encoding=UTF-8",
        "-Dsun.stdout.encoding=UTF-8",
        "-Dsun.stderr.encoding=UTF-8",
        "-Xms64m",
        "-Xmx384m",
    ];
    // macOS dual-stack sockets try IPv6 first. Hosts that answer that path with HTTP 403
    // then stall inside the stubbed Android WebView fallback until the call times out.
    // Windows and Android already land on IPv4; pin the macOS JVM to the same stack.
    if os == "macos" {
        args.extend([
            "-Djava.net.preferIPv4Stack=true",
            "-Djava.net.preferIPv6Addresses=false",
        ]);
    }
    args.push("-jar");
    args
}

#[cfg(test)]
mod tests {
    use super::java_runtime_jvm_args;

    #[test]
    fn macos_java_runtime_prefers_ipv4() {
        let args = java_runtime_jvm_args("macos");
        assert!(args.contains(&"-Djava.net.preferIPv4Stack=true"));
        assert!(args.contains(&"-Djava.net.preferIPv6Addresses=false"));
        assert_eq!(args.last(), Some(&"-jar"));
    }

    #[test]
    fn other_platforms_keep_default_java_address_family() {
        for os in ["windows", "linux"] {
            let args = java_runtime_jvm_args(os);
            assert!(
                !args.iter().any(|arg| arg.contains("preferIPv4Stack")),
                "{os} must not pin the JVM address family"
            );
            assert!(
                !args.iter().any(|arg| arg.contains("preferIPv6Addresses")),
                "{os} must not pin the JVM address family"
            );
            assert_eq!(args.last(), Some(&"-jar"));
        }
    }
}
