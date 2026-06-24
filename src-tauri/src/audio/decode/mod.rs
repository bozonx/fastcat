use std::path::Path;
use std::sync::Arc;

use anyhow::{anyhow, Context, Result};
use parking_lot::{Condvar, Mutex};

use crate::audio::ffmpeg_decode::{decode_range_ffmpeg, spawn_ffmpeg_f32le, FfmpegDecodeParams};
use crate::audio::resample::{
    make_sinc_resampler, planar_to_interleaved, resample_flush_cached, resample_planar_cached,
    resample_planar_with_speed, RESAMPLER_CHUNK_SIZE,
};
use crate::audio::shared::{
    make_symphonia_decoder, open_symphonia_audio, AudioRenderTarget, AudioShared,
    AudioSourceMetadata, SymphoniaAudioInfo, REFILL_MARGIN_SEC, WINDOW_SEC,
};

mod window_cache;

#[cfg(test)]
use crate::audio::shared::AudioWindow;
#[cfg(test)]
use window_cache::WINDOW_FILL_MAX_CONCURRENCY;
pub(crate) use window_cache::{spawn_window_fill, WindowFillPriority};

/// Native streaming decoder backed by Symphonia and a cached rubato resampler.
pub(crate) struct SymphoniaDecoder {
    path: String,
    format: Box<dyn symphonia::core::formats::FormatReader>,
    decoder: Box<dyn symphonia::core::codecs::Decoder>,
    track_id: u32,
    source_rate: u32,
    channels: usize,
    time_base: symphonia::core::units::TimeBase,
    resampler: Option<Box<rubato::SincFixedIn<f32>>>,
    last_resample_ratio: f64,
    resampler_primed: bool,
    last_decode_end_sec: f64,
    resample_remainder: Vec<Vec<f32>>,
    resample_output_remainder: Vec<f32>,
}

/// Fallback streaming decoder backed by one long-lived ffmpeg process.
pub(crate) struct FfmpegStreamSource {
    path: String,
    sample_rate: u32,
    channels: usize,
    next_source_sec: f64,
    reader: Option<crate::audio::ffmpeg_decode::FfmpegPcmReader>,
}

/// Stateful per-layer streaming decoder selected once when its source is opened.
pub(crate) enum LayerDecoder {
    Symphonia(SymphoniaDecoder),
    Ffmpeg(FfmpegStreamSource),
}

/// Fraction of the current source chunk tolerated as scheduling jitter before
/// the streaming decoder treats the request as a discontinuity and reseeks.
/// Reversed clips bypass this and always reseek (see `stream_layer_chunk`).
const SEEK_TOLERANCE_CHUNK_FRACTION: f64 = 0.25;
const SEEK_TOLERANCE_MIN_SEC: f64 = 0.001;

/// Message produced when a media file has no decodable audio track. A video
/// re-encoded without sound (e.g. a silent screen capture or a video-only
/// export) hits this — it is NOT an error condition, the layer just contributes
/// silence. We key the silent-path cache on this so the mixer / window-fill stop
/// re-probing the file (and stop spamming a warning) every 50 ms chunk.
pub(crate) const NO_AUDIO_TRACK_MSG: &str = "no active audio track found";

/// Paths proven to carry no audio track. Audio-track presence is an immutable
/// property of a file path for the life of the process (a media replace / proxy
/// swap changes the path string), so once seen we cache it and serve silence for
/// that path without re-opening it. Bounds the otherwise-unbounded per-chunk
/// re-probe of video-only sources.
static NO_AUDIO_PATHS: std::sync::LazyLock<Mutex<std::collections::HashSet<String>>> =
    std::sync::LazyLock::new(|| Mutex::new(std::collections::HashSet::new()));

/// True when `path` is already known to have no audio track.
pub(crate) fn path_known_silent(path: &str) -> bool {
    NO_AUDIO_PATHS.lock().contains(path)
}

/// Record that `path` has no audio track so future chunks skip the decode.
pub(crate) fn remember_silent_path(path: &str) {
    let newly_inserted = NO_AUDIO_PATHS.lock().insert(path.to_string());
    if newly_inserted {
        log::info!("[audio] no audio track in {path}; treating layer as silent");
    }
}

/// True when any cause in `error`'s chain is the no-audio-track condition.
pub(crate) fn is_no_audio_track_error(error: &anyhow::Error) -> bool {
    error
        .chain()
        .any(|cause| cause.to_string().contains(NO_AUDIO_TRACK_MSG))
}

#[cfg(test)]
pub(crate) fn reset_silent_paths_for_test() {
    NO_AUDIO_PATHS.lock().clear();
}

#[allow(dead_code)]
pub(crate) fn probe_audio_source_metadata(path: &str) -> Result<AudioSourceMetadata> {
    let info = open_symphonia_audio(path, "metadata", 48_000)?;
    Ok(AudioSourceMetadata {
        sample_rate: info.sample_rate,
        channels: info.channels,
    })
}

/// Decodes a BOUNDED time range `[start_sec, start_sec + duration_sec)` of a file
/// to interleaved f32 at the target rate/channels — never the whole file. This is
/// the off-thread fill for the per-layer look-ahead window: memory is bounded by
/// `duration_sec` regardless of how large the source is (tens of GB are fine).
///
/// Seeks accurately to `start_sec` and discards the sub-frame remainder so the
/// returned buffer begins exactly at `start_sec`, then stops once `duration_sec`
/// worth of source frames have been collected. Resampling reuses
/// `resample_planar_with_speed` (speed 1.0), which drops the resampler group delay,
/// so the window has NO leading silence.
pub(crate) fn decode_range_symphonia(
    path: &str,
    start_sec: f64,
    duration_sec: f64,
    target_sample_rate: u32,
    output_channels: usize,
) -> Result<Vec<f32>> {
    let start_sec = start_sec.max(0.0);
    let duration_sec = duration_sec.max(0.0);

    let mut info = open_symphonia_audio(path, "decode", target_sample_rate)?;
    let track = info
        .track()
        .ok_or_else(|| anyhow!("probed audio track disappeared"))?;

    // symphonia can't decode this codec (Opus today, and a safety net for any other
    // codec it lacks): fall back to a one-shot ranged ffmpeg decode. The streaming
    // path makes the same decision in `open_layer_decoder`.
    let mut decoder = match make_symphonia_decoder(track) {
        Ok(decoder) => decoder,
        Err(_) => {
            log::warn!("[audio] symphonia cannot decode codec; ranged ffmpeg fallback: {path}");
            return decode_range_ffmpeg(
                Path::new(path),
                start_sec,
                duration_sec,
                target_sample_rate,
                output_channels,
            )
            .context("failed to decode audio range via ffmpeg fallback");
        }
    };

    let track_id = info.track_id;
    let source_rate = info.sample_rate;

    // Seek to the window start (only when not at 0) and compute how many decoded
    // source frames to discard so the buffer begins exactly at `start_sec`.
    // `discard_frames_remaining` is in SOURCE frames (dropped pre-resample so output
    // begins at `start_sec`); `front_pad_frames` is in TARGET frames (prepended when
    // the seek OVERSHOOT means there is no source audio before where it landed).
    let (discard_frames_remaining, front_pad_frames) = if start_sec > 0.0 {
        match seek_window_start(&mut info, &mut *decoder, start_sec, target_sample_rate)? {
            Some(offsets) => offsets,
            // Seeking past the end yields an empty window — the caller treats this
            // region as silence (the chunk it serves zero-fills the tail).
            None => return Ok(Vec::new()),
        }
    } else {
        (0, 0)
    };

    // Stop once this many POST-discard source frames are collected: this is what
    // bounds the decode (and memory) to `duration_sec` regardless of file length.
    let wanted_source_frames = (duration_sec * source_rate as f64).ceil() as usize;
    let window = collect_planar_window(
        &mut *info.format,
        &mut *decoder,
        track_id,
        info.channels,
        discard_frames_remaining,
        wanted_source_frames,
    )?;

    if window.collected_frames == 0 {
        return Ok(Vec::new());
    }

    let resampled = resample_planar_with_speed(
        window.planar_buffers,
        source_rate,
        target_sample_rate,
        1.0,
        window.channels,
    )?;
    let interleaved = planar_to_interleaved(&resampled, output_channels);
    if front_pad_frames > 0 {
        let mut padded = vec![0.0f32; front_pad_frames * output_channels];
        padded.extend_from_slice(&interleaved);
        return Ok(padded);
    }
    Ok(interleaved)
}

/// Seek `info` so a decode starting now lands at `start_sec`, returning
/// `(discard_source_frames, front_pad_target_frames)`: trim this many decoded
/// source frames, or — when the accurate seek overshot — prepend this much target
/// silence, so the window aligns exactly to `start_sec`. `Ok(None)` means the seek
/// landed past the end of the stream and the window is entirely silent.
fn seek_window_start(
    info: &mut SymphoniaAudioInfo,
    decoder: &mut dyn symphonia::core::codecs::Decoder,
    start_sec: f64,
    target_sample_rate: u32,
) -> Result<Option<(usize, usize)>> {
    let source_rate = info.sample_rate;
    let time_base = info.time_base;
    let seeked_to = match info.format.seek(
        symphonia::core::formats::SeekMode::Accurate,
        symphonia::core::formats::SeekTo::Time {
            time: symphonia::core::units::Time {
                seconds: start_sec.floor() as u64,
                frac: start_sec.fract(),
            },
            track_id: Some(info.track_id),
        },
    ) {
        Ok(seeked_to) => seeked_to,
        Err(error) if is_audio_seek_past_end(&error) => return Ok(None),
        Err(error) => return Err(error).context("failed to seek in format reader"),
    };
    decoder.reset();
    let actual_sec = {
        let t = time_base.calc_time(seeked_to.actual_ts);
        t.seconds as f64 + t.frac
    };
    let offsets = if actual_sec <= start_sec {
        (
            ((start_sec - actual_sec) * source_rate as f64).floor() as usize,
            0usize,
        )
    } else if actual_sec - start_sec > SEEK_TOLERANCE_MIN_SEC {
        // Accurate seek overshot the requested start (rare, container-dependent):
        // there is genuinely no source audio between `start_sec` and where the
        // demuxer landed. Front-pad with that much silence so the window stays
        // aligned to `start_sec` instead of shifting its content earlier. A
        // sub-frame jitter under the tolerance is ignored so an aligned landing
        // never injects a spurious silent gap.
        (
            0usize,
            ((actual_sec - start_sec) * target_sample_rate as f64).round() as usize,
        )
    } else {
        (0usize, 0usize)
    };
    Ok(Some(offsets))
}

/// One batch of decoded source frames produced by `decode_source_batch`.
struct DecodedBatch {
    planar_buffers: Vec<Vec<f32>>,
    batch_collected: usize,
    /// End-of-stream was reached while filling this batch.
    hit_eof: bool,
    /// A packet declared more channels mid-stream, so the resampler was rebuilt.
    channel_layout_changed: bool,
}

/// Decoded planar PCM collected from a bounded packet range.
struct PlanarWindow {
    planar_buffers: Vec<Vec<f32>>,
    /// Channel count, which may grow above the initial value if a later packet
    /// declares more channels.
    channels: usize,
    collected_frames: usize,
}

