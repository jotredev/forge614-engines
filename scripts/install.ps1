#Requires -Version 5.1
[CmdletBinding(DefaultParameterSetName = "Latest")]
param(
    [Parameter(ParameterSetName = "Latest")]
    [switch]$Latest,

    [Parameter(ParameterSetName = "Uninstall")]
    [switch]$Uninstall,

    [Parameter(ParameterSetName = "Uninstall")]
    [switch]$Yes,

    [Parameter(ParameterSetName = "Archive", Mandatory = $true)]
    [string]$Archive
)

$ErrorActionPreference = "Stop"

function Get-Architecture {
    $arch = $env:PROCESSOR_ARCHITECTURE
    if ($arch -eq "AMD64") { return "x64" }
    if ($arch -eq "ARM64") {
        throw "Forge614 Engines does not have a Windows arm64 build yet (only x64). See scripts/release-bundle.mjs."
    }
    throw "Forge614 Engines does not support this CPU architecture ($arch)."
}

$forgeHome = if ($env:FORGE614_HOME) { $env:FORGE614_HOME } else { Join-Path $env:USERPROFILE ".forge614" }
$enginesRoot = Join-Path $forgeHome "engines"

if ($PSCmdlet.ParameterSetName -eq "Uninstall") {
    Write-Host "This removes Forge614 Engines from $enginesRoot."
    Write-Host "Shell, Engram, Atlas, and other Forge614 tools are unchanged."
    if (-not $Yes) {
        $answer = Read-Host "Continue? [y/N]"
        if ($answer -notin @("y", "Y")) {
            Write-Host "Uninstall cancelled."
            exit 0
        }
    }
    if (Test-Path $enginesRoot) { Remove-Item -Recurse -Force $enginesRoot }
    Write-Host "Forge614 Engines was uninstalled. Other Forge614 tools are unchanged."
    exit 0
}

if (-not (Get-Command tar -ErrorAction SilentlyContinue)) {
    throw "Forge614 Engines requires tar.exe (built into Windows 10 1803+ and Windows 11)."
}

$arch = Get-Architecture
$platform = "windows"
$temporary = Join-Path ([System.IO.Path]::GetTempPath()) ([System.IO.Path]::GetRandomFileName())
New-Item -ItemType Directory -Path $temporary | Out-Null

try {
    if ($PSCmdlet.ParameterSetName -eq "Latest") {
        $apiUrl = if ($env:FORGE614_RELEASE_API_URL) { $env:FORGE614_RELEASE_API_URL } else { "https://api.github.com/repos/jotredev/forge614-engines/releases/latest" }
        try {
            $release = Invoke-RestMethod -Uri $apiUrl -Headers @{ "User-Agent" = "forge614-engines-installer" }
        } catch {
            throw "Could not download Forge614 Engines release metadata: $_"
        }

        $version = $release.tag_name -replace "^v", ""
        if ($version -notmatch "^\d+\.\d+\.\d+$") { throw "Latest release has an invalid version tag." }

        $assetName = "forge614-engines-$version-$platform-$arch.tar.gz"
        $asset = $release.assets | Where-Object { $_.name -eq $assetName }
        $checksumAsset = $release.assets | Where-Object { $_.name -eq "$assetName.sha256" }
        if (-not $asset -or -not $checksumAsset) { throw "Latest release is missing a Forge614 Engines asset for $platform-$arch." }

        $archivePath = Join-Path $temporary $assetName
        $checksumPath = "$archivePath.sha256"
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archivePath -UseBasicParsing
        Invoke-WebRequest -Uri $checksumAsset.browser_download_url -OutFile $checksumPath -UseBasicParsing

        $expected = (Get-Content $checksumPath -Raw).Split(" ")[0].Trim()
        $actual = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLower()
        if ($expected.ToLower() -ne $actual) { throw "Forge614 Engines download checksum failed." }
    } else {
        if (-not (Test-Path $Archive)) { throw "Release archive not found: $Archive" }
        $archivePath = $Archive
    }

    $extracted = Join-Path $temporary "extracted"
    New-Item -ItemType Directory -Path $extracted | Out-Null
    tar -xzf $archivePath -C $extracted
    if ($LASTEXITCODE -ne 0) { throw "Invalid Forge614 Engines release archive." }

    $releaseRoot = Get-ChildItem -Path $extracted -Directory | Where-Object { $_.Name -like "forge614-engines-*" } | Select-Object -First 1
    if (-not $releaseRoot -or -not (Test-Path (Join-Path $releaseRoot.FullName "package.json")) -or -not (Test-Path (Join-Path $releaseRoot.FullName "forge614-engines.exe"))) {
        throw "Invalid Forge614 Engines release archive."
    }

    $packageJson = Get-Content (Join-Path $releaseRoot.FullName "package.json") -Raw | ConvertFrom-Json
    $version = $packageJson.version
    if ($version -notmatch "^\d+\.\d+\.\d+$") { throw "Invalid Forge614 Engines release version." }

    $target = Join-Path $enginesRoot $version
    $binDir = Join-Path $enginesRoot "bin"
    $activeLauncher = Join-Path $binDir "forge614-engines.exe"

    if ((Test-Path $activeLauncher) -and (Test-Path (Join-Path $enginesRoot ".active-version")) -and ((Get-Content (Join-Path $enginesRoot ".active-version") -Raw).Trim() -eq $version)) {
        Write-Host "Forge614 Engines v$version is already active."
        exit 0
    }

    New-Item -ItemType Directory -Force -Path $binDir | Out-Null
    if (Test-Path $target) { Remove-Item -Recurse -Force $target }
    Move-Item -Path $releaseRoot.FullName -Destination $target

    # Windows file symlinks need elevated privileges or Developer Mode in many
    # configurations, so the stable launcher is a plain copy of the versioned
    # binary rather than a symlink (unlike the macOS/Linux install.sh).
    Copy-Item -Path (Join-Path $target "forge614-engines.exe") -Destination $activeLauncher -Force
    Set-Content -Path (Join-Path $enginesRoot ".active-version") -Value $version -NoNewline

    Write-Host "Installed Forge614 Engines v$version at $activeLauncher"
    Write-Host "Forge614 Engines is an internal dependency — it is not added to PATH."
    Write-Host "Other Forge614 products call it directly by this path."
} finally {
    Remove-Item -Recurse -Force $temporary -ErrorAction SilentlyContinue
}
