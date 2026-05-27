param(
    [switch]$Mock,
    [switch]$Real,
    [string]$Home,
    [string]$Target,
    [string]$Runner,
    [string]$CdpUrl = "http://127.0.0.1:9222"
)

$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($Target)) {
    if ([string]::IsNullOrWhiteSpace($Home)) {
        $Target = Join-Path (Get-Location) "tools"
    } else {
        $Target = Join-Path $Home "tools"
    }
}

if ([string]::IsNullOrWhiteSpace($Runner)) {
    $LocalRunner = ".\dist\flyflor.exe"
    if (Test-Path (Join-Path (Get-Location) "dist/flyflor.exe")) {
        $Runner = $LocalRunner
    } elseif (Get-Command "flyflor.exe" -ErrorAction SilentlyContinue) {
        $Runner = "flyflor.exe"
    } elseif (Get-Command "flyflor" -ErrorAction SilentlyContinue) {
        $Runner = "flyflor"
    } else {
        throw "Flyflor binary was not found. Pass -Runner PATH."
    }
}

$PackageBinaryName = "flyflor"
if ($Runner -like "*.exe" -or $IsWindows) {
    $PackageBinaryName = "flyflor.exe"
}

$Mode = "real"
if ($Mock) {
    $Mode = "mock"
}
if ($Real) {
    $Mode = "real"
}

$PackageRoot = Join-Path $Target "packages"
New-Item -ItemType Directory -Force -Path $PackageRoot | Out-Null
foreach ($Package in @("browser-cdp", "browser-use", "search-web", "media", "computer-native", "computer-use", "utility", "mock")) {
    $PackageDir = Join-Path $PackageRoot $Package
    $PackageBin = Join-Path $PackageDir "bin"
    New-Item -ItemType Directory -Force -Path $PackageBin | Out-Null
    Copy-Item -Force -Path $Runner -Destination (Join-Path $PackageBin $PackageBinaryName)
    $PackageCommand = "./$($Target.TrimStart('.', '/', '\').Replace('\', '/'))/packages/$Package/bin/$PackageBinaryName"
    @"
# $Package

This directory is the project-local payload for the external tool package.

Runtime discovery stays in ../../external.tools.jsonc. The command registered there points to $PackageCommand.
"@ | Set-Content -Encoding UTF8 -Path (Join-Path $PackageDir "README.md")
    @{
        schemaVersion = 1
        id = $Package
        kind = "external-tool-package"
        registry = "../../external.tools.jsonc"
        runtime = "process-json"
        command = $PackageCommand
    } | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 -Path (Join-Path $PackageDir "package.jsonc")
}

$BrowserCdpRunner = "./$($Target.TrimStart('.', '/', '\').Replace('\', '/'))/packages/browser-cdp/bin/$PackageBinaryName"
$BrowserUseRunner = "./$($Target.TrimStart('.', '/', '\').Replace('\', '/'))/packages/browser-use/bin/$PackageBinaryName"
$SearchWebRunner = "./$($Target.TrimStart('.', '/', '\').Replace('\', '/'))/packages/search-web/bin/$PackageBinaryName"
$MediaRunner = "./$($Target.TrimStart('.', '/', '\').Replace('\', '/'))/packages/media/bin/$PackageBinaryName"
$ComputerNativeRunner = "./$($Target.TrimStart('.', '/', '\').Replace('\', '/'))/packages/computer-native/bin/$PackageBinaryName"
$ComputerUseRunner = "./$($Target.TrimStart('.', '/', '\').Replace('\', '/'))/packages/computer-use/bin/$PackageBinaryName"
$UtilityRunner = "./$($Target.TrimStart('.', '/', '\').Replace('\', '/'))/packages/utility/bin/$PackageBinaryName"
$MockRunner = "./$($Target.TrimStart('.', '/', '\').Replace('\', '/'))/packages/mock/bin/$PackageBinaryName"

if ($Mode -eq "mock") {
    $Manifest = @{
        schemaVersion = 1
        sidecars = @{
            "mock.xtools" = @{
                mock = $true
                command = $MockRunner
                args = @("xtool-sidecar", "mock.xtools")
                cwd = "app"
                timeoutMs = 2000
                maxOutputBytes = 65536
                tools = @(
                    "browser.open", "browser.snapshot", "browser.screenshot", "browser.use", "browser.click", "browser.type", "browser.navigate", "browser.evaluate",
                    "screen.screenshot", "computer.use", "computer.mouse", "computer.keyboard", "computer.window",
                    "vision.analyze", "vision.ocr", "audio.transcribe", "audio.speak",
                    "web.search", "web.fetch", "web.extract", "web.download",
                    "lsp.symbols", "lsp.diagnostics", "file.hash", "archive.create", "archive.extract", "data.convert", "task.background"
                )
            }
        }
    }
} else {
    $Manifest = @{
        schemaVersion = 1
        sidecars = @{
            "browser.cdp" = @{
                command = $BrowserCdpRunner
                args = @("xtool-sidecar", "browser.cdp")
                cwd = "app"
                env = @{ FLYFLOR_BROWSER_CDP_URL = $CdpUrl }
                timeoutMs = 8000
                maxOutputBytes = 65536
                tools = @("browser.open", "browser.snapshot", "browser.screenshot")
            }
            "browser.use" = @{
                command = $BrowserUseRunner
                args = @("xtool-sidecar", "browser.use")
                cwd = "app"
                config = @{ backend = "delegate"; delegateCommand = ""; delegateArgs = @(); cdpUrl = $CdpUrl }
                timeoutMs = 30000
                maxOutputBytes = 262144
                tools = @()
            }
            "computer.native" = @{
                command = $ComputerNativeRunner
                args = @("xtool-sidecar", "computer.native")
                cwd = "app"
                config = @{ mouseCommand = ""; mouseArgs = @(); keyboardCommand = ""; keyboardArgs = @() }
                timeoutMs = 10000
                maxOutputBytes = 65536
                tools = @("screen.screenshot", "computer.window")
            }
            "media.local" = @{
                command = $MediaRunner
                args = @("xtool-sidecar", "media.local")
                cwd = "app"
                config = @{ providerUrl = ""; providerHeaders = @{}; localCommands = @{} }
                timeoutMs = 30000
                maxOutputBytes = 262144
                tools = @()
            }
            "web.search" = @{
                command = $SearchWebRunner
                args = @("xtool-sidecar", "web.search")
                cwd = "app"
                config = @{ cacheTtlMs = 600000; providers = @() }
                timeoutMs = 10000
                maxOutputBytes = 65536
                tools = @("web.fetch", "web.extract", "web.download")
            }
            "utility.local" = @{
                command = $UtilityRunner
                args = @("xtool-sidecar", "utility.local")
                cwd = "app"
                config = @{ lspCommand = ""; lspArgs = @(); taskCommand = ""; taskArgs = @() }
                timeoutMs = 30000
                maxOutputBytes = 262144
                tools = @("file.hash", "archive.create", "archive.extract", "data.convert")
            }
        }
    }
}

$ManifestPath = Join-Path $Target "external.tools.jsonc"
$Manifest | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 -Path $ManifestPath

Write-Host "flyflor xtools initialized"
Write-Host "mode: $Mode"
Write-Host "runner: $Runner"
Write-Host "config: $ManifestPath"
