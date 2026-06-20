# Tauri-композитор на Vello — архитектура

## Цель
Заменить веб-композитор (PixiJS + WebCodecs в video-core worker) на нативный Rust-композитор
в Tauri-сборке. Веб-сборка продолжает использовать старое ядро без изменений.

Разделение:
- **Web** → `src/workers/video-core.worker.ts` + `src/utils/video-editor/VideoCompositor.ts` (Pixi).
- **Tauri** → `src-tauri/src/compositor` (Vello) + `src-tauri/src/media` (декод).

Точка переключения — `src/utils/video-backend/index.ts` (`getVideoBackend()`).

## Текущий native parity

Нативная Tauri-сцена теперь собирается через общий payload builder:
`src/utils/native-monitor-scene.ts`. Это важно для совпадения preview, thumbnail и export
с веб-движком по базовой семантике таймлайна:

- video/image/svg/text/shape/background/adjustment слои;
- nested timelines через тот же resolver, что и web/export worker;
- opacity, blend mode (все 17), transform, crop, source orientation;
- video speed, reverse video и freeze frame;
- видео-эффекты (общий `shared/effects/effect.wgsl`, спек `VideoEffectSpec` генерится из Rust)
  и переходы (канонические шейдеры находятся в `shared/transitions/*.wgsl`, а манифесты
  передают те же исходники в native через `custom-wgsl`);
- audio clips с gain, balance, fade in/out, solo/mute и отдельной master audio bus gain;
- native export может muxить нативный офлайн-аудиомикс, если проект не требует неподдержанных
  визуальных или аудио-возможностей.

Web и native — это два полностью отдельных конвейера (выбор по `isTauriRuntime()`), которые
обязаны совпадать по фичам. Web-путь работает строго через WebGPU (Pixi-filter путь удалён;
эффекты считает `WebGpuComputeRunner`), native — через wgpu/vello.

Реально остаются **web-only** (намеренно не перенесено в native): masks, HUD и audio reverse.
В native-сцене они просто не строятся.

