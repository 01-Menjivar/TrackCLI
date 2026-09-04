# TrackCLI

> Herramienta de terminal para extraer audio con metadatos oficiales y selección automática de pistas de estudio.

TrackCLI automatiza la localización y descarga de audio a partir de búsquedas por nombre o enlaces de Spotify, Apple Music y YouTube. Analiza los metadatos de las plataformas de streaming para identificar y priorizar la pista oficial de estudio (*Art Track* provista por el sello discográfico), evitando videoclips con efectos de sonido o diálogos introductorios, e incrusta la carátula y etiquetas ID3 en el archivo final.

---

## Índice

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
  - [Modo interactivo continuo](#modo-interactivo-continuo)
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

- **Modo interactivo asistido (`trackcli`):** Al ejecutar el comando sin argumentos, se inicia una consola guiada donde se puede introducir el nombre de una pista, pegar un enlace de streaming o indicar un archivo `.txt`.
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
```powershell
irm https://raw.githubusercontent.com/01-Menjivar/TrackCLI/main/install.ps1 | iex
```

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

### Modo interactivo continuo
Inicia una consola guiada para procesar múltiples canciones sin reiniciar la herramienta:
```bash
trackcli
```
*Tus preferencias de formato y carpeta se configuran en la primera pista y se reutilizan en las siguientes para agilizar la sesión.*

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
Define tus preferencias globales en `config.json` para no tener que repetir opciones en cada comando:
```bash
# Ver configuración activa
trackcli config

# Establecer carpeta de destino predeterminada
trackcli config set output ~/Music

# Establecer formato preferido (opus, m4a o mp3)
trackcli config set format opus

# Guardar navegador preferido para extracción de cookies
trackcli config set cookies-browser chrome

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
| `--cookies-from-browser` | `-b` | Extrae cookies del navegador para evitar verificaciones de bot. | `chrome`, `firefox`, `brave`, `edge`, etc. | `null` |
| `--cookies` | | Ruta a archivo de cookies en formato Netscape (`cookies.txt`). | `<ruta_archivo>` | `null` |

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
