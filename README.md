# TrackCLI

TrackCLI es una herramienta de terminal para descargar audio y organizar metadatos musicales. Permite buscar canciones por nombre, ingresar enlaces de Spotify, Apple Music o YouTube, y obtener archivos de audio con sus etiquetas oficiales (título, artista, álbum, año, número de pista) y carátulas integradas.

---

## Tabla de Contenidos

- [Funcionalidades](#funcionalidades)
- [Requisitos](#requisitos)
- [Instalacion](#instalacion)
  - [Instalacion con Git (Recomendado)](#instalacion-con-git-recomendado)
  - [Instalacion global con npm](#instalacion-global-con-npm)
  - [Instalacion con script asistido](#instalacion-con-script-asistido)
- [Guia de Uso](#guia-de-uso)
  - [Modo interactivo](#modo-interactivo)
  - [Buscar y descargar por nombre](#buscar-y-descargar-por-nombre)
  - [Descargar desde enlaces (Spotify, Apple Music, YouTube)](#descargar-desde-enlaces-spotify-apple-music-youtube)
  - [Descarga de albumes completos](#descarga-de-albumes-completos)
  - [Descarga por lotes (archivo .txt)](#descarga-por-lotes-archivo-txt)
  - [Configuracion persistente](#configuracion-persistente)
  - [Diagnostico y actualizacion](#diagnostico-y-actualizacion)
- [Opciones de linea de comandos](#opciones-de-linea-de-comandos)
- [Formatos de audio compatibles](#formatos-de-audio-compatibles)
- [Ejemplo de archivo de lista](#ejemplo-de-archivo-de-lista)
- [Licencia](#licencia)

---

## Funcionalidades

- **Priorizacion de versiones de estudio**: Evalua los resultados de audio disponibles para seleccionar versiones oficiales (`Official Audio`), evitando videoclips con efectos de sonido o introducciones habladas.
- **Cotejo de duracion**: Si se proporciona un enlace de Spotify o Apple Music, extrae la duracion oficial de la pista y la contrasta contra los candidatos de audio para asegurar la version exacta.
- **Incrustacion automatica de metadatos e ID3**: Asigna titulo, artista, album, ano, numero de pista (`1/12`), disco y portada en alta resolucion al archivo final.
- **Soporte de albumes completos**: Procesa enlaces de albumes de Spotify y Apple Music, descargando todas sus canciones en orden y con sus metadatos correspondientes.
- **Descargas en paralelo**: Ejecuta descargas concurrentes para listas y albumes (`concurrency: 3` por defecto).
- **Omision de duplicados**: Detecta si una cancion ya existe en el directorio de destino y la omite para evitar descargas redundantes.
- **Selector interactivo**: Permite explorar alternativas y elegir la pista deseada mediante las flechas del teclado (`Arriba` / `Abajo`).
- **Configuracion persistente**: Guarda preferencias de formato, carpeta de destino y nivel de concurrencia mediante el comando `trackcli config`.

---

## Requisitos

- **Node.js** (version 20 o superior)
- **yt-dlp**
- **FFmpeg**

Verifica el estado de las herramientas en tu sistema con:
```bash
trackcli doctor
```

Para instalarlas segun tu sistema operativo:
- **macOS**: `brew install yt-dlp ffmpeg node`
- **Windows** (PowerShell): `winget install yt-dlp.yt-dlp Gyan.FFmpeg OpenJS.NodeJS`
- **Linux** (Debian/Ubuntu): `sudo apt install yt-dlp ffmpeg nodejs`

---

## Instalacion

### Instalacion con Git (Recomendado)

```bash
git clone https://github.com/01-Menjivar/TrackCLI.git
cd TrackCLI
npm link
```

### Instalacion global con npm

```bash
npm install --global https://github.com/01-Menjivar/TrackCLI/archive/refs/heads/main.tar.gz
```

### Instalacion con script asistido

```bash
# macOS / Linux
chmod +x install.sh && ./install.sh

# Windows (PowerShell)
.\install.ps1
```

---

## Guia de Uso

### Modo interactivo

Inicia el menu interactivo donde puedes escribir nombres de canciones, pegar enlaces o cargar archivos:

```bash
trackcli
```

### Buscar y descargar por nombre

```bash
# Descarga la pista con formato MP3 y portada incrustada
trackcli search "Artista - Titulo de la cancion"

# Descarga en formato M4A
trackcli search "Artista - Cancion" --format m4a

# Descarga sin incrustar portada (modo minimal)
trackcli search "Artista - Cancion" -m
```

### Descargar desde enlaces (Spotify, Apple Music, YouTube)

```bash
# Pista individual de Spotify
trackcli download "https://open.spotify.com/track/<ID_PISTA>"

# Pista de Apple Music
trackcli download "https://music.apple.com/us/album/<NOMBRE>/<ID_ALBUM>?i=<ID_PISTA>"

# Enlace de YouTube
trackcli download "https://www.youtube.com/watch?v=<ID_VIDEO>"

# Descarga de varios enlaces simultaneos
trackcli download "<URL_1>" "<URL_2>" "<URL_3>"
```

### Descarga de albumes completos

Al ingresar el enlace de un album de Spotify o Apple Music, TrackCLI descarga todas las pistas del disco de forma concurrente con sus numeros de orden correspondientes:

```bash
# Album de Spotify
trackcli download "https://open.spotify.com/album/<ID_ALBUM>"

# Album de Apple Music
trackcli download "https://music.apple.com/us/album/<NOMBRE_ALBUM>/<ID_ALBUM>"
```

### Descarga por lotes (archivo .txt)

Procesa una lista de canciones, enlaces o albumes linea por linea:

```bash
trackcli batch mi-lista.txt --output "$HOME/Music" -c 4
```

### Configuracion persistente

Permite definir valores predeterminados para evitar escribir flags en cada comando:

```bash
# Ver configuracion actual
trackcli config

# Definir la carpeta de destino predeterminada
trackcli config set output ~/Music/Canciones

# Definir el formato predeterminado (mp3, m4a u opus)
trackcli config set format m4a

# Definir la cantidad de descargas simultaneas
trackcli config set concurrency 4

# Restablecer la configuracion por defecto
trackcli config reset
```

### Diagnostico y actualizacion

```bash
# Comprobar que yt-dlp y ffmpeg estan configurados correctamente
trackcli doctor

# Actualizar a la version mas reciente desde GitHub
trackcli update
```

---

## Opciones de linea de comandos

| Opcion | Alias | Descripcion | Valores | Por defecto |
| :--- | :--- | :--- | :--- | :--- |
| `--format` | | Formato de salida del audio. | `mp3`, `m4a`, `opus` | `mp3` |
| `--quality` | | Nivel de calidad VBR para MP3 (`0` es la maxima calidad). | `0` a `10` | `0` |
| `--output` | | Directorio donde se guardaran los archivos. | `<directorio>` | `./trackcli-downloads` |
| `--concurrency` | `-c` | Numero de descargas simultaneas para colas y albumes. | `1` a `16` | `3` |
| `--minimal` | `-m` | Descarga solo el audio sin portada incrustada. | Booleano | `false` |
| `--overwrite` | `-f` | Sobrescribe archivos si ya existen en destino. | Booleano | `false` |

---

## Formatos de audio compatibles

- **MP3 (`.mp3`)**: Formato estandar compatible con reproductores de audio, automoviles y equipos DJ.
- **M4A / AAC (`.m4a`)**: Formato de alta compresion y compatibilidad nativa con dispositivos Apple (iPhone, Mac) e iTunes.
- **Opus (`.opus`)**: Formato de mayor fidelidad y eficiencia, extraido directamente de la fuente sin recodificacion.

---

## Ejemplo de archivo de lista

Contenido valido para usar con `trackcli batch lista.txt`:

```text
# Pista individual de Spotify:
https://open.spotify.com/track/<ID_PISTA>

# Album completo de Spotify:
https://open.spotify.com/album/<ID_ALBUM>

# Pista de Apple Music:
https://music.apple.com/us/album/<NOMBRE_ALBUM>/<ID_ALBUM>?i=<ID_PISTA>

# Album completo de Apple Music:
https://music.apple.com/us/album/<NOMBRE_ALBUM>/<ID_ALBUM>

# Enlace de YouTube:
https://www.youtube.com/watch?v=<ID_VIDEO>

# Busqueda directa por nombre:
Artista Uno - Cancion Uno
Artista Dos - Cancion Dos
Artista Tres - Cancion Tres
```

---

## Exencion de Responsabilidad

- TrackCLI es una herramienta de software libre desarrollada exclusivamente para fines educativos, de organizacion de archivos personales y para su utilizacion con contenido propio, bajo licencias libres (Creative Commons) o de dominio publico.
- TrackCLI no aloja, distribuye ni elude sistemas de proteccion de derechos digitales (DRM).
- TrackCLI no descarga audio directamente desde los servidores de Spotify ni de Apple Music; unicamente analiza metadatos web publicos para estructurar e incrustar etiquetas ID3.
- El autor no se hace responsable del uso indebido que terceros puedan hacer de esta herramienta ni de posibles infracciones a terminos de servicio o leyes de propiedad intelectual en sus respectivas jurisdicciones. El usuario asume toda la responsabilidad legal derivada del uso del programa.

---

## Licencia

Distribuido bajo la licencia [MIT](LICENSE).


