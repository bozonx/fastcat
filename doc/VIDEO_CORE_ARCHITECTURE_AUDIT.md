# Аудит архитектуры видео ядра (Tauri-версия)

**Дата:** 2026-06-03  
**Область:** `src-tauri/src/`, `src/workers/`, `src/utils/video-editor/`, `src/timeline/`, `src/stores/timeline/`, `src/media-cache/`, `src/file-manager/`, `src/utils/io/`, `src/effects/`  
**Автор:** Antigravity AI

---

## Резюме

Архитектура видео ядра в Tauri-версии представляет собой **гибридную систему с двумя независимыми путями рендеринга**:
- **Web-путь**: PixiJS v8 (WebGL/WebGPU) в dedicated Web Worker + mediabunny (WebCodecs)
- **Tauri-путь**: Vello + wgpu в нативном Rust-потоке + ffmpeg-next (libav)

Это архитектурное раздвоение — главный источник сложности. Оба пути имеют существенные проблемы производительности, плохие практики и узкие места. Ниже приведён детальный разбор.

---

## 1. Критические архитектурные проблемы

### 1.1. Дублирование видео-ядер: Web vs Tauri divergence 🔴

**Проблема:** Два совершенно разных конвейера рендеринга:
- **Web**: `VideoCompositor` (PixiJS) в `video-core.worker.ts`
- **Tauri**: `Compositor` (Vello/wgpu) в `src-tauri/src/compositor/compositor.rs`

**Последствия:**
- Удвоение площади тестирования
- Различия в поведении эффектов, переходов, текстового рендера
- `isTauriRuntime()` разветвляет логику в десятках мест (`effects/core/registry.ts`, `transitions/core/registry.ts`, `useMonitorCore.compositor.ts`)
- Баги, воспроизводимые только в одном режиме

**Рекомендация:** Выбрать единый рендерер для обоих режимов (например, везде использовать wgpu через Rust с canvas stream в web) либо строго изолировать divergence на уровне единого адаптера.

### 1.2. Монолитные God-objects 🔴

| Файл | Строк | Обязанности |
|------|-------|-------------|
| `src/workers/video-core.worker.ts` | 903 | Превью, экспорт, транскод, thumbnails, frame extraction, audio extraction, RPC-диспетчер |
| `src/utils/video-editor/VideoCompositor.ts` | 863 | Рендеринг, декодинг, кэширование, эффекты, переходы, layout |
| `src/workers/core/AudioMixer.ts` | 1363 | Offline микширование, эффекты, resample, stretch, crossfade |
| `src/stores/timeline.store.ts` | 848 | 30+ полей, 12 модулей, ручное управление циклическими зависимостями |

**Последствия:**
- Невозможно тестировать изолированно
- Сложность рефакторинга экспоненциально растёт
- Merge-конфликты

### 1.3. Дублирование runtime-данных таймлайна 🔴

Данные таймлайна хранятся минимум в **4 независимых местах**:
1. `timelineDoc` (Pinia store) — "источник правды"
2. `workerTimelineClips` / `workerAudioClips` — подготовленные для worker
3. `VideoCompositor.clips` + `TrackRuntimeManager` — внутри worker
4. `AudioEngine.currentClips` — в main thread

Синхронизация через сигнатуры (`clipSourceSignature`, `clipLayoutSignature`) и debounced watchers — это **eventual consistency**, а не строгая синхронизация. Возможны race conditions при быстрых операциях.

### 1.4. Сериализация всех операций композитора 🔴

**Файл:** `src/utils/video-editor/compositor/CompositorOperationQueue.ts`

```ts
public run<T>(fn: (signal: AbortSignal) => Promise<T> | T): Promise<T> {
  const result = this.queue.then(run, run);
  this.queue = result.then(() => undefined, () => undefined);
  return result;
}
```

Все операции (render, load, update, clear) сериализуются через единую цепочку Promise. При частом scrubbing'е или тяжёлых timeline update операция render встаёт в очередь и ждёт. Watchdog (15 сек) лечит симптом, а не причину.

---

## 2. Проблемы производительности

### 2.1. Tauri / Rust ядро

#### 2.1.1. Синхронный GPU readback блокирует event loop 🔴
**Файл:** `src-tauri/src/compositor/compositor.rs:586-594`

```rust
slice.map_async(wgpu::MapMode::Read, move |r| { let _ = tx.send(r); });
device.poll(wgpu::PollType::wait_indefinitely()).ok();
rx.recv().map_err(...)?;
```

В Canvas-режиме (stream RGBA в JS) и thumbnail-рендере каждый кадр выполняет **блокирующий CPU poll + recv** в потоке winit event loop. На 1080p это 1-5 мс, что съедает значительную часть бюджета 60fps (16.6 мс).

