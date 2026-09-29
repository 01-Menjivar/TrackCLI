$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "  TrackCLI - Automatic Installer for Windows" -ForegroundColor Cyan
Write-Host "  =========================================" -ForegroundColor Cyan
Write-Host ""

function Refresh-EnvironmentPath {
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "✖ 'winget' was not found on this system." -ForegroundColor Red
    Write-Host "Please install Node.js 20+, yt-dlp, and FFmpeg manually or enable 'App Installer' from the Microsoft Store." -ForegroundColor Yellow
    exit 1
}

# 1. Check / Install Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "› Installing Node.js LTS..." -ForegroundColor Gray
    winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    Refresh-EnvironmentPath
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $nodeDir = Join-Path $env:ProgramFiles 'nodejs'
    if (Test-Path $nodeDir) { $env:Path = "$nodeDir;$env:Path" }
}

# 2. Check / Install yt-dlp
if (-not (Get-Command yt-dlp.exe -ErrorAction SilentlyContinue)) {
    Write-Host "› Installing yt-dlp..." -ForegroundColor Gray
    winget install --id yt-dlp.yt-dlp --silent --accept-source-agreements --accept-package-agreements
    Refresh-EnvironmentPath
}

# 3. Check / Install FFmpeg
if (-not (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue)) {
    Write-Host "› Installing FFmpeg..." -ForegroundColor Gray
    winget install --id Gyan.FFmpeg --silent --accept-source-agreements --accept-package-agreements
    Refresh-EnvironmentPath
}

# 4. Install TrackCLI
Write-Host "› Installing TrackCLI..." -ForegroundColor Gray
if (Test-Path ".\package.json") {
    npm link
} else {
    npm install --global https://github.com/01-Menjivar/TrackCLI/archive/refs/tags/v0.2.2.tar.gz
}

Write-Host ""
Write-Host "  Installation completed successfully!" -ForegroundColor Green
Write-Host "  ------------------------------------" -ForegroundColor Green
Write-Host "  To get started, run in your terminal:" -ForegroundColor White
Write-Host "    trackcli" -ForegroundColor Yellow
Write-Host ""
Write-Host "  Or search for a track directly:" -ForegroundColor White
Write-Host "    trackcli search `"Artist - Song`"" -ForegroundColor Yellow
Write-Host ""