/// Decode packets for `track_id` until `wanted_source_frames` post-discard source
/// frames are collected (or the stream ends), dropping the leading `discard_frames`.
fn collect_planar_window(
    format: &mut dyn symphonia::core::formats::FormatReader,
    decoder: &mut dyn symphonia::core::codecs::Decoder,
    track_id: u32,
    mut channels: usize,
    mut discard_frames_remaining: usize,
    wanted_source_frames: usize,
) -> Result<PlanarWindow> {
    let mut planar_buffers = vec![Vec::new(); channels];
    let mut collected_frames = 0usize;

    'outer: loop {
        if collected_frames >= wanted_source_frames {
            break;
        }
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(ref err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(err) => return Err(err).context("failed to read next packet"),
        };

        if packet.track_id() != track_id {
            continue;
        }

        match decoder.decode(&packet) {
            Ok(audio_buf) => {
                let spec = *audio_buf.spec();
                let duration = audio_buf.frames() as u64;
                let mut sample_buf =
                    symphonia::core::audio::SampleBuffer::<f32>::new(duration, spec);
                sample_buf.copy_interleaved_ref(audio_buf);

                let samples = sample_buf.samples();
                let num_channels = spec.channels.count();
                let num_frames = samples.len() / num_channels;
                if num_channels > channels {
                    for _ in channels..num_channels {
                        planar_buffers.push(vec![0.0; collected_frames]);
                    }
                    channels = num_channels;
                }

                for frame in 0..num_frames {
                    if discard_frames_remaining > 0 {
                        discard_frames_remaining -= 1;
                        continue;
                    }
                    if collected_frames >= wanted_source_frames {
                        break 'outer;
                    }
                    for ch in 0..channels {
                        let sample = if ch < num_channels {
                            samples[frame * num_channels + ch]
                        } else {
                            0.0
                        };
                        planar_buffers[ch].push(sample);
                    }
                    collected_frames += 1;
                }
            }
            Err(symphonia::core::errors::Error::IoError(ref err))
                if err.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(symphonia::core::errors::Error::DecodeError(err)) => {
                log::warn!("[audio] symphonia decode error: {:?}", err);
                continue;
            }
            Err(err) => return Err(err).context("failed to decode packet"),
        }
    }

    Ok(PlanarWindow {
        planar_buffers,
        channels,
        collected_frames,
    })
}

/// Request for one streaming chunk decode, independent of which backend serves it.
pub(crate) struct StreamChunkRequest {
    pub source_start_sec: f64,
    pub timeline_duration_sec: f64,
    pub speed: f64,
    pub reverse: bool,
    pub target_sample_rate: u32,
    pub output_channels: usize,
}

pub(crate) struct StreamChunkParams<'a> {
    pub layer_id: &'a str,
    pub path: &'a str,
    pub source_start_sec: f64,
    pub timeline_duration_sec: f64,
    pub speed: f64,
    pub target_sample_rate: u32,
    pub output_channels: usize,
    pub reverse: bool,
    pub shared: &'a Arc<(Mutex<AudioShared>, Condvar)>,
}

/// Streams one chunk for a layer through its cached `LayerDecoder`, building one the
/// first time (or after a path change). The codec→backend decision is made ONCE here
/// (in `open_layer_decoder`); both backends then share this single cache, the same
/// sequential-continuation contract, and the same eviction. The decoder is removed
/// from the shared map while decoding so the lock is NOT held across the decode, then
/// re-inserted — matching the realtime producer's lock-free decode invariant.
pub(crate) fn stream_layer_chunk(params: StreamChunkParams<'_>) -> Result<Vec<f32>> {
    let StreamChunkParams {
        layer_id,
        path,
        source_start_sec,
        timeline_duration_sec,
        speed,
        target_sample_rate,
        output_channels,
        reverse,
        shared,
    } = params;

    let req = StreamChunkRequest {
        source_start_sec,
        timeline_duration_sec,
        speed,
        reverse,
        target_sample_rate,
        output_channels,
    };

    // Take the cached decoder out (dropping a stale one whose path changed: proxy
    // on/off, media replace under the same layer id), or build a fresh one for this
    // path. One cache, so a backend switch on media-replace is just a rebuild here.
    let mut decoder = {
        let mut state = shared.0.lock();
        state.decoders.remove(layer_id)
    };
    if decoder.as_ref().is_some_and(|d| d.path() != path) {
        decoder = None;
    }
    let mut decoder = match decoder {
        Some(decoder) => decoder,
        None => open_layer_decoder(path, &req)?,
    };

    // Decode WITHOUT holding the shared lock, then re-insert.
    let out = decoder.decode_chunk(&req)?;

    let mut state = shared.0.lock();
    state.decoders.insert(layer_id.to_string(), decoder);
    Ok(out)
}

/// Builds the per-layer streaming decoder, choosing the backend ONCE: symphonia if it
/// can decode the codec, otherwise the ffmpeg fallback (Opus today, and a safety net
/// for any other codec symphonia lacks — the ranged path decides the same way in
/// `decode_range_symphonia`).
fn open_layer_decoder(path: &str, req: &StreamChunkRequest) -> Result<LayerDecoder> {
    let info = open_symphonia_audio(path, "chunk decode", req.target_sample_rate)?;
    let track = info
        .track()
        .ok_or_else(|| anyhow!("probed audio track disappeared"))?;

    match make_symphonia_decoder(track) {
        Ok(decoder) => {
            let source_rate = info.sample_rate;
            let channels = info.channels;
            let time_base = info.time_base;
            Ok(LayerDecoder::Symphonia(SymphoniaDecoder {
                path: path.to_string(),
                format: info.format,
                decoder,
                track_id: info.track_id,
                source_rate,
                channels,
                time_base,
                resampler: None,
                last_resample_ratio: 0.0,
                resampler_primed: false,
                last_decode_end_sec: 0.0,
                resample_remainder: vec![Vec::new(); channels],
                resample_output_remainder: Vec::new(),
            }))
        }
        Err(_) => {
            log::warn!("[audio] symphonia cannot decode codec; ffmpeg streaming fallback: {path}");
            Ok(LayerDecoder::Ffmpeg(FfmpegStreamSource::new(path)))
        }
    }
}

impl LayerDecoder {
    fn path(&self) -> &str {
        match self {
            LayerDecoder::Symphonia(d) => &d.path,
            LayerDecoder::Ffmpeg(d) => &d.path,
        }
    }

    fn decode_chunk(&mut self, req: &StreamChunkRequest) -> Result<Vec<f32>> {
        match self {
            LayerDecoder::Symphonia(d) => d.decode_chunk(req),
            LayerDecoder::Ffmpeg(d) => d.decode_chunk(req),
        }
    }
}

/// Per-chunk decode parameters threaded into the decode/resample loop. All scalar
/// (Copy) so the loop body can destructure it into plain locals.
#[derive(Clone, Copy)]
struct ChunkDecodeCtx {
    /// Interleaved output samples this chunk must produce.
    target_samples: usize,
    /// Source frames spanning the chunk's timeline duration (sizes the decode batch).
    chunk_source_frames: usize,
    output_channels: usize,
    target_sample_rate: u32,
    speed: f64,
    /// target_rate / (source_rate * speed); reused when the channel layout changes.
    current_ratio: f64,
    /// Whether the resampler is engaged (rate/speed differ from passthrough).
    resampling_active: bool,
}

impl SymphoniaDecoder {
    /// Decodes one chunk of `timeline_duration_sec` to interleaved f32 at the target
    /// rate/channels, continuing sequentially from the previous chunk where possible
    /// and reseeking only on a discontinuity (or any reverse chunk).
    fn decode_chunk(&mut self, req: &StreamChunkRequest) -> Result<Vec<f32>> {
        let target_sample_rate = req.target_sample_rate;
        let output_channels = req.output_channels;
        let speed = req.speed;
        let source_start_sec = req.source_start_sec;
        let timeline_duration_sec = req.timeline_duration_sec;
        let target_samples = (timeline_duration_sec.max(0.0) * target_sample_rate as f64).round()
            as usize
            * output_channels;

        let source_advance_sec = timeline_duration_sec * speed;
        let current_ratio = target_sample_rate as f64 / (self.source_rate as f64 * speed);

        // Phase 1: reseek on a discontinuity (or any reverse chunk) and re-prime the
        // resampler. `None` means the seek landed past end-of-stream → emit silence.
        let discard_frames_remaining =
            match self.seek_and_reprime(req, current_ratio, source_advance_sec)? {
                Some(discard) => discard,
                None => return Ok(vec![0.0f32; target_samples]),
            };

        // Phase 2: (re)build the resampler for this chunk's ratio if needed.
        let resampling_active =
            !((current_ratio - 1.0).abs() < 1e-6 && self.source_rate == target_sample_rate);
        self.ensure_resampler(current_ratio, resampling_active)?;

        // Source frames spanning this chunk's timeline duration. Used only to size the
        // per-iteration decode batch and to advance the logical decode cursor — the
        // amount we actually decode is driven by how much OUTPUT we still need.
        let chunk_source_frames =
            (timeline_duration_sec * speed * self.source_rate as f64).round() as usize;

        // Phase 3: decode + resample until a full chunk of output is collected (or EOF),
        // flushing the resampler's group-delay tail at end-of-stream.
        let ctx = ChunkDecodeCtx {
            target_samples,
            chunk_source_frames,
            output_channels,
            target_sample_rate,
            speed,
            current_ratio,
            resampling_active,
        };
        let (mut combined, total_collected, hit_eof) =
            self.fill_chunk_output(&ctx, discard_frames_remaining)?;

        if total_collected == 0 && combined.is_empty() {
            self.last_decode_end_sec = source_start_sec;
            return Ok(vec![0.0f32; target_samples]);
        }

        let out = if combined.len() >= target_samples {
            self.resample_output_remainder = combined.split_off(target_samples);
            combined
        } else {
            combined.resize(target_samples, 0.0);
            combined
        };
        self.resampler_primed = true;

        // Advance the logical cursor by exactly one chunk on a complete decode. The
        // loop may have read AHEAD of this (its surplus is buffered in
        // `resample_output_remainder`), so the cursor tracks the logical timeline
        // position, not the physical reader position — the next sequential chunk's
        // `source_start` then matches and skips a reseek. On EOF the source ran out
        // before a full chunk, so leave the cursor put (the producer's next advance
        // will exceed the seek tolerance and reseek, as before).
        let logical_source_end_sec = source_start_sec + source_advance_sec;
        self.last_decode_end_sec = if hit_eof {
            source_start_sec
        } else {
            logical_source_end_sec
        };

        Ok(out)
    }

