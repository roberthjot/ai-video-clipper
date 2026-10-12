# Herramienta: Lyric Edits (Estilo Saturn / Rolitas)

## 📌 Descripción General

El modo **Lyric Edits** permite generar videos musicales verticales en formato **9:16 (1080×1920)** con la estética popular de canales de YouTube Shorts / TikTok ("Rolitas", estilo Saturn):
- **Lienzo vertical 9:16 con fondo negro**.
- **Montaje secuencial multi-clip**: Varios clips estéticos oscuros se recortan y concatenan de forma secuencial en una ventana central de `1080×608` (overlay en `y=656`).
- **Subtítulos ASS quemados**: Integración directa con el catálogo completo de 42 estilos de subtítulos dinámicos de `ai-video-clipper`.

---

## 🏗️ Arquitectura Técnica

### 1. Backend (`backend/app/services/lyrics_service.py` y `backend/app/routes/lyrics.py`)
- **Endpoints FastAPI**:
  - `GET /api/lyrics/stock-clips`: Lista los clips estéticos de stock (`backend/app/stock_aesthetic/`).
  - `GET /api/lyrics/demo`: Carga los datos de demostración pre-configurados (ej. *Beéle - La Plena*).
  - `POST /api/lyrics/upload-audio`: Sube un archivo de audio o video y extrae un WAV mono a 16 kHz para Whisper.
  - `POST /api/lyrics/upload-clip`: Permite al usuario subir sus propios videos de fondo personalizados.
  - `POST /api/lyrics/transcribe`: Transcribe el audio con Faster-Whisper, timestamps a nivel de palabra y filtro VAD (`vad_filter=True`).
  - `POST /api/lyrics/render`: Recibe la lista de tarjetas de letra, estilo, tamaño de fuente, offset vertical y clips seleccionados; genera el archivo `.ass` y compila el video con FFmpeg.
  - `GET /api/lyrics/video/{filename}`: Sirve el archivo MP4 generado con soporte para streaming (HTTP 206 Partial Content).

### 2. Generación de Subtítulos ASS (`subtitle_service.py`)
- Soporta **42 estilos visuales**:
  - **Karaoke**: Amarillo, Verde, Azul, Rosa, Rojo, Naranja, Morado, Subrayado.
  - **1 Palabra / Viral (Hormozi / Reels)**: Pop-up (MrBeast), Glitch RGB cromático, Neón Cyan, 3D Magenta, Doble Borde, Gold metálico, Comic Pop, Zoom agresivo, Giro (Spin), Barra negra, Sombra larga, Minimal, Bounce, Big Center, Two-Word.
  - **Cajas**: Highlight amarillo, Cajas de colores (Verde, Azul, Rosa, Roja), Burbuja TikTok (fondo blanco, texto negro), Caja Línea.
  - **Efectos & Retro**: Retro 3D años 80, Neón frase, Typewriter, Vertical Stack, Reveal, Contorno (Hollow).
  - **Clásicos & Limpios**: Estándar Netflix, Limpio, Impact clásico (Saturn), Arial Black Cursiva.
- Conversión `cards_to_words`: Distribuye proporcionalmente la duración de las frases entre sus palabras para alimentar las funciones de animación palabra por palabra de `subtitle_service`.
- Control de posición vertical (`subtitle_y` de `-0.30` a `+0.30`) y escala de tamaño (`font_size`).

### 3. Frontend (`frontend/src/components/LyricsStep.jsx`)
- Selector visual de clips de fondo (clips de stock incluidos + subida de clips propios).
- Catálogo interactivo de 42 estilos de subtítulos con miniaturas dinámicas clasificadas por categoría (*Karaoke*, *Viral*, *Cajas*, *Efectos*, *Clásicos*).
- Controles deslizantes para tamaño de texto y posición vertical (con botones de posición rápida: *Sobre el video - Centro*, *Sobre el video - Abajo*, *Banda negra inferior*).
- Editor de tarjetas de letra sincronizadas con tiempos de inicio y fin editables.
- Botones de micro-ajuste rápido de sincronización global: **`-0.2s`** y **`+0.2s`**.
- Reproductor de vista previa con cache-busting automático para reflejar el render más reciente sin problemas de caché del navegador.

---

## ⚠️ Diagnóstico de Sincronización y Reconocimiento de Letras

### Estado Actual:
- **Modelos de lenguaje tradicionales en música**: Faster-Whisper (`base`) fue entrenado principalmente sobre habla conversacional (podcasts, conferencias, audiolibros).
- En pistas musicales comerciales con autotune, mezclas cargadas de bajos/batería o cadencias rápidas (ej. reggaeton, trap, slang caribeño), Whisper puede:
  1. Omitir palabras o confundir fonemas con slang local.
  2. Tener pequeños desfases de 0.2s - 0.5s debido a la reverberación y la música de fondo.

### Herramientas de Mitigación Implementadas:
1. **Filtro VAD (`vad_filter=True`)**: Activa Silero VAD para asegurar que Whisper detecte los límites de actividad vocal reales y no alucine durante silencios o instrumentales.
2. **Botones de Micro-Ajuste Global (`-0.2s` / `+0.2s`)**: Permiten adelantar o atrasar todas las tarjetas en bloque con un solo clic.
3. **Edición manual directa**: Cada tarjeta permite cambiar el texto y ajustar numéricamente los segundos de inicio y fin.

### 🚀 Mejoras Futuras Planificadas:
1. **Alineación Forzada (Forced Alignment)**: Permitir al usuario pegar la letra oficial exacta en texto; un modelo de alineación fonética (CTC / wav2vec2 / Whisper-alignment) ancla el texto oficial directamente a los formantes vocales del audio, garantizando 100% de precisión ortográfica y métrica.
2. **Separación de Pistas Vocales (Demucs / UVR)**: Aislar la pista acapella antes de pasarla a Whisper para eliminar la interferencia de los instrumentos y ritmos fuertes.
