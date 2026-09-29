# TrackCLI

<p align="center">
  <strong>Herramienta de terminal para extraer audio con metadatos oficiales y selección automática de pistas de estudio.</strong>
</p>

<p align="center">
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="Licencia: MIT"></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/node-%3E%3D20.0-brightgreen.svg" alt="Node.js 20+"></a>
  <img src="https://img.shields.io/badge/plataformas-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey.svg" alt="Plataformas: macOS, Linux, Windows">
  <a href="package.json"><img src="https://img.shields.io/badge/dependencias-0%20npm%20deps-orange.svg" alt="0 dependencias npm"></a>
  <a href="https://github.com/01-Menjivar/TrackCLI/pulls"><img src="https://img.shields.io/badge/PRs-bienvenidos-brightgreen.svg" alt="PRs Bienvenidos"></a>
</p>

<p align="center">
  <a href="README.md">English</a> | <strong>Español</strong>
</p>

---

## ¿Por qué TrackCLI?

La mayoría de descargadores de música desde YouTube presentan un gran problema: **descargan el videoclip oficial con 30 segundos de diálogo antes de la canción, efectos de sonido de ambiente o audio alterado**. Además, los archivos descargados suelen carecer de portadas en alta definición, etiquetas de artista o número de pista, dejando desorganizada tu biblioteca musical.

**TrackCLI resuelve esto de forma automática y transparente:**
1. Indicas una canción o pegas un enlace de **Spotify, Apple Music o YouTube**.
2. Lee los metadatos públicos oficiales (título, artista, álbum, número de pista, año y duración exacta de estudio).
3. Un **motor de selección heurística** contrasta YouTube para localizar la versión pura de estudio (*Art Track* distribuida directamente por el sello discográfico en *YouTube Music Topic*), penalizando fuertemente los videoclips y cortometrajes.
4. Extrae el audio con concurrencia controlada e incrusta la **carátula en alta definición y etiquetas ID3 completas**.

```text
◆ TrackCLI v0.2.1 · audio extractor

╭──────────────────────────────────────────────────────────╮
│ ✦ Álbum de Spotify detectado (12 pistas)                 │
│   Álbum    Random Access Memories                        │
│   Artista  Daft Punk                                     │
│   Año      2013                                          │
│   Pistas   12 canciones                                  │
╰──────────────────────────────────────────────────────────╯

  ████████████████ 100.0% · 3.4MiB/s · [1/12] Daft Punk - Give Life Back to Music
  ✔ [#1] Daft Punk - Give Life Back to Music.mp3
  ████████████████ 100.0% · 4.1MiB/s · [2/12] Daft Punk - The Game of Love
  ✔ [#2] Daft Punk - The Game of Love.mp3

╭──────────────────────────────────────────────────────────╮
│ ✔ Descarga completada                                    │
│   Pistas   12 descargadas (18.4s)                        │
│   Destino  /Music/Daft Punk - Random Access Memories     │
╰──────────────────────────────────────────────────────────╯
```

---

## Características destacadas

- **Garantía de audio de estudio:** Penaliza videoclips con diálogos o efectos; prioriza lanzamientos oficiales de discográfica (*Topic*) con verificación de duración oficial (±2s).
- **Etiquetado ID3 impecable:** Título, artista, álbum, número de pista, año y carátula incrustados directamente en el archivo final.
- **Doble modo de interacción:** Ejecuta `trackcli` sin argumentos para abrir un menú interactivo navegable con flechas (`↑` / `↓` / `Enter`), o utiliza flags y subcomandos para automatización.
- **Despacho inteligente (Smart Routing):** Pega cualquier URL, archivo `.txt` o nombre de canción sin tener que recordar subcomandos obligatorios (`search`, `download`, `batch`).
- **Pipeline concurrente:** Cola de procesamiento con velocidad controlada y mitigación automática de bloqueos temporales de YouTube (HTTP 429).
- **Formatos honestos sin falsas promesas:** Opus puro (stream nativo sin recodificar), AAC/M4A de alta calidad (ecosistema Apple) o MP3 universal (autos y equipos DJ). Sin reescalados inflados.
- **Cero dependencias de producción en npm:** Desarrollado con APIs nativas de Node.js ESM. Rápido, ligero y auditable.

---

## Índice