Замечание по сопровождению: разбиение эффектов на GPU-пассы написано вручную дважды —
`src/utils/video-editor/compositor/WebGpuComputeRunner.ts` (`buildPasses`) и
`src-tauri/src/compositor/effects/mod.rs` (`build_passes`). Они должны оставаться идентичными
байт-в-байт (клампы, порядок пассов, упаковка uniform'ов); при правке одной стороны правь и вторую.

## Файловая структура

### Rust (src-tauri/src)
```
compositor/
  mod.rs              — модуль и Compositor reexport
  compositor.rs       — главный объект (wgpu device + vello renderer)
  gpu/mod.rs          — GpuContext: instance/adapter/device/queue
  scene/mod.rs        — доменная Scene, Layer, Transform, BlendMode, Mask
  layers/mod.rs       — типы слоёв: VideoFrame, Image, Shape, Svg, Text, Group
  effects/
    mod.rs            — EffectSpec enum
    runtime.rs        — EffectPipeline (применение через wgpu render passes)
  transitions/mod.rs  — TransitionSpec + TransitionPipeline
  text/mod.rs         — parley layout -> vello glyph runs
  svg/mod.rs          — vello_svg адаптер
media/
  mod.rs              — описание pipeline
  decode.rs           — VideoDecoder trait, MediaInfo, VideoFrame (скелет)
  frame_cache.rs      — LRU кэш GPU-текстур кадров
engine/
  mod.rs              — VideoEngine: Compositor + FrameCache (singleton через tauri::State)
ipc/
  mod.rs
  compositor_cmd.rs   — tauri commands: compositor_render_frame, media_open
```

### Frontend (src/utils/video-backend)
```
index.ts   — getVideoBackend() — runtime-выбор web vs tauri
types.ts   — Scene/Layer/EffectSpec/TransitionSpec — TS зеркало Rust-структур
tauri.ts   — Tauri-реализация (invoke к Rust)
web.ts    — Web-обёртка над старым ядром (пока заглушка)
```

## Как использовать с фронта
```ts
import { getVideoBackend } from '~/utils/video-backend';

const backend = await getVideoBackend();
const info = await backend.openMedia('/path/to/clip.mp4');
const frame = await backend.renderFrame(scene);
```
`tauri.ts` динамически импортируется только в Tauri-рантайме — `web.ts` не утянет `@tauri-apps/api`,
и наоборот: `web.ts` НЕ импортирует старый `VideoCompositor`, поэтому в Tauri-бандле его не будет
(если все вызовы переведены через `getVideoBackend`).

### План миграции вызовов (TODO)
1. Монитор: `src/composables/monitor/useMonitorCore.compositor.ts` → дергает `getVideoBackend().renderFrame()`
   вместо прямого `new VideoCompositor()`.
2. Превью: `src/composables/preview/*` → то же.
3. Экспорт: `src/workers/core/export.ts` — отдельная команда `compositor_export_*` на Rust.
4. После миграции — `import('./web')` упадёт в no-op в Tauri-сборке (Vite per-build code-split).

---

## Ответы на вопросы

### 1) FFmpeg или GStreamer для экспорта (и GPU, особенно на Linux)?

**Бери FFmpeg (через `ffmpeg-next` crate).** Причины:

| | FFmpeg | GStreamer |
|---|---|---|
| Поддержка кодеков | максимум, эталон | хорошо, но через плагины |
| GPU на Linux | VAAPI ✓, NVENC/NVDEC ✓, Vulkan ✓ (h264_vulkan, hevc_vulkan с 6.0) | VAAPI ✓ (gstreamer-vaapi), NVENC ✓ (nvcodecplugin) |
| GPU на macOS | VideoToolbox ✓ | VideoToolbox ✓ (vtenc/vtdec) |
| GPU на Windows | D3D11VA, NVENC, AMF, QuickSync ✓ | D3D11, NVENC ✓ |
| Зависимости/сборка | один libavcodec + флаги | много `.so`, плагины, GLib runtime |
| Bundling в .deb/.rpm | проще (статика или dlopen) | тащит GStreamer стек целиком (десятки пакетов) |
| API в Rust | `ffmpeg-next` (зрелый, активен) | `gstreamer-rs` (зрелый, но pipeline-based mental model) |
| Pipeline-композитинг | ручной граф фильтров (libavfilter) | мощный graph из коробки |
| Подходит как **бэкенд декодера/энкодера** к нашему собственному композитору | ★★★★★ | ★★★ |
| Подходит как **готовый pipeline editor с микшированием** | ★★★ | ★★★★★ |

Поскольку **композитинг мы делаем сами на Vello+wgpu**, нам не нужны pipeline-возможности GStreamer.
Нам нужен максимально широкий и компактный декод/энкод — это FFmpeg.

**GPU-encoding на Linux:**
- NVIDIA → NVENC (через ffmpeg `h264_nvenc`/`hevc_nvenc`/`av1_nvenc`) — отлично работает на свежих драйверах.
- AMD/Intel → VAAPI (`h264_vaapi`/`hevc_vaapi`/`av1_vaapi`) — на современных Mesa уже стабильно.
- Универсальный fallback: Vulkan Video (с FFmpeg 7.x) — пока экспериментально, но растёт.
- Софт: `libx264` (быстрый baseline), `libx265`, `libsvtav1` (быстрее aom).

Рантайм-стратегия: пробовать NVENC → VAAPI → software (libx264/libsvtav1).

**Не статически линковать FFmpeg.** Лицензия LGPL ок только при динамической линковке (или GPL если включены `--enable-gpl`-компоненты, например libx264). Безопасно: брать `ffmpeg` из системных пакетов (на Linux — зависимость `.deb`/`.rpm` на `ffmpeg`/`libavcodec59` и т.п.), на macOS — bundling динамических .dylib, на Windows — `.dll` рядом с exe.

### 2) Как рендерить картинку в монитор? Битмапы vs пробрасывание surface

Есть три реальных варианта, от худшего к лучшему:

#### A) Pull bitmap → отдать в `<canvas>` (текущий план tauri.ts: base64 PNG)
- **Эффективность:** очень плохая. Encode PNG (CPU!) + base64 (CPU) + IPC (сериализация) + decode в браузере + draw. На 1080p60 — десятки мс на кадр, дропы гарантированы.
- **Когда подходит:** только для разовых preview-снимков.

#### B) Raw RGBA через IPC + put в `<canvas>` (через `ImageData` или `texSubImage2D`)
- Если использовать Tauri **invoke с binary** (или custom URI scheme `asset://frame/<id>`) и пробрасывать сырой буфер RGBA — копия одна, без encode.
- 1080p RGBA = 8.3 МБ × 60fps = 500 МБ/с через IPC. **Слишком много** для invoke (он сериализует через webview bridge).
- Лучше — **custom URI scheme** (`tauri::Builder::register_asynchronous_uri_scheme_protocol`): браузер делает один GET на `frame://<id>`, Tauri отдаёт raw bytes без сериализации. Это работает на 60fps для 1080p при условии, что Rust готовит буфер заранее.
- Можно ускорить ещё: один **SharedArrayBuffer** (если включены COOP/COEP headers) — Rust пишет в shared memory, JS читает без копии. В Tauri 2 настраивается через custom protocol с правильными CORS-заголовками.

#### C) Native overlay surface (zero-copy)
- Tauri умеет создавать **отдельное native окно** (не webview), куда wgpu рендерит напрямую через `raw-window-handle`. Это окно позиционируется поверх области монитора в webview (или окно с прозрачным webview, где monitor — это «дырка» через CSS).
- **Эффективность:** максимум. Нулевые копии, surface рисуется драйвером, webview только обрабатывает UI. На 4K60 работает спокойно.
- **Сложность:** средняя. Нужна синхронизация позиции/размера overlay-окна при ресайзе/скролле панелей; на Linux/Wayland есть нюансы с subsurface'ами.
- В Tauri это делается через `WebviewWindowBuilder` + второе окно, либо через `tao` напрямую. Аналог — что делают Discord (overlay для игр), OBS (preview), DaVinci Resolve.

**Сравнение (1080p60):**

| Подход | Копий/кадр | CPU на кадр | Сложность | Качество |
|---|---|---|---|---|
| A: PNG base64 invoke | 4 (encode, b64, decode, draw) | ~10–30 мс | низкая | работает, но дропы |
| B1: invoke raw RGBA | 3 | ~3–5 мс | низкая | 60fps впритык |
| B2: custom URI scheme RGBA | 2 (copy → GPU upload) | ~1–2 мс | средняя | стабильно 60fps |
| B3: SharedArrayBuffer | 1 (только GPU upload) | <1 мс | средняя | стабильно 60fps+ |
| C: Native overlay surface | 0 (прямой surface) | ~0 | средне-высокая | 4K60 ок |

**Рекомендация поэтапно:**
1. **Сейчас (MVP):** B2 — custom URI scheme отдаёт raw RGBA. Просто, без shared memory, всё ещё быстро.
2. **Для production:** C — native overlay-окно с wgpu surface. Это путь профессиональных видео-редакторов и единственный, который масштабируется до 4K HDR без забот.
3. Между ними B3 как переходный шаг, если C окажется дорогим по времени реализации (особенно из-за Wayland).

Заметка для wasm-таргета: там нативного surface нет — только `<canvas>` с WebGPU, куда wgpu рендерит напрямую через `wgpu::Surface::create_surface_from_canvas`. То есть тот же `Compositor` без изменений умеет рендерить и в native окно, и в canvas — это и есть main bonus от wgpu.
