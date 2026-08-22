#!/usr/bin/env bash
set -Eeuo pipefail

echo "✦ Preparando TrackCLI..."

if ! command -v node >/dev/null 2>&1 || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)'; then
  echo "✖ Se necesita Node.js 20 o superior. Instálalo desde https://nodejs.org/ y vuelve a ejecutar este script."
  exit 1
fi

install_system_packages() {
  local elevate=()
  if [[ "$(id -u)" -ne 0 ]]; then
    if ! command -v sudo >/dev/null 2>&1; then
      echo "✖ Se requieren permisos de administrador para instalar yt-dlp y ffmpeg."
      exit 1
    fi
    elevate=(sudo)
  fi
  if command -v brew >/dev/null 2>&1; then
    brew install yt-dlp ffmpeg
  elif command -v apt-get >/dev/null 2>&1; then
    "${elevate[@]}" apt-get update
    "${elevate[@]}" apt-get install -y yt-dlp ffmpeg
  elif command -v dnf >/dev/null 2>&1; then
    "${elevate[@]}" dnf install -y yt-dlp ffmpeg
  elif command -v pacman >/dev/null 2>&1; then
    "${elevate[@]}" pacman -Sy --needed yt-dlp ffmpeg
  else
    echo "✖ No encontré un gestor compatible. Instala yt-dlp y ffmpeg y vuelve a ejecutar el script."
    exit 1
  fi
}

if ! command -v yt-dlp >/dev/null 2>&1 || ! command -v ffmpeg >/dev/null 2>&1; then
  echo "› Instalando dependencias del sistema (yt-dlp y ffmpeg)..."
  install_system_packages
fi

if [[ -f "./package.json" ]] && grep -q '"name": "trackcli"' "./package.json" 2>/dev/null; then
  echo "› Enlazando TrackCLI localmente..."
  npm link
else
  echo "› Descargando e instalando TrackCLI directamente desde GitHub..."
  npm install --global https://github.com/01-Menjivar/TrackCLI/archive/refs/heads/main.tar.gz
fi

echo ""
echo "✔ ¡Instalación completa!"
echo "› Ejecuta: trackcli doctor"
