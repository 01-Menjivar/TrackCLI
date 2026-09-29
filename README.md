# TrackCLI

<p align="center">
  <strong>Terminal audio extractor with official metadata and automatic studio track selection.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0-brightgreen.svg" alt="Node.js 20+"></a>
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg" alt="Platform: macOS, Linux, Windows">
  <a href="package.json"><img src="https://img.shields.io/badge/dependencies-0%20npm%20deps-orange.svg" alt="0 npm dependencies"></a>
  <a href="https://github.com/01-Menjivar/TrackCLI/pulls"><img src="https://img.shields.io/badge/PRs-welcome-brightgreen.svg" alt="PRs Welcome"></a>
</p>

<p align="center">
  <strong>English</strong> | <a href="README.es.md">Español</a>
</p>

---

## Why TrackCLI?

Most music downloaders from YouTube give you **music videos with 30-second dialogue intros, sound effects, or altered audio**. Furthermore, downloaded files often lack album covers, artist tags, or track numbers, leaving your music library messy.

**TrackCLI solves this completely:**
1. You pass a song title or a link from **Spotify, Apple Music, or YouTube**.
2. It fetches the official public metadata (title, artist, album, track number, year, and studio duration).
3. An automated **heuristic scoring engine** cross-references YouTube to locate the pure studio release (*Art Track* distributed directly by record labels), heavily penalizing music videos and sketches.
4. It extracts audio with high-performance concurrency and embeds **high-resolution cover art and complete ID3 tags**.

```text
◆ TrackCLI v0.2.2 · audio extractor

╭──────────────────────────────────────────────────────────╮
│ ✦ Spotify album detected (12 tracks)                     │
│   Album    Random Access Memories                        │
│   Artist   Daft Punk                                     │
│   Year     2013                                          │
│   Tracks   12 songs                                      │
╰──────────────────────────────────────────────────────────╯

  ████████████████ 100.0% · 3.4MiB/s · [1/12] Daft Punk - Give Life Back to Music
  ✔ [#1] Daft Punk - Give Life Back to Music.mp3
  ████████████████ 100.0% · 4.1MiB/s · [2/12] Daft Punk - The Game of Love
  ✔ [#2] Daft Punk - The Game of Love.mp3

╭──────────────────────────────────────────────────────────╮
│ ✔ Download completed                                     │
│   Tracks   12 downloaded (18.4s)                         │
│   Output   /Music/Daft Punk - Random Access Memories     │
╰──────────────────────────────────────────────────────────╯
```

---

## Highlights

- **Studio Audio Guarantee:** Penalizes music videos, dialogue, and intro sound effects; prioritizes label-released *YouTube Music Topic* art tracks with exact duration matching.
- **Accurate ID3 Tagging:** Embeds title, artist, album, track number, year, and high-res cover art straight into MP3 and M4A containers.
- **Dual Interaction Modes:** Run `trackcli` without arguments for a keyboard-navigable interactive menu (`↑` / `↓` / `Enter`), or use direct CLI flags and automated pipelines.
- **Smart CLI Routing:** Pass any URL, file (`.txt`), or song name without having to remember specific subcommands (`search`, `download`, `batch`).
- **Concurrent Pipeline:** Worker queue with controlled concurrency and automated YouTube rate-limit mitigation (HTTP 429 backoff).
- **Honest Audio Formats:** Pure untouched Opus (direct stream, highest fidelity), high-quality AAC/M4A (Apple ecosystem), or universal MP3 (car stereos and DJ software). No fake upscaling.
- **Zero NPM Dependencies:** Written in 100% native Node.js ESM. Fast, auditable, and lightweight.

---

## Table of Contents

