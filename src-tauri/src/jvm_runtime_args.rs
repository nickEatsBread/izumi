use std::path::{Path, PathBuf};

pub(crate) fn tls_provider_security_properties() -> &'static str {
    "security.provider.1=org.conscrypt.OpenSSLProvider\n"
}

pub(crate) fn tls_provider_security_path(jar: &Path) -> PathBuf {
    jar.with_extension("security")
}

pub(crate) fn java_runtime_jvm_args(os: &str, tls_provider_jar: Option<&Path>) -> Vec<String> {
    let mut args = vec![
        "-Dfile.encoding=UTF-8".to_string(),
        "-Dsun.stdout.encoding=UTF-8".to_string(),
        "-Dsun.stderr.encoding=UTF-8".to_string(),
        "-Xms64m".to_string(),
        "-Xmx384m".to_string(),
    ];
    // macOS dual-stack sockets try IPv6 first. Hosts that answer that path with HTTP 403
    // then stall inside the stubbed Android WebView fallback until the call times out.
    // Windows and Android already land on IPv4; pin the macOS JVM to the same stack.
    if os == "macos" {
        args.extend([
            "-Djava.net.preferIPv4Stack=true".to_string(),
            "-Djava.net.preferIPv6Addresses=false".to_string(),
        ]);
        // OkHttp 5 only uses Conscrypt/BoringSSL when it is Security.getProviders()[0].
        // The bundled JRE's JSSE ClientHello is distinct on macOS and some hosts 403 it;
        // Android already uses this stack, which is why the same sources work there.
        if let Some(jar) = tls_provider_jar {
            args.push(format!("-Xbootclasspath/a:{}", jar.display()));
            args.push(format!(
                "-Djava.security.properties={}",
                tls_provider_security_path(jar).display()
            ));
        }
    }
    args.push("-jar".to_string());
    args
}

#[cfg(test)]
mod tests {
    use super::{
        java_runtime_jvm_args, tls_provider_security_path, tls_provider_security_properties,
    };
    use std::path::Path;

    #[test]
    fn macos_java_runtime_prefers_ipv4() {
        let args = java_runtime_jvm_args("macos", None);
        assert!(args.iter().any(|arg| arg == "-Djava.net.preferIPv4Stack=true"));
        assert!(
            args.iter()
                .any(|arg| arg == "-Djava.net.preferIPv6Addresses=false")
        );
        assert_eq!(args.last().map(String::as_str), Some("-jar"));
        assert!(!args.iter().any(|arg| arg.contains("bootclasspath")));
    }

    #[test]
    fn macos_java_runtime_installs_conscrypt_as_first_provider() {
        let jar = Path::new("conscrypt-openjdk-uber.jar");
        let args = java_runtime_jvm_args("macos", Some(jar));
        assert!(args.contains(&format!("-Xbootclasspath/a:{}", jar.display())));
        assert!(args.contains(&format!(
            "-Djava.security.properties={}",
            tls_provider_security_path(jar).display()
        )));
        assert_eq!(
            tls_provider_security_properties(),
            "security.provider.1=org.conscrypt.OpenSSLProvider\n"
        );
        assert_eq!(args.last().map(String::as_str), Some("-jar"));
    }

    #[test]
    fn other_platforms_keep_default_java_tls_stack() {
        let jar = Path::new("conscrypt-openjdk-uber.jar");
        for os in ["windows", "linux"] {
            let args = java_runtime_jvm_args(os, Some(jar));
            assert!(
                !args.iter().any(|arg| arg.contains("preferIPv4Stack")),
                "{os} must not pin the JVM address family"
            );
            assert!(
                !args.iter().any(|arg| arg.contains("bootclasspath")),
                "{os} must not replace the JVM TLS provider"
            );
            assert_eq!(args.last().map(String::as_str), Some("-jar"));
        }
    }
}
