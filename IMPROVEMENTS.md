# TrackCLI — Plan de Mejora y Hoja de Ruta Realista

Documento de objetivos y mejoras técnicas para **TrackCLI**.  
Este plan está diseñado bajo una filosofía de **software honesto, transparente y útil para la comunidad**: sin funciones innecesarias o engañosas (como prometer calidad FLAC a partir de fuentes comprimidas de YouTube), priorizando la robustez, la organización de archivos y la eliminación de fricción para el usuario diario.

---

## 🎯 Filosofía del Proyecto y Alcance Técnico

1. **Realismo sobre el audio:**
   - La fuente de extracción es YouTube / YouTube Music.
   - Los streams máximos disponibles son **Opus ~160 kbps** (formato 251) y **AAC ~128 kbps** (formato 140).
   - TrackCLI preserva el audio de mayor fidelidad de la fuente (`opus` directo sin recodificación, o `mp3`/`m4a` para compatibilidad con reproductores antiguos o ecosistema Apple). No se implementará transcodificación inflada a formatos sin pérdida (FLAC/WAV).
2. **Cero falsos positivos:** La herramienta nunca debe ocultar errores de red o pistas no encontradas.
3. **Cero dependencias de producción en npm:** Mantener la base ligera, auditable y rápida usando exclusivamente las APIs nativas de Node.js (20+), `yt-dlp` y `ffmpeg`.

---

## 📋 Fases de Implementación

### Fase 1: Transparencia y Corrección de Bugs Críticos
*Objetivo: Garantizar que la herramienta reporte exactamente lo que ocurre y no falle en sistemas específicos.*

- [x] **1.1 Transparencia total en `runBatchPipeline` (Cero fallos silenciosos)**
  - **Problema:** Si una pista o enlace falla durante la resolución de metadatos o búsqueda en lotes, se ignora silenciosamente en el bloque `catch`. El resumen final muestra *"✔ Descarga completada"* con números parciales sin alertar al usuario.
  - **Acción:** Registrar cada elemento fallido en `results` con `{ ok: false, error: '...' }` y mostrar al final una lista clara de pistas omitidas para que el usuario pueda revisarlas o reintentarlas manualmente.
  - **Archivos:** `src/download.js`, `src/cli.js`, `test/queue.test.js`.

- [x] **1.2 Respetar `userConfig.thumbnail` en `parseOptions`**
  - **Problema:** En `src/args.js`, la propiedad `thumbnail` se evalúa únicamente como `userConfig.minimal ? false : true`. Si el usuario tiene `"thumbnail": false` en su `config.json`, la opción se ignora.
  - **Acción:** Evaluar `thumbnail: userConfig.minimal ? false : (userConfig.thumbnail ?? true)`.
  - **Archivos:** `src/args.js`, `test/args.test.js`.

- [x] **1.3 Blindaje de procesos en Windows (`cmd.exe`)**
  - **Problema:** El flag `{ shell: process.platform === 'win32' }` en `spawnTracked` expone los argumentos a `cmd.exe`. Títulos con `&`, `^` o `%` pueden causar errores de sintaxis o dejar procesos `yt-dlp.exe` huérfanos al cancelar con Ctrl+C.
  - **Acción:** Prescindir de `shell: true` cuando se invocan binarios directos o implementar sanitización estricta y terminación de árbol de procesos (`taskkill /T /F`) en Windows.
  - **Archivos:** `src/process.js`, `src/requirements.js`.

---

### Fase 2: Experiencia de Usuario sin Fricción (CLI UX)
*Objetivo: Hacer que usar la herramienta sea inmediato e intuitivo.*

- [x] **2.1 Despacho inteligente de argumentos (Smart CLI Routing)**
  - **Problema:** Ejecutar `trackcli <URL>`, `trackcli "Artista - Cancion"` o `trackcli lista.txt` arroja `Comando no reconocido. Usa trackcli help`. Exige escribir el subcomando exacto (`download`, `search`, `batch`).
  - **Acción:** Detectar la intención automáticamente en `run(argv)`:
    - Si el argumento es URL HTTP/HTTPS → `executeDownload`.
    - Si es un archivo existente o termina en `.txt` → `executeBatch`.
    - Si es texto libre → `executeSearch` o `executeSearchInteractive`.
    - Mantener los comandos explícitos (`search`, `download`, `batch`) para scripts o usuarios avanzados.
  - **Archivos:** `src/cli.js`, `test/cli.test.js`.

