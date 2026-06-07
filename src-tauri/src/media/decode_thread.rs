//! Background decoder thread: owns the `VideoDecoder` and pushes decoded frames into a
//! bounded queue. The monitor event-loop only pulls frames — no blocking IO on the UI thread.
//!
//! Seek contract:
//!   - The consumer calls `seek(t)`. Internally the generation counter is incremented and a
//!     command is sent to the decoder thread.
//!   - Frames already in the queue tagged with the old generation are discarded by the consumer.
//!
//! Guarantee: after `seek(t)` every frame that reaches the consumer has PTS >= t
//! (within a tolerance of 1/2 * 1/fps).

use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, SyncSender, TryRecvError};
use std::sync::Arc;

use parking_lot::Mutex;
use std::thread::JoinHandle;

use anyhow::{anyhow, Context, Result};

use super::decode::{FfmpegNextDecoderFactory, MediaInfo, VideoDecoderFactory, VideoFrame};
use super::types::HwAccelMode;

// Размер очереди декодированных кадров. Каждый кадр = ширина × высота × 4 байта.
// Для 1080×1920 это ~8 МБ/кадр, так что 2 = 16 МБ буфера на слой — достаточно для smooth
// playback (всегда есть `current` + 1 `upcoming` для lookahead) и не раздувает память.
const QUEUE_CAPACITY: usize = 2;

pub struct DecodedFrameMsg {
    pub generation: u64,
    pub frame: VideoFrame,
}

enum DecoderCmd {
    Play,
    Pause,
    Seek { generation: u64, time_sec: f64 },
    Stop,
}

pub struct DecodePump {
    pub info: MediaInfo,
    rx: Receiver<DecodedFrameMsg>,
    cmd_tx: Sender<DecoderCmd>,
    generation: Arc<AtomicU64>,
    thread: Option<JoinHandle<()>>,
}

impl DecodePump {
    /// `max_output_long_edge` — кап на длинную сторону декодированного кадра в пикселях.
    /// Прокидывается в ffmpeg `-vf scale`. `None` = декод в нативе.
    pub fn open(
        path: &Path,
        max_output_long_edge: Option<u32>,
        on_frame_decoded: Option<Box<dyn Fn() + Send + Sync + 'static>>,
        device: Option<wgpu::Device>,
        queue: Option<wgpu::Queue>,
        hw_mode: HwAccelMode,
        vaapi_device: Option<&str>,
    ) -> Result<Self> {
        Self::open_with_factory(
            path,
            max_output_long_edge,
            on_frame_decoded,
            device,
            queue,
            hw_mode,
            vaapi_device,
            &FfmpegNextDecoderFactory,
        )
    }

    pub fn open_with_factory(
        path: &Path,
        max_output_long_edge: Option<u32>,
        on_frame_decoded: Option<Box<dyn Fn() + Send + Sync + 'static>>,
        device: Option<wgpu::Device>,
        queue: Option<wgpu::Queue>,
        hw_mode: HwAccelMode,
        vaapi_device: Option<&str>,
        factory: &dyn VideoDecoderFactory,
    ) -> Result<Self> {
        let decoder = factory.open(path, max_output_long_edge, hw_mode, vaapi_device)?;
        let info = decoder.info().clone();

        let (frame_tx, frame_rx) = mpsc::sync_channel::<DecodedFrameMsg>(QUEUE_CAPACITY);
        // Маленькая command-очередь: seek/stop. sync_channel(1) — чтобы consumer не уехал
        // вперёд с пачкой seek'ов; ему достаточно знать про самый свежий.
        let (cmd_tx, cmd_rx) = mpsc::channel::<DecoderCmd>();
        let generation = Arc::new(AtomicU64::new(0));
        let gen_in_thread = generation.clone();
        let path_str = path.display().to_string();
        #[allow(clippy::type_complexity)]
        let texture_pool: Arc<Mutex<HashMap<(u32, u32), Vec<wgpu::Texture>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let texture_pool_thread = texture_pool.clone();

        let thread = std::thread::Builder::new()
            .name(format!("fastcat-decode:{}", path_str))
            .spawn(move || {
                run_decoder_loop(
                    decoder,
                    frame_tx,
                    cmd_rx,
                    gen_in_thread,
                    on_frame_decoded,
                    device,
                    queue,
                    texture_pool_thread,
                );
            })
            .context("spawn decoder thread")?;

        Ok(Self {
            info,
            rx: frame_rx,
            cmd_tx,
            generation,
            thread: Some(thread),
        })
    }

