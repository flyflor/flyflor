param(
    [string]$Target = "$HOME\src\flyflor",
    [string]$Repo = "https://github.com/flyflor/flyflor.git",
    [string]$Branch = "master"
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Write-Info([string]$Message) {
    Write-Host "flyflor-windows-install: $Message"
}

# Windows bootstrap is source-first: keeping the checkout on disk is required
# for Flyflor's self-iteration workflow after installation.
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw "git is required"
}
if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
    throw "bun is required"
}

if (-not (Test-Path (Join-Path $Target ".git"))) {
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $Target) | Out-Null
    Write-Info "cloning $Repo -> $Target"
    git clone --branch $Branch $Repo $Target
} else {
    Write-Info "updating existing checkout at $Target"
    git -C $Target pull --ff-only
}

Push-Location $Target
try {
    Write-Info "installing Bun dependencies"
    bun install
    Write-Info "installing templates into the checkout config tree"
    bun run install:templates
    Write-Info "source checkout ready. Run 'bun run chat' inside $Target."
} finally {
    Pop-Location
}