    /// Phase 1: seeks to `req.source_start_sec` when the request isn't a sequential
    /// continuation (or is reversed) and re-primes the resampler/remainder state.
    /// Returns the number of leading source frames to discard so decoding starts exactly
    /// at the requested position, or `None` if the seek landed past end-of-stream (the
    /// caller emits a silent chunk).
    fn seek_and_reprime(
        &mut self,
        req: &StreamChunkRequest,
        current_ratio: f64,
        source_advance_sec: f64,
    ) -> Result<Option<usize>> {
        let source_start_sec = req.source_start_sec;
        let seek_tolerance_sec =
            (source_advance_sec.abs() * SEEK_TOLERANCE_CHUNK_FRACTION).max(SEEK_TOLERANCE_MIN_SEC);
        let needs_seek = req.reverse
            || source_start_sec < self.last_decode_end_sec - seek_tolerance_sec
            || source_start_sec > self.last_decode_end_sec + seek_tolerance_sec;
        if !needs_seek {
            return Ok(Some(0));
        }

        let seeked_to = match self.format.seek(
            symphonia::core::formats::SeekMode::Accurate,
            symphonia::core::formats::SeekTo::Time {
                time: symphonia::core::units::Time {
                    seconds: source_start_sec.floor() as u64,
                    frac: source_start_sec.fract(),
                },
                track_id: Some(self.track_id),
            },
        ) {
            Ok(seeked_to) => seeked_to,
            Err(error) if is_audio_seek_past_end(&error) => {
                self.last_decode_end_sec = source_start_sec;
                return Ok(None);
            }
            Err(error) => return Err(error).context("failed to seek in format reader"),
        };

        self.decoder.reset();
        if self.resampler.is_some() && (self.last_resample_ratio - current_ratio).abs() <= 1e-6 {
            if let Some(r) = self.resampler.as_mut() {
                use rubato::Resampler;
                r.reset();
            }
        } else {
            self.resampler = None;
        }
        self.resample_remainder = vec![Vec::new(); self.channels];
        self.resample_output_remainder.clear();
        self.last_resample_ratio = current_ratio;
        self.resampler_primed = false;

        let actual_sec = {
            let t = self.time_base.calc_time(seeked_to.actual_ts);
            t.seconds as f64 + t.frac
        };
        let discard_frames = if actual_sec <= source_start_sec {
            let discard_sec = source_start_sec - actual_sec;
            (discard_sec * self.source_rate as f64).floor() as usize
        } else {
            0
        };
        Ok(Some(discard_frames))
    }

    /// Phase 2: drops a resampler whose ratio no longer matches and builds a fresh one
    /// when resampling is engaged but none is cached. Records the active ratio either way.
    fn ensure_resampler(&mut self, current_ratio: f64, resampling_active: bool) -> Result<()> {
        if self.resampler.is_some() && (self.last_resample_ratio - current_ratio).abs() > 1e-6 {
            self.resampler = None;
            self.resample_remainder = vec![Vec::new(); self.channels];
            self.resample_output_remainder.clear();
            self.resampler_primed = false;
        }
        self.last_resample_ratio = current_ratio;

        if resampling_active && self.resampler.is_none() {
            self.resampler = Some(Box::new(make_sinc_resampler(current_ratio, self.channels)?));
            self.resample_remainder = vec![Vec::new(); self.channels];
            self.resampler_primed = false;
        }
        Ok(())
    }

    /// Phase 3: decode source packets and resample until a full chunk of OUTPUT is
    /// collected (or end-of-stream), draining the resampler's sub-block remainder and
    /// group-delay tail at EOF. Returns the interleaved output (possibly longer than the
    /// chunk; the surplus is stashed in `resample_output_remainder` by the caller), the
    /// source frames collected, and whether EOF was hit.
    fn fill_chunk_output(
        &mut self,
        ctx: &ChunkDecodeCtx,
        mut discard_frames_remaining: usize,
    ) -> Result<(Vec<f32>, usize, bool)> {
        let ChunkDecodeCtx {
            target_samples,
            chunk_source_frames,
            output_channels,
            target_sample_rate,
            speed,
            current_ratio,
            resampling_active,
        } = *ctx;

        // Output already buffered from previous chunks' resampler surplus. The decode
        // loop tops this up to a full chunk; the surplus is carried to the next chunk.
        let mut combined = std::mem::take(&mut self.resample_output_remainder);

        // Decode source in blocks and resample until we have a full chunk of OUTPUT
        // (or hit end-of-stream). This is the core invariant that prevents periodic
        // silent chunks: `SincFixedIn` only emits output once a full input block
        // accumulates, so for an upsampled source (rate well below the device rate,
        // e.g. an 8 kHz clip on a 48 kHz device → only ~400 source frames per 50 ms
        // chunk) a block fills just once every few chunks. Decoding a FIXED per-chunk
        // source amount and zero-padding the shortfall therefore dropped a fully-silent
        // 50 ms chunk in every inter-burst valley (heard as glitchy/"fast" playback
        // until the background precache swapped in the gap-free whole-file decode).
        // Driving the decode by an OUTPUT target instead guarantees every chunk is
        // filled; the resampler's variable per-block surplus is carried in `combined`
        // so the source read-ahead stays bounded (≈ one block) rather than growing.
        let mut total_collected = 0usize;
        let mut hit_eof = false;
        // Drop the resampler's group-delay region exactly once, on the first resample
        // after a (re)prime, so the first emitted chunk isn't short by the resampler
        // latency. Queried after the first resample (the resampler may have just been
        // created) and carried across batches in case the first batch is shorter than
        // the delay.
        let mut needs_delay_drop = resampling_active && !self.resampler_primed;
        let mut pending_delay_samples = 0usize;

        while combined.len() < target_samples {
            // Batch large enough to cross at least one resampler input block so each
            // iteration makes guaranteed progress (covers the chunk span plus read-ahead).
            let batch_target = chunk_source_frames.max(RESAMPLER_CHUNK_SIZE);
            let batch = self.decode_source_batch(
                batch_target,
                &mut discard_frames_remaining,
                current_ratio,
            )?;
            if batch.hit_eof {
                hit_eof = true;
            }
            if batch.channel_layout_changed {
                // Channel layout changed mid-stream: the old resampler and any
                // already-collected output are invalid. Restart this chunk's
                // accumulation cleanly and re-prime.
                combined.clear();
                needs_delay_drop = resampling_active;
                pending_delay_samples = 0;
            }

            if batch.batch_collected == 0 {
                hit_eof = true;
                break;
            }
            total_collected += batch.batch_collected;

            let resampled =
                resample_planar_cached(crate::audio::resample::ResamplePlanarCachedParams {
                    input: batch.planar_buffers,
                    source_rate: self.source_rate,
                    target_rate: target_sample_rate,
                    speed,
                    num_channels: self.channels,
                    cached_resampler: &mut self.resampler,
                    remainder: &mut self.resample_remainder,
                })?;
            if needs_delay_drop {
                use rubato::Resampler;
                pending_delay_samples = self
                    .resampler
                    .as_ref()
                    .map(|r| r.output_delay())
                    .unwrap_or(0)
                    * output_channels;
                needs_delay_drop = false;
            }

            let mut interleaved = planar_to_interleaved(&resampled, output_channels);
            if pending_delay_samples > 0 {
                let drop = pending_delay_samples.min(interleaved.len());
                interleaved.drain(0..drop);
                pending_delay_samples -= drop;
            }
            combined.extend_from_slice(&interleaved);

            if hit_eof {
                break;
            }
        }

        // End-of-stream flush: the streaming resampler carries a sub-block input
        // remainder and trails the signal by its group delay. Without draining both at
        // EOF the clip's final ~block-plus-delay of audio would be replaced by the
        // zero-padding below (heard as the tail cutting abruptly to silence). Only
        // meaningful while actually resampling and still short of a full chunk.
        if hit_eof && resampling_active && combined.len() < target_samples {
            let flushed = self.flush_resampler_tail(
                needs_delay_drop,
                target_sample_rate,
                speed,
                output_channels,
            )?;
            combined.extend_from_slice(&flushed);
        }

        Ok((combined, total_collected, hit_eof))
    }

    /// Decode source packets into planar buffers up to `batch_target` post-discard
    /// frames, stopping at a PACKET boundary (never mid-packet — see below), or at
    /// EOF. Decrements the shared `discard_frames_remaining` counter and, on a
    /// mid-stream channel-count increase, rebuilds the resampler and reports it via
    /// `channel_layout_changed` so the caller can restart chunk accumulation.
    fn decode_source_batch(
        &mut self,
        batch_target: usize,
        discard_frames_remaining: &mut usize,
        current_ratio: f64,
    ) -> Result<DecodedBatch> {
        let mut planar_buffers = vec![Vec::new(); self.channels];
        let mut batch_collected = 0usize;
        let mut batch_full = false;
        let mut hit_eof = false;
        let mut channel_layout_changed = false;

        while !batch_full {
            let packet = match self.format.next_packet() {
                Ok(packet) => packet,
                Err(symphonia::core::errors::Error::IoError(ref err))
                    if err.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    hit_eof = true;
                    break;
                }
                Err(err) => return Err(err).context("failed to read next packet"),
            };

            if packet.track_id() != self.track_id {
                continue;
            }

            match self.decoder.decode(&packet) {
                Ok(audio_buf) => {
                    let spec = *audio_buf.spec();
                    let duration = audio_buf.frames() as u64;
                    let mut sample_buf =
                        symphonia::core::audio::SampleBuffer::<f32>::new(duration, spec);
                    sample_buf.copy_interleaved_ref(audio_buf);

                    let samples = sample_buf.samples();
                    let num_channels = spec.channels.count();
                    let num_frames = samples.len() / num_channels;
                    if num_channels > self.channels {
                        for _ in self.channels..num_channels {
                            planar_buffers.push(vec![0.0; batch_collected]);
                        }
                        self.channels = num_channels;
                        self.resampler = None;
                        self.resample_remainder = vec![Vec::new(); self.channels];
                        self.last_resample_ratio = current_ratio;
                        channel_layout_changed = true;
                    }

                    for frame in 0..num_frames {
                        if *discard_frames_remaining > 0 {
                            *discard_frames_remaining -= 1;
                            continue;
                        }
                        for ch in 0..self.channels {
                            let sample = if ch < num_channels {
                                samples[frame * num_channels + ch]
                            } else {
                                0.0
                            };
                            planar_buffers[ch].push(sample);
                        }
                        batch_collected += 1;
                    }
                    // Stop reading once the batch target is met, but only at this PACKET
                    // boundary — never mid-packet. A decoded packet is consumed in full
                    // and the (bounded, ≤ one packet) over-read rides along: it resamples
                    // into `combined` and the surplus past `target_samples` is carried to
                    // the next chunk via `resample_output_remainder`. Breaking mid-packet
                    // and dropping the remaining frames (the demuxer has already advanced
                    // past them, and the next sequential chunk does NOT reseek) silently
                    // lost ~20-28% of every chunk's audio — heard on export as faster,
                    // crackly playback.
                    if batch_collected >= batch_target {
                        batch_full = true;
                    }
                }
                Err(symphonia::core::errors::Error::IoError(ref err))
                    if err.kind() == std::io::ErrorKind::UnexpectedEof =>
                {
                    hit_eof = true;
                    break;
                }
                Err(symphonia::core::errors::Error::DecodeError(err)) => {
                    log::warn!("[audio] symphonia chunk decode error: {:?}", err);
                    continue;
                }
                Err(err) => return Err(err).context("failed to decode packet"),
            }
        }

        Ok(DecodedBatch {
            planar_buffers,
            batch_collected,
            hit_eof,
            channel_layout_changed,
        })
    }

    /// Drain the streaming resampler at end-of-stream: its sub-block input remainder
    /// plus group-delay tail, returning the interleaved tail to append. Without this
    /// the clip's final ~block-plus-delay of audio would be lost to zero-padding (the
    /// tail cutting abruptly to silence). `needs_delay_drop` is set when this session
    /// never emitted a resampled block (clip shorter than one input block), so its
    /// initial priming delay still has to be dropped from the flushed output.
    fn flush_resampler_tail(
        &mut self,
        needs_delay_drop: bool,
        target_sample_rate: u32,
        speed: f64,
        output_channels: usize,
    ) -> Result<Vec<f32>> {
        let mut pending_delay_samples = 0usize;
        if needs_delay_drop {
            use rubato::Resampler;
            pending_delay_samples = self
                .resampler
                .as_ref()
                .map(|r| r.output_delay())
                .unwrap_or(0)
                * output_channels;
        }
        let flushed = resample_flush_cached(crate::audio::resample::ResampleFlushCachedParams {
            source_rate: self.source_rate,
            target_rate: target_sample_rate,
            speed,
            num_channels: self.channels,
            cached_resampler: &mut self.resampler,
            remainder: &mut self.resample_remainder,
        })?;
        let mut interleaved = planar_to_interleaved(&flushed, output_channels);
        if pending_delay_samples > 0 {
            let drop = pending_delay_samples.min(interleaved.len());
            interleaved.drain(0..drop);
        }
        Ok(interleaved)
    }
}

