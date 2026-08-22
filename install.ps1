$ErrorActionPreference = 'Stop'

Write-Host ""
Write-Host "  TrackCLI - Instalador Automático para Windows" -ForegroundColor Cyan
Write-Host "  =============================================" -ForegroundColor Cyan
Write-Host ""

function Refresh-EnvironmentPath {
    $machinePath = [System.Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [System.Environment]::GetEnvironmentVariable("Path", "User")
    $env:Path = "$machinePath;$userPath"
}

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    Write-Host "✖ No se encontró 'winget' en este sistema." -ForegroundColor Red
    Write-Host "Por favor instala Node.js 20+, yt-dlp y FFmpeg manualmente o activa 'App Installer' desde la Microsoft Store." -ForegroundColor Yellow
    exit 1
}

# 1. Comprobar / Instalar Node.js
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "› Instalando Node.js LTS..." -ForegroundColor Gray
    winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    Refresh-EnvironmentPath
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    $nodeDir = Join-Path $env:ProgramFiles 'nodejs'
    if (Test-Path $nodeDir) { $env:Path = "$nodeDir;$env:Path" }
}

# 2. Comprobar / Instalar yt-dlp
if (-not (Get-Command yt-dlp.exe -ErrorAction SilentlyContinue)) {
    Write-Host "› Instalando yt-dlp..." -ForegroundColor Gray
    winget install --id yt-dlp.yt-dlp --silent --accept-source-agreements --accept-package-agreements
    Refresh-EnvironmentPath
}

# 3. Comprobar / Instalar FFmpeg
if (-not (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue)) {
    Write-Host "› Instalando FFmpeg..." -ForegroundColor Gray
    winget install --id Gyan.FFmpeg --silent --accept-source-agreements --accept-package-agreements
    Refresh-EnvironmentPath
}

# 4. Instalar TrackCLI
Write-Host "› Instalando TrackCLI..." -ForegroundColor Gray
if (Test-Path ".\package.json") {
    npm link
} else {
    npm install --global https://github.com/01-Menjivar/TrackCLI/archive/refs/heads/main.tar.gz
}

Write-Host ""
Write-Host "  ¡Instalación completada con éxito!" -ForegroundColor Green
Write-Host "  ----------------------------------" -ForegroundColor Green
Write-Host "  Para comenzar, escribe en tu terminal:" -ForegroundColor White
Write-Host "    trackcli" -ForegroundColor Yellow
Write-Host ""
Write-Host "  O busca una canción directamente:" -ForegroundColor White
Write-Host "    trackcli search `"Artista - Cancion`"" -ForegroundColor Yellow
Write-Host ""