**Рекомендация:** Двойная буферизация readback + async callback-интеграция с `about_to_wait` winit.

#### 2.1.2. Аллокации GPU-текстур на каждый кадр 🔴
**Файлы:** `compositor.rs:300-304`, `compositor.rs:330-334`

```rust
// Transition: новая текстура
layers[i].kind = LayerKind::Raster {
    source: RasterSource::GpuTexture(std::sync::Arc::new(processed)),
};

// Effects: новая текстура
next.kind = LayerKind::Raster {
    source: RasterSource::GpuTexture(std::sync::Arc::new(processed)),
};
```

`apply_transition` и `apply_effects` создают **новую `wgpu::Texture`** на каждый кадр для каждого слоя с эффектом/переходом. При 10 слоях с blur/bloom — десятки аллокаций GPU-памяти на кадр.

**Рекомендация:** Пул текстур (texture pool / render target cache) с reuse по размеру.

#### 2.1.3. Отсутствие zero-copy видео декодинга 🟡
Preview-путь теперь избегает полного CPU RGBA для поддерживаемых 8-bit 4:2:0 кадров: `ffmpeg-next` отдаёт NV12-style Y/UV planes, `decode_thread` грузит их как `R8Unorm`/`Rg8Unorm`, а `compositor::yuv` конвертирует YUV→RGBA на GPU перед существующим Vello texture path. Это всё ещё не zero-copy HW decode: неподдерживаемые форматы и export остаются на RGBA fallback.

Для профилирования native compositor можно запускать приложение с `FASTCAT_RENDER_TIMING=1`; Rust-ядро будет логировать stage timings для `materialize`, `build_vello`, `render` и total.

**Рекомендация:** Интеграция HW-decode (VAAPI/VideoToolbox/D3D11) с `wgpu::Texture` напрямую.

#### 2.1.4. Busy-polling в аудио-производителе 🟡
**Файл:** `src-tauri/src/audio/engine.rs:374`

```rust
std::thread::sleep(Duration::from_millis(8));
```

Producer thread спит фиксированные 8 мс при недостатке данных. Это даёт jitter в latency и не оптимально по CPU.

**Рекомендация:** Использовать `Condvar` или `crossbeam-channel` для пробуждения producer'а при необходимости.

#### 2.1.5. Синхронный seek через убийство процесса 🟡
`FfmpegCliDecoder::seek` убивает и пересоздаёт процесс `ffmpeg`. При частом скрабе — дорого.

#### 2.1.6. Отсутствие pipeline cache в Vello 🟢
`RendererOptions { pipeline_cache: None }` — Vello перекомпилирует WGSL шейдеры с нуля при каждом старте.

---

### 2.2. Web Workers / Композитор

#### 2.2.1. Inline video decode блокирует GPU 🔴
**Файл:** `src/utils/video-editor/compositor/TransitionRenderer.ts:231-362`

```ts
// Внутри render loop:
sample = await params.getVideoSampleForClip({ clip, sampleTimeS: ... });
```

`renderTransitionClipToTexture` вызывает асинхронный `getVideoSampleForClip` прямо внутри render loop. Пока mediabunny декодит кадр, GPU простаивает.

**Рекомендация:** Предварительная декодинг кадров для transitions в отдельной очереди, до начала render frame.

#### 2.2.2. Adjustment clips = полный re-render на каждый кадр 🔴
**Файл:** `src/utils/video-editor/compositor/StageTextureRenderer.ts:155-180`

```ts
public renderLowerLayersToTexture(layer: number, texture: RenderTexture) {
  // На каждый кадр: рендерит ВСЕ нижележащие слои в текстуру
}
```

Каждый adjustment clip требует `renderLowerLayersToTexture()` на **каждый кадр**. При частом использовании adjustment clips GPU делает полный rerender stage многократно.

**Рекомендация:** Кэшировать результат `renderLowerLayersToTexture` пока нижележащие слои не изменились.

#### 2.2.3. Memory bloat transition textures 🔴
До 4 `RenderTexture` на клип (`transitionFromTexture`, `transitionToTexture`, `transitionOutputTexture`, `transitionCombinedTexture`). Полный кадр 1920×1080 × 4 байт ≈ 8 МБ каждая. При 10 клипах с transitions — ~320 МБ GPU памяти. **Нет пула текстур**.

#### 2.2.4. CPU-интенсивное ожидание encode queue 🔴
**Файл:** `src/workers/core/export.ts:239-245`

```ts
while (Number(videoSource?.encodeQueueSize ?? 0) >= maxQueueSize) {
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
}
```

Active polling с `setTimeout(..., 0)` — это busy-wait, который жрёт CPU.

**Рекомендация:** Использовать события `VideoEncoder` (`encodeQueueSize` + `requestAnimationFrame` или callback-based backpressure).

