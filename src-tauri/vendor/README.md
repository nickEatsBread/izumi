# Vendored crates

Patched copies of two crates that librqbit 9.0.0 depends on. The `[patch.crates-io]` section at the
end of `src-tauri/Cargo.toml` swaps them in.

| Crate | Version | Upstream |
| --- | --- | --- |
| `librqbit-dht` | 9.0.0 | [ikatson/rqbit](https://github.com/ikatson/rqbit) `crates/dht` |
| `librqbit-utp` | 0.7.0 | [ikatson/librqbit-utp](https://github.com/ikatson/librqbit-utp) |

Each directory is the published `.crate` archive unpacked unchanged, plus the patch below and a
note at the top of each file it changes. The archives' sha256 matched the checksums Cargo.lock had
recorded for them. Both crates are Apache-2.0 (see `THIRD-PARTY-NOTICES.md`).

## The patch

On Windows, `recv_from` on a UDP socket fails for three conditions that concern a single datagram.
The socket keeps working afterwards:

- WSAECONNRESET (10054): an earlier `send_to` got an ICMP port unreachable back.
- WSAENETRESET (10052): an earlier `send_to` got an ICMP time exceeded back.
- WSAEMSGSIZE (10040): the datagram was longer than the 16 KiB receive buffer.

Upstream returns on any receive error, in the DHT framer (`librqbit-dht/src/dht.rs`) and in the
uTP dispatcher (`librqbit-utp/src/socket.rs`). That ends the DHT worker or the uTP socket for the
rest of the session. After that, every DHT lookup fails with `DhtDead` and every uTP connect or
accept fails with `DispatcherDead`. Pausing and resuming torrents can't bring them back. One
unreachable DHT node or uTP peer is enough to cause it, and any host can send an oversized datagram.

The patch adds `is_datagram_error`, which matches these three codes on Windows only. Both loops now
skip such an error and keep reading. It also adds two tests to each crate that fail on Windows
without the patch. The same change is proposed upstream in
[ikatson/rqbit#690](https://github.com/ikatson/rqbit/pull/690) (issue
[ikatson/rqbit#664](https://github.com/ikatson/rqbit/issues/664)) and
[ikatson/librqbit-utp#4](https://github.com/ikatson/librqbit-utp/pull/4).

To see the exact diff, unpack the published archive and compare:

```bash
curl -sL https://static.crates.io/crates/librqbit-dht/librqbit-dht-9.0.0.crate | tar -xz -C /tmp
diff -ru /tmp/librqbit-dht-9.0.0 src-tauri/vendor/librqbit-dht
```

## Checking it on Windows

izumi's own test binary doesn't start on the Windows dev box, but these crates' tests do. Keep the
target directory outside the repo. librqbit-utp's tests also build a C++ uTP implementation, which
needs MSVC.

```bash
cargo test --locked --target-dir "$TEMP/vendor-target" --manifest-path src-tauri/vendor/librqbit-dht/Cargo.toml --lib test_dht_answers_after
```

```bash
cargo test --locked --target-dir "$TEMP/vendor-target" --manifest-path src-tauri/vendor/librqbit-utp/Cargo.toml --lib e2e_test_connect_after
```

Other platforms never report these errors on an unconnected UDP socket, so there the tests pass with
or without the patch.

## When librqbit is bumped

If a librqbit release needs newer DHT or uTP versions than the ones here, Cargo stops using these
copies and only prints a warning. `scripts/ci/librqbit-vendored-crates.test.ts` turns that into a
test failure. Then:

- If the new upstream releases include the fix, delete this directory, the `[patch.crates-io]`
  section and that test.
- If not, unpack the new archives here and apply the upstream PRs' diffs to them.