- [¿Por qué TrackCLI?](#por-qué-trackcli)
- [Características destacadas](#características-destacadas)
- [¿Cómo funciona?](#cómo-funciona)
  - [1. Modos de interacción](#1-modos-de-interacción)
  - [2. Motor de selección heurística (bajo el capó)](#2-motor-de-selección-heurística-bajo-el-capó)
- [Formatos de audio](#formatos-de-audio)
  - [Guía de selección según tu dispositivo](#guía-de-selección-según-tu-dispositivo)
- [Requisitos](#requisitos)
- [Instalación](#instalación)
  - [Instalador automático (macOS / Linux)](#instalador-automático-macos--linux)
  - [Instalador automático (Windows)](#instalador-automático-windows)
  - [Instalación global con npm](#instalación-global-con-npm)
- [Guía de Uso](#guía-de-uso)
  - [Despacho inteligente (Smart Routing)](#despacho-inteligente-smart-routing)
  - [Menú interactivo](#menú-interactivo)
  - [Búsqueda por nombre](#búsqueda-por-nombre)
  - [Descarga por enlace (Pistas y Álbumes)](#descarga-por-enlace-pistas-y-álbumes)
  - [Descarga por lotes (archivo .txt)](#descarga-por-lotes-archivo-txt)
  - [Configuración persistente](#configuración-persistente)
- [Opciones de línea de comandos](#opciones-de-línea-de-comandos)
- [Diagnóstico del sistema](#diagnóstico-del-sistema)
- [Consideraciones legales](#consideraciones-legales)
- [Licencia](#licencia)

---

## ¿Cómo funciona?

TrackCLI opera tanto de forma interactiva como desatendida mediante dos componentes: la interfaz de usuario asistida y el motor de selección heurística.

### 1. Modos de interacción

- **Menú interactivo (`trackcli`):** Al ejecutar el comando sin argumentos, se despliega un menú navegable con las flechas del teclado (`↑` / `↓` / `Enter`) que permite acceder a todas las funciones (búsqueda, descarga por enlace/álbum, listas por lotes, configuración persistente o diagnóstico) sin forzar una búsqueda inmediata.
  - **Confirmación inteligente:** Al buscar por nombre, el sistema analiza las fuentes y propone la mejor coincidencia oficial encontrada.
  - **Selector interactivo:** Si la coincidencia propuesta no es la deseada, se despliega un menú en terminal navegable con las flechas del teclado (`↑` / `↓` / `Enter`), mostrando las pistas alternativas junto con su canal y duración para seleccionar la versión correcta o reintentar la búsqueda sin abandonar la sesión.
- **Modo de comandos directos:** Permite la ejecución directa y la automatización mediante subcomandos explícitos (`search`, `download`, `batch`), flags de configuración y procesamiento concurrente.

### 2. Motor de selección heurística (bajo el capó)

Para garantizar que se obtenga la versión pura de estudio y no un video alterado:

1. **Lectura de metadatos:** A partir de un enlace de Spotify o Apple Music, extrae las etiquetas públicas de la pista o álbum (artista, título, año, número de pista y duración oficial de estudio).
2. **Algoritmo de puntuación (Scoring):**
   - **Prioridad a fuentes oficiales:** Otorga la mayor puntuación a los lanzamientos provistos directamente por los sellos discográficos (*YouTube Music - Topic*).
   - **Verificación de duración:** Contrasta la duración del candidato frente a la duración oficial de estudio (tolerancia de ±2 segundos).
   - **Filtrado de contenido audiovisual:** Penaliza fuertemente videoclips (*Official Video*, *MV*, cortometrajes) para evitar ruidos de ambiente, efectos de sonido o diálogos iniciales ajenos a la música.
3. **Descarga y etiquetado:** Obtiene el flujo de audio mediante `yt-dlp` y utiliza `ffmpeg` para incrustar la portada en alta resolución y los metadatos completos en el archivo final.

---

## Formatos de audio

El audio se obtiene a partir de los flujos de mayor fidelidad disponibles en la fuente y se procesa según el formato de salida seleccionado:

| Formato | Parámetro | Procesamiento técnico | Compatibilidad / Uso |
| :--- | :--- | :--- | :--- |
| **Opus** | `--format opus` | **Extracción directa** sin recodificación (stream nativo Opus a ~160 kbps). | Recomendado. Preserva la calidad exacta de la fuente con el menor tamaño de archivo. |
| **M4A / AAC** | `--format m4a` | Empaquetado o recodificación en contenedor MP4/AAC. | Compatibilidad nativa con dispositivos Apple (iPhone, Mac) e iTunes. |
| **MP3** | `--format mp3` | Recodificación mediante FFmpeg con bitrate variable (VBR 0). | Compatibilidad universal con autorradios, equipos antiguos y software de audio. |

### Guía de selección según tu dispositivo

- **Elige MP3 si:**
  - Vas a reproducir música en el **automóvil** mediante memorias USB o estéreos tradicionales.
  - Usas reproductores MP3 dedicados, altavoces con lector USB o equipos de sonido antiguos.
  - Utilizas software o controladores de **DJ** (Rekordbox, Serato, Traktor, VirtualDJ) o consolas Pioneer CDJ clásicas.
  - *Ventaja:* Es el estándar histórico más universal; funciona en cualquier dispositivo que admita audio digital sin excepciones.

- **Elige M4A (AAC) si:**
  - Tu ecosistema principal es **Apple** (iPhone, iPad, Mac, Apple Watch, CarPlay o iPod).
  - Sincronizas tu biblioteca local con la app **Apple Music** o **iTunes**.
  - Buscas un formato moderno respaldado de forma nativa por la mayoría de teléfonos y computadoras actuales.
  - *Ventaja:* Mayor eficiencia que MP3 y compatibilidad perfecta en dispositivos Apple.

- **Elige Opus si:**
  - Escuchas tu música en **Android**, computadoras con **Linux/Windows** o reproductores modernos (VLC, foobar2000, Poweramp, Musicolet, Plexamp).
  - Buscas la **máxima fidelidad acústica posible**: es el único formato que se almacena directamente del stream de origen sin pasar por una segunda compresión.
  - Deseas ahorrar espacio de almacenamiento manteniendo la máxima claridad de sonido.
  - *Nota:* La app nativa de Música en iOS y la mayoría de autorradios antiguos no reproducen Opus directamente (requiere reproductores de terceros como VLC).

---

## Requisitos

- **Node.js** (versión 20.0 o superior)
- **yt-dlp**
- **FFmpeg**

Comprueba la disponibilidad de las herramientas en tu sistema con:
```bash
trackcli doctor
```

---

## Instalación

### Instalador automático (macOS / Linux)
```bash
curl -fsSL https://raw.githubusercontent.com/01-Menjivar/TrackCLI/main/install.sh | bash
```

### Instalador automático (Windows)

En PowerShell (ejecutar primero para permitir la ejecución de scripts si aún no está habilitada):
```powershell
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

Luego ejecutar el instalador:
```powershell
irm https://raw.githubusercontent.com/01-Menjivar/TrackCLI/main/install.ps1 | iex
```

> **Nota:** Windows bloquea por defecto la ejecución de scripts en PowerShell. Configurar `RemoteSigned` en el ámbito `CurrentUser` (no requiere permisos de administrador) es necesario para que tanto `npm` como el propio comando `trackcli` puedan ejecutarse sin restricciones de seguridad.

### Instalación global con npm
```bash
npm install --global https://github.com/01-Menjivar/TrackCLI/archive/refs/heads/main.tar.gz
```

---

## Guía de Uso

### Despacho inteligente (Smart Routing)

TrackCLI detecta automáticamente el tipo de entrada sin necesidad de escribir subcomandos:

```bash
# Búsqueda y descarga directa por nombre
trackcli "Artista - Canción"

# Descarga directa por enlace de canción o álbum
trackcli "https://open.spotify.com/album/<ID_ALBUM>" -o ~/Music

# Procesamiento directo de un listado por lotes
trackcli lista.txt -c 4
```

*(Los subcomandos explícitos `search`, `download` y `batch` se mantienen disponibles para scripts y automatizaciones).*

### Menú interactivo
Inicia el entorno interactivo navegable para buscar canciones, descargar enlaces o álbumes, procesar listas, ajustar configuración o ejecutar diagnósticos sin necesidad de recordar parámetros ni forzar búsquedas inmediatas:
```bash
trackcli
```
*Navega con `↑` / `↓`, confirma con `Enter` y cancela con `Esc` o `q`.*

### Búsqueda por nombre
```bash
# Descarga por defecto en MP3 con portada
trackcli search "Artista - Canción"

# Descarga en Opus (sin recodificar)
trackcli search "Artista - Canción" --format opus

# Descarga sin carátula
trackcli search "Artista - Canción" -m
```

### Descarga por enlace (Pistas y Álbumes)
```bash
# Pista individual de Spotify o Apple Music (se guarda como "Artista - Canción.ext")
trackcli download "https://open.spotify.com/track/<ID_PISTA>"
trackcli download "https://music.apple.com/us/album/<NOMBRE_ALBUM>/<ID_ALBUM>?i=<ID_PISTA>"

# Enlace de YouTube
trackcli download "https://www.youtube.com/watch?v=<ID_VIDEO>"

# Álbum completo (se organiza en subcarpeta "Artista - Álbum/" con pistas "01 - Canción.ext")
trackcli download "https://open.spotify.com/album/<ID_ALBUM>"
trackcli download "https://music.apple.com/us/album/<NOMBRE_ALBUM>/<ID_ALBUM>"
trackcli download "https://www.youtube.com/playlist?list=<ID_PLAYLIST>"

# Múltiples enlaces simultáneos en una carpeta específica
trackcli download "<URL_1>" "<URL_2>" "<URL_3>" -o ~/Music
```

### Descarga por lotes (archivo .txt)
Procesa un listado de enlaces o nombres (uno por línea):
```bash
trackcli batch lista.txt -o ~/Music -c 4
```

*Ejemplo de `lista.txt`:*
```text
# Enlaces o nombres de canciones
https://open.spotify.com/track/<ID_PISTA>
https://open.spotify.com/album/<ID_ALBUM>
https://music.apple.com/us/album/<NOMBRE_ALBUM>/<ID_ALBUM>
https://www.youtube.com/watch?v=<ID_VIDEO>
Artista Uno - Canción Uno
Artista Dos - Canción Dos
```

### Configuración persistente
Define tus preferencias globales en `config.json` para que se apliquen automáticamente sin tener que repetir flags en cada comando (también configurable interactivamente desde `trackcli` → `Configuración`):

```bash
# Ver configuración activa
trackcli config

# Formato de audio preferido (mp3, m4a u opus)
trackcli config set format opus

# Carpeta de destino predeterminada
trackcli config set output ~/Music

# Concurrencia de descargas en lotes o listas (1 a 6, recomendado: 3)
trackcli config set concurrency 4

# Habilitar o deshabilitar carátula e imágenes ID3 por defecto (true | false)
trackcli config set cover false

# Sobrescribir archivos existentes por defecto (true | false)
trackcli config set overwrite true

# Descargar playlists completas por defecto al pegar enlaces con &list= (true | false)
trackcli config set playlist true

# Restablecer valores predeterminados
trackcli config reset
```

---

## Opciones de línea de comandos

| Opción | Alias | Descripción | Valores | Por defecto |
| :--- | :--- | :--- | :--- | :--- |
| `--format` | | Formato de salida del audio. | `opus`, `m4a`, `mp3` | `mp3` |
| `--output` | `-o` | Carpeta de destino donde se guardarán los archivos. | `<directorio>` | `./trackcli-downloads` |
| `--concurrency` | `-c` | Número de descargas simultáneas en colas y álbumes. | `1` a `6` (recomendado: `3`) | `3` |
| `--no-cover` | `-m` | Descarga rápida de audio sin incrustar portada. | Booleano | `false` |
| `--overwrite` | `-f` | Sobrescribe archivos si ya existen en el destino. | Booleano | `false` |
| `--playlist` | | Fuerza la descarga de playlist completa en URLs con `&list=`. | Booleano | `false` |

---

## Diagnóstico del sistema

```bash
# Verificar estado y versiones de las dependencias externas
trackcli doctor

# Actualizar a la versión más reciente del repositorio
trackcli update
```

---

## Consideraciones legales

- **Naturaleza del software:** TrackCLI es una herramienta de automatización local que procesa metadatos web públicos e interactúa con utilidades del sistema (`yt-dlp` y `ffmpeg`). No aloja, almacena, retransmite ni distribuye archivos de audio.
- **Sin elusión de DRM:** La herramienta no desencripta ni vulnera sistemas de gestión de derechos digitales (DRM); no descarga flujos de audio de los servidores de Spotify ni de Apple Music.
- **Responsabilidad de uso:** El usuario final es el único responsable del uso que dé a la herramienta, de las fuentes a las que acceda y del cumplimiento de la legislación de propiedad intelectual y los términos de servicio aplicables en su territorio.
- **Marcas registradas:** Spotify, Apple Music y YouTube son marcas comerciales de sus respectivos titulares. TrackCLI es un proyecto independiente sin afiliación, patrocinio ni respaldo de dichas entidades.

---

## Licencia

Distribuido bajo licencia [MIT](LICENSE).