#### 2.2.5. Создание нового VideoCompositor для экспорта 🟡
**Файл:** `src/workers/core/export.ts:609`

```ts
const localCompositor = options.videoCodec !== 'none' ? new VideoCompositor() : null;
```

Для экспорта создаётся **новый** `VideoCompositor` с полной инициализацией PixiJS. Это дорого.

#### 2.2.6. FrameExtractor кэш без TTL 🟡
**Файл:** `src/workers/video-core.worker.ts:657`

`frameExtractors` Map хранит состояние декодеров между вызовами (`keepAlive`), но нет явного ограничения по памяти или времени жизни.

#### 2.2.7. Audio decode concurrency bottleneck 🟡
`maxGlobalDecodeSlots = 2` — консервативно. При большом количестве клипов на таймлайне — bottleneck.

---

### 2.3. Таймлайн / State Management

#### 2.3.1. O(N) операции в hot path 🔴
**Файл:** `src/stores/timeline/dispatcher.ts`

`selectTimelineDurationUs` — полный обход всех треков и айтемов при **каждой команде** (вызывается из dispatcher). `itemToTrackMap` пересоздаётся при каждом обращении через `computed`.

#### 2.3.2. Глубокое клонирование документа 🔴
Каждая команда создаёт новый `TimelineDocument` через spread-операторы. Для длинных таймлайнов (100+ клипов) — дорого. **Отсутствует structural sharing** (immer или подобное).

**Рекомендация:** Использовать Immer или ручное structural sharing для массивов/объектов, которые не изменились.

---

### 2.4. I/O и файловая система

#### 2.4.1. OPFS copyFile читает весь файл в память 🔴
**Файл:** `src/file-manager/core/vfs/opfs.adapter.ts:468`

```ts
const sourceFile = await this.getFile(sourcePath);
// ... затем writeStream
```

Для файлов в несколько гигабайт — OOM.

**Рекомендация:** `readStream → writeStream` без промежуточного `getFile()`/`Blob`.

#### 2.4.2. BloggerDog adapter не поддерживает streaming 🔴
`writeStream` throws `VfsUnsupportedError`. Большие файлы загружаются целиком.

#### 2.4.3. Последовательная очистка vector cache 🟡
**Файл:** `src/media-cache/application/vectorImageCache.ts`

Цикл `for...of` с `await` — при большом количестве файлов блокирует event loop.

---

## 3. Плохие практики и код

### 3.1. Глобальные мутации и полифиллы

#### 3.1.1. Подмена глобальных объектов
- `DOMAdapter.set(WebWorkerAdapter)` — глобальная мутация PixiJS в воркере
- `self.fetch = ...` в STT воркере (`stt.worker.ts:22-81`) — глобальная подмена fetch для ONNX-моделей

**Риск:** Влияние на другие библиотеки в том же контексте, сложность отладки.

#### 3.1.2. Monkey-patch mediabunny
**Файл:** `src/workers/core/transcode.ts:96-102`

```ts
// Workaround for MKV rotation metadata
const originalAddVideoTrack = output.addVideoTrack.bind(output);
(output as any).addVideoTrack = function (track: unknown) { ... }
```

Хрупкое решение, завязанное на внутреннюю реализацию mediabunny. При обновлении библиотеки сломается.

### 3.2. `unsafe` в Rust без достаточной изоляции

**Файл:** `src-tauri/src/media/decode.rs`

```rust
unsafe impl Send for FfmpegNextDecoder {}
```

Хотя обосновано комментарием ("move'ится целиком в один поток"), это нарушает контракт компилятора. Любое будущее изменение, добавляющее shared state, создаст data race.

### 3.3. Чрезмерное использование `any`

Интеграция с mediabunny требует частых `as any` / `// eslint-disable-next-line @typescript-eslint/no-explicit-any`. Распространено по `export.ts`, `transcode.ts`, `audio.ts`. Это скрывает runtime-ошибки.

### 3.4. Синхронный Mutex для read-only данных

**Файл:** `src-tauri/src/lib.rs` (state)

```rust
std::sync::Mutex<FfmpegHardwareSettings>
```

Каждая media-команда берёт `Mutex` для read-only доступа. При высокой нагрузке — ненужная контенция. Следует использовать `RwLock` или `Arc<Settings>`.

### 3.5. Кастомный Semaphore вместо готовых примитивов

**Файл:** `src-tauri/src/media/decode_gate.rs`

Кастомный `Semaphore` на `Condvar` + `Mutex` вместо `tokio::sync::Semaphore` или `std::sync::Semaphore` (стабильный с Rust 1.68+). Работает, но увеличивает площадь собственного кода, которую нужно поддерживать.

---

## 4. Архитектурные anti-patterns

