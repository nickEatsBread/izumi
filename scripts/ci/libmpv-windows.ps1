# Windows libmpv setup for CI builds.
#
# libmpv2-sys links `-l mpv` (needs an MSVC import lib, mpv.lib) and the app needs libmpv-2.dll at
# runtime. Fetch a reviewed libmpv dev build from shinchiro, make mpv.lib from its exports, put the
# directory on LIB, and stage the DLL for Tauri's resource bundling.
#
# Shared by the release matrix and the PR preview build so the two cannot drift. Requires MSVC
# (lib.exe/dumpbin) already on PATH — the caller sets that up — and GH_TOKEN in the environment.

$ErrorActionPreference = 'Stop'
$dir = "$env:RUNNER_TEMP\libmpv"
New-Item -ItemType Directory -Force -Path $dir | Out-Null
$PinnedTag = '20260829'
$PinnedAsset = 'mpv-dev-x86_64-20260829-git-e8673660ab.7z'
$PinnedSha256 = 'e99b8c85e184463571088c79732f7e1e09ed4524c2945cdca177a4df70ba6f2e'
# Authenticate requests so shared runner IPs do not hit GitHub's small anonymous limit.
$hdr = @{
  'User-Agent' = 'izumi-ci'
  'Authorization' = "Bearer $env:GH_TOKEN"
  'Accept' = 'application/vnd.github+json'
}
$rel = Invoke-RestMethod "https://api.github.com/repos/shinchiro/mpv-winbuild-cmake/releases/tags/$PinnedTag" -Headers $hdr
$asset = $rel.assets | Where-Object { $_.name -eq $PinnedAsset } | Select-Object -First 1
if (-not $asset) { throw "pinned libmpv asset missing: $PinnedAsset" }
Write-Host "libmpv dev build: $($asset.name)"
Invoke-WebRequest $asset.browser_download_url -OutFile "$dir\libmpv.7z" -Headers $hdr
$actualSha256 = (Get-FileHash "$dir\libmpv.7z" -Algorithm SHA256).Hash.ToLowerInvariant()
if ($actualSha256 -ne $PinnedSha256) { throw "libmpv SHA-256 mismatch: $actualSha256" }
7z x "$dir\libmpv.7z" -o"$dir" -y
$dll = (Get-ChildItem -Path $dir -Recurse -Filter 'libmpv-2.dll' | Select-Object -First 1).FullName
if (-not $dll) { throw 'libmpv-2.dll not found in archive' }
$libdir = Split-Path $dll
# Newer shinchiro dev archives no longer ship mpv.def (only libmpv.dll.a, a GNU import lib MSVC's
# link can't consume). Use it if present; otherwise synthesize a .def from the DLL's exports (via
# dumpbin) so lib.exe can produce the MSVC import lib mpv.lib.
$def = (Get-ChildItem -Path $dir -Recurse -Filter 'mpv.def' | Select-Object -First 1).FullName
if (-not $def) {
  $def = "$libdir\mpv.def"
  'EXPORTS' | Set-Content $def
  & dumpbin /nologo /exports "$dll" |
    Select-String '^\s+\d+\s+[0-9A-Fa-f]+\s+[0-9A-Fa-f]+\s+(\w+)\s*$' |
    ForEach-Object { $_.Matches[0].Groups[1].Value } |
    Add-Content $def
  $count = ((Get-Content $def).Count - 1)
  if ($count -lt 1) { throw "synthesized mpv.def has no exports" }
  Write-Host "synthesized mpv.def with $count exports"
}
lib /def:"$def" /name:libmpv-2.dll /out:"$libdir\mpv.lib" /machine:x64
echo "LIB=$libdir;$env:LIB" >> $env:GITHUB_ENV
Copy-Item "$dll" "$env:GITHUB_WORKSPACE\src-tauri\libmpv-2.dll" -Force
