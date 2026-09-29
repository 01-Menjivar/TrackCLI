#!/usr/bin/env bash
set -Eeuo pipefail

echo ""
echo "  TrackCLI - Automatic Installer"
echo "  =============================="
echo ""

elevate=()
if [[ "$(id -u)" -ne 0 ]]; then
  if command -v sudo >/dev/null 2>&1; then
    elevate=(sudo)
  fi
fi

# Expanding an empty array fails under "set -u" in bash 3.2 (macOS), so branch on its length.
run_elevated() {
  if [[ ${#elevate[@]} -gt 0 ]]; then
    "${elevate[@]}" "$@"
  else
    "$@"
  fi
}

install_package() {
  local pkg_brew="$1"
  local pkg_apt="$2"
  local pkg_dnf="$3"
  local pkg_pacman="$4"

  if command -v brew >/dev/null 2>&1; then
    brew install "$pkg_brew"
  elif command -v apt-get >/dev/null 2>&1; then
    run_elevated apt-get update -qq
    run_elevated apt-get install -y -qq "$pkg_apt"
  elif command -v dnf >/dev/null 2>&1; then
    run_elevated dnf install -y -q "$pkg_dnf"
  elif command -v pacman >/dev/null 2>&1; then
    run_elevated pacman -Sy --needed --noconfirm "$pkg_pacman"
  else
    return 1
  fi
}

# 1. Check / Install Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "› Installing Node.js..."
  if ! install_package "node" "nodejs npm" "nodejs npm" "nodejs npm"; then
    echo "✖ Could not install Node.js automatically. Please install it from https://nodejs.org/"
    exit 1
  fi
fi

# Verify Node.js version
if ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 20 ? 0 : 1)' 2>/dev/null; then
  echo "› Upgrading Node.js to version 20 or higher..."
  if command -v brew >/dev/null 2>&1; then
    brew upgrade node || brew install node
  elif command -v apt-get >/dev/null 2>&1; then
    echo "› Configuring official Node.js LTS repository..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | run_elevated bash -
    run_elevated apt-get install -y -qq nodejs
  fi
fi

# 2. Check / Install yt-dlp and ffmpeg
if ! command -v yt-dlp >/dev/null 2>&1; then
  echo "› Installing yt-dlp..."
  install_package "yt-dlp" "yt-dlp" "yt-dlp" "yt-dlp" || {
    echo "› Downloading standalone yt-dlp binary..."
    run_elevated curl -fsSL https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
    run_elevated chmod a+rx /usr/local/bin/yt-dlp
  }
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "› Installing FFmpeg..."
  install_package "ffmpeg" "ffmpeg" "ffmpeg" "ffmpeg" || {
    echo "✖ Could not install FFmpeg automatically. Please install it manually."
    exit 1
  }
fi

# 3. Install TrackCLI
echo "› Installing TrackCLI..."
if [[ -f "./package.json" ]] && grep -q '"name": "trackcli"' "./package.json" 2>/dev/null; then
  npm link
else
  npm install --global https://github.com/01-Menjivar/TrackCLI/archive/refs/heads/main.tar.gz
fi

echo ""
echo "  Installation completed successfully!"
echo "  ------------------------------------"
echo "  To get started, run in your terminal:"
echo "    trackcli"
echo ""
echo "  Or search for a track directly:"
echo "    trackcli search \"Artist - Song\""
echo ""
