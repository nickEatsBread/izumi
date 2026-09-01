<#
.SYNOPSIS
Build, sign, install, and launch Izumi on one connected arm64 Android device.

.EXAMPLE
.\scripts\build-android-and-install.ps1

.EXAMPLE
.\scripts\build-android-and-install.ps1 -SkipBuild -NoLaunch
#>
[CmdletBinding()]
param(
    [string]$DeviceSerial = "",
    [switch]$SkipBuild,
    [switch]$NoLaunch
)

$ErrorActionPreference = "Stop"

# Fixed Izumi Android build/install configuration.
$Target = "aarch64"
$RequiredAbi = "arm64-v8a"
$CargoFeature = "android-mpv"
$TauriConfig = "src-tauri/tauri.android-mpv.conf.json"
# The generated local Android project intentionally uses the debug application id so installs
# preserve the developer build's existing pairing, settings, and playback data.
$PackageId = "com.nicho.izumi.debug"
$KeyAlias = "androiddebugkey"
$KeyPassword = "android"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$AndroidProject = Join-Path $ProjectRoot "src-tauri\gen\android"
$LocalProperties = Join-Path $AndroidProject "local.properties"
$UnsignedApk = Join-Path $AndroidProject "app\build\outputs\apk\universal\release\app-universal-release-unsigned.apk"
$SignedApk = Join-Path $AndroidProject "app\build\outputs\apk\universal\release\app-universal-release-debug-signed.apk"
$AlignedApk = Join-Path $AndroidProject "app\build\outputs\apk\universal\release\app-universal-release-16k-aligned.apk"
$SecureLibmpv = Join-Path $ProjectRoot "src-tauri\tauri-plugin-mpv\android\libs\libmpv.aar"
$DebugKeystore = Join-Path $env:USERPROFILE ".android\debug.keystore"

function Write-Step([string]$Message) {
    Write-Host ""
    Write-Host "==> $Message" -ForegroundColor Cyan
}

function Invoke-Checked([string]$FilePath, [string[]]$Arguments) {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code ${LASTEXITCODE}: $FilePath $($Arguments -join ' ')"
    }
}

function Find-AndroidSdk {
    if (Test-Path -LiteralPath $LocalProperties) {
        $line = Get-Content -LiteralPath $LocalProperties |
            Where-Object { $_ -match '^sdk\.dir=' } |
            Select-Object -First 1
        if ($line) {
            $value = ($line -replace '^sdk\.dir=', '')
            $value = $value.Replace('\:', ':').Replace('\\', '\')
            if (Test-Path -LiteralPath $value) { return $value }
        }
    }

    if ($env:ANDROID_SDK_ROOT -and (Test-Path -LiteralPath $env:ANDROID_SDK_ROOT)) {
        return $env:ANDROID_SDK_ROOT
    }
    if ($env:ANDROID_HOME -and (Test-Path -LiteralPath $env:ANDROID_HOME)) {
        return $env:ANDROID_HOME
    }

    $defaultSdk = Join-Path $env:LOCALAPPDATA "Android\Sdk"
    if (Test-Path -LiteralPath $defaultSdk) { return $defaultSdk }
    throw "Android SDK not found. Open Android Studio once or update src-tauri\gen\android\local.properties."
}

function Find-LatestBuildTool([string]$Sdk, [string]$ToolName) {
    $tools = Get-ChildItem -Path (Join-Path $Sdk "build-tools") -Filter $ToolName -Recurse -File -ErrorAction SilentlyContinue
    if (-not $tools) { throw "$ToolName was not found under $Sdk\build-tools." }
    return ($tools | Sort-Object {
        try { [version]$_.Directory.Name } catch { [version]"0.0" }
    } -Descending | Select-Object -First 1).FullName
}

function Ensure-DebugKeystore {
    if (Test-Path -LiteralPath $DebugKeystore) { return }

    Write-Step "Creating the standard local Android debug keystore"
    $keytool = Get-Command keytool.exe -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
    if (-not $keytool) {
        $studioKeytool = Join-Path $env:ProgramFiles "Android\Android Studio\jbr\bin\keytool.exe"
        if (Test-Path -LiteralPath $studioKeytool) { $keytool = $studioKeytool }
    }
    if (-not $keytool) { throw "keytool.exe was not found in PATH or Android Studio's bundled JBR." }

    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $DebugKeystore) | Out-Null
    Invoke-Checked $keytool @(
        "-genkeypair", "-v", "-keystore", $DebugKeystore,
        "-storepass", $KeyPassword, "-alias", $KeyAlias, "-keypass", $KeyPassword,
        "-dname", "CN=Android Debug,O=Android,C=US", "-keyalg", "RSA",
        "-keysize", "2048", "-validity", "10000"
    )
}