- [Why TrackCLI?](#why-trackcli)
- [Highlights](#highlights)
- [How It Works](#how-it-works)
  - [1. Interaction Modes](#1-interaction-modes)
  - [2. Heuristic Selection Engine (Under the Hood)](#2-heuristic-selection-engine-under-the-hood)
- [Audio Formats](#audio-formats)
  - [Device Recommendation Guide](#device-recommendation-guide)
- [Requirements](#requirements)
- [Installation](#installation)
  - [Automatic Installer (macOS / Linux)](#automatic-installer-macos--linux)
  - [Automatic Installer (Windows)](#automatic-installer-windows)
  - [Global Install via npm](#global-install-via-npm)
- [Usage Guide](#usage-guide)
  - [Smart CLI Routing](#smart-cli-routing)
  - [Interactive Menu](#interactive-menu)
  - [Search by Title / Artist](#search-by-title--artist)
  - [Download by URL (Tracks & Albums)](#download-by-url-tracks--albums)
  - [Batch Download (from .txt list)](#batch-download-from-txt-list)
  - [Persistent Configuration](#persistent-configuration)
- [CLI Options](#cli-options)
- [System Diagnostics](#system-diagnostics)
- [Legal Notice](#legal-notice)
- [License](#license)

---

## How It Works

TrackCLI operates both interactively and unattended through two main components: an assisted terminal user interface and an automated heuristic scoring engine.

### 1. Interaction Modes

- **Interactive Menu (`trackcli`):** Running without arguments opens a keyboard-navigable menu (`↑` / `↓` / `Enter`) allowing you to search, download URLs/albums, process batch lists, update persistent configuration, or run diagnostics without memorizing flags.
  - **Smart Confirmation:** When searching by name, the engine identifies and proposes the best official match.
  - **Interactive Selector:** If the top suggestion is not the intended version, an interactive terminal menu lets you inspect alternate candidates (with channel and duration) to pick the correct version or refine the search without exiting.
- **Direct Command Mode:** Enables automation and scripted pipelines via subcommands (`search`, `download`, `batch`), flags, and concurrent queue processing.

### 2. Heuristic Selection Engine (Under the Hood)

To ensure you get the clean studio version rather than a modified music video:

1. **Metadata Resolution:** Extracts public tags from Spotify or Apple Music URLs (artist, title, release year, track number, and official studio duration).
2. **Scoring Algorithm:**
   - **Official Source Priority:** Rewards tracks distributed directly by record labels (*YouTube Music - Topic* channels).
   - **Duration Cross-Check:** Verifies candidate length against the official studio release duration (±2 seconds tolerance).
   - **Video Content Penalty:** Heavily penalizes official music videos (*MV*, *Official Video*, short films) to filter out ambient sound effects, skits, and spoken intros.
3. **Download & Tagging:** Fetches the audio stream via `yt-dlp` and uses `ffmpeg` to embed high-resolution artwork and accurate ID3 metadata into the output file.

---

## Audio Formats

Audio is extracted from the highest-quality streams available at the source and processed according to the selected output format:

| Format | Option | Technical Processing | Compatibility & Recommended Use |
| :--- | :--- | :--- | :--- |
| **Opus** | `--format opus` | **Direct extraction** without re-encoding (native Opus stream at ~160 kbps). | Recommended. Preserves the exact source quality with minimal file size. |
| **M4A / AAC** | `--format m4a` | Packaged or re-encoded into MP4/AAC container. | Native compatibility with Apple devices (iPhone, iPad, Mac) and iTunes. |
| **MP3** | `--format mp3` | Re-encoded using FFmpeg with variable bitrate (VBR 0). | Universal compatibility with car stereos, older players, and DJ software. |

### Device Recommendation Guide

- **Choose MP3 if:**
  - You play music in your **car** via USB flash drives or older head units.
  - You use dedicated MP3 players, portable USB speakers, or vintage Hi-Fi stereos.
  - You use **DJ software or hardware** (Rekordbox, Serato, Traktor, VirtualDJ, classic Pioneer CDJs).
  - *Advantage:* Most universal audio standard; works on virtually any digital playback device.

- **Choose M4A (AAC) if:**
  - Your primary ecosystem is **Apple** (iPhone, iPad, Mac, Apple Watch, CarPlay, iPod).
  - You sync your local music library into **Apple Music** or **iTunes**.
  - You want a modern codec natively supported by modern phones and laptops.
  - *Advantage:* Higher acoustic efficiency than MP3 and seamless Apple integration.

- **Choose Opus if:**
  - You listen on **Android**, **Linux / Windows** PCs, or modern audio players (VLC, foobar2000, Poweramp, Musicolet, Plexamp).
  - You want the **highest acoustic fidelity possible**: directly saved from the source stream without a second lossy re-encoding pass.
  - You want smaller file sizes with pristine clarity.
  - *Note:* The stock iOS Music app and legacy car stereos do not play Opus natively (requires third-party players like VLC).

---

## Requirements

- **Node.js** (version 20.0 or higher)
- **yt-dlp**
- **FFmpeg**

Check tool availability on your system anytime with:
```bash
trackcli doctor
```

---

## Installation

### Automatic Installer (macOS / Linux)
```bash
curl -fsSL https://raw.githubusercontent.com/01-Menjivar/TrackCLI/main/install.sh | bash
```

### Automatic Installer (Windows)

In PowerShell (run this first to allow script execution if not already enabled):
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Then run the installer:
```powershell
irm https://raw.githubusercontent.com/01-Menjivar/TrackCLI/main/install.ps1 | iex
```

> **Note:** Windows blocks script execution by default in PowerShell. Setting `RemoteSigned` for the `CurrentUser` scope (does not require administrator privileges) is required so that both `npm` and the `trackcli` command can run without security policy errors.

### Global Install via npm
```bash
npm install --global https://github.com/01-Menjivar/TrackCLI/archive/refs/tags/v0.2.2.tar.gz
```

---

## Usage Guide

### Smart CLI Routing

TrackCLI automatically understands what you want to do based on the input argument:

```bash
# Search and download by song name
trackcli "Artist - Song"

# Download a track or full album from URL
trackcli "https://open.spotify.com/album/<ALBUM_ID>" -o ~/Music

# Process a batch file of songs/links
trackcli list.txt -c 4
```

*(Explicit subcommands `search`, `download`, and `batch` remain available for scripts and CI/CD).*

### Interactive Menu
Launch the keyboard-driven terminal menu to search, download tracks/albums, batch process, adjust persistent settings, or diagnose dependencies:
```bash
trackcli
```
*Navigate with `↑` / `↓`, confirm with `Enter`, cancel with `Esc` or `q`.*

### Search by Title / Artist
```bash
# Default MP3 download with cover art
trackcli search "Artist - Song"

# Direct Opus download (no re-encoding)
trackcli search "Artist - Song" --format opus

# Fast download without cover art
trackcli search "Artist - Song" -m
```

### Download by URL (Tracks & Albums)
```bash
# Single track from Spotify or Apple Music (saved as "Artist - Track.ext")
trackcli download "https://open.spotify.com/track/<TRACK_ID>"
trackcli download "https://music.apple.com/us/album/<ALBUM_NAME>/<ALBUM_ID>?i=<TRACK_ID>"

# YouTube link
trackcli download "https://www.youtube.com/watch?v=<VIDEO_ID>"

# Full album (organized in "Artist - Album/" folder with "01 - Track.ext")
trackcli download "https://open.spotify.com/album/<ALBUM_ID>"
trackcli download "https://music.apple.com/us/album/<ALBUM_NAME>/<ALBUM_ID>"
trackcli download "https://www.youtube.com/playlist?list=<PLAYLIST_ID>"

# Multiple URLs downloaded in parallel to a specific folder
trackcli download "<URL_1>" "<URL_2>" "<URL_3>" -o ~/Music
```

### Batch Download (from .txt list)
Process a list of links or song queries (one per line):
```bash
trackcli batch list.txt -o ~/Music -c 4
```

*Example `list.txt`:*
```text
# URLs or song titles
https://open.spotify.com/track/<TRACK_ID>
https://open.spotify.com/album/<ALBUM_ID>
https://music.apple.com/us/album/<ALBUM_NAME>/<ALBUM_ID>
https://www.youtube.com/watch?v=<VIDEO_ID>
Artist One - Track One
Artist Two - Track Two
```

### Persistent Configuration
Define your global preferences in `config.json` so they apply automatically without passing CLI flags every time (also accessible via `trackcli` → `Settings`):

```bash
# View active configuration
trackcli config

# Set default audio format (mp3, m4a, or opus)
trackcli config set format opus

# Set default output directory
trackcli config set output ~/Music

# Set concurrency level for batch/album downloads (1 to 6, recommended: 3)
trackcli config set concurrency 4

# Enable or disable cover art embedding by default (true | false)
trackcli config set cover false

# Always overwrite existing files by default (true | false)
trackcli config set overwrite true

# Download full playlists by default when pasting URLs with &list= (true | false)
trackcli config set playlist true

# Reset settings to factory defaults
trackcli config reset
```

---

## CLI Options

| Option | Alias | Description | Values | Default |
| :--- | :--- | :--- | :--- | :--- |
| `--format` | | Audio output format. | `opus`, `m4a`, `mp3` | `mp3` |
| `--output` | `-o` | Output directory where files are saved. | `<directory>` | `./trackcli-downloads` |
| `--concurrency` | `-c` | Number of concurrent downloads in queues and albums. | `1` to `6` (recommended: `3`) | `3` |
| `--no-cover` | `-m` | Fast download without embedding cover art. | Boolean flag | `false` |
| `--overwrite` | `-f` | Overwrite files if they already exist at destination. | Boolean flag | `false` |
| `--playlist` | | Force downloading entire playlist on URLs with `&list=`. | Boolean flag | `false` |

---

## System Diagnostics

```bash
# Check dependencies and system status
trackcli doctor

# Update to the latest version directly from GitHub
trackcli update
```

---

## Legal Notice

- **Software Scope:** TrackCLI is a local automation utility that parses public streaming web metadata and interfaces with installed system utilities (`yt-dlp` and `ffmpeg`). It does not host, store, stream, or distribute copyrighted audio files.
- **No DRM Circumvention:** TrackCLI does not bypass or circumvent digital rights management (DRM); it does not extract audio streams from Spotify or Apple Music servers.
- **User Responsibility:** Users are solely responsible for how they use this tool, the content they access, and compliance with copyright laws and applicable terms of service in their jurisdiction.
- **Trademarks:** Spotify, Apple Music, and YouTube are trademarks of their respective owners. TrackCLI is an independent open-source project with no affiliation, sponsorship, or endorsement from these entities.

---

## License

Distributed under the [MIT](LICENSE) License.
