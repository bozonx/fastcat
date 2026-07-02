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

use crate::compositor::yuv::YuvToRgbaPipeline;

use super::{FfmpegNextDecoderFactory, MediaInfo, VideoDecoderFactory, VideoFrame};
use crate::media::types::HwAccelMode;
use crate::media::GpuTexturePool;

// Size of the decoded-frame queue. Each frame = width × height × 4 bytes.
// For 1080×1920 that's ~8 MB/frame, so 2 = 16 MB of buffer per layer — enough for smooth
// playback (always a `current` + 1 `upcoming` for lookahead) without bloating memory.
const QUEUE_CAPACITY: usize = 2;

pub type DecodeCallback = Box<dyn Fn() + Send + Sync + 'static>;

pub struct DecodeOpenParams<'a> {
    pub path: &'a Path,
    pub max_output_long_edge: Option<u32>,
    pub on_frame_decoded: Option<DecodeCallback>,
    pub device: Option<wgpu::Device>,
    pub queue: Option<wgpu::Queue>,
    pub hw_mode: HwAccelMode,
    pub vaapi_device: Option<&'a str>,
}

struct DecoderLoopArgs {
    decoder: Box<dyn super::VideoDecoder>,
    frame_tx: SyncSender<DecodedFrameMsg>,
    cmd_rx: Receiver<DecoderCmd>,
    gen: Arc<AtomicU64>,
    on_frame_decoded: Option<DecodeCallback>,
    device: Option<wgpu::Device>,
    queue: Option<wgpu::Queue>,
    texture_pool: GpuTexturePool,
}

pub struct DecodedFrameMsg {
    pub generation: u64,
    pub frame: VideoFrame,
}

enum DecoderCmd {
    Play,
    Pause,
    /// Decode up to `frames` frames forward from the current position while still
    /// paused, then park again. Warms the first GOP so a later Play doesn't freeze
    /// waiting for a 4K keyframe→target decode. `frames` is a hard cap (memory
    /// safeguard): a pathological huge-GOP / keyframe-less source can never push
    /// more than this ahead.
    ///
    /// When `keep_preseek_frames` is `true`, intra-GOP frames that come *before*
    /// the seek target are also emitted (opportunistic caching — backward scrub
    /// within the same GOP will be served from cache).
    Prebuffer {
        frames: u32,
        keep_preseek_frames: bool,
    },
    Seek {
        generation: u64,
        time_sec: f64,
    },
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
    /// `max_output_long_edge` — cap on the decoded frame's long side in pixels.
    /// Passed through to ffmpeg `-vf scale`. `None` = decode at native size.
    pub fn open(params: DecodeOpenParams<'_>) -> Result<Self> {
        Self::open_with_factory(params, FfmpegNextDecoderFactory)
    }

