use std::collections::HashMap;

use crate::audio::plugins::AudioEffectSpec;
use crate::monitor::scene::{SceneAudioLayer, SceneAudioTrack};

use symphonia::core::formats::Track;

pub(crate) const CHUNK_DURATION_SEC: f64 = 0.05;
/// Minimum fill before the real-time output callback starts consuming after a
/// play/seek. Eight 50ms chunks = 400ms: enough slack that a single missed
/// producer deadline (common on Linux without RT-priority, e.g. under 4K decode
/// load) does not immediately underrun and crackle on the very first output.
/// Intentionally smaller than `PREBUFFER_CHUNKS` so playback does not feel
/// delayed relative to the click.
pub(crate) const START_PREBUFFER_CHUNKS: usize = 8;
/// Target fill of the playback ring buffer, in `CHUNK_DURATION_SEC` chunks. This
/// is the real defence against crackle: it sits upstream of the cpal device
/// buffer and absorbs scheduler jitter / decode spikes when the producer thread
/// briefly misses its 50ms deadline (e.g. without real-time priority on Linux).
/// At 50ms/chunk, 16 chunks = ~800ms of headroom (ring capacity is 2× this).
/// Raised from 8 (~400ms) after observed underruns under UI/decode contention.
pub(crate) const PREBUFFER_CHUNKS: usize = 16;

/// Length of one decoded look-ahead window, in seconds. The background fill thread
/// decodes only this much of a clip at a time (never the whole file), so memory is
/// bounded regardless of file size — tens of GB are fine. 12s × 2ch × 48kHz × 4B ≈
/// 4.6 MB per active layer. Chosen well above the ~800ms producer ring and the
/// ranged-decode latency so a refill always lands before the current window drains.
///
/// Audio intentionally does NOT use the video decode_gate (media/decode_gate.rs);
/// it has its own bounded look-ahead so audio and video loads never contend.
pub(crate) const WINDOW_SEC: f64 = 12.0;
/// When the playhead comes within this of the current window's end, prefetch the
/// next window. 4s ≫ ring depth and ≫ a ranged-decode's wall time, so the next
/// window is resident before the current one is exhausted (steady-state stays on
/// the memcpy fast path, no inline streaming).
pub(crate) const REFILL_MARGIN_SEC: f64 = 4.0;
/// Upper bound on a forward-scrub audio preview snippet. The frontend asks for
/// ~90 ms; this caps it so a stray request can't queue a long burst.
pub(crate) const MAX_SCRUB_PREVIEW_SEC: f64 = 0.5;

pub(crate) fn find_audio_track(tracks: &[Track]) -> Option<&Track> {
    tracks.iter().find(|track| {
        let params = &track.codec_params;
        params.codec != symphonia::core::codecs::CODEC_TYPE_NULL
            && (params.sample_rate.is_some()
                || params.channels.is_some()
                || params.sample_format.is_some())
    })
}

