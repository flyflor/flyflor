param(
    [string]$Target = "$HOME\.flyflor",
    [string]$Repo = "https://github.com/flyflor/flyflor.git",
    [string]$Branch = "master",
    [string]$GlobalBin = "$HOME\.local\bin",
    [string]$ConfigDir = ""
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Info([string]$Message) {
    Write-Host "flyflor-windows-install: $Message"
}

# Windows bootstrap is source-first: ~/.flyflor is the editable checkout and
# ~/.flyflor/.config is the config/data home. The global command always points
# at the compiled Bun binary under dist/, never at a source runner.
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git is required"
}
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    throw "bun is required"
}

if (-not (Test-Path (Join-Path $Target ".git"))) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null
    if ((Test-Path $Target) -and ((Get-ChildItem -Force $Target | Select-Object -First 1) -ne $null)) {
        $tempSource = Join-Path ([System.IO.Path]::GetTempPath()) ("flyflor-source-" + [System.Guid]::NewGuid().ToString("N"))
        Write-Info "cloning $Repo -> $tempSource"
        git clone --branch $Branch $Repo $tempSource
        Write-Info "merging source checkout into existing $Target without deleting config"
        Copy-Item -Path (Join-Path $tempSource "*") -Destination $Target -Recurse -Force
        Copy-Item -Path (Join-Path $tempSource ".git") -Destination $Target -Recurse -Force
        Remove-Item -Recurse -Force $tempSource
    } else {
        Write-Info "cloning $Repo -> $Target"
        git clone --branch $Branch $Repo $Target
    }
} else {
    Write-Info "updating existing checkout at $Target"
    git -C $Target pull --ff-only
}

Push-Location $Target
try {
    Write-Info "installing Bun dependencies"
    bun install
    if ([string]::IsNullOrWhiteSpace($ConfigDir)) {
        $ConfigDir = Join-Path $Target ".config"
    }
    Write-Info "installing templates into $ConfigDir"
    bun run install:templates -- --target $ConfigDir
    Write-Info "building Bun-compiled binary"
    bun run build:binary
    New-Item -ItemType Directory -Force -Path $GlobalBin | Out-Null
    $binary = Join-Path $Target "dist\flyflor.exe"
    if (-not (Test-Path $binary)) {
        $binary = Join-Path $Target "dist\flyflor"
    }
    $cmdPath = Join-Path $GlobalBin "flyflor.cmd"
    Set-Content -Path $cmdPath -Encoding ASCII -Value "@echo off`r`n""$binary"" %*`r`n"
    Write-Info "installed flyflor command -> $cmdPath"
    Write-Info "source checkout ready. Run 'flyflor -h' globally or 'bun run chat' inside $Target."
} finally {
    Pop-Location
}