    pub fn open_with_factory<F>(params: DecodeOpenParams<'_>, factory: F) -> Result<Self>
    where
        F: VideoDecoderFactory + 'static,
    {
        let path_buf = params.path.to_path_buf();
        let vaapi_device_str = params.vaapi_device.map(|s| s.to_string());

        let (frame_tx, frame_rx) = mpsc::sync_channel::<DecodedFrameMsg>(QUEUE_CAPACITY);
        let (cmd_tx, cmd_rx) = mpsc::channel::<DecoderCmd>();
        let generation = Arc::new(AtomicU64::new(0));
        let gen_in_thread = generation.clone();
        let path_str = params.path.display().to_string();
        let texture_pool: GpuTexturePool = Arc::new(Mutex::new(HashMap::new()));
        let texture_pool_thread = texture_pool.clone();

        let (init_tx, init_rx) = mpsc::channel::<Result<MediaInfo>>();
        let thread = std::thread::Builder::new()
            .name(format!("fastcat-decode:{}", path_str))
            .spawn(move || {
                let decoder = factory.open(
                    &path_buf,
                    params.max_output_long_edge,
                    params.hw_mode,
                    vaapi_device_str.as_deref(),
                );
                match decoder {
                    Ok(decoder) => {
                        let info = decoder.info().clone();
                        if init_tx.send(Ok(info)).is_err() {
                            return; // caller dropped
                        }
                        run_decoder_loop(DecoderLoopArgs {
                            decoder,
                            frame_tx,
                            cmd_rx,
                            gen: gen_in_thread,
                            on_frame_decoded: params.on_frame_decoded,
                            device: params.device,
                            queue: params.queue,
                            texture_pool: texture_pool_thread,
                        });
                    }
                    Err(e) => {
                        let _ = init_tx.send(Err(e));
                    }
                }
            })
            .context("spawn decoder thread")?;

        let info = init_rx
            .recv()
            .context("decoder thread died before completing init")?
            .context("failed to open decoder in thread")?;

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

    /// Warms the cache while paused: asks the decoder to decode up to `frames`
    /// frames forward from its current position and emit them, then park. Bounded
    /// by `frames` (hard memory cap) and the queue capacity, so it is safe even on
    /// huge-GOP / keyframe-less sources. No-op if `frames == 0`.
    ///
    /// `keep_preseek_frames` — when `true`, intra-GOP frames that lie chronologically
    /// *before* the seek target are also emitted and cached. This fills the
    /// `VideoFrameCache` with the whole decoded GOP so backward scrubbing within
    /// the same GOP doesn't trigger a re-seek.
    pub fn prebuffer(&self, frames: u32, keep_preseek_frames: bool) -> Result<()> {
        if frames == 0 {
            return Ok(());
        }
        self.cmd_tx
            .send(DecoderCmd::Prebuffer {
                frames,
                keep_preseek_frames,
            })
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

    /// Non-blocking receive of one frame from the decoder.
    /// `None` — the channel is empty or the decoder has finished.
    pub fn try_recv_frame(&self) -> Option<DecodedFrameMsg> {
        match self.rx.try_recv() {
            Ok(msg) => Some(msg),
            Err(TryRecvError::Empty) | Err(TryRecvError::Disconnected) => None,
        }
    }
}

impl Drop for DecodePump {
    fn drop(&mut self) {
        // IMPORTANT: drop the frame receiver BEFORE joining the thread. Otherwise:
        // - the sync_channel frame_tx can block the decoder thread in `send()` (queue full);
        // - the decoder checks cmd_rx only between sends → never sees the Stop command;
        // - handle.join() waits for the thread forever;
        // - self.rx is auto-dropped only after fn drop returns → deadlock.
        // We swap self.rx for a dummy receiver — the original rx is dropped instantly,
        // frame_tx.send() in the decoder returns Err, the thread exits, join completes.
        let (_dummy_tx, dummy_rx) = mpsc::sync_channel::<DecodedFrameMsg>(0);
        let _ = std::mem::replace(&mut self.rx, dummy_rx);
        let _ = self.cmd_tx.send(DecoderCmd::Stop);
        if let Some(handle) = self.thread.take() {
            let _ = handle.join();
        }
    }
}

/// Consecutive YUV→RGBA GPU upload failures tolerated before the decoder gives up
/// the GPU fast path. A single failure can be transient (a momentary allocation
/// hiccup), so the fast path is only disabled once it fails repeatedly.
const YUV_UPLOAD_FAILURE_LIMIT: u32 = 3;

/// Scheduling state of the decoder loop: playback flag, post-seek bookkeeping and
/// the preroll / pre-seek budgets that decide when the thread parks vs. decodes ahead.
struct ScheduleState {
    playing: bool,
    decoded_after_seek: bool,
    /// Frames still owed to an in-flight `Prebuffer`: while > 0 the (paused) decoder
    /// keeps decoding forward instead of parking after the first frame.
    preroll_remaining: u32,
    /// Whether the active Prebuffer should emit pre-seek frames (opportunistic caching).
    preroll_keep_preseek: bool,
    /// Seek target (stream-time seconds) not yet reached after the last seek. While
    /// `Some`, decoded intra-GOP frames before it are "pre-seek" frames retained only
    /// for backward-scrub caching; they must not consume the forward preroll budget,
    /// and the decoder must not park before a frame at/after the target is emitted.
    preseek_target: Option<f64>,
    /// Hard cap on how many pre-seek frames are RETAINED, bounding warm-up memory on
    /// huge-GOP / keyframe-less sources.
    preseek_cap_remaining: u32,
    at_eof: bool,
    current_gen: u64,
}

/// Commands drained from the channel in one batch, merged so rapid duplicates don't
/// fight each other (max preroll frames, OR-ed keep-preseek, latest seek wins).
#[derive(Default)]
struct DrainedCommands {
    latest_seek: Option<(u64, f64)>,
    pending_preroll: Option<(u32, bool)>,
    set_playing: Option<bool>,
    stop: bool,
}

impl DrainedCommands {
    fn push(&mut self, cmd: DecoderCmd) {
        match cmd {
            DecoderCmd::Seek {
                generation,
                time_sec,
            } => {
                self.latest_seek = Some((generation, time_sec));
            }
            DecoderCmd::Prebuffer {
                frames,
                keep_preseek_frames,
            } => {
                // Take the max frames so multiple rapid Prebuffer commands don't reduce
                // the budget, and OR the keep-preseek flag so a request that asked to
                // cache the whole GOP (keep=true) is never downgraded by a later merge.
                let (prev_frames, prev_keep) = self.pending_preroll.unwrap_or((0, false));
                self.pending_preroll =
                    Some((prev_frames.max(frames), prev_keep || keep_preseek_frames));
            }
            DecoderCmd::Play => self.set_playing = Some(true),
            DecoderCmd::Pause => self.set_playing = Some(false),
            DecoderCmd::Stop => self.stop = true,
        }
    }
}

/// Drains all currently-queued commands without blocking. Returns `None` if the
/// command channel disconnected (the loop must terminate).
fn drain_pending_commands(cmd_rx: &Receiver<DecoderCmd>) -> Option<DrainedCommands> {
    let mut drained = DrainedCommands::default();
    loop {
        match cmd_rx.try_recv() {
            Ok(cmd) => {
                drained.push(cmd);
                if drained.stop {
                    break;
                }
            }
            Err(TryRecvError::Empty) => break,
            Err(TryRecvError::Disconnected) => return None,
        }
    }
    Some(drained)
}

/// Applies a batch of drained commands to the schedule state, performing the actual
/// `decoder.seek` when a seek was requested. A fresh seek discards any leftover preroll
/// budget; a bare Prebuffer extends the forward budget at the current playhead.
fn apply_drained_commands(
    decoder: &mut Box<dyn super::VideoDecoder>,
    state: &mut ScheduleState,
    drained: DrainedCommands,
) {
    if let Some(playing) = drained.set_playing {
        state.playing = playing;
    }
    if let Some((generation, time_sec)) = drained.latest_seek {
        state.current_gen = generation;
        if let Some((frames, keep)) = drained.pending_preroll {
            state.preroll_remaining = frames;
            state.preroll_keep_preseek = keep;
            state.preseek_cap_remaining = frames;
        } else {
            state.preroll_remaining = 0;
            state.preroll_keep_preseek = false;
            state.preseek_cap_remaining = 0;
        }
        // Must decode through the GOP to this exact target before parking, so the
        // displayed paused frame is the playhead frame, not a near-keyframe one.
        state.preseek_target = Some(time_sec);
        if let Err(e) = decoder.seek(time_sec) {
            // A failed seek must not kill the decode thread permanently: the layer
            // would freeze forever with no retry. Park as if at EOF; a later seek
            // (e.g. another user scrub) resets this and retries.
            log::error!("[decode] seek({time_sec}) failed: {e:?}");
            state.at_eof = true;
            state.decoded_after_seek = true;
            state.preseek_target = None;
        } else {
            state.at_eof = false;
            state.decoded_after_seek = false;
        }
    } else if let Some((frames, keep)) = drained.pending_preroll {
        // Prebuffer without an accompanying seek (already positioned past any prior
        // target): keep decoding forward from here. No pre-seek phase.
        state.preroll_remaining = state.preroll_remaining.max(frames);
        state.preroll_keep_preseek = keep;
        state.preseek_cap_remaining = state.preseek_cap_remaining.max(frames);
    }
}

/// Uploads a decoded frame to a pooled GPU texture, converting YUV on the GPU when
/// available and falling back to a plain RGBA `write_texture` otherwise. Returns
/// `false` on a transient YUV upload failure, signalling the caller to skip this frame
/// (the loop should `continue`); `true` once `frame.texture` is populated.
fn upload_frame_to_gpu(
    frame: &mut VideoFrame,
    device: &wgpu::Device,
    queue: &wgpu::Queue,
    texture_pool: &GpuTexturePool,
    yuv_pipeline: &mut Option<YuvToRgbaPipeline>,
    yuv_upload_failures: &mut u32,
    prefer_yuv: &mut bool,
) -> bool {
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
                    | wgpu::TextureUsages::COPY_SRC
                    | wgpu::TextureUsages::STORAGE_BINDING,
                view_formats: &[],
            })
        })
    };
    if let Some(yuv) = frame.yuv.as_ref() {
        let pipeline = yuv_pipeline.get_or_insert_with(|| YuvToRgbaPipeline::new(device, None));
        match pipeline.upload_and_convert(device, queue, yuv, frame.width, frame.height, &tex) {
            Ok(()) => {
                *yuv_upload_failures = 0;
                frame.texture = Some(Arc::new(super::SharedTexture::new_owned(
                    tex,
                    texture_pool.clone(),
                )));
            }
            Err(error) => {
                // The dispatch failed but the texture itself is intact and unused —
                // return it to the pool instead of dropping it, so a transient failure
                // does not slowly drain the pooled slots.
                {
                    let mut pool = texture_pool.lock();
                    let slot = pool.entry((frame.width, frame.height)).or_default();
                    if slot.len() < super::MAX_TEXTURES_PER_SIZE {
                        slot.push(tex);
                    }
                }
                *yuv_upload_failures += 1;
                if *yuv_upload_failures >= YUV_UPLOAD_FAILURE_LIMIT {
                    log::warn!(
                        "[decode] YUV GPU upload failed {yuv_upload_failures}× — \
                         disabling YUV fast path, falling back to RGBA decode: {error:?}"
                    );
                    *prefer_yuv = false;
                } else {
                    log::warn!(
                        "[decode] YUV GPU upload failed ({yuv_upload_failures}/\
                         {YUV_UPLOAD_FAILURE_LIMIT}), retrying YUV fast path: {error:?}"
                    );
                }
                return false;
            }
        }
    } else {
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
        frame.texture = Some(Arc::new(super::SharedTexture::new_owned(
            tex,
            texture_pool.clone(),
        )));
    }
    true
}