impl FfmpegStreamSource {
    fn new(path: &str) -> Self {
        // rate/channels 0 force a (re)spawn on the first chunk, which sets them.
        Self {
            path: path.to_string(),
            sample_rate: 0,
            channels: 0,
            next_source_sec: 0.0,
            reader: None,
        }
    }

    /// Decodes one chunk. Forward 1× chunks read on from the LONG-LIVED ffmpeg/swr
    /// child so back-to-back chunks are sample-continuous (no per-chunk reseek → no
    /// boundary clicks); a non-sequential request or a target rate/channel change
    /// reseeks by killing and respawning ffmpeg. Speed/reverse chunks (rare for an
    /// ffmpeg-only codec) fall to a per-chunk one-shot `ffmpeg -ss` decode.
    fn decode_chunk(&mut self, req: &StreamChunkRequest) -> Result<Vec<f32>> {
        if req.reverse || (req.speed - 1.0).abs() > 1e-6 {
            return decode_chunk_ffmpeg(DecodeChunkFfmpegParams {
                path: &self.path,
                source_start_sec: req.source_start_sec,
                timeline_duration_sec: req.timeline_duration_sec,
                speed: req.speed,
                target_sample_rate: req.target_sample_rate,
                output_channels: req.output_channels,
            });
        }

        let output_channels = req.output_channels.max(1);
        let target_sample_rate = req.target_sample_rate;
        let source_start_sec = req.source_start_sec;
        let timeline_duration_sec = req.timeline_duration_sec;
        let target_samples = (timeline_duration_sec.max(0.0) * target_sample_rate as f64).round()
            as usize
            * output_channels;
        if target_samples == 0 {
            return Ok(Vec::new());
        }

        // Continue the running stream only if this request resumes ~where it left off
        // at the SAME target rate/channels. Tolerance mirrors `SymphoniaDecoder`: a
        // quarter-chunk of scheduling jitter. A rate/channel change or a jump kills the
        // child (via `FfmpegPcmReader::drop`) and respawns at the new position/format.
        let seek_tolerance_sec = (timeline_duration_sec.abs() * SEEK_TOLERANCE_CHUNK_FRACTION)
            .max(SEEK_TOLERANCE_MIN_SEC);
        let format_changed =
            self.sample_rate != target_sample_rate || self.channels != output_channels;
        let needs_seek = format_changed
            || self.reader.is_none()
            || (source_start_sec - self.next_source_sec).abs() > seek_tolerance_sec;

        if needs_seek {
            // Drop any prior stream (kills its child) before spawning a fresh one with
            // NO `-t` so it streams from `source_start_sec` to EOF; read it chunk-by-chunk.
            drop(self.reader.take());
            let reader = spawn_ffmpeg_f32le(FfmpegDecodeParams {
                path: Path::new(&self.path),
                start_sec: source_start_sec.max(0.0),
                duration_sec: None,
                target_sample_rate,
                output_channels,
            })?;
            self.sample_rate = target_sample_rate;
            self.channels = output_channels;
            self.next_source_sec = source_start_sec.max(0.0);
            self.reader = Some(reader);
        }

        let (mut samples, hit_eof) = match self.reader.as_mut() {
            Some(reader) => reader.read_f32(target_samples)?,
            // Stream already exhausted (past source end): serve silence, stay sequential.
            None => (Vec::new(), true),
        };

        // Advance the logical cursor by the frames actually produced (a short read at
        // EOF advances by less), so a later sequential chunk past the end still matches
        // `next_source_sec` and serves silence without a needless respawn.
        let produced_frames = samples.len() / output_channels;
        self.next_source_sec += produced_frames as f64 / target_sample_rate as f64;
        if hit_eof {
            // Stream ended; release the child now (its bytes are fully drained).
            self.reader = None;
        }

        if samples.len() < target_samples {
            samples.resize(target_samples, 0.0);
        }

        Ok(samples)
    }
}

struct DecodeChunkFfmpegParams<'a> {
    path: &'a str,
    source_start_sec: f64,
    timeline_duration_sec: f64,
    speed: f64,
    target_sample_rate: u32,
    output_channels: usize,
}

fn decode_chunk_ffmpeg(params: DecodeChunkFfmpegParams<'_>) -> Result<Vec<f32>> {
    let DecodeChunkFfmpegParams {
        path,
        source_start_sec,
        timeline_duration_sec,
        speed,
        target_sample_rate,
        output_channels,
    } = params;
    let target_samples = (timeline_duration_sec.max(0.0) * target_sample_rate as f64).round()
        as usize
        * output_channels;
    let source_duration_sec = timeline_duration_sec.max(0.0) * speed.abs().max(1e-6);
    let mut samples = decode_range_ffmpeg(
        Path::new(path),
        source_start_sec,
        source_duration_sec,
        target_sample_rate,
        output_channels,
    )
    .context("failed to decode Opus audio chunk via ffmpeg")?;

    let channels = output_channels.max(1);
    let target_frames = target_samples / channels;
    let source_frames = samples.len() / channels;

    if source_frames > 0 && source_frames != target_frames {
        samples = resample_interleaved_linear(&samples, channels, target_frames);
    }

    if samples.len() > target_samples {
        samples.truncate(target_samples);
    } else {
        samples.resize(target_samples, 0.0);
    }
    Ok(samples)
}

fn resample_interleaved_linear(input: &[f32], channels: usize, target_frames: usize) -> Vec<f32> {
    if channels == 0 || target_frames == 0 {
        return Vec::new();
    }
    let source_frames = input.len() / channels;
    if source_frames == 0 {
        return vec![0.0; target_frames * channels];
    }
    if source_frames == 1 {
        let mut out = vec![0.0; target_frames * channels];
        for frame in 0..target_frames {
            for ch in 0..channels {
                out[frame * channels + ch] = input[ch];
            }
        }
        return out;
    }

    let mut out = vec![0.0; target_frames * channels];
    let scale = source_frames as f64 / target_frames.max(1) as f64;
    for frame in 0..target_frames {
        let pos = (frame as f64 + 0.5) * scale - 0.5;
        let left = pos.floor().max(0.0) as usize;
        let right = (left + 1).min(source_frames - 1);
        let frac = (pos - left as f64).clamp(0.0, 1.0) as f32;
        for ch in 0..channels {
            let a = input[left * channels + ch];
            let b = input[right * channels + ch];
            out[frame * channels + ch] = a + (b - a) * frac;
        }
    }
    out
}

pub(crate) struct DecodeAudioChunkParams<'a> {
    pub layer_id: &'a str,
    pub path: &'a str,
    pub source_start_sec: f64,
    pub timeline_duration_sec: f64,
    pub speed: f64,
    pub target: AudioRenderTarget,
    pub reverse: bool,
    pub shared: &'a Arc<(Mutex<AudioShared>, Condvar)>,
}

pub(crate) fn decode_audio_chunk(params: DecodeAudioChunkParams<'_>) -> Result<Vec<f32>> {
    let DecodeAudioChunkParams {
        layer_id,
        path,
        source_start_sec,
        timeline_duration_sec,
        speed,
        target,
        reverse,
        shared,
    } = params;
    let sample_rate = target.sample_rate;
    let output_channels = target.channels;
    let source_start_sec = if source_start_sec.is_finite() {
        source_start_sec.max(0.0)
    } else {
        0.0
    };
    let timeline_duration_sec = if timeline_duration_sec.is_finite() {
        timeline_duration_sec.max(0.0)
    } else {
        0.0
    };
    // Only forward, 1× clips are served from a window; reverse / speed-shifted
    // clips always stream (the window is a contiguous forward buffer).
    let is_cacheable = (speed - 1.0).abs() <= 1e-6 && !reverse;

    let stream = || {
        stream_layer_chunk(StreamChunkParams {
            layer_id,
            path,
            source_start_sec,
            timeline_duration_sec,
            speed,
            target_sample_rate: sample_rate,
            output_channels,
            reverse,
            shared,
        })
    };

    // Export is offline (no realtime deadline) and mixes strictly FORWARD, so the
    // per-layer streaming decoder stays sequential (one seek, then sequential
    // decode) and is gap-free from the first chunk thanks to the resampler-priming
    // fix. No window / whole-file decode is needed — and never reading the whole
    // file keeps export bounded for tens-of-GB sources too.
    if !is_cacheable || target.is_export() {
        return stream();
    }

    let start_frame = (source_start_sec * sample_rate as f64).round() as usize;
    let frames_to_read = (timeline_duration_sec * sample_rate as f64).round() as usize;
    let samples_to_read = frames_to_read * output_channels;

    // Look for a window covering this chunk. On a hit, copy out of it (window-
    // relative) — the realtime fast path is a lock + Arc clone + memcpy.
    let (hit, window_end_frame) = {
        let state = shared.0.lock();
        match state.layer_windows.get(layer_id) {
            // The window must be for THIS layer's current path: a stale window left from
            // a previous path (proxy swap / media replace) holds the wrong file's PCM.
            Some(w)
                if w.path == path
                    && w.covers(start_frame, frames_to_read, sample_rate, output_channels) =>
            {
                (
                    Some((w.samples.clone(), w.source_start_frame)),
                    Some(w.end_frame()),
                )
            }
            // A window exists but doesn't cover this request (e.g. after a seek):
            // treat as a miss but still report its end so we don't refill needlessly.
            _ => (None, None),
        }
    };
    let source_end_frame = source_end_frame_for_layer(shared, layer_id, sample_rate);

    if let Some((samples, win_start)) = hit {
        let rel = (start_frame - win_start) * output_channels;
        let mut result = vec![0.0f32; samples_to_read];
        let available = samples.len().saturating_sub(rel).min(samples_to_read);
        if available > 0 {
            result[..available].copy_from_slice(&samples[rel..rel + available]);
        }
        // Refill-ahead: once less than `REFILL_MARGIN_SEC` of look-ahead remains,
        // slide the window forward so steady state stays on the memcpy fast path.
        // Target the CURRENT playhead (not the window end) so the new, overlapping
        // window still covers this position — replacing it with a forward-only
        // window would leave the playhead in a gap and thrash (miss → refill → …).
        if let Some(end) = window_end_frame {
            let margin_frames = (REFILL_MARGIN_SEC * sample_rate as f64) as usize;
            // A window materially shorter than a full `WINDOW_SEC` was clamped by the
            // source EOF (the only way `decode_range_symphonia` returns less), so its
            // end already IS the source end. Catch this even when the clip declares no
            // explicit source range (`source_end_frame == None`) — otherwise the last
            // few seconds of such a clip re-decode a shrinking tail every chunk. One
            // slack second absorbs resampler rounding on a genuinely full window. (A
            // false positive only suppresses refill; the miss path then streams the
            // gap inline, so it can never cause an audible drop.)
            let full_window_frames = (WINDOW_SEC * sample_rate as f64) as usize;
            let window_reached_eof = end.saturating_sub(win_start)
                < full_window_frames.saturating_sub(sample_rate as usize);
            let reached_source_end =
                window_reached_eof || source_end_frame.is_some_and(|source_end| end >= source_end);
            // Keep exactly ONE refill in flight per layer. The target tracks the moving
            // playhead, so a per-start dedup in `spawn_window_fill` never matched during
            // the margin window and the burst spawned several overlapping `WINDOW_SEC`
            // decodes that superseded and discarded each other — wasted disk/CPU that
            // competes with the producer's own inline reads. Gating on "any fill for
            // this layer" keeps a single forward-slide running until it lands.
            let already_filling = { shared.0.lock().window_fill_in_flight.contains_key(layer_id) };
            if !reached_source_end
                && !already_filling
                && end.saturating_sub(start_frame + frames_to_read) < margin_frames
            {
                spawn_window_fill(
                    shared,
                    layer_id,
                    path,
                    start_frame,
                    sample_rate,
                    output_channels,
                    WindowFillPriority::Live,
                );
            }
        }
        return Ok(result);
    }

    // Miss (no window yet, or the playhead jumped outside it after a seek). Kick off
    // a bounded background fill at this position AND stream this one chunk inline so
    // there is no audible gap while the window fills. Inline streaming a single chunk
    // is cheap (~1ms); the long ranged decode stays off the realtime thread.
    spawn_window_fill(
        shared,
        layer_id,
        path,
        start_frame,
        sample_rate,
        output_channels,
        WindowFillPriority::Live,
    );
    stream()
}