/// A one-shot forward-scrub audio preview requested by the UI while NOT playing.
/// The producer mixes `[from_sec, from_sec + duration_sec)` once and plays it out,
/// without touching the master transport (origin/playing stay put).
#[derive(Debug, Clone, Copy)]
pub(crate) struct ScrubRequest {
    pub(crate) from_sec: f64,
    pub(crate) duration_sec: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum AudioRenderMode {
    /// Realtime monitor/preview. The render rate and channel layout are dictated
    /// by the current output device, independent of the project/export settings.
    Monitor,
    /// Offline export. The render rate and channel layout are dictated by the
    /// requested export/timeline audio settings, independent of the output device.
    Export,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AudioRenderTarget {
    pub(crate) sample_rate: u32,
    pub(crate) channels: usize,
    pub(crate) mode: AudioRenderMode,
}

impl AudioRenderTarget {
    pub(crate) fn monitor(device_sample_rate: u32, device_channels: usize) -> Self {
        Self {
            sample_rate: device_sample_rate.max(1),
            channels: device_channels.max(1),
            mode: AudioRenderMode::Monitor,
        }
    }

    pub(crate) fn export(sample_rate: u32, channels: usize) -> Self {
        Self {
            sample_rate: sample_rate.max(1),
            channels: channels.clamp(1, 2),
            mode: AudioRenderMode::Export,
        }
    }

    pub(crate) fn is_export(self) -> bool {
        matches!(self.mode, AudioRenderMode::Export)
    }
}

pub(crate) struct CachedAudioDecoder {
    /// Source file this decoder was opened for. `decoders` is keyed by layer id, but a
    /// layer's `path` can change under the same id (proxy on/off, media replace). The
    /// chunk decoder validates this before reuse and rebuilds on a mismatch, otherwise
    /// it would keep decoding the OLD file's audio after a path swap.
    pub(crate) path: String,
    pub(crate) format: Box<dyn symphonia::core::formats::FormatReader>,
    pub(crate) decoder: Box<dyn symphonia::core::codecs::Decoder>,
    pub(crate) track_id: u32,
    pub(crate) source_rate: u32,
    pub(crate) channels: usize,
    pub(crate) time_base: symphonia::core::units::TimeBase,
    // Cached resampler to avoid rebuilding it every chunk.
    // Stored as Option<Box<...>> because resamplers are large and rarely change ratio.
    pub(crate) resampler: Option<Box<rubato::SincFixedIn<f32>>>,
    pub(crate) last_resample_ratio: f64,
    // False whenever the resampler was just created/reset (its delay line is
    // empty). The next decode then primes it with `output_delay`-worth of extra
    // source frames so the first emitted chunk isn't short by the resampler
    // latency (which would zero-pad a ~3 ms silent gap into the tail after every
    // seek and into every chunk of a reversed clip).
    pub(crate) resampler_primed: bool,
    // Last source position we decoded up to; used to skip seeks on sequential chunks.
    pub(crate) last_decode_end_sec: f64,
    // Planar input frames not yet consumed by the fixed-size resampler. Carried
    // across sequential chunks so block boundaries don't inject zero-padding,
    // which would otherwise create periodic clicks in the output.
    pub(crate) resample_remainder: Vec<Vec<f32>>,
    // Interleaved resampled output produced beyond what a chunk requested. The
    // block-based resampler emits a variable frame count per call; without this
    // FIFO the surplus would be truncated (and the deficit zero-padded) every
    // chunk, leaking samples and clicking at boundaries. Drained first by the
    // next chunk so output length is exact and lossless.
    pub(crate) resample_output_remainder: Vec<f32>,
}

/// A long-lived ffmpeg streaming decoder for a codec symphonia can't decode
/// natively (currently Opus). Unlike a one-shot-per-chunk `ffmpeg -ss`, this keeps
/// ONE ffmpeg/swr session alive and reads it sequentially chunk-by-chunk, so
/// back-to-back chunks are sample-continuous — a fresh seek+resample per chunk left
/// audible clicks at the ~50 ms boundaries (heard on Opus-audio exports). Keyed per
/// layer id (like `decoders`), and reseeks only on a non-sequential request.
pub(crate) struct CachedFfmpegDecoder {
    /// Source file this stream was opened for; rebuilt on a path change (proxy swap /
    /// media replace under the same layer id), like `CachedAudioDecoder::path`.
    pub(crate) path: String,
    /// Target rate/channels the ffmpeg child is emitting at; a change rebuilds it.
    pub(crate) sample_rate: u32,
    pub(crate) channels: usize,
    /// Source position (sec) the stream will next emit. A request within tolerance of
    /// this continues reading the live process; a jump reseeks (kill + respawn).
    pub(crate) next_source_sec: f64,
    /// The running ffmpeg, or `None` once the stream hit EOF (further sequential
    /// reads past the source end return silence without respawning).
    pub(crate) reader: Option<crate::audio::ffmpeg_decode::FfmpegPcmReader>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AudioSourceMetadata {
    pub(crate) sample_rate: u32,
    pub(crate) channels: usize,
}

/// A bounded, contiguous decoded-PCM look-ahead window for ONE layer, at the
/// target rate/channels. Covers `[source_start_frame, source_start_frame + len)`
/// in TARGET-rate frames (the same units `decode_audio_chunk` indexes by), so a
/// requested `source_start_sec * sample_rate` maps directly into `samples`.
///
/// The background fill thread decodes only `WINDOW_SEC` of source into this; the
/// realtime producer serves a chunk by `memcpy` out of it. Replacing the whole-file
/// cache with this is what bounds memory to the window regardless of file size.
pub(crate) struct AudioWindow {
    /// Source file this window was decoded from. `layer_windows` is keyed by layer id,
    /// but a layer's path can change under the same id (proxy swap / media replace), so
    /// the producer validates this before a memcpy hit — otherwise it would serve the
    /// OLD file's PCM after a path change.
    pub(crate) path: String,
    /// Window start, in target-rate frames from the start of the source.
    pub(crate) source_start_frame: usize,
    /// Target rate this window was decoded at (guards against a device-rate change).
    pub(crate) sample_rate: u32,
    /// Output channels this window is interleaved by.
    pub(crate) channels: usize,
    pub(crate) samples: std::sync::Arc<Vec<f32>>,
}

impl AudioWindow {
    /// Number of target-rate frames held by this window.
    pub(crate) fn len_frames(&self) -> usize {
        self.samples.len() / self.channels.max(1)
    }

    /// One-past-the-last target-rate frame this window covers.
    pub(crate) fn end_frame(&self) -> usize {
        self.source_start_frame + self.len_frames()
    }

    /// True if this window fully covers `[start_frame, start_frame + frames)` at the
    /// given rate/channels.
    pub(crate) fn covers(
        &self,
        start_frame: usize,
        frames: usize,
        sample_rate: u32,
        channels: usize,
    ) -> bool {
        self.sample_rate == sample_rate
            && self.channels == channels
            && start_frame >= self.source_start_frame
            && start_frame + frames <= self.end_frame()
    }
}

pub(crate) struct AudioShared {
    pub(crate) scene: Vec<SceneAudioLayer>,
    pub(crate) tracks: Vec<SceneAudioTrack>,
    pub(crate) audio_master_effects: Vec<AudioEffectSpec>,
    pub(crate) master_gain: f64,
    pub(crate) playing: bool,
    /// Warmup gate: while true the producer keeps mixing and filling the ring but
    /// must NOT arm the real-time output clock, so the buffered audio stays
    /// inaudible. Used to prime the ring during the video prebuffer window so the
    /// first Play after a cold page load starts with a full buffer instead of an
    /// immediate underrun (crackle + sped-up audio). Cleared in `release_output`.
    pub(crate) hold_output: bool,
    /// Глобальная скорость транспорта (мультипликатор таймлайн-времени). >0 —
    /// вперёд (1.0 норма, !=1 даёт варипитч-ресемпл), <=0 — реверс/стоп: producer
    /// не миксует (аудио молчит), мастер-клок ведёт само видео.
    pub(crate) global_speed: f64,
    pub(crate) origin_pts_sec: f64,
    pub(crate) producer_pts_sec: f64,
    pub(crate) seek_serial: u64,
    pub(crate) scene_serial: u64,
    pub(crate) plugin_host: std::sync::Arc<parking_lot::Mutex<crate::audio::plugins::PluginHost>>,
    /// Per-LAYER rolling decoded window (keyed by layer id, like `decoders`, so two
    /// clips from the same file don't collide). The realtime producer serves a chunk
    /// by `memcpy` out of the covering window; a background thread refills it ahead
    /// of the playhead. Bounded to `WINDOW_SEC` per layer — never the whole file.
    pub(crate) layer_windows: HashMap<String, AudioWindow>,
    /// Layer ids with a background window fill in flight, mapped to the TARGET-frame
    /// start that fill will cover. Dedupes refill spawns for the same start and lets
    /// the worker discard its result if a newer seek has superseded it.
    pub(crate) window_fill_in_flight: HashMap<String, usize>,
    /// Number of background window-fill threads running. Bounded by
    /// `WINDOW_FILL_MAX_CONCURRENCY` so refills don't thrash the disk and starve the
    /// producer's own inline streaming reads.
    pub(crate) active_window_fill_count: usize,
    /// Streaming decoders, keyed per layer (NOT per path): two clips from the
    /// same media file must not share one stateful decoder or they thrash seeks.
    pub(crate) decoders: HashMap<String, CachedAudioDecoder>,
    /// Long-lived ffmpeg streaming decoders for codecs symphonia can't decode (Opus),
    /// keyed per layer like `decoders`. Kept alive across sequential chunks so the
    /// decode/resample stays continuous (no per-chunk reseek → no boundary clicks).
    pub(crate) ffmpeg_decoders: HashMap<String, CachedFfmpegDecoder>,
    /// Hash of timing-relevant layer fields (path/position/speed/source). Used to
    /// decide whether a scene update needs a ring flush (positions changed) or is
    /// a pure mix-param change (gain/balance/fade) that can apply gap-free.
    pub(crate) timing_sig: u64,
    /// When true, the producer thread will clear the ring buffer on its next
    /// iteration. This avoids a race between the main thread calling `clear()`
    /// while the producer is in the middle of `push_slice`.
    pub(crate) pending_ring_clear: bool,
    /// Pending forward-scrub preview to start (set by the UI thread, consumed by
    /// the producer so all ring writes stay on the single producer thread).
    pub(crate) scrub_request: Option<ScrubRequest>,
    /// Set by the UI thread to stop an in-progress scrub preview (drag ended).
    pub(crate) scrub_cancel: bool,
}

impl Default for AudioShared {
    fn default() -> Self {
        Self {
            scene: Vec::new(),
            tracks: Vec::new(),
            audio_master_effects: Vec::new(),
            master_gain: 1.0,
            playing: false,
            hold_output: false,
            global_speed: 1.0,
            origin_pts_sec: 0.0,
            producer_pts_sec: 0.0,
            seek_serial: 0,
            scene_serial: 0,
            plugin_host: std::sync::Arc::new(parking_lot::Mutex::new(
                crate::audio::plugins::PluginHost::new(),
            )),
            layer_windows: HashMap::new(),
            window_fill_in_flight: HashMap::new(),
            active_window_fill_count: 0,
            decoders: HashMap::new(),
            ffmpeg_decoders: HashMap::new(),
            timing_sig: 0,
            pending_ring_clear: false,
            scrub_request: None,
            scrub_cancel: false,
        }
    }
}

/// Hashes the timing-relevant fields of the scene. Two scenes with the same
/// signature place the same audio at the same timeline positions, so a switch
/// between them does not require flushing already-buffered output.
pub(crate) fn compute_timing_sig(layers: &[SceneAudioLayer]) -> u64 {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    layers.len().hash(&mut hasher);
    for l in layers {
        l.id.hash(&mut hasher);
        l.path.hash(&mut hasher);
        l.track_id.hash(&mut hasher);
        l.timeline_start_sec.to_bits().hash(&mut hasher);
        l.timeline_end_sec.to_bits().hash(&mut hasher);
        l.source_start_sec.to_bits().hash(&mut hasher);
        l.source_range_duration_sec.to_bits().hash(&mut hasher);
        l.speed.to_bits().hash(&mut hasher);
    }
    hasher.finish()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::monitor::scene::{AudioFadeCurve, SceneAudioLayer};

    fn layer() -> SceneAudioLayer {
        SceneAudioLayer {
            id: "a1".into(),
            track_id: Some("track-a".into()),
            path: "/tmp/a.wav".into(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 10.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 0.0,
            speed: 1.0,
            audio_gain: 1.0,
            audio_balance: 0.0,
            audio_fade_in_sec: 2.0,
            audio_fade_out_sec: 2.0,
            audio_fade_in_curve: AudioFadeCurve::Linear,
            audio_fade_out_curve: AudioFadeCurve::Linear,
            audio_effects: vec![],
        }
    }

    #[test]
    fn render_targets_encode_monitor_vs_export_rate_ownership() {
        let monitor = AudioRenderTarget::monitor(44_100, 6);
        assert_eq!(monitor.sample_rate, 44_100);
        assert_eq!(monitor.channels, 6);
        assert_eq!(monitor.mode, AudioRenderMode::Monitor);
        assert!(!monitor.is_export());

        let export = AudioRenderTarget::export(48_000, 6);
        assert_eq!(export.sample_rate, 48_000);
        assert_eq!(export.channels, 2);
        assert_eq!(export.mode, AudioRenderMode::Export);
        assert!(export.is_export());
    }

    #[test]
    fn find_audio_track_skips_non_audio_track_before_audio() {
        use symphonia::core::audio::Channels;
        use symphonia::core::codecs::{CodecParameters, CODEC_TYPE_OPUS};

        let mut non_audio_params = CodecParameters::new();
        non_audio_params.for_codec(CODEC_TYPE_OPUS);

        let mut audio_params = CodecParameters::new();
        audio_params
            .for_codec(CODEC_TYPE_OPUS)
            .with_sample_rate(48_000)
            .with_channels(Channels::FRONT_LEFT | Channels::FRONT_RIGHT);

        let tracks = vec![Track::new(7, non_audio_params), Track::new(8, audio_params)];

        let track = find_audio_track(&tracks).expect("audio track");
        assert_eq!(track.id, 8);
    }

    #[test]
    fn timing_sig_ignores_mix_params_but_reacts_to_position() {
        let base = layer();
        let sig = compute_timing_sig(std::slice::from_ref(&base));

        // Pure mix-param edits must NOT change the signature (no ring flush).
        let mut gained = base.clone();
        gained.audio_gain = 0.3;
        gained.audio_balance = -0.7;
        gained.audio_fade_in_sec = 1.5;
        assert_eq!(compute_timing_sig(&[gained]), sig);

        // Position / speed / path edits MUST change it (flush required).
        let mut moved = base.clone();
        moved.timeline_start_sec = 1.0;
        assert_ne!(compute_timing_sig(&[moved]), sig);
        let mut sped = base.clone();
        sped.speed = 2.0;
        assert_ne!(compute_timing_sig(&[sped]), sig);
        let mut source_range_changed = base.clone();
        source_range_changed.source_range_duration_sec = 3.0;
        assert_ne!(compute_timing_sig(&[source_range_changed]), sig);
        let mut repathed = base.clone();
        repathed.path = "/tmp/other.wav".into();
        assert_ne!(compute_timing_sig(&[repathed]), sig);
    }

    #[test]
    fn audio_window_covers_only_fully_contained_requests() {
        let w = AudioWindow {
            path: "/tmp/a.wav".to_string(),
            source_start_frame: 100,
            sample_rate: 48_000,
            channels: 2,
            samples: std::sync::Arc::new(vec![0.0f32; 200 * 2]), // 200 frames → [100, 300)
        };
        assert_eq!(w.len_frames(), 200);
        assert_eq!(w.end_frame(), 300);
        // Fully inside.
        assert!(w.covers(120, 50, 48_000, 2));
        // Touches the exact end (half-open) — still covered.
        assert!(w.covers(250, 50, 48_000, 2));
        // Past the end / before the start → not covered.
        assert!(!w.covers(280, 50, 48_000, 2));
        assert!(!w.covers(50, 10, 48_000, 2));
        // Rate / channel mismatch → not covered.
        assert!(!w.covers(120, 50, 44_100, 2));
        assert!(!w.covers(120, 50, 48_000, 1));
    }
}
