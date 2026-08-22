#!/usr/bin/env bash
set -Eeuo pipefail

echo ""
echo "  TrackCLI - Instalador Automático"
echo "  ================================"
echo ""

elevate=()
if [[ "$(id -u)" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    elevate=(sudo)
  fi
fi

install_package() {
  local pkg_brew="$1"
  local pkg_apt="$2"
  local pkg_dnf="$3"
  local pkg_pacman="$4"

  if command -v brew >/dev/null 2>&1; then
    brew install "$pkg_brew"
  elif command -v apt-get >/dev/null 2>&1; then
    "${elevate[@]}" apt-get update -qq
    "${elevate[@]}" apt-get install -y -qq "$pkg_apt"
  elif command -v dnf >/dev/null 2>&1; then
    "${elevate[@]}" dnf install -y -q "$pkg_dnf"
  elif command -v pacman >/dev/null 2>&1; then
    "${elevate[@]}" pacman -Sy --needed --noconfirm "$pkg_pacman"
  else
    return 1
  fi
}

# 1. Comprobar / Instalar Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "› Instalando Node.js..."
  if ! install_package "node" "nodejs npm" "nodejs npm" "nodejs npm"; then
    echo "✖ No se pudo instalar Node.js automáticamente. Instálalo desde https://nodejs.org/"
    exit 1
  fi
fi

# Verificar versión de Node.js
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' 2>/dev/null; then
  echo "› Actualizando Node.js a versión 20 o superior..."
  if command -v brew >/dev/null 2>&1; then
    brew upgrade node || brew install node
  elif command -v apt-get >/dev/null 2>&1; then
    echo "› Configurando repositorio oficial de Node.js LTS..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | "${elevate[@]}" bash -
    "${elevate[@]}" apt-get install -y -qq nodejs
  fi
fi

# 2. Comprobar / Instalar yt-dlp y ffmpeg
if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "› Instalando yt-dlp..."
  install_package "yt-dlp" "yt-dlp" "yt-dlp" "yt-dlp" || {
    echo "› Descargando binario independiente de yt-dlp..."
    "${elevate[@]}" curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
    "${elevate[@]}" chmod a+rx /usr/local/bin/yt-dlp
  }
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "› Instalando FFmpeg..."
  install_package "ffmpeg" "ffmpeg" "ffmpeg" "ffmpeg" || {
    echo "✖ No se pudo instalar FFmpeg automáticamente. Por favor instálalo manualmente."
    exit 1
  }
fi

# 3. Instalar TrackCLI
echo "› Instalando TrackCLI..."
if [[ -f "./package.json" ]] && grep -q '"name": "trackcli"' "./package.json" 2>/dev/null; then
  npm link
else
  npm install --global https://github.com/01-Menjivar/TrackCLI/archive/refs/heads/main.tar.gz
fi

echo ""
echo "  ¡Instalación completada con éxito!"
echo "  ----------------------------------"
echo "  Para comenzar, escribe en tu terminal:"
echo "    trackcli"
echo ""
echo "  O busca una canción directamente:"
echo "    trackcli search \"Artista - Cancion\""
echo ""
