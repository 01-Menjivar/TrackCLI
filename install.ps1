$ErrorActionPreference = 'Stop'
Write-Host "✦ Preparando TrackCLI para Windows..." -ForegroundColor Cyan

if (-not (Get-Command winget -ErrorAction SilentlyContinue)) {
    throw "Necesitas winget para este instalador. Instala Node.js 20+, yt-dlp y FFmpeg manualmente y después ejecuta: npm install -g trackcli@latest"
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Host "› Instalando Node.js LTS..." -ForegroundColor Gray
    winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    $nodeDirectory = Join-Path $env:ProgramFiles 'nodejs'
    if (Test-Path $nodeDirectory) { $env:Path = "$nodeDirectory;$env:Path" }
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    throw "Node.js se instaló pero esta sesión no lo detecta. Abre una nueva terminal y ejecuta este script de nuevo."
}

if ([int](node -p "process.versions.node.split('.')[0]") -lt 20) {
    throw "Se necesita Node.js 20 o superior. Actualízalo y vuelve a ejecutar este script."
}

if (-not (Get-Command yt-dlp.exe -ErrorAction SilentlyContinue)) {
    Write-Host "› Instalando yt-dlp..." -ForegroundColor Gray
    winget install --id yt-dlp.yt-dlp --silent --accept-source-agreements --accept-package-agreements
}
if (-not (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue)) {
    Write-Host "› Instalando FFmpeg..." -ForegroundColor Gray
    winget install --id Gyan.FFmpeg --silent --accept-source-agreements --accept-package-agreements
}

if (Test-Path ".\package.json") {
    Write-Host "› Enlazando TrackCLI localmente..." -ForegroundColor Gray
    npm link
} else {
    Write-Host "› Descargando e instalando TrackCLI directamente desde GitHub..." -ForegroundColor Gray
    npm install --global https://github.com/01-Menjivar/TrackCLI/archive/refs/heads/main.tar.gz
}

Write-Host ""
Write-Host "✔ ¡Instalación completa!" -ForegroundColor Green
Write-Host "› Abre una nueva terminal y ejecuta: trackcli doctor" -ForegroundColor Cyan