### 4.1. Eventual consistency вместо strict sync

Синхронизация между main thread, worker'ами и Rust-бекендом происходит через:
- Debounced watchers (Vue `watch`)
- RPC с таймаутом 30 сек
- Generation counters (Rust) / Signatures (JS)

Это создаёт окна, в которых состояние различных подсистем расходится.

### 4.2. Fallback chain вместо graceful degradation

**Файл:** `src/workers/core/export.ts:810-831`

```ts
try {
  await runExportWithHardwareAcceleration('prefer-hardware', true);
} catch {
  try {
    await runExportWithHardwareAcceleration('prefer-hardware', false);
  } catch {
    await runExportWithHardwareAcceleration('prefer-software', false);
  }
}
```

Проблемы накапливаются и взрываются в самом конце. Пользователь ждёт, пока система трижды провалится.

### 4.3. Отключение аудио в Tauri-режиме

В Tauri аудио полностью отключено (`audioOutputDisabled = true`), но master-clock в web-части продолжает работать на wall-clock без синхронизации с нативным аудио. Это создаёт рассинхронизацию между UI и фактическим воспроизведением.

### 4.4. Ручное управление видимостью вместо сцены

**Файл:** `src/utils/video-editor/compositor/StageTextureRenderer.ts:103-153`

```ts
const stagePrev = stageChildren.map((child) => child.visible);
for (...) { child.visible = track?.id === clip.trackId; }
// render
try { ... } finally {
  for (...) { child.visible = stagePrev[i]; }
}
```

Вместо построения изолированной сцены для рендера код мутирует глобальное состояние видимости и восстанавливает его в `finally`. Это хрупко: при исключении в середине — состояние stage остаётся испорченным.

---

## 5. Потенциальные утечки памяти

### 5.1. VideoFrameCache underestimation
**Файл:** `src/utils/video-editor/compositor/VideoFrameCache.ts:188-202`

```ts
return codedWidth * codedHeight * 4;
```

Упрощённая формула. Реальное потребление GPU-памяти может быть выше (alignment, YUV→RGBA). LRU eviction может происходить позже, чем нужно.

### 5.2. Context lost = full cache wipe
При `webglcontextrestored` очищается весь `videoFrameCache`, все text/shape помечаются dirty. На мобильных — частые перезагрузки.

### 5.3. Slot watchdog не force-releases
**Файл:** `src/utils/io/slot-watchdog.ts`

Только warn, не force-release. При exception без `finally` пул I/O застрянет навсегда.

---

## 6. Приоритезация рекомендаций

### P0 — Критический (блокирует масштабирование)
1. **Пул GPU-текстур** в Rust compositor (вместо `Arc::new(processed)` на каждый кадр)
2. **Async GPU readback** в Rust (вынести из winit loop)
3. **Zero-copy video decode** (HW-decode → wgpu Texture)
4. **Inline decode в TransitionRenderer** (предварительный декодинг)
5. **OPFS copyFile streaming** (readStream → writeStream)

### P1 — Высокий (заметное влияние на UX)
6. **Structural sharing** для TimelineDocument (Immer)
7. **Кэширование adjustment clips** (не рендерить lower layers каждый кадр)
8. **Разделение video-core.worker.ts** на отдельные специализированные воркеры
9. **Унификация рендерера** Web/Tauri (или строгая изоляция divergence)
10. **Busy-polling в audio producer** → Condvar / channel

### P2 — Средний (технический долг)
11. **O(N) селекторы** → memoization / инкрементальные обновления
12. **Encode queue polling** → callback-based backpressure
13. **Pipeline cache** для Vello
14. **Убрать `unsafe impl Send`** или изолировать в `Arc<Mutex<...>>`
15. **Заменить `Mutex<FfmpegHardwareSettings>`** на `RwLock` или `Arc`

### P3 — Низкий (улучшения)
16. **Slot watchdog force-release** после экстремального таймаута
17. **VectorImageCache parallel cleanup**
18. **TypeScript strict types** для mediabunny интеграции
19. **Убрать глобальные мутации** (`DOMAdapter.set`, `self.fetch`)

---

## 7. Вывод

Архитектура видео ядра **функциональна и в некоторых местах продумана** (I/O Governor с SAB, поколенческая инвалидация кадров, bounded queues, graceful fallback chains). Однако она страдает от **фундаментального раздвоения** (Web vs Tauri) и **монолитности ключевых компонентов**.

Главные риски:
- **GPU memory thrashing** в Rust (аллокации на каждый кадр)
- **Блокировка event loop** синхронным readback
- **GPU простой** из-за inline decode в transitions
- **O(N) hot paths** в таймлайне
- **OOM при копировании** больших файлов в OPFS

При росте нагрузки (4K, множество слоёв, 60fps) эти проблемы станут критическими.
