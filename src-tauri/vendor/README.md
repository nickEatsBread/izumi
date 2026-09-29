# Vendored crates

izumi builds librqbit from the head of its upstream `main` branch, not from the last crates.io
release, and carries its own changes on top until upstream has an equivalent. This directory holds
what that takes. `scripts/ci/librqbit-vendor.mjs` writes it; don't edit the crate directories by
hand.

- `upstream.json` pins one commit in each upstream repository:
  [ikatson/rqbit](https://github.com/ikatson/rqbit),
  [ikatson/librqbit-utp](https://github.com/ikatson/librqbit-utp) and
  [ikatson/librqbit-dualstack-sockets](https://github.com/ikatson/librqbit-dualstack-sockets). Its
  `vendored` list says which crates are copied here.
- `patches/<repository>/` holds izumi's changes as `git format-patch` files, applied in order to the
  pinned commit.
- Each crate directory is what `cargo package` makes of the pinned commit with the patches applied,
  which is what crates.io would publish from it. It leaves out the package's `.cargo_vcs_info.json`
  and `Cargo.lock`, which Cargo never reads for a dependency, and librqbit's `webui/`, since izumi
  builds librqbit without its `webui` feature. It adds the repository's `LICENSE` notice when the
  package has none.

Only crates that differ from the crates.io release of the same version are copied. The rest of
librqbit's crates come from crates.io. The block between `# BEGIN librqbit-vendor` and
`# END librqbit-vendor` at the end of `src-tauri/Cargo.toml` is generated to match, and
`scripts/ci/librqbit-vendored-crates.test.ts` fails if Cargo stops using any of the copies. Cargo
drops an unusable patch with only a warning.

## izumi's patches

They change librqbit only (`patches/rqbit/`). Each file they touch says so at the top.

The player reads a torrent through librqbit's HTTP stream, which blocks until the piece at the read
position has arrived and been verified. librqbit gives each piece to a single peer, so one slow peer
holding that piece stalls playback while the rest of the swarm keeps delivering other pieces. In
one test the swarm delivered 91 MB in 9 seconds while the first piece of the file stayed missing.

1. **Taking over a waited-for piece sooner** (`0001`). The first eight pieces ahead of every open
   stream are "critical": mpv reads a release's embedded fonts, often several megabytes, before it
   shows anything. Before a peer starts anything else, it takes over a critical piece that another
   peer has held for 1.5 times this peer's average piece time, and never sooner than 500 ms.
   Upstream waits for ten times that average. A peer that has not completed a piece yet takes
   nothing. A peer that takes a piece over only requests the chunks that are still missing.
   Upstream requests every chunk again, in order, which put the missing ones last.
2. **A request queue sized by delivery** (`0002`). A peer serves requests in order, so a newly
   waited-for piece sits behind everything already asked of that peer. Upstream keeps up to 128
   chunks (2 MiB) in flight per peer, several seconds at a typical peer's rate. The patch measures
   each peer's delivery rate while requests are outstanding and keeps about one second of it in
   flight: at least 16 chunks, 32 before the first measurement, and never more than the peer allows
   or upstream's `max_request_window` option.
3. **Passive reads for previews** (`0003`). `ManagedTorrent::stream_passive` opens a stream that is
   not registered with the torrent, so it never changes which pieces are requested, and that fails
   at once on a piece that has not been downloaded instead of waiting for it.
   `FileStream::is_available` and `ManagedTorrent::file_range_downloaded` say whether a position or a
   byte range is already there. The seek bar's thumbnails read a direct torrent this way, so they
   never compete with the video the player is waiting for.

Unit tests cover the takeover rule, the chunk bookkeeping and the queue sizing
(`try_steal_critical`, `chunks_received_before_a_piece_completes_stay_downloaded` and
`delivery_rate_tests`).

## Updating

```bash
node scripts/ci/librqbit-vendor.mjs update
```

This moves each pin to the head of its branch and rebases the patches onto it, then rewrites this
directory, the `Cargo.toml` block and the librqbit entries in `Cargo.lock`. The scratch clones live
in `tmp/librqbit-vendor/src/`. If upstream's version moves past what the `librqbit` requirement in
`src-tauri/Cargo.toml` accepts (a new major version, say), Cargo stops using the copies and the
command says so: raise the requirement and run `sync`.

If a patch conflicts, the command stops and says where. Resolve the conflict in that clone, `git
add` the files and run `git rebase --continue` there, then:

```bash
node scripts/ci/librqbit-vendor.mjs export
```

To give up on that update instead, `node scripts/ci/librqbit-vendor.mjs sync --discard` goes back
to the pins. `sync`, `update` and `check` reset the clones, so they refuse to run while an update is
waiting like this, or while a clone has commits that `export` hasn't written yet. `--discard` throws
that work away.

Before committing an update, check it:

- `cargo check` in `src-tauri`.
- librqbit's tests, in the scratch clone that now holds the pinned commit plus the patches. Keep
  the target directory outside the repository. On the Windows dev box the two
  `tests::e2e::test_e2e_download_*` tests can time out while other builds are running; they pass
  on Linux (WSL).

  ```bash
  cargo test --manifest-path tmp/librqbit-vendor/src/rqbit/Cargo.toml --target-dir "${TMPDIR:-${TEMP:-/tmp}}/rqbit-target" -p librqbit --lib
  ```

- `npx vitest run scripts/ci/librqbit-vendor.test.ts scripts/ci/librqbit-vendored-crates.test.ts`
- A direct P2P playback start and a few seeks on a real release.

Commit `src-tauri/vendor`, `src-tauri/Cargo.toml` and `src-tauri/Cargo.lock` together. `sync` moves
only the librqbit crates in `Cargo.lock`. If the diff shows other packages moving (a build running
at the same time can re-resolve the whole lockfile), restore `Cargo.lock` from git and run `sync`
again.

## When upstream has one of these changes

Git drops a patch during `update` only when upstream made exactly the same change, which rarely
happens: each patch also adds the "Modified for izumi" notices. So once upstream has the code, the
rebased patch usually shrinks to those notices, and `update` and `check` say so. Or it conflicts
where upstream solved the problem another way. Either way, drop it in the clone and export:

```bash
node scripts/ci/librqbit-vendor.mjs sync
git -C tmp/librqbit-vendor/src/rqbit log --oneline izumi
git -C tmp/librqbit-vendor/src/rqbit rebase --onto <commit>^ <commit> izumi
node scripts/ci/librqbit-vendor.mjs export
```

A later patch may touch lines the dropped one added (0003 edits the notice 0001 adds at the top of
`streaming.rs`). Resolve that in the rebase like any other conflict before running `export`.

## Changing a patch

`sync` leaves each clone on an `izumi` branch: the pinned commit plus one commit per patch. Edit and
commit there (a new commit adds a patch, `git commit --amend` or a fixup changes one), then run
`export`. It writes the branch back to `patches/` and syncs.

```bash
node scripts/ci/librqbit-vendor.mjs sync
node scripts/ci/librqbit-vendor.mjs export
```

## The checks

`.github/workflows/librqbit-upstream.yml` runs `node scripts/ci/librqbit-vendor.mjs check` every
Monday. It changes nothing. It opens an issue labelled `librqbit-upstream`, or updates the open
one, when any of these is true:

- an upstream branch has commits after its pin. The issue says whether the patches still rebase,
  and which of them upstream now has;
- crates.io has a newer release of a vendored crate;
- this directory is not what `sync` builds from the pins and patches.

It closes the issue once none of them holds. The same job runs on a pull request that touches this
directory, `src-tauri/Cargo.toml` or `src-tauri/Cargo.lock`, and fails only on the last point, so a
hand edit to a vendored crate can't slip in. It uses the Cargo version `sync` recorded in
`upstream.json` (`"cargo"`), so the `Cargo.toml` files Cargo generates compare equal.

## When this goes away

`sync` stops copying a crate as soon as the crates.io release of the version upstream is at has the
same contents. So after upstream publishes a release, `update` moves the pins onto it, and every
crate that release matches comes from crates.io again. When no patches are left either, `sync`
copies nothing and removes the `Cargo.toml` block.

## Licence

All these crates are Apache-2.0. Each copy carries its repository's `LICENSE` notice, and
`THIRD-PARTY-NOTICES.md` has the notice too.
