//! Фоновый поток декодера: владеет `VideoDecoder`, шлёт готовые кадры в bounded queue.
//! Event-loop монитора только тянет кадры — без блокирующего IO в UI-потоке.
//!
//! Контракт по seek:
//!   - consumer вызывает `seek(t)` → внутри инкрементится generation, отправляется команда;
//!   - старые кадры в очереди помечены прошлым generation → consumer их выбрасывает.
//! Гарантия: после `seek(t)` все кадры, дошедшие до consumer'а, имеют PTS >= t (с допуском 1/2*1/fps).

use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::mpsc::{self, Receiver, Sender, SyncSender, TryRecvError};
use std::sync::Arc;
use std::thread::JoinHandle;

use anyhow::{anyhow, Context, Result};

use super::decode::{open as open_decoder, MediaInfo, VideoFrame};

// Размер очереди декодированных кадров. Каждый кадр = ширина × высота × 4 байта.
// Для 1080×1920 это ~8 МБ/кадр, так что 2 = 16 МБ буфера на слой — достаточно для smooth
// playback (всегда есть `current` + 1 `upcoming` для lookahead) и не раздувает память.
const QUEUE_CAPACITY: usize = 2;

pub struct DecodedFrameMsg {
    pub generation: u64,
    pub frame: VideoFrame,
}

enum DecoderCmd {
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
    ) -> Result<Self> {
        let decoder = open_decoder(path, max_output_long_edge)?;
        let info = decoder.info().clone();

        let (frame_tx, frame_rx) = mpsc::sync_channel::<DecodedFrameMsg>(QUEUE_CAPACITY);
        // Маленькая command-очередь: seek/stop. sync_channel(1) — чтобы consumer не уехал
        // вперёд с пачкой seek'ов; ему достаточно знать про самый свежий.
        let (cmd_tx, cmd_rx) = mpsc::channel::<DecoderCmd>();
        let generation = Arc::new(AtomicU64::new(0));
        let gen_in_thread = generation.clone();
        let path_str = path.display().to_string();

        let thread = std::thread::Builder::new()
            .name(format!("fastcat-decode:{}", path_str))
            .spawn(move || {
                run_decoder_loop(decoder, frame_tx, cmd_rx, gen_in_thread, on_frame_decoded);
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

fn run_decoder_loop(
    mut decoder: Box<dyn super::decode::VideoDecoder>,
    frame_tx: SyncSender<DecodedFrameMsg>,
    cmd_rx: Receiver<DecoderCmd>,
    gen: Arc<AtomicU64>,
    on_frame_decoded: Option<Box<dyn Fn() + Send + Sync + 'static>>,
) {
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
                log::error!("[decode] seek({time_sec}) failed: {e:?}");
                return;
            }
            at_eof = false;
        }

        // 2) EOF — ждём следующую команду блокирующе.
        if at_eof {
            match cmd_rx.recv() {
                Ok(DecoderCmd::Seek {
                    generation,
                    time_sec,
                }) => {
                    let mut latest_seek = Some((generation, time_sec));
                    let mut stop = false;
                    loop {
                        match cmd_rx.try_recv() {
                            Ok(DecoderCmd::Seek {
                                generation,
                                time_sec,
                            }) => {
                                latest_seek = Some((generation, time_sec));
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
                            log::error!("[decode] seek({time_sec}) failed: {e:?}");
                            return;
                        }
                        at_eof = false;
                        continue;
                    }
                }
                Ok(DecoderCmd::Stop) => return,
                Err(_) => return,
            }
        }

        // 3) Тянем следующий кадр.
        match decoder.next_frame() {
            Ok(Some(frame)) => {
                // Если consumer уже сделал seek во время нашего read_exact —
                // отбросим этот кадр, не нагружая канал. Generation atomics свежее.
                let live_gen = gen.load(Ordering::SeqCst);
                if live_gen != current_gen {
                    continue;
                }
                let msg = DecodedFrameMsg {
                    generation: current_gen,
                    frame,
                };
                if frame_tx.send(msg).is_err() {
                    return; // consumer ушёл
                }
                if let Some(ref cb) = on_frame_decoded {
                    cb();
                }
            }
            Ok(None) => {
                at_eof = true;
            }
            Err(e) => {
                log::error!("[decode] next_frame failed: {e:?}");
                return;
            }
        }
    }
}