    pub fn play(&self) -> Result<()> {
        self.cmd_tx
            .send(DecoderCmd::Play)
            .map_err(|_| anyhow!("decoder thread is gone"))
    }

    pub fn pause(&self) -> Result<()> {
        self.cmd_tx
            .send(DecoderCmd::Pause)
            .map_err(|_| anyhow!("decoder thread is gone"))
    }

    /// Returns the generation that all future frames will have.
    pub fn seek(&self, time_sec: f64) -> Result<u64> {
        let gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.cmd_tx
            .send(DecoderCmd::Seek {
                generation: gen,
                time_sec,
            })
            .map_err(|_| anyhow!("decoder thread is gone"))?;
        Ok(gen)
    }

    pub fn current_generation(&self) -> u64 {
        self.generation.load(Ordering::SeqCst)
    }

    /// Неблокирующий приём одного кадра из декодера.
    /// `None` — канал пуст или декодер завершился.
    pub fn try_recv_frame(&self) -> Option<DecodedFrameMsg> {
        match self.rx.try_recv() {
            Ok(msg) => Some(msg),
            Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => None,
        }
    }
}

impl Drop for DecodePump {
    fn drop(&mut self) {
        // ВАЖНО: дропаем frame receiver ДО join'а потока. Иначе:
        // - sync_channel frame_tx может блокировать decoder-поток в `send()` (очередь полна);
        // - decoder проверяет cmd_rx только между send'ами → Stop команду не увидит;
        // - handle.join() ждёт поток вечно;
        // - self.rx автодропается только после возврата из fn drop → deadlock.
        // Меняем self.rx на dummy receiver — оригинальный rx моментально дропается,
        // frame_tx.send() в decoder возвращает Err, поток выходит, join завершается.
        let (_dummy_tx, dummy_rx) = mpsc::sync_channel::<DecodedFrameMsg>(0);
        let _ = std::mem::replace(&mut self.rx, dummy_rx);
        let _ = self.cmd_tx.send(DecoderCmd::Stop);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

#[allow(clippy::type_complexity)]
fn run_decoder_loop(
    mut decoder: Box<dyn super::decode::VideoDecoder>,
    frame_tx: SyncSender<DecodedFrameMsg>,
    cmd_rx: Receiver<DecoderCmd>,
    gen: Arc<AtomicU64>,
    on_frame_decoded: Option<Box<dyn Fn() + Send + Sync + 'static>>,
    device: Option<wgpu::Device>,
    queue: Option<wgpu::Queue>,
    texture_pool: Arc<Mutex<HashMap<(u32, u32), Vec<wgpu::Texture>>>>,
) {
    let mut playing = false;
    let mut decoded_after_seek = false;
    let mut current_gen = gen.load(Ordering::SeqCst);
    let mut at_eof = false;

    loop {
        // 1) Обработать все накопившиеся команды.
        let mut latest_seek = None;
        let mut stop = false;

        loop {
            match cmd_rx.try_recv() {
                Ok(DecoderCmd::Seek {
                    generation,
                    time_sec,
                }) => {
                    latest_seek = Some((generation, time_sec));
                }
                Ok(DecoderCmd::Play) => {
                    playing = true;
                }
                Ok(DecoderCmd::Pause) => {
                    playing = false;
                }
                Ok(DecoderCmd::Stop) => {
                    stop = true;
                    break;
                }
                Err(TryRecvError::Empty) => break,
                Err(TryRecvError::Disconnected) => return,
            }
        }

        if stop {
            return;
        }

        if let Some((generation, time_sec)) = latest_seek {
            current_gen = generation;
            if let Err(e) = decoder.seek(time_sec) {
                // A failed seek must not kill the decode thread permanently: the
                // layer would freeze forever with no retry. Park until the next
                // command (e.g. another seek from the user) and try again then.
                log::error!("[decode] seek({time_sec}) failed: {e:?}");
                at_eof = true;
                decoded_after_seek = true;
            } else {
                at_eof = false;
                decoded_after_seek = false;
            }
        }

        // Если мы не проигрываем, и уже декодировали один кадр после seek, то нам нечего делать — ждём команду блокирующе.
        if (!playing && decoded_after_seek) || at_eof {
            match cmd_rx.recv() {
                Ok(cmd) => {
                    let mut latest_seek = None;
                    let mut stop = false;

                    let mut process_cmd = |cmd: DecoderCmd| match cmd {
                        DecoderCmd::Seek {
                            generation,
                            time_sec,
                        } => {
                            latest_seek = Some((generation, time_sec));
                        }
                        DecoderCmd::Play => {
                            playing = true;
                        }
                        DecoderCmd::Pause => {
                            playing = false;
                        }
                        DecoderCmd::Stop => {
                            stop = true;
                        }
                    };

                    process_cmd(cmd);

                    loop {
                        match cmd_rx.try_recv() {
                            Ok(cmd) => process_cmd(cmd),
                            Err(TryRecvError::Empty) => break,
                            Err(TryRecvError::Disconnected) => return,
                        }
                    }

                    if stop {
                        return;
                    }

                    if let Some((generation, time_sec)) = latest_seek {
                        current_gen = generation;
                        if let Err(e) = decoder.seek(time_sec) {
                            // Stay alive and parked; a later seek can recover.
                            log::error!("[decode] seek({time_sec}) failed: {e:?}");
                            at_eof = true;
                            decoded_after_seek = true;
                        } else {
                            at_eof = false;
                            decoded_after_seek = false;
                        }
                    }
                    continue;
                }
                Err(_) => return,
            }
        }

        // 3) Тянем следующий кадр.
        match decoder.next_frame() {
            Ok(Some(mut frame)) => {
                // Если consumer уже сделал seek во время нашего read_exact —
                // отбросим этот кадр, не нагружая канал. Generation atomics свежее.
                let live_gen = gen.load(Ordering::SeqCst);
                if live_gen != current_gen {
                    continue;
                }

                // Загружаем кадр на GPU, если доступны device и queue
                if let (Some(device), Some(queue)) = (&device, &queue) {
                    let tex = {
                        let mut pool = texture_pool.lock();
                        let slot = pool.entry((frame.width, frame.height)).or_default();
                        slot.pop().unwrap_or_else(|| {
                            device.create_texture(&wgpu::TextureDescriptor {
                                label: Some("decode-gpu-frame"),
                                size: wgpu::Extent3d {
                                    width: frame.width,
                                    height: frame.height,
                                    depth_or_array_layers: 1,
                                },
                                mip_level_count: 1,
                                sample_count: 1,
                                dimension: wgpu::TextureDimension::D2,
                                format: wgpu::TextureFormat::Rgba8Unorm,
                                usage: wgpu::TextureUsages::COPY_DST
                                    | wgpu::TextureUsages::TEXTURE_BINDING
                                    | wgpu::TextureUsages::COPY_SRC,
                                view_formats: &[],
                            })
                        })
                    };
                    queue.write_texture(
                        wgpu::TexelCopyTextureInfo {
                            texture: &tex,
                            mip_level: 0,
                            origin: wgpu::Origin3d::ZERO,
                            aspect: wgpu::TextureAspect::All,
                        },
                        &frame.pixels,
                        wgpu::TexelCopyBufferLayout {
                            offset: 0,
                            bytes_per_row: Some(frame.width * 4),
                            rows_per_image: Some(frame.height),
                        },
                        wgpu::Extent3d {
                            width: frame.width,
                            height: frame.height,
                            depth_or_array_layers: 1,
                        },
                    );
                    frame.texture = Some(tex);
                    frame.texture_pool = Some(texture_pool.clone());
                }

                let msg = DecodedFrameMsg {
                    generation: current_gen,
                    frame,
                };
                if frame_tx.send(msg).is_err() {
                    return; // consumer ушёл
                }
                decoded_after_seek = true;
                if let Some(ref cb) = on_frame_decoded {
                    cb();
                }
            }
            Ok(None) => {
                at_eof = true;
            }
            Err(e) => {
                // Don't tear down the thread on a transient decode error — that
                // would freeze the layer with no way back. Park as if at EOF; a
                // subsequent seek resets `at_eof` and retries decoding.
                log::error!("[decode] next_frame failed: {e:?}");
                at_eof = true;
            }
        }
    }
}
