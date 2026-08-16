# rustls reaches these classes through JNI, so R8 cannot discover the references itself.
-keep,includedescriptorclasses class org.rustls.platformverifier.** { *; }

# The JVM resolves this app-owned native method by its fully qualified JNI symbol name.
-keep class com.nicho.izumi.AndroidTlsVerifier { *; }
