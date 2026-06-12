use std::collections::{HashMap, HashSet};

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

/// Max bytes of decoded f32 audio kept in `decoded_cache` across all files.
pub(crate) const MAX_DECODED_CACHE_BYTES: usize = 256 * 1024 * 1024;
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AudioSourceMetadata {
    pub(crate) sample_rate: u32,
    pub(crate) channels: usize,
}

pub(crate) struct AudioShared {
    pub(crate) scene: Vec<SceneAudioLayer>,
    pub(crate) tracks: Vec<SceneAudioTrack>,
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
    pub(crate) decoded_cache: lru::LruCache<String, std::sync::Arc<Vec<f32>>>,
    /// Total bytes held by `decoded_cache`; bounds the in-memory full-file cache
    /// by weight (a single 50 MB compressed file can decode to > 1 GB of f32).
    pub(crate) decoded_cache_bytes: usize,
    /// Cached `fs::metadata` file sizes so the cache-routing decision doesn't
    /// `stat` the file on every 50 ms chunk.
    pub(crate) file_size_cache: HashMap<String, u64>,
    /// Lightweight source metadata used for cache routing. The producer must not
    /// eagerly decode+resample whole files whose source rate differs from the
    /// output device: an 8 kHz WAV can otherwise pin the only producer thread
    /// long enough to make all monitor audio disappear.
    pub(crate) source_metadata_cache: HashMap<String, AudioSourceMetadata>,
    /// Streaming decoders, keyed per layer (NOT per path): two clips from the
    /// same media file must not share one stateful decoder or they thrash seeks.
    pub(crate) decoders: HashMap<String, CachedAudioDecoder>,
    /// Hash of timing-relevant layer fields (path/position/speed/source). Used to
    /// decide whether a scene update needs a ring flush (positions changed) or is
    /// a pure mix-param change (gain/balance/fade) that can apply gap-free.
    pub(crate) timing_sig: u64,
    /// When true, the producer thread will clear the ring buffer on its next
    /// iteration. This avoids a race between the main thread calling `clear()`
    /// while the producer is in the middle of `push_slice`.
    pub(crate) pending_ring_clear: bool,
    /// Decoded-cache keys currently being decoded on a BACKGROUND thread. The
    /// realtime producer must never decode a whole streaming file inline (a 127ms
    /// AAC spike under 1080p decode load starves both the ring and the cpal
    /// callback → crackle). When a streaming clip is first seen we spawn one
    /// background decode and keep streaming until it lands in `decoded_cache`;
    /// this set stops us from spawning a second thread for the same key.
    /// Pending forward-scrub preview to start (set by the UI thread, consumed by
    /// the producer so all ring writes stay on the single producer thread).
    pub(crate) scrub_request: Option<ScrubRequest>,
    /// Set by the UI thread to stop an in-progress scrub preview (drag ended).
    pub(crate) scrub_cancel: bool,
    pub(crate) decoding_in_flight: HashSet<String>,
    /// Decoded-cache keys we deliberately will NOT background-cache (too large to
    /// fit the cache budget, or no declared frame count to size-gate them). Kept
    /// so the producer streams them forever instead of re-spawning a doomed decode
    /// every chunk.
    pub(crate) precache_skip: HashSet<String>,
}

pub(crate) fn decoded_cache_key(path: &str, sample_rate: u32, output_channels: usize) -> String {
    format!("{path}|sr={sample_rate}|ch={output_channels}")
}

impl Default for AudioShared {
    fn default() -> Self {
        Self {
            scene: Vec::new(),
            tracks: Vec::new(),
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
            decoded_cache: lru::LruCache::unbounded(),
            decoded_cache_bytes: 0,
            file_size_cache: HashMap::new(),
            source_metadata_cache: HashMap::new(),
            decoders: HashMap::new(),
            timing_sig: 0,
            pending_ring_clear: false,
            scrub_request: None,
            scrub_cancel: false,
            decoding_in_flight: HashSet::new(),
            precache_skip: HashSet::new(),
        }
    }
}

impl AudioShared {
    /// Inserts a fully decoded file into the byte-bounded cache, evicting the
    /// least-recently-used entries until the total stays under the budget.
    /// Skips caching entirely if a single file exceeds the whole budget.
    pub(crate) fn cache_decoded(&mut self, key: String, samples: std::sync::Arc<Vec<f32>>) {
        let bytes = samples.len() * std::mem::size_of::<f32>();
        if bytes > MAX_DECODED_CACHE_BYTES {
            return;
        }
        if let Some(prev) = self.decoded_cache.put(key, samples) {
            self.decoded_cache_bytes = self
                .decoded_cache_bytes
                .saturating_sub(prev.len() * std::mem::size_of::<f32>());
        }
        self.decoded_cache_bytes += bytes;
        while self.decoded_cache_bytes > MAX_DECODED_CACHE_BYTES {
            match self.decoded_cache.pop_lru() {
                Some((_, evicted)) => {
                    self.decoded_cache_bytes = self
                        .decoded_cache_bytes
                        .saturating_sub(evicted.len() * std::mem::size_of::<f32>());
                }
                None => break,
            }
        }
    }

    pub(crate) fn drop_decoded(&mut self, key: &str) {
        if let Some(removed) = self.decoded_cache.pop(key) {
            self.decoded_cache_bytes = self
                .decoded_cache_bytes
                .saturating_sub(removed.len() * std::mem::size_of::<f32>());
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
        let mut repathed = base.clone();
        repathed.path = "/tmp/other.wav".into();
        assert_ne!(compute_timing_sig(&[repathed]), sig);
    }

    #[test]
    fn decoded_cache_evicts_to_stay_under_byte_budget() {
        let mut shared = AudioShared::default();
        // Each ~100 MB; budget is 256 MB, so inserting three drops the oldest.
        let big = std::sync::Arc::new(vec![0.0f32; 25 * 1024 * 1024]);
        shared.cache_decoded("a".into(), big.clone());
        shared.cache_decoded("b".into(), big.clone());
        shared.cache_decoded("c".into(), big.clone());
        assert!(shared.decoded_cache_bytes <= MAX_DECODED_CACHE_BYTES);
        assert!(shared.decoded_cache.peek("a").is_none(), "oldest evicted");
        assert!(shared.decoded_cache.peek("c").is_some(), "newest retained");
    }

    #[test]
    fn decoded_cache_skips_items_larger_than_budget() {
        let mut shared = AudioShared::default();
        let huge = std::sync::Arc::new(vec![0.0f32; MAX_DECODED_CACHE_BYTES]); // 4x budget in bytes
        shared.cache_decoded("x".into(), huge);
        assert!(shared.decoded_cache.peek("x").is_none());
        assert_eq!(shared.decoded_cache_bytes, 0);
    }
}