fn run_decoder_loop(args: DecoderLoopArgs) {
    let DecoderLoopArgs {
        mut decoder,
        frame_tx,
        cmd_rx,
        gen,
        on_frame_decoded,
        device,
        queue,
        texture_pool,
    } = args;
    // PTS tolerance for "reached the seek target", matching the decoder's own intra-GOP skip.
    let seek_tolerance_sec = 0.5 / decoder.info().effective_fps();
    let mut prefer_yuv = device.is_some() && queue.is_some();
    let mut yuv_pipeline: Option<YuvToRgbaPipeline> = None;
    let mut yuv_upload_failures: u32 = 0;
    let mut state = ScheduleState {
        playing: false,
        decoded_after_seek: false,
        preroll_remaining: 0,
        preroll_keep_preseek: false,
        preseek_target: None,
        preseek_cap_remaining: 0,
        at_eof: false,
        current_gen: gen.load(Ordering::SeqCst),
    };

    loop {
        // 1) Drain and apply all queued commands non-blocking.
        let Some(drained) = drain_pending_commands(&cmd_rx) else {
            return;
        };
        if drained.stop {
            return;
        }
        apply_drained_commands(&mut decoder, &mut state, drained);

        // 2) Nothing to do (paused, no budget, target reached, one frame already shown)
        // or at EOF — block until the next command, apply it, and re-evaluate.
        if (!state.playing
            && state.preroll_remaining == 0
            && state.preseek_target.is_none()
            && state.decoded_after_seek)
            || state.at_eof
        {
            match cmd_rx.recv() {
                Ok(cmd) => {
                    let mut drained = DrainedCommands::default();
                    drained.push(cmd);
                    match drain_pending_commands(&cmd_rx) {
                        Some(rest) => {
                            if let Some((g, t)) = rest.latest_seek {
                                drained.latest_seek = Some((g, t));
                            }
                            if let Some((frames, keep)) = rest.pending_preroll {
                                let (pf, pk) = drained.pending_preroll.unwrap_or((0, false));
                                drained.pending_preroll = Some((pf.max(frames), pk || keep));
                            }
                            if let Some(p) = rest.set_playing {
                                drained.set_playing = Some(p);
                            }
                            drained.stop |= rest.stop;
                        }
                        None => return,
                    }
                    if drained.stop {
                        return;
                    }
                    apply_drained_commands(&mut decoder, &mut state, drained);
                    continue;
                }
                Err(_) => return,
            }
        }

        // 3) Pull the next frame. During Prebuffer with keep_preseek=true use the
        // *_keep_preseek* variants so intra-GOP frames before the seek target also land in
        // the cache. Retain pre-seek frames only while warming up toward an unreached
        // target AND the retention cap is not spent; otherwise fall back to the skipping
        // decode so the decoder advances to the target without retaining more GOP interior.
        let keep_preseek_now = state.preroll_keep_preseek
            && state.preseek_target.is_some()
            && state.preseek_cap_remaining > 0;
        let decoded = if keep_preseek_now {
            if prefer_yuv {
                decoder.next_frame_keep_preseek_for_gpu()
            } else {
                decoder.next_frame_keep_preseek()
            }
        } else if prefer_yuv {
            decoder.next_frame_for_gpu()
        } else {
            decoder.next_frame()
        };
        match decoded {
            Ok(Some(mut frame)) => {
                // If the consumer seeked while we were decoding, drop this frame without
                // loading the channel. The generation atomic is fresher than current_gen.
                if gen.load(Ordering::SeqCst) != state.current_gen {
                    continue;
                }

                if let (Some(device), Some(queue)) = (&device, &queue) {
                    if !upload_frame_to_gpu(
                        &mut frame,
                        device,
                        queue,
                        &texture_pool,
                        &mut yuv_pipeline,
                        &mut yuv_upload_failures,
                        &mut prefer_yuv,
                    ) {
                        continue;
                    }
                }

                let frame_pts = frame.pts_sec;
                let msg = DecodedFrameMsg {
                    generation: state.current_gen,
                    frame,
                };
                if frame_tx.send(msg).is_err() {
                    return; // consumer is gone
                }
                state.decoded_after_seek = true;
                // Account the emitted frame. A "pre-seek" frame (PTS before the active seek
                // target) is an intra-GOP frame retained only for backward-scrub caching: it
                // spends the retention cap but must NOT consume the forward preroll budget nor
                // count as reaching the target. Only a frame at/after the target clears the
                // target and spends the forward budget — guaranteeing the displayed paused
                // frame is the playhead frame, not a near-keyframe one.
                let is_preseek = state
                    .preseek_target
                    .is_some_and(|target| frame_pts < target - seek_tolerance_sec);
                if is_preseek {
                    state.preseek_cap_remaining = state.preseek_cap_remaining.saturating_sub(1);
                } else {
                    state.preseek_target = None;
                    state.preroll_remaining = state.preroll_remaining.saturating_sub(1);
                }
                if let Some(ref cb) = on_frame_decoded {
                    cb();
                }
            }
            Ok(None) => {
                state.at_eof = true;
            }
            Err(e) => {
                // Don't tear down the thread on a transient decode error — that would
                // freeze the layer with no way back. Park as if at EOF; a subsequent seek
                // resets `at_eof` and retries decoding.
                log::error!("[decode] next_frame failed: {e:?}");
                state.at_eof = true;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{Duration, Instant};

    use crate::media::decode::{MediaInfo, VideoDecoder, VideoDecoderFactory, VideoFrame};

    /// Decoder simulating a single huge GOP: every `seek` lands on the keyframe at PTS 0
    /// and frames are produced sequentially, so reaching a target deep inside the GOP
    /// requires decoding through many intra-GOP (pre-seek) frames — exactly the case where
    /// the old budget logic parked on a near-keyframe frame.
    struct LongGopDecoder {
        info: MediaInfo,
        cursor_idx: u64,
        seek_target: Option<f64>,
    }

    impl LongGopDecoder {
        fn frame_pts(&self) -> f64 {
            self.cursor_idx as f64 / self.info.fps
        }

        fn make_frame(pts_sec: f64) -> VideoFrame {
            VideoFrame {
                width: 2,
                height: 2,
                pixels: vec![0u8; 2 * 2 * 4],
                yuv: None,
                pts_sec,
                texture: None,
            }
        }

        fn next_with_mode(&mut self, keep_preseek: bool) -> Result<Option<VideoFrame>> {
            let tol = 0.5 / self.info.fps;
            loop {
                if self.frame_pts() > self.info.duration_sec {
                    self.seek_target = None;
                    return Ok(None);
                }
                let pts = self.frame_pts();
                self.cursor_idx += 1;
                if let Some(target) = self.seek_target {
                    if pts < target - tol {
                        if keep_preseek {
                            return Ok(Some(Self::make_frame(pts)));
                        }
                        continue;
                    }
                    self.seek_target = None;
                }
                return Ok(Some(Self::make_frame(pts)));
            }
        }
    }

    impl VideoDecoder for LongGopDecoder {
        fn info(&self) -> &MediaInfo {
            &self.info
        }
        fn seek(&mut self, _time_sec: f64) -> Result<()> {
            // Single GOP: every seek rewinds to the keyframe at 0.
            self.cursor_idx = 0;
            self.seek_target = Some(_time_sec.max(0.0));
            Ok(())
        }
        fn next_frame(&mut self) -> Result<Option<VideoFrame>> {
            self.next_with_mode(false)
        }
        fn next_frame_keep_preseek(&mut self) -> Result<Option<VideoFrame>> {
            self.next_with_mode(true)
        }
    }

    struct LongGopFactory {
        fps: f64,
        duration_sec: f64,
    }

    impl VideoDecoderFactory for LongGopFactory {
        fn open(
            &self,
            _path: &Path,
            _max_output_long_edge: Option<u32>,
            _hw_mode: HwAccelMode,
            _vaapi_device: Option<&str>,
        ) -> Result<Box<dyn VideoDecoder>> {
            Ok(Box::new(LongGopDecoder {
                info: MediaInfo {
                    duration_sec: self.duration_sec,
                    width: 2,
                    height: 2,
                    rotation: 0,
                    fps: self.fps,
                    codec: "mock".into(),
                    has_audio: false,
                    start_time_sec: 0.0,
                    is_hdr: false,
                },
                cursor_idx: 0,
                seek_target: None,
            }))
        }
    }

    fn open_mock_pump(fps: f64, duration_sec: f64) -> DecodePump {
        DecodePump::open_with_factory(
            DecodeOpenParams {
                path: Path::new("/mock/long-gop.mp4"),
                max_output_long_edge: None,
                on_frame_decoded: None,
                device: None,
                queue: None,
                hw_mode: HwAccelMode::None,
                vaapi_device: None,
            },
            LongGopFactory { fps, duration_sec },
        )
        .expect("open mock pump")
    }

    /// Drains frames of the given `generation` until one reaches `target`. Frames from an
    /// older generation are skipped, exactly as the real consumer does in
    /// `LayerRuntime::pull_into_cache`. This matters because opening a pump always decodes
    /// one initial frame (≈0s) before parking; that stale frame races with the test's
    /// `seek`, so without the generation filter the drain non-deterministically picks it up.
    fn drain_generation_until_pts_ge(
        pump: &DecodePump,
        generation: u64,
        target: f64,
        timeout: Duration,
    ) -> Vec<f64> {
        let deadline = Instant::now() + timeout;
        let mut seen = Vec::new();
        while Instant::now() < deadline {
            match pump.try_recv_frame() {
                Some(msg) if msg.generation == generation => {
                    seen.push(msg.frame.pts_sec);
                    if msg.frame.pts_sec >= target {
                        break;
                    }
                }
                // Stale-generation frame (e.g. the open-time initial frame): ignore it.
                Some(_) => {}
                None => std::thread::sleep(Duration::from_millis(2)),
            }
        }
        seen
    }

    /// Regression: a paused warm-up (`prebuffer(MIN_PREROLL_FRAMES, keep_preseek=true)`) into
    /// a position deep inside a long GOP must still decode through to a frame at/after the
    /// seek target. Previously the small preroll budget was spent on near-keyframe pre-seek
    /// frames and the decoder parked, so the monitor displayed a frame seconds behind the
    /// playhead.
    #[test]
    fn paused_warmup_reaches_seek_target_on_long_gop() {
        let fps = 30.0;
        let pump = open_mock_pump(fps, 100.0);
        let target = 5.0; // frame ~150, far past the keyframe at 0

        let generation = pump.seek(target).expect("seek");
        // Tiny budget, as for a 4K source; keep_preseek=true as request_prebuffer uses.
        pump.prebuffer(2, true).expect("prebuffer");

        let seen = drain_generation_until_pts_ge(
            &pump,
            generation,
            target - 0.5 / fps,
            Duration::from_secs(3),
        );
        let max_pts = seen.iter().cloned().fold(f64::MIN, f64::max);
        assert!(
            max_pts >= target - 0.5 / fps,
            "warm-up parked before the target: got frames {seen:?}, expected one >= {target}"
        );
        // Pre-seek frames are still retained for backward-scrub caching (cap = 2),
        // so the keyframe-region frames must also have been emitted.
        assert!(
            seen.iter().any(|&p| p < target - 0.5 / fps),
            "expected retained pre-seek frames for caching, got {seen:?}"
        );
    }

    /// A plain paused seek (no prebuffer) must also land on the exact target frame — the
    /// skipping decode path was already correct and must stay so.
    #[test]
    fn paused_seek_without_prebuffer_lands_on_target() {
        let fps = 30.0;
        let pump = open_mock_pump(fps, 100.0);
        let target = 3.0;
        let generation = pump.seek(target).expect("seek");

        let seen = drain_generation_until_pts_ge(
            &pump,
            generation,
            target - 0.5 / fps,
            Duration::from_secs(3),
        );
        assert_eq!(
            seen.len(),
            1,
            "skipping decode must emit exactly the target frame: {seen:?}"
        );
        assert!((seen[0] - target).abs() < 1.0 / fps);
    }
}