function Select-AdbDevice([string]$Adb) {
    Invoke-Checked $Adb @("start-server")
    $lines = & $Adb devices -l
    if ($LASTEXITCODE -ne 0) { throw "Could not query ADB devices." }
    $devices = @($lines | ForEach-Object {
        if ($_ -match '^(\S+)\s+device(?:\s|$)') { $Matches[1] }
    })

    if ($DeviceSerial) {
        if ($devices -notcontains $DeviceSerial) {
            throw "ADB device '$DeviceSerial' is not connected and authorized."
        }
        return $DeviceSerial
    }
    if ($devices.Count -eq 0) {
        throw "No authorized ADB device found. Connect and unlock the phone, then accept the USB debugging prompt."
    }
    if ($devices.Count -gt 1) {
        throw "More than one ADB device is connected. Re-run with -DeviceSerial <serial>. Connected: $($devices -join ', ')"
    }
    return $devices[0]
}

try {
    $sdk = Find-AndroidSdk
    $env:ANDROID_HOME = $sdk
    $env:ANDROID_SDK_ROOT = $sdk
    $adb = Join-Path $sdk "platform-tools\adb.exe"
    if (-not (Test-Path -LiteralPath $adb)) { throw "adb.exe was not found at $adb." }

    $androidStudioJava = Join-Path $env:ProgramFiles "Android\Android Studio\jbr"
    if (-not $env:JAVA_HOME -and (Test-Path -LiteralPath $androidStudioJava)) {
        $env:JAVA_HOME = $androidStudioJava
    }

    Write-Step "Finding the connected Android phone"
    $serial = Select-AdbDevice $adb
    Invoke-Checked $adb @("-s", $serial, "wait-for-device")
    $abis = (& $adb -s $serial shell getprop ro.product.cpu.abilist).Trim()
    if ($LASTEXITCODE -ne 0) { throw "Could not read the phone ABI." }
    $abiPattern = '(^|,)' + [regex]::Escape($RequiredAbi) + '(,|$)'
    if ($abis -notmatch $abiPattern) {
        throw "Device '$serial' does not support $RequiredAbi. Reported ABIs: $abis"
    }
    $model = (& $adb -s $serial shell getprop ro.product.model).Trim()

    Push-Location $ProjectRoot
    try {
        if (-not $SkipBuild) {
            if (-not (Test-Path -LiteralPath $SecureLibmpv)) {
                throw "Secure libmpv AAR is missing. From WSL in this repository, run: bash scripts/ci/libmpv-android.sh"
            }
            Write-Step "Building the arm64 release APK with embedded mpv"
            $npx = Get-Command npx.cmd -ErrorAction SilentlyContinue | Select-Object -ExpandProperty Source -First 1
            if (-not $npx) { throw "npx.cmd was not found. Install Node.js and run npm install first." }
            Invoke-Checked $npx @(
                "tauri", "android", "build", "--apk", "--target", $Target,
                "--features", $CargoFeature, "--config", $TauriConfig
            )
        } else {
            Write-Step "Skipping compilation and using the existing release APK"
        }

        if (-not (Test-Path -LiteralPath $UnsignedApk)) {
            throw "Unsigned release APK was not produced at $UnsignedApk."
        }

        Ensure-DebugKeystore
        $apksigner = Find-LatestBuildTool $sdk "apksigner.bat"
        $zipalign = Find-LatestBuildTool $sdk "zipalign.exe"
        Write-Step "Aligning native libraries for 16 KiB Android kernels"
        if (Test-Path -LiteralPath $AlignedApk) { Remove-Item -LiteralPath $AlignedApk -Force }
        Invoke-Checked $zipalign @("-f", "-P", "16", "4", $UnsignedApk, $AlignedApk)
        Write-Step "Signing the release APK with the local Android debug key"
        if (Test-Path -LiteralPath $SignedApk) { Remove-Item -LiteralPath $SignedApk -Force }
        Invoke-Checked $apksigner @(
            "sign", "--ks", $DebugKeystore, "--ks-key-alias", $KeyAlias,
            "--ks-pass", "pass:$KeyPassword", "--key-pass", "pass:$KeyPassword",
            "--out", $SignedApk, $AlignedApk
        )
        Invoke-Checked $apksigner @("verify", "--verbose", $SignedApk)
        Invoke-Checked $zipalign @("-c", "-P", "16", "-v", "4", $SignedApk)
        Remove-Item -LiteralPath $AlignedApk -Force

        Write-Step "Installing on $model ($serial) without clearing app data"
        Invoke-Checked $adb @("-s", $serial, "install", "-r", "-d", $SignedApk)

        if (-not $NoLaunch) {
            Write-Step "Launching Izumi"
            Invoke-Checked $adb @("-s", $serial, "shell", "am", "force-stop", $PackageId)
            Invoke-Checked $adb @(
                "-s", $serial, "shell", "monkey", "-p", $PackageId,
                "-c", "android.intent.category.LAUNCHER", "1"
            )
        }

        $sizeMb = [math]::Round((Get-Item -LiteralPath $SignedApk).Length / 1MB, 1)
        Write-Host ""
        Write-Host "Done: Izumi was built, signed, and installed successfully." -ForegroundColor Green
        Write-Host "APK: $SignedApk"
        Write-Host "Size: $sizeMb MB"
        Write-Host "Device: $model ($serial)"
    } finally {
        Pop-Location
    }
} catch {
    Write-Host ""
    Write-Host "Android build/install failed:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    exit 1
}