- [x] **2.2 Modo interactivo continuo (`guidedMode`)**
  - **Problema:** Al descargar múltiples canciones en la misma sesión, el CLI vuelve a solicitar el formato y la carpeta de destino en cada vuelta del bucle.
  - **Acción:** Preguntar formato y carpeta solo en la primera pista (o tomar la configuración guardada por defecto) y en las siguientes iteraciones pedir directamente la canción/enlace, permitiendo un flujo rápido.
  - **Archivos:** `src/cli.js`.

---

### Fase 3: Organización de Archivos y Metadatos en Disco
*Objetivo: Que los archivos descargados queden ordenados y listos para cualquier reproductor musical.*

- [x] **3.1 Subcarpetas automáticas y numeración de pistas para álbumes**
  - **Problema:** Al descargar un álbum completo de Spotify o Apple Music, todas las pistas se guardan en la raíz de `trackcli-downloads/` con el nombre de YouTube. Si se bajan dos álbumes, se mezclan 30 canciones desordenadas.
  - **Acción:**
    - Crear automáticamente la subcarpeta: `[Destino]/[Artista] - [Álbum]/`.
    - Nombrar las pistas anteponiendo el número con ceros a la izquierda: `01 - [Título].mp3`, `02 - [Título].mp3`.
    - Preservar el orden de reproducción original en reproductores locales de móvil, coche o computadora.
  - **Archivos:** `src/args.js`, `src/download.js`, `src/cli.js`.

- [x] **3.2 Prevención de colisiones de nombres**
  - **Problema:** Usar exclusivamente `%(title)s.%(ext)s` provoca que canciones con títulos genéricos (ej. "Intro", "Stay", "Home") de distintos artistas colisionen y se omitan como `(ya existe)`.
  - **Acción:** Estructurar el nombre predeterminado como `[Artista] - [Título].ext` cuando se cuente con metadatos.
  - **Archivos:** `src/args.js`.

---

### Fase 4: Resiliencia de Red y Prevención de Bloqueos
*Objetivo: Evitar que la herramienta falle ante verificaciones de bot o restricciones de YouTube.*

- [x] **4.1 Soporte de Cookies contra verificaciones de bot en YouTube**
  - **Problema:** YouTube frecuentemente arroja *"Sign in to confirm you're not a bot"* o HTTP 403 a conexiones concurrentes o IPs residenciales.
  - **Acción:**
    - Soportar flags `--cookies-from-browser <navegador>` y `--cookies <archivo>`.
    - Permitir persistir el navegador preferido: `trackcli config set cookies-browser chrome`.
    - Pasar el argumento a `yt-dlp` solo cuando esté configurado.
  - **Archivos:** `src/args.js`, `src/config.js`, `src/cli.js`.

---

## 📊 Matriz de Prioridad vs. Esfuerzo

| Tarea | Impacto | Esfuerzo | Prioridad |
| :--- | :---: | :---: | :---: |
| **1.1 Transparencia en lotes** | Alto | Bajo | Inmediata |
| **2.1 Smart CLI Dispatch** | Alto | Bajo | Inmediata |
| **3.1 Subcarpetas para álbumes** | Alto | Medio | Alta |
| **1.2 Respetar `userConfig.thumbnail`** | Medio | Muy bajo | Alta |
| **2.2 Modo interactivo fluido** | Medio | Bajo | Media |
| **4.1 Soporte de Cookies** | Alto | Medio | Media |
| **1.3 Robustez en Windows** | Medio | Medio | Media |

---

## 📌 Historial de Decisiones Técnicas (ADR)

* **¿Por qué NO dar soporte a formato FLAC?**  
  *Decisión:* Rechazado conscientemente.  
  *Motivo:* YouTube entrega audio comprimido lossy (Opus a ~160kbps o AAC a ~128kbps). Ofrecer FLAC generaría una transcodificación que infla el archivo de 5 a 10 veces de tamaño sin aportar ni un bit extra de fidelidad acústica. TrackCLI es una herramienta honesta y evita el "placebo audiófilo".
