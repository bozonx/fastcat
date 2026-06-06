use std::collections::HashMap;

use crate::monitor::scene::{SceneAudioLayer, SceneAudioTrack};

pub(crate) const CHUNK_DURATION_SEC: f64 = 0.05;
/// Target fill of the playback ring buffer, in `CHUNK_DURATION_SEC` chunks. This
/// is the real defence against crackle: it sits upstream of the cpal device
/// buffer and absorbs scheduler jitter / decode spikes when the producer thread
/// briefly misses its 50ms deadline (e.g. without real-time priority on Linux).
/// At 50ms/chunk, 16 chunks = ~800ms of headroom (ring capacity is 2× this).
/// Raised from 8 (~400ms) after observed underruns under UI/decode contention.
pub(crate) const PREBUFFER_CHUNKS: usize = 16;

/// Max bytes of decoded f32 audio kept in `decoded_cache` across all files.
pub(crate) const MAX_DECODED_CACHE_BYTES: usize = 256 * 1024 * 1024;
/// Only fully decode + cache files whose compressed size is below this. Larger
/// files stream through the chunk decoder (which is built for it), avoiding a
/// multi-GB decode of a long track into RAM.
pub(crate) const MAX_CACHEABLE_FILE_BYTES: u64 = 16 * 1024 * 1024;
/// Producer resync threshold: if the mix position falls more than this behind
/// the audible playhead (e.g. after an output underrun), skip stale audio and
/// realign instead of permanently lagging.
pub(crate) const PRODUCER_RESYNC_THRESHOLD_SEC: f64 = 0.12;

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
    pub(crate) origin_pts_sec: f64,
    pub(crate) producer_pts_sec: f64,
    pub(crate) seek_serial: u64,
    pub(crate) scene_serial: u64,
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
            origin_pts_sec: 0.0,
            producer_pts_sec: 0.0,
            seek_serial: 0,
            scene_serial: 0,
            decoded_cache: lru::LruCache::unbounded(),
            decoded_cache_bytes: 0,
            file_size_cache: HashMap::new(),
            source_metadata_cache: HashMap::new(),
            decoders: HashMap::new(),
            timing_sig: 0,
            pending_ring_clear: false,
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
    use crate::monitor::scene::{AudioFadeCurve, SceneAudioLayer, SceneAudioTrack};

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
        }
    }

    fn track(id: &str) -> SceneAudioTrack {
        SceneAudioTrack {
            id: id.into(),
            audio_gain: 1.0,
            audio_balance: 0.0,
            audio_muted: false,
            audio_solo: false,
        }
    }

    #[test]
    fn timing_sig_ignores_mix_params_but_reacts_to_position() {
        let base = layer();
        let sig = compute_timing_sig(&[base.clone()]);

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