fn source_end_frame_for_layer(
    shared: &Arc<(Mutex<AudioShared>, Condvar)>,
    layer_id: &str,
    sample_rate: u32,
) -> Option<usize> {
    let state = shared.0.lock();
    let layer = state.scene.iter().find(|layer| layer.id == layer_id)?;
    if !layer.source_start_sec.is_finite()
        || !layer.source_range_duration_sec.is_finite()
        || layer.source_range_duration_sec <= 0.0
    {
        return None;
    }
    Some(((layer.source_start_sec + layer.source_range_duration_sec) * sample_rate as f64) as usize)
}

fn is_audio_seek_past_end(error: &symphonia::core::errors::Error) -> bool {
    matches!(
        error,
        symphonia::core::errors::Error::IoError(err)
            if err.kind() == std::io::ErrorKind::UnexpectedEof
    ) || matches!(
        error,
        symphonia::core::errors::Error::SeekError(
            symphonia::core::errors::SeekErrorKind::OutOfRange,
        )
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::shared::AudioShared;
    use std::process::Command;

    #[test]
    fn no_audio_track_error_is_detected_through_context_chain() {
        reset_silent_paths_for_test();
        let base = anyhow!(NO_AUDIO_TRACK_MSG);
        let wrapped = base.context("decode audio layer clip_v2_x__audio");
        assert!(
            is_no_audio_track_error(&wrapped),
            "the no-audio condition must be recognised even when wrapped in mixer context"
        );

        let other = anyhow!("disk read failed").context("decode audio layer clip_v2_y__audio");
        assert!(!is_no_audio_track_error(&other));
    }

    #[test]
    fn silent_path_cache_records_once_and_short_circuits() {
        reset_silent_paths_for_test();
        let path = "/tmp/fastcat-video-only-source.mp4";
        assert!(!path_known_silent(path));
        remember_silent_path(path);
        assert!(path_known_silent(path));
        // Idempotent: remembering again is a no-op (the info log fires only once).
        remember_silent_path(path);
        assert!(path_known_silent(path));
    }

    fn write_temp_f32_wav(
        sample_rate: u32,
        channels: usize,
        frames: usize,
    ) -> anyhow::Result<std::path::PathBuf> {
        use std::io::{Seek, Write};
        let mut path = std::env::temp_dir();
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| anyhow::anyhow!("system time error: {e}"))?
            .as_nanos();
        path.push(format!("fastcat-audio-test-{unique}.wav"));

        let mut file = std::fs::File::create(&path)?;
        let bits_per_sample = 32u16;
        let bytes_per_sample = (bits_per_sample / 8) as u32;
        let data_size = 0u32;
        let riff_size = 36u32.saturating_add(data_size);
        file.write_all(b"RIFF")?;
        file.write_all(&riff_size.to_le_bytes())?;
        file.write_all(b"WAVE")?;
        file.write_all(b"fmt ")?;
        file.write_all(&16u32.to_le_bytes())?;
        file.write_all(&3u16.to_le_bytes())?;
        file.write_all(&(channels as u16).to_le_bytes())?;
        file.write_all(&sample_rate.to_le_bytes())?;
        let byte_rate = sample_rate
            .saturating_mul(channels as u32)
            .saturating_mul(bytes_per_sample);
        file.write_all(&byte_rate.to_le_bytes())?;
        let block_align = (channels as u16).saturating_mul(bytes_per_sample as u16);
        file.write_all(&block_align.to_le_bytes())?;
        file.write_all(&bits_per_sample.to_le_bytes())?;
        file.write_all(b"data")?;
        file.write_all(&data_size.to_le_bytes())?;

        for frame in 0..frames {
            let sample =
                ((frame as f32 / sample_rate as f32) * 440.0 * std::f32::consts::TAU).sin() * 0.25;
            for _ in 0..channels {
                file.write_all(&sample.to_le_bytes())?;
            }
        }
        let data_size = (frames * channels * std::mem::size_of::<f32>()) as u32;
        file.seek(std::io::SeekFrom::Start(4))?;
        file.write_all(&(36u32 + data_size).to_le_bytes())?;
        file.seek(std::io::SeekFrom::Start(40))?;
        file.write_all(&data_size.to_le_bytes())?;

        Ok(path)
    }

    #[test]
    fn decode_range_symphonia_decodes_mp3() -> anyhow::Result<()> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/media/sample-1s-audio.mp3"
        );
        // 2s range covers the whole ~1s fixture.
        let samples = decode_range_symphonia(path, 0.0, 2.0, 48000, 2)?;
        assert!(!samples.is_empty(), "Decoded sample buffer is empty");
        Ok(())
    }

    #[test]
    fn decode_range_symphonia_webm_opus_uses_ffmpeg_fallback() -> anyhow::Result<()> {
        let wav_path = write_temp_f32_wav(48_000, 2, 4_800)?;
        let mut webm_path = wav_path.clone();
        webm_path.set_extension("webm");

        let status = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-i",
                wav_path.to_string_lossy().as_ref(),
                "-c:a",
                "libopus",
                webm_path.to_string_lossy().as_ref(),
            ])
            .status();

        let Ok(status) = status else {
            let _ = std::fs::remove_file(wav_path);
            return Ok(());
        };
        if !status.success() {
            let _ = std::fs::remove_file(wav_path);
            let _ = std::fs::remove_file(webm_path);
            return Ok(());
        }

        let samples = decode_range_symphonia(&webm_path.to_string_lossy(), 0.0, 2.0, 48_000, 2)?;
        assert!(
            samples.len() >= 4_800 * 2,
            "decoded Opus fallback should produce PCM samples"
        );

        let _ = std::fs::remove_file(wav_path);
        let _ = std::fs::remove_file(webm_path);
        Ok(())
    }

    #[test]
    fn decode_audio_chunk_ogg_opus_uses_ffmpeg_fallback() -> anyhow::Result<()> {
        let wav_path = write_temp_f32_wav(48_000, 2, 24_000)?;
        let mut opus_path = wav_path.clone();
        opus_path.set_extension("opus");

        let status = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-i",
                wav_path.to_string_lossy().as_ref(),
                "-c:a",
                "libopus",
                opus_path.to_string_lossy().as_ref(),
            ])
            .status();

        let Ok(status) = status else {
            let _ = std::fs::remove_file(wav_path);
            return Ok(());
        };
        if !status.success() {
            let _ = std::fs::remove_file(wav_path);
            let _ = std::fs::remove_file(opus_path);
            return Ok(());
        }

        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let decoded = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "opus-layer",
            path: &opus_path.to_string_lossy(),
            source_start_sec: 0.1,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target: AudioRenderTarget::monitor(48_000, 2),
            reverse: false,
            shared: &shared,
        })?;

        assert_eq!(decoded.len(), (0.05f64 * 48_000.0).round() as usize * 2);
        assert!(
            decoded.iter().any(|sample| sample.abs() > 1e-6),
            "decoded Opus chunk should contain PCM samples"
        );

        let _ = std::fs::remove_file(wav_path);
        let _ = std::fs::remove_file(opus_path);
        Ok(())
    }

    /// Export streams an Opus clip via back-to-back 50 ms `decode_audio_chunk` calls.
    /// Each chunk must read on from ONE long-lived ffmpeg/swr session (cached in
    /// `ffmpeg_decoders`), not a fresh `ffmpeg -ss` per chunk — otherwise each chunk's
    /// independent seek + resampler priming leaves a discontinuity at the boundary
    /// (the occasional clicks heard in Opus-audio exports). Proven by: the per-chunk
    /// concatenation must match a single whole-range ffmpeg decode, AND exactly one
    /// ffmpeg child is cached after the run (sequential reuse, not per-chunk respawn).
    #[test]
    fn export_opus_streams_sequentially_without_boundary_discontinuity() -> anyhow::Result<()> {
        let rate = 48_000u32;
        let wav_path = write_temp_f32_wav(rate, 1, rate as usize)?; // 1 s, 440 Hz tone
        let mut opus_path = wav_path.clone();
        opus_path.set_extension("opus");
        let encoded = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-i",
                wav_path.to_string_lossy().as_ref(),
                "-c:a",
                "libopus",
                opus_path.to_string_lossy().as_ref(),
            ])
            .status();
        let _ = std::fs::remove_file(&wav_path);
        match encoded {
            Ok(status) if status.success() => {}
            _ => return Ok(()), // ffmpeg/libopus unavailable: skip
        }
        let opus_str = opus_path.to_string_lossy().to_string();

        let chunk_sec = 0.05f64;
        let num_chunks = 10usize; // 0.5 s, well inside the tone
        let chunk_frames = (chunk_sec * rate as f64).round() as usize;

        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let mut stream: Vec<f32> = Vec::new();
        for k in 0..num_chunks {
            let chunk = decode_audio_chunk(DecodeAudioChunkParams {
                layer_id: "export-opus",
                path: &opus_str,
                source_start_sec: k as f64 * chunk_sec,
                timeline_duration_sec: chunk_sec,
                speed: 1.0,
                target: AudioRenderTarget::export(rate, 1),
                reverse: false,
                shared: &shared,
            })?;
            assert_eq!(chunk.len(), chunk_frames, "each export chunk must be exact");
            stream.extend_from_slice(&chunk);
        }

        // Exactly one long-lived ffmpeg child served all chunks (no per-chunk respawn).
        {
            let state = shared.0.lock();
            assert!(
                matches!(
                    state.decoders.get("export-opus"),
                    Some(LayerDecoder::Ffmpeg(_))
                ),
                "the streaming ffmpeg decoder must be cached and reused across chunks"
            );
        }

        let range = decode_range_ffmpeg(&opus_path, 0.0, num_chunks as f64 * chunk_sec, rate, 1)?;
        let _ = std::fs::remove_file(&opus_path);

        // Compare the back half: a per-chunk reseek/re-prime drifts away from the
        // continuous whole-range decode; sequential streaming stays aligned.
        let compare = stream.len().min(range.len());
        assert!(compare > chunk_frames, "decoded enough to compare");
        let from = compare / 2;
        let mean_abs_diff = stream[from..compare]
            .iter()
            .zip(range[from..compare].iter())
            .map(|(a, b)| (*a - *b).abs())
            .sum::<f32>()
            / (compare - from) as f32;
        assert!(
            mean_abs_diff < 1e-2,
            "streamed Opus export drifts from the continuous decode (mean abs diff \
             {mean_abs_diff}) — chunks are not sequential"
        );

        Ok(())
    }

    #[test]
    fn resample_interleaved_linear_matches_target_frame_count() {
        let input = vec![0.0, 0.0, 1.0, 1.0, 0.0, 0.0, -1.0, -1.0];
        let out = resample_interleaved_linear(&input, 2, 2);

        assert_eq!(out.len(), 4);
        assert_eq!(out[0], 0.5);
        assert_eq!(out[1], 0.5);
        assert_eq!(out[2], -0.5);
        assert_eq!(out[3], -0.5);
    }

    #[test]
    fn test_decode_symphonia_chunk() -> anyhow::Result<()> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/media/sample-1s-audio.mp3"
        );
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let samples = stream_layer_chunk(StreamChunkParams {
            layer_id: "layer-1",
            path,
            source_start_sec: 0.2,
            timeline_duration_sec: 0.5,
            speed: 1.0,
            target_sample_rate: 48000,
            output_channels: 2,
            reverse: false,
            shared: &shared,
        })?;
        let expected = (0.5f64 * 48000.0).round() as usize * 2;
        assert_eq!(samples.len(), expected, "chunk length must be exact");
        Ok(())
    }

    #[test]
    fn rate_mismatched_small_file_streams_instead_of_full_cache() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(8000, 1, 8000)?;
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));

        let target = AudioRenderTarget::monitor(48000, 2);
        let decoded = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "layer-8k",
            path: &path_str,
            source_start_sec: 0.0,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target,
            reverse: false,
            shared: &shared,
        })?;

        assert_eq!(decoded.len(), (0.05f64 * 48000.0).round() as usize * 2);
        let metadata = probe_audio_source_metadata(&path_str)?;
        assert_eq!(
            metadata,
            AudioSourceMetadata {
                sample_rate: 8000,
                channels: 1,
            }
        );
        let state = shared.0.lock();
        // The producer-thread call must be served by the STREAMING decoder (proof:
        // a decoder was created for this layer), never by a synchronous whole-file
        // decode that would block the realtime thread. A bounded window fill may be
        // spawned off-thread to take over later — that's fine — so we assert the
        // streaming path was taken on this call.
        assert!(
            state.decoders.contains_key("layer-8k"),
            "rate-mismatched file must stream on the producer thread (decoder created)"
        );
        drop(state);

        let _ = std::fs::remove_file(path);
        Ok(())
    }

    /// Export is offline and mixes strictly forward, so a clip is served by the
    /// sequential STREAMING decoder — never decoded whole into memory (which would
    /// OOM on a tens-of-GB source) and never via a look-ahead window fill.
    #[test]
    fn export_streams_clip_via_streaming_decoder() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(8000, 1, 8000)?;
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));

        let decoded = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "export-8k",
            path: &path_str,
            source_start_sec: 0.0,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target: AudioRenderTarget::export(48000, 2),
            reverse: false,
            shared: &shared,
        })?;

        assert_eq!(decoded.len(), (0.05f64 * 48000.0).round() as usize * 2);
        let state = shared.0.lock();
        assert!(
            state.decoders.contains_key("export-8k"),
            "export must stream via the sequential decoder"
        );
        assert!(
            !state.layer_windows.contains_key("export-8k"),
            "export must not build a look-ahead window"
        );
        assert!(
            !state.window_fill_in_flight.contains_key("export-8k"),
            "export must not spawn a background window fill"
        );
        drop(state);

        let _ = std::fs::remove_file(path);
        Ok(())
    }

    /// Streaming an upsampled (source rate << device rate) clip must never emit a
    /// fully-silent chunk. Before the fix, `SincFixedIn`'s 1024-frame input blocks
    /// meant the output FIFO underflowed in the valleys between resampler bursts,
    /// producing a periodic silent 50 ms chunk (heard as glitchy/"fast" playback
    /// until the background precache took over). Covers several low source rates.
    #[test]
    fn streaming_upsampled_source_never_emits_silent_chunk() -> anyhow::Result<()> {
        let chunk_sec = 0.05;
        let chunk_frames = (chunk_sec * 48000.0) as usize;
        let n = 60; // 3s of continuous streaming
        for src_rate in [8000u32, 11025, 16000, 22050] {
            // 5s source so the 3s stream (plus the loop's read-ahead) never hits EOF.
            let path = write_temp_f32_wav(src_rate, 1, src_rate as usize * 5)?;
            let path_str = path.to_string_lossy().to_string();
            let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
            for k in 0..n {
                let src = k as f64 * chunk_sec;
                let c = stream_layer_chunk(StreamChunkParams {
                    layer_id: "diag",
                    path: &path_str,
                    source_start_sec: src,
                    timeline_duration_sec: chunk_sec,
                    speed: 1.0,
                    target_sample_rate: 48000,
                    output_channels: 2,
                    reverse: false,
                    shared: &shared,
                })?;
                assert_eq!(c.len(), chunk_frames * 2);
                // Skip the very first chunk (resampler group-delay region may be
                // partially silent by design); every subsequent chunk must carry audio.
                if k == 0 {
                    continue;
                }
                let peak = c.iter().fold(0.0f32, |a, &b| a.max(b.abs()));
                assert!(
                    peak > 0.01,
                    "src_rate {src_rate}: chunk {k} is silent (peak {peak}) — resampler FIFO underflow"
                );
                // Frequency must stay ~440Hz (no time-compression/skip): measure
                // zero-crossings of this chunk's left channel.
                let mut zc = 0usize;
                for f in 1..chunk_frames {
                    let a = c[(f - 1) * 2];
                    let b = c[f * 2];
                    if (a <= 0.0 && b > 0.0) || (a >= 0.0 && b < 0.0) {
                        zc += 1;
                    }
                }
                let freq = zc as f64 / 2.0 / chunk_sec;
                assert!(
                    (freq - 440.0).abs() < 40.0,
                    "src_rate {src_rate}: chunk {k} freq {freq} != ~440Hz (content distorted)"
                );
            }
            let _ = std::fs::remove_file(path);
        }
        Ok(())
    }

    #[test]
    fn streaming_resampler_drops_initial_filter_delay() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(8000, 1, 8000)?;
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));

        let chunk = stream_layer_chunk(StreamChunkParams {
            layer_id: "delay-layer",
            path: &path_str,
            source_start_sec: 0.0,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target_sample_rate: 48000,
            output_channels: 2,
            reverse: false,
            shared: &shared,
        })?;
        let full = decode_range_symphonia(&path_str, 0.0, 2.0, 48000, 2)?;

        let compare_len = chunk.len().min(full.len()).min(512);
        let mean_abs_diff = chunk[..compare_len]
            .iter()
            .zip(full[..compare_len].iter())
            .map(|(a, b)| (*a - *b).abs())
            .sum::<f32>()
            / compare_len as f32;

        assert!(
            mean_abs_diff < 0.03,
            "streaming first chunk should align with whole-file resample, mean abs diff {mean_abs_diff}"
        );

        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn sequential_export_chunks_do_not_drop_packet_tails() -> anyhow::Result<()> {
        // The export path streams a clip via back-to-back `stream_layer_chunk`
        // calls (50 ms each) with NO reseek between them. A batch that hit its target
        // mid-packet used to discard the rest of that already-decoded packet; since
        // the demuxer had advanced past it and the next chunk does not reseek, those
        // frames were lost on every chunk — compressing (speeding up) the audio and
        // clicking at each boundary.
        //
        // Reproduce with a real packetised codec (mp3, 1152-frame packets) carrying a
        // LOUD continuous tone, so the 2400-frame chunk target lands mid-packet and any
        // dropped frames shift the content. Decode the SAME source two ways at MATCHED
        // rate (no resampler in either path → they must be sample-identical): the
        // one-shot whole-range path behind the monitor window cache (preview, known
        // good) vs. the per-chunk streaming path behind export. Per-chunk frame loss
        // makes the streamed concatenation drift out of phase with the range decode.
        let rate = 48_000u32;
        let src = write_temp_f32_wav(rate, 1, rate as usize)?; // 1 s, 440 Hz @ 0.25
        let mut mp3 = src.clone();
        mp3.set_extension("mp3");
        let encoded = Command::new("ffmpeg")
            .args([
                "-v",
                "error",
                "-y",
                "-i",
                src.to_string_lossy().as_ref(),
                "-c:a",
                "libmp3lame",
                "-b:a",
                "192k",
                mp3.to_string_lossy().as_ref(),
            ])
            .status();
        let _ = std::fs::remove_file(&src);
        match encoded {
            Ok(s) if s.success() => {}
            _ => return Ok(()), // ffmpeg/libmp3lame unavailable: skip
        }
        let mp3_str = mp3.to_string_lossy().to_string();

        let chunk_sec = 0.05f64;
        let num_chunks = 10usize; // 0.5 s, inside the 1 s tone
        let chunk_frames = (chunk_sec * rate as f64).round() as usize;

        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let mut stream: Vec<f32> = Vec::new();
        for k in 0..num_chunks {
            let chunk = stream_layer_chunk(StreamChunkParams {
                layer_id: "export-layer",
                path: &mp3_str,
                source_start_sec: k as f64 * chunk_sec,
                timeline_duration_sec: chunk_sec,
                speed: 1.0,
                target_sample_rate: rate,
                output_channels: 1,
                reverse: false,
                shared: &shared,
            })?;
            assert_eq!(chunk.len(), chunk_frames, "each export chunk must be exact");
            stream.extend_from_slice(&chunk);
        }

        let range = decode_range_symphonia(&mp3_str, 0.0, num_chunks as f64 * chunk_sec, rate, 1)?;
        let _ = std::fs::remove_file(&mp3);

        // Compare the back half (the drop accumulates over chunks; the first chunk is
        // still aligned). The two decodes are byte-equivalent absent frame loss.
        let compare = stream.len().min(range.len());
        let from = compare / 2;
        let mean_abs_diff = stream[from..compare]
            .iter()
            .zip(range[from..compare].iter())
            .map(|(a, b)| (*a - *b).abs())
            .sum::<f32>()
            / (compare - from) as f32;
        assert!(
            mean_abs_diff < 1e-2,
            "streamed export decode drifts from the one-shot decode (mean abs diff \
             {mean_abs_diff}) — frames dropped at chunk boundaries"
        );

        Ok(())
    }

    #[test]
    fn decode_chunk_primes_resampler_no_tail_silence_after_seek() -> anyhow::Result<()> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/media/sample-1s-audio.mp3"
        );
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let chunk = stream_layer_chunk(StreamChunkParams {
            layer_id: "seek-layer",
            path,
            source_start_sec: 0.1,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target_sample_rate: 44100,
            output_channels: 2,
            reverse: false,
            shared: &shared,
        })?;
        let frames = chunk.len() / 2;
        let expected_frames = (0.05f64 * 44100.0).round() as usize;
        assert_eq!(frames, expected_frames, "chunk length must be exact");

        let state = shared.0.lock();
        let Some(LayerDecoder::Symphonia(decoder)) = state.decoders.get("seek-layer") else {
            return Err(anyhow::anyhow!("symphonia decoder cached"));
        };
        assert!(decoder.resampler_primed, "resampler should be primed");
        assert!(
            !decoder.resample_output_remainder.is_empty(),
            "priming should leave surplus resampled audio for the next chunk"
        );
        Ok(())
    }

    #[test]
    fn decode_chunk_reverse_resampled_stays_full() -> anyhow::Result<()> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/media/sample-1s-audio.mp3"
        );
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let expected_frames = (0.05f64 * 44100.0).round() as usize;
        for i in 0..3 {
            let src = 0.5 - i as f64 * 0.05;
            let chunk = stream_layer_chunk(StreamChunkParams {
                layer_id: "rev-layer",
                path,
                source_start_sec: src,
                timeline_duration_sec: 0.05,
                speed: 1.0,
                target_sample_rate: 44100,
                output_channels: 2,
                reverse: true,
                shared: &shared,
            })?;
            assert_eq!(
                chunk.len() / 2,
                expected_frames,
                "reverse chunk exact length"
            );
            let state = shared.0.lock();
            let Some(LayerDecoder::Symphonia(decoder)) = state.decoders.get("rev-layer") else {
                return Err(anyhow::anyhow!("symphonia decoder cached"));
            };
            assert!(
                decoder.resampler_primed,
                "reverse resampler should be primed"
            );
            assert!(
                !decoder.resample_output_remainder.is_empty(),
                "reverse priming should leave surplus resampled audio"
            );
        }
        Ok(())
    }

    /// Offline probe (ignored): decode a real file through the streaming chunk
    /// path exactly like the producer does — fixed 0.05s chunks at the device
    /// rate — and write the concatenated result to a WAV, reporting tail-zero
    /// runs at chunk boundaries (the periodic-click fingerprint). Run with:
    ///   FASTCAT_PROBE_FILE=/abs/path.wav cargo test -p app_lib \
    ///     decode_streaming_offline_probe -- --ignored --nocapture
    #[test]
    #[ignore]
    fn decode_streaming_offline_probe() -> anyhow::Result<()> {
        let path = std::env::var("FASTCAT_PROBE_FILE")
            .map_err(|_| anyhow::anyhow!("set FASTCAT_PROBE_FILE to an absolute media path"))?;
        let target_rate = std::env::var("FASTCAT_PROBE_RATE")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(44100u32);
        let out_channels = 2usize;
        let chunk_sec = 0.05f64;
        let total_sec = std::env::var("FASTCAT_PROBE_SECS")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(5.0f64);

        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let target = AudioRenderTarget::monitor(target_rate, out_channels);
        let chunk_frames = (chunk_sec * target_rate as f64).round() as usize;
        let chunk_samples = chunk_frames * out_channels;
        let n_chunks = (total_sec / chunk_sec).round() as usize;

        let mut all = Vec::<f32>::new();
        let mut boundary_zero_runs = Vec::<usize>::new();
        for k in 0..n_chunks {
            let source_start = k as f64 * chunk_sec;
            let chunk = decode_audio_chunk(DecodeAudioChunkParams {
                layer_id: "probe",
                path: &path,
                source_start_sec: source_start,
                timeline_duration_sec: chunk_sec,
                speed: 1.0,
                target,
                reverse: false,
                shared: &shared,
            })?;
            assert_eq!(chunk.len(), chunk_samples, "chunk {k} wrong length");
            // Count trailing zero frames in this chunk (a zero-padded tail = the
            // resampler-starved click fingerprint).
            let mut trailing = 0usize;
            for f in (0..chunk_frames).rev() {
                let base = f * out_channels;
                if chunk[base..base + out_channels].iter().all(|s| *s == 0.0) {
                    trailing += 1;
                } else {
                    break;
                }
            }
            boundary_zero_runs.push(trailing);
            all.extend_from_slice(&chunk);
        }

        let padded_chunks = boundary_zero_runs.iter().filter(|&&z| z > 0).count();
        let max_run = boundary_zero_runs.iter().copied().max().unwrap_or(0);
        eprintln!(
            "[probe] {path} @ {target_rate}Hz: {n_chunks} chunks, {padded_chunks} with a \
             zero-padded tail (max {max_run} frames). per-chunk tail-zeros: {:?}",
            &boundary_zero_runs[..boundary_zero_runs.len().min(40)]
        );

        // Write a WAV for listening / spectral inspection.
        let out_path = std::env::temp_dir().join("fastcat-probe-out.wav");
        write_f32_wav(&out_path, &all, target_rate, out_channels as u16)?;
        eprintln!("[probe] wrote {}", out_path.display());
        Ok(())
    }

    fn write_f32_wav(
        path: &std::path::Path,
        samples: &[f32],
        sample_rate: u32,
        channels: u16,
    ) -> anyhow::Result<()> {
        use std::io::Write;
        let mut file = std::fs::File::create(path)?;
        let data_size = (samples.len() * 4) as u32;
        let byte_rate = sample_rate * channels as u32 * 4;
        let block_align = channels * 4;
        file.write_all(b"RIFF")?;
        file.write_all(&(36 + data_size).to_le_bytes())?;
        file.write_all(b"WAVE")?;
        file.write_all(b"fmt ")?;
        file.write_all(&16u32.to_le_bytes())?;
        file.write_all(&3u16.to_le_bytes())?;
        file.write_all(&channels.to_le_bytes())?;
        file.write_all(&sample_rate.to_le_bytes())?;
        file.write_all(&byte_rate.to_le_bytes())?;
        file.write_all(&block_align.to_le_bytes())?;
        file.write_all(&32u16.to_le_bytes())?;
        file.write_all(b"data")?;
        file.write_all(&data_size.to_le_bytes())?;
        for s in samples {
            file.write_all(&s.to_le_bytes())?;
        }
        Ok(())
    }

    #[test]
    fn decode_chunk_tail_eof_keeps_cursor_on_clamped_source_start() -> anyhow::Result<()> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/media/sample-1s-audio.mp3"
        );
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let source_start = 0.999;
        let chunk = stream_layer_chunk(StreamChunkParams {
            layer_id: "tail-layer",
            path,
            source_start_sec: source_start,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target_sample_rate: 44100,
            output_channels: 2,
            reverse: false,
            shared: &shared,
        })?;
        let expected_samples = (0.05f64 * 44100.0).round() as usize * 2;
        assert_eq!(
            chunk.len(),
            expected_samples,
            "tail chunk length must be exact"
        );

        let state = shared.0.lock();
        let Some(LayerDecoder::Symphonia(decoder)) = state.decoders.get("tail-layer") else {
            return Err(anyhow::anyhow!("symphonia decoder cached"));
        };
        assert!(
            (decoder.last_decode_end_sec - source_start).abs() < 1e-9,
            "EOF tail cursor should stay at clamped source start"
        );
        Ok(())
    }

    #[test]
    fn decode_chunk_seek_past_end_returns_silence() -> anyhow::Result<()> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/media/sample-1s-audio.mp3"
        );
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        let chunk = stream_layer_chunk(StreamChunkParams {
            layer_id: "past-end-layer",
            path,
            source_start_sec: 999.0,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target_sample_rate: 44100,
            output_channels: 2,
            reverse: false,
            shared: &shared,
        })?;

        let expected_samples = (0.05f64 * 44100.0).round() as usize * 2;
        assert_eq!(chunk.len(), expected_samples);
        assert!(chunk.iter().all(|sample| *sample == 0.0));
        Ok(())
    }

    #[test]
    fn test_probe_audio_source_metadata() -> anyhow::Result<()> {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../test/fixtures/media/sample-1s-audio.mp3"
        );
        let meta = probe_audio_source_metadata(path)?;
        assert_eq!(meta.channels, 2);
        assert_eq!(meta.sample_rate, 48000);
        Ok(())
    }

    /// Polls `layer_windows[layer_id]` until a window with the given start frame is
    /// resident (a background fill landed), or times out (~2s).
    fn wait_for_window(
        shared: &Arc<(Mutex<AudioShared>, Condvar)>,
        layer_id: &str,
        start_frame: usize,
    ) -> bool {
        for _ in 0..200 {
            if shared
                .0
                .lock()
                .layer_windows
                .get(layer_id)
                .is_some_and(|w| w.source_start_frame == start_frame)
            {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        false
    }

    #[test]
    fn window_hit_serves_memcpy() -> anyhow::Result<()> {
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        // Resident window [0, 5s) of a distinct ramp so we can verify the offset copy.
        let frames = 5 * 48000;
        let samples: Vec<f32> = (0..frames * 2).map(|i| i as f32 * 1e-6).collect();
        let samples = Arc::new(samples);
        shared.0.lock().layer_windows.insert(
            "w1".to_string(),
            AudioWindow {
                path: "/tmp/does-not-exist.wav".to_string(),
                source_start_frame: 0,
                sample_rate: 48000,
                channels: 2,
                samples: samples.clone(),
            },
        );

        // Request at 0.1s — well before the 4s refill margin, so no fill is spawned
        // and the fake path is never opened.
        let out = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "w1",
            path: "/tmp/does-not-exist.wav",
            source_start_sec: 0.1,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target: AudioRenderTarget::monitor(48000, 2),
            reverse: false,
            shared: &shared,
        })?;

        let start = (0.1 * 48000.0) as usize * 2;
        let len = (0.05 * 48000.0) as usize * 2;
        assert_eq!(
            out,
            samples[start..start + len],
            "memcpy is window-relative"
        );
        let state = shared.0.lock();
        assert!(
            !state.decoders.contains_key("w1"),
            "a window hit must not create a streaming decoder"
        );
        assert!(
            !state.window_fill_in_flight.contains_key("w1"),
            "a hit far from the window end must not spawn a refill"
        );
        Ok(())
    }

    /// Regression: a resident window left from a PREVIOUS path (proxy swap / media
    /// replace under the same layer id) must NOT be served — its PCM is the wrong
    /// file's audio. The chunk must miss, stream the new file inline, and start a
    /// fresh fill for the new path.
    #[test]
    fn window_for_stale_path_is_not_served() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(48000, 2, 48000 * 3)?; // 3s real NEW source
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        // A window covering [0, 5s) but tagged with the OLD path; a distinctive ramp
        // so a (buggy) memcpy hit would be obvious.
        let frames = 5 * 48000;
        let stale: Vec<f32> = (0..frames * 2).map(|i| i as f32 * 1e-3).collect();
        shared.0.lock().layer_windows.insert(
            "p1".to_string(),
            AudioWindow {
                path: "/tmp/old-proxy.wav".to_string(),
                source_start_frame: 0,
                sample_rate: 48000,
                channels: 2,
                samples: Arc::new(stale),
            },
        );

        let out = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "p1",
            path: &path_str,
            source_start_sec: 0.1,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target: AudioRenderTarget::monitor(48000, 2),
            reverse: false,
            shared: &shared,
        })?;

        // Served by streaming the NEW file (decoder created), not the stale window.
        assert!(
            shared.0.lock().decoders.contains_key("p1"),
            "a window with a stale path must miss and stream the new file inline"
        );
        // The new WAV is a 440Hz sine ≤ 0.25 amplitude; the stale window's ramp around
        // index 0.1s would be ~9.6. So the output must not be the stale ramp.
        assert!(
            out.iter().all(|s| s.abs() <= 0.5),
            "output must be the new file's audio, not the stale window's ramp"
        );
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn window_refill_ahead_spawns_next_window() -> anyhow::Result<()> {
        // 16s source so the refill at ~11s still has forward audio to decode (and so the
        // resident window below is a genuine, non-EOF `WINDOW_SEC` window). 8kHz mono
        // keeps the temp file small; it is resampled to the 48kHz window target.
        let path = write_temp_f32_wav(8000, 1, 8000 * 16)?;
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        // Resident FULL `WINDOW_SEC` window [0, 12s) — a chunk near its end is within the
        // refill margin but the window is not EOF-clamped, so refill-ahead must fire.
        let end_frame = (WINDOW_SEC * 48000.0) as usize;
        shared.0.lock().layer_windows.insert(
            "r1".to_string(),
            AudioWindow {
                path: path_str.clone(),
                source_start_frame: 0,
                sample_rate: 48000,
                channels: 2,
                samples: Arc::new(vec![0.1f32; end_frame * 2]),
            },
        );

        let start_frame = (11.0 * 48000.0) as usize;
        let _ = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "r1",
            path: &path_str,
            source_start_sec: 11.0,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target: AudioRenderTarget::monitor(48000, 2),
            reverse: false,
            shared: &shared,
        })?;
        let _ = end_frame;

        // Refill-ahead slides the window forward from the CURRENT playhead (so the
        // new, overlapping window still covers it), not from the old window end.
        assert!(
            wait_for_window(&shared, "r1", start_frame),
            "refill-ahead must decode and install a forward window at the playhead"
        );
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn window_refill_stops_at_known_source_end() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(48000, 2, 48000 * 3)?;
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        shared.0.lock().scene = vec![crate::monitor::scene::SceneAudioLayer {
            id: "eof".into(),
            track_id: None,
            path: path_str.clone(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 1.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 1.0,
            speed: 1.0,
            audio_gain: 1.0,
            audio_balance: 0.0,
            audio_fade_in_sec: 0.0,
            audio_fade_out_sec: 0.0,
            audio_fade_in_curve: crate::monitor::scene::AudioFadeCurve::Linear,
            audio_fade_out_curve: crate::monitor::scene::AudioFadeCurve::Linear,
            audio_effects: vec![],
        }];
        shared.0.lock().layer_windows.insert(
            "eof".to_string(),
            AudioWindow {
                path: path_str.clone(),
                source_start_frame: 0,
                sample_rate: 48000,
                channels: 2,
                samples: Arc::new(vec![0.1f32; 48000 * 2]),
            },
        );

        let _ = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "eof",
            path: &path_str,
            source_start_sec: 0.9,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target: AudioRenderTarget::monitor(48000, 2),
            reverse: false,
            shared: &shared,
        })?;

        std::thread::sleep(std::time::Duration::from_millis(80));
        let state = shared.0.lock();
        assert_eq!(
            state
                .layer_windows
                .get("eof")
                .map(|window| window.source_start_frame),
            Some(0),
            "a window that already reaches the clip source end must not be refilled"
        );
        assert!(!state.window_fill_in_flight.contains_key("eof"));
        drop(state);
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn short_window_without_declared_source_end_is_not_refilled() -> anyhow::Result<()> {
        // A resident window materially shorter than `WINDOW_SEC` was clamped by EOF, so
        // even when the clip declares no source range (`source_range_duration_sec` 0 →
        // `source_end_frame` None) the refill-ahead must NOT keep re-decoding the
        // shrinking tail near the clip end.
        let path = write_temp_f32_wav(48000, 2, 48000)?; // 1s real source
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        // Scene layer with NO source range → source end is unknown.
        shared.0.lock().scene = vec![crate::monitor::scene::SceneAudioLayer {
            id: "short".into(),
            track_id: None,
            path: path_str.clone(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 1.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 0.0,
            speed: 1.0,
            audio_gain: 1.0,
            audio_balance: 0.0,
            audio_fade_in_sec: 0.0,
            audio_fade_out_sec: 0.0,
            audio_fade_in_curve: crate::monitor::scene::AudioFadeCurve::Linear,
            audio_fade_out_curve: crate::monitor::scene::AudioFadeCurve::Linear,
            audio_effects: vec![],
        }];
        // Resident window [0, 1s): far shorter than WINDOW_SEC, so it reads as EOF.
        shared.0.lock().layer_windows.insert(
            "short".to_string(),
            AudioWindow {
                path: path_str.clone(),
                source_start_frame: 0,
                sample_rate: 48000,
                channels: 2,
                samples: Arc::new(vec![0.1f32; 48000 * 2]),
            },
        );

        // A hit near the window end would be inside the refill margin.
        let _ = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "short",
            path: &path_str,
            source_start_sec: 0.9,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target: AudioRenderTarget::monitor(48000, 2),
            reverse: false,
            shared: &shared,
        })?;

        std::thread::sleep(std::time::Duration::from_millis(60));
        let state = shared.0.lock();
        assert!(
            !state.window_fill_in_flight.contains_key("short"),
            "an EOF-clamped short window must not be refilled even without a declared source end"
        );
        assert_eq!(
            state
                .layer_windows
                .get("short")
                .map(|w| w.source_start_frame),
            Some(0),
            "the short window must be left as-is"
        );
        drop(state);
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn window_miss_streams_inline_and_spawns_fill() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(48000, 2, 48000 * 3)?;
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));

        // No window yet → miss: serve this chunk inline AND start a fill at start 0.
        let out = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "m1",
            path: &path_str,
            source_start_sec: 0.0,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target: AudioRenderTarget::monitor(48000, 2),
            reverse: false,
            shared: &shared,
        })?;

        assert_eq!(out.len(), (0.05 * 48000.0) as usize * 2);
        assert!(
            shared.0.lock().decoders.contains_key("m1"),
            "a miss must stream this chunk inline (decoder created)"
        );
        assert!(
            wait_for_window(&shared, "m1", 0),
            "a miss must spawn a fill that installs the window at the requested start"
        );
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn seek_outside_window_refills_at_new_start() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(48000, 2, 48000 * 3)?;
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));
        // Resident window [0, 1s); the request jumps to 2s — outside it.
        shared.0.lock().layer_windows.insert(
            "s1".to_string(),
            AudioWindow {
                path: path_str.clone(),
                source_start_frame: 0,
                sample_rate: 48000,
                channels: 2,
                samples: Arc::new(vec![0.0f32; 48000 * 2]),
            },
        );

        let _ = decode_audio_chunk(DecodeAudioChunkParams {
            layer_id: "s1",
            path: &path_str,
            source_start_sec: 2.0,
            timeline_duration_sec: 0.05,
            speed: 1.0,
            target: AudioRenderTarget::monitor(48000, 2),
            reverse: false,
            shared: &shared,
        })?;

        // The fill targets the NEW seek position (2s), not the old window end.
        assert!(
            wait_for_window(&shared, "s1", 2 * 48000),
            "a seek outside the window must refill at the new position"
        );
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn decode_range_symphonia_no_leading_silence() -> anyhow::Result<()> {
        // Continuous 440Hz tone at 8kHz → decoding at 48k forces a resample, so this
        // exercises that the resampler group delay is dropped (no leading silence).
        let path = write_temp_f32_wav(8000, 1, 8000 * 2)?; // 2s tone
        let path_str = path.to_string_lossy().to_string();
        let head_frames = (0.005 * 48000.0) as usize * 2; // first 5ms
                                                          // Both from 0 (no seek) and from a mid-clip seek must open with signal.
        for start in [0.0, 0.1] {
            let out = decode_range_symphonia(&path_str, start, 0.5, 48000, 2)?;
            assert!(!out.is_empty(), "start {start}: empty");
            let head_peak = out[..head_frames]
                .iter()
                .fold(0.0f32, |a, &b| a.max(b.abs()));
            assert!(
                head_peak > 0.01,
                "start {start}: leading silence (peak {head_peak})"
            );
        }
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn decode_range_symphonia_is_bounded() -> anyhow::Result<()> {
        // 10s source; decode only a 1s range → ~1s of output, NOT the whole file.
        let path = write_temp_f32_wav(8000, 1, 8000 * 10)?;
        let path_str = path.to_string_lossy().to_string();
        let out = decode_range_symphonia(&path_str, 0.0, 1.0, 48000, 2)?;
        let out_frames = out.len() / 2;
        assert!(
            (47000..49000).contains(&out_frames),
            "expected ~1s ({}) of output, got {out_frames} frames",
            48000
        );
        // Must be far less than a whole-file decode (10s → 480000 frames).
        assert!(out_frames < 100_000, "decode was not bounded to the range");
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn window_fill_respects_concurrency_limit() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(48000, 2, 48000 * 2)?;
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));

        // Saturate the budget: a fresh fill must NOT claim a slot or spawn.
        shared.0.lock().active_window_fill_count = WINDOW_FILL_MAX_CONCURRENCY;
        spawn_window_fill(
            &shared,
            "c1",
            &path_str,
            0,
            48000,
            2,
            WindowFillPriority::Live,
        );
        std::thread::sleep(std::time::Duration::from_millis(30));
        {
            let state = shared.0.lock();
            assert!(
                !state.window_fill_in_flight.contains_key("c1"),
                "must not claim a slot while the budget is full"
            );
            assert!(!state.layer_windows.contains_key("c1"));
            assert_eq!(state.active_window_fill_count, WINDOW_FILL_MAX_CONCURRENCY);
        }

        // Free the budget; the same call now fills and releases the slot.
        shared.0.lock().active_window_fill_count = 0;
        spawn_window_fill(
            &shared,
            "c1",
            &path_str,
            0,
            48000,
            2,
            WindowFillPriority::Live,
        );
        assert!(
            wait_for_window(&shared, "c1", 0),
            "fill must run with a free slot"
        );
        assert_eq!(
            shared.0.lock().active_window_fill_count,
            0,
            "slot must be released when the fill thread finishes"
        );
        let _ = std::fs::remove_file(path);
        Ok(())
    }

    #[test]
    fn speculative_window_fill_is_capped_but_uses_a_free_slot() -> anyhow::Result<()> {
        let path = write_temp_f32_wav(48000, 2, 48000 * 2)?;
        let path_str = path.to_string_lossy().to_string();
        let shared = Arc::new((Mutex::new(AudioShared::default()), Condvar::new()));

        // Slots full → speculative must NOT push past the concurrency cap.
        shared.0.lock().active_window_fill_count = WINDOW_FILL_MAX_CONCURRENCY;
        spawn_window_fill(
            &shared,
            "full",
            &path_str,
            0,
            48000,
            2,
            WindowFillPriority::Speculative,
        );
        {
            let state = shared.0.lock();
            assert!(
                !state.window_fill_in_flight.contains_key("full"),
                "speculative prewarm must never exceed the concurrency cap"
            );
            assert_eq!(state.active_window_fill_count, WINDOW_FILL_MAX_CONCURRENCY);
        }

        // A genuinely free slot (below the cap, but with a live fill already active):
        // speculative now uses it so future-clip windows actually get prewarmed
        // instead of falling to inline streaming at section boundaries.
        if WINDOW_FILL_MAX_CONCURRENCY >= 2 {
            shared.0.lock().active_window_fill_count = WINDOW_FILL_MAX_CONCURRENCY - 1;
            spawn_window_fill(
                &shared,
                "future",
                &path_str,
                0,
                48000,
                2,
                WindowFillPriority::Speculative,
            );
            assert!(
                wait_for_window(&shared, "future", 0),
                "speculative prewarm must claim a free slot below the cap"
            );
        }

        let _ = std::fs::remove_file(path);
        Ok(())
    }
}
