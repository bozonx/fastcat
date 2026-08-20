use super::{AudioEffectSpec, PluginInstance};

const SUPPORTED_TYPES: &[&str] = &[
    "test-multiply",
    "audio-echo",
    "audio-distortion",
    "audio-tremolo",
    "audio-env-behind-wall",
    "audio-env-muffled",
    "audio-telephone",
    "audio-voice-underwater",
];

pub(super) fn can_handle(effect_type: &str) -> bool {
    SUPPORTED_TYPES.contains(&effect_type)
}

pub(super) fn instantiate(
    spec: &AudioEffectSpec,
    sample_rate: u32,
    channels: usize,
) -> Box<dyn PluginInstance> {
    match spec.effect_type.as_str() {
        "test-multiply" => Box::new(MultiplyPlugin),
        "audio-echo" => Box::new(EchoEffect::new(spec, sample_rate, channels)),
        "audio-distortion" => Box::new(DistortionEffect::new(spec)),
        "audio-tremolo" => Box::new(TremoloEffect::new(spec, sample_rate)),
        "audio-env-behind-wall" => Box::new(BehindWallEffect::new(spec, sample_rate, channels)),
        "audio-env-muffled" => Box::new(MuffledEffect::new(spec, sample_rate, channels)),
        "audio-telephone" => Box::new(TelephoneEffect::new(spec, sample_rate, channels)),
        "audio-voice-underwater" => Box::new(UnderwaterEffect::new(spec, sample_rate, channels)),
        _ => Box::new(PassthroughBuiltin),
    }
}

struct PassthroughBuiltin;

impl PluginInstance for PassthroughBuiltin {
    fn set_params(&mut self, _spec: &AudioEffectSpec) {}
    fn process(
        &mut self,
        _buffer: &mut [f32],
        _channels: usize,
        _context: crate::audio::plugins::PluginProcessContext,
    ) {
    }
    fn reset(&mut self) {}
}

struct MultiplyPlugin;

impl PluginInstance for MultiplyPlugin {
    fn set_params(&mut self, _spec: &AudioEffectSpec) {}
    fn process(
        &mut self,
        buffer: &mut [f32],
        _channels: usize,
        _context: crate::audio::plugins::PluginProcessContext,
    ) {
        for sample in buffer.iter_mut() {
            *sample *= 2.0;
        }
    }
    fn reset(&mut self) {}
}

fn param_f64(spec: &AudioEffectSpec, key: &str, fallback: f64) -> f64 {
    spec.params
        .get(key)
        .and_then(serde_json::Value::as_f64)
        .filter(|value| value.is_finite())
        .unwrap_or(fallback)
}

fn clamp(value: f64, min: f64, max: f64) -> f64 {
    value.max(min).min(max)
}

fn cutoff_to_alpha(cutoff_hz: f64, sample_rate: u32) -> f32 {
    let cutoff = clamp(cutoff_hz, 20.0, sample_rate as f64 * 0.45);
    let dt = 1.0 / sample_rate as f64;
    let rc = 1.0 / (std::f64::consts::TAU * cutoff);
    (dt / (rc + dt)) as f32
}

#[derive(Clone)]
struct OnePoleLowpass {
    alpha: f32,
    state: Vec<f32>,
}

impl OnePoleLowpass {
    fn new(channels: usize, cutoff_hz: f64, sample_rate: u32) -> Self {
        Self {
            alpha: cutoff_to_alpha(cutoff_hz, sample_rate),
            state: vec![0.0; channels],
        }
    }

    fn set_cutoff(&mut self, cutoff_hz: f64, sample_rate: u32, channels: usize) {
        self.alpha = cutoff_to_alpha(cutoff_hz, sample_rate);
        self.resize(channels);
    }

    fn process(&mut self, channel: usize, input: f32) -> f32 {
        let y = self.state[channel] + self.alpha * (input - self.state[channel]);
        self.state[channel] = y;
        y
    }

    fn resize(&mut self, channels: usize) {
        if self.state.len() != channels {
            self.state.resize(channels, 0.0);
        }
    }

    fn reset(&mut self) {
        self.state.fill(0.0);
    }
}

#[derive(Clone)]
struct OnePoleHighpass {
    alpha: f32,
    prev_input: Vec<f32>,
    prev_output: Vec<f32>,
}

impl OnePoleHighpass {
    fn new(channels: usize, cutoff_hz: f64, sample_rate: u32) -> Self {
        let mut filter = Self {
            alpha: 0.0,
            prev_input: vec![0.0; channels],
            prev_output: vec![0.0; channels],
        };
        filter.set_cutoff(cutoff_hz, sample_rate, channels);
        filter
    }

    fn set_cutoff(&mut self, cutoff_hz: f64, sample_rate: u32, channels: usize) {
        let cutoff = clamp(cutoff_hz, 20.0, sample_rate as f64 * 0.45);
        let dt = 1.0 / sample_rate as f64;
        let rc = 1.0 / (std::f64::consts::TAU * cutoff);
        self.alpha = (rc / (rc + dt)) as f32;
        self.resize(channels);
    }

    fn process(&mut self, channel: usize, input: f32) -> f32 {
        let y = self.alpha * (self.prev_output[channel] + input - self.prev_input[channel]);
        self.prev_input[channel] = input;
        self.prev_output[channel] = y;
        y
    }

    fn resize(&mut self, channels: usize) {
        if self.prev_input.len() != channels {
            self.prev_input.resize(channels, 0.0);
            self.prev_output.resize(channels, 0.0);
        }
    }

    fn reset(&mut self) {
        self.prev_input.fill(0.0);
        self.prev_output.fill(0.0);
    }
}

struct DelayLine {
    buffer: Vec<f32>,
    channels: usize,
    write_frame: usize,
}

impl DelayLine {
    fn new(max_delay_s: f64, sample_rate: u32, channels: usize) -> Self {
        let frames = ((max_delay_s * sample_rate as f64).ceil() as usize).max(1) + 1;
        Self {
            buffer: vec![0.0; frames * channels.max(1)],
            channels: channels.max(1),
            write_frame: 0,
        }
    }

    fn reset(&mut self) {
        self.buffer.fill(0.0);
        self.write_frame = 0;
    }

    fn resize(&mut self, max_delay_s: f64, sample_rate: u32, channels: usize) {
        let channels = channels.max(1);
        let frames = ((max_delay_s * sample_rate as f64).ceil() as usize).max(1) + 1;
        if self.channels != channels || self.frames() != frames {
            self.channels = channels;
            self.buffer = vec![0.0; frames * channels];
            self.write_frame = 0;
        }
    }

    fn frames(&self) -> usize {
        self.buffer.len() / self.channels
    }

    fn read(&self, channel: usize, delay_frames: usize) -> f32 {
        let frames = self.frames();
        let delay = delay_frames.min(frames - 1);
        let read_frame = (self.write_frame + frames - delay) % frames;
        self.buffer[read_frame * self.channels + channel]
    }

    fn write(&mut self, channel: usize, value: f32) {
        let idx = self.write_frame * self.channels + channel;
        self.buffer[idx] = value;
    }

    fn advance(&mut self) {
        self.write_frame = (self.write_frame + 1) % self.frames();
    }
}

struct EchoEffect {
    sample_rate: u32,
    channels: usize,
    delay_time: f64,
    feedback: f32,
    tone: f64,
    delay: DelayLine,
    tone_filter: OnePoleLowpass,
}

impl EchoEffect {
    fn new(spec: &AudioEffectSpec, sample_rate: u32, channels: usize) -> Self {
        let mut effect = Self {
            sample_rate,
            channels: channels.max(1),
            delay_time: 0.25,
            feedback: 0.35,
            tone: 6_000.0,
            delay: DelayLine::new(1.05, sample_rate, channels),
            tone_filter: OnePoleLowpass::new(channels, 6_000.0, sample_rate),
        };
        effect.set_params(spec);
        effect
    }
}

impl PluginInstance for EchoEffect {
    fn set_params(&mut self, spec: &AudioEffectSpec) {
        self.delay_time = clamp(param_f64(spec, "delayTime", 0.25), 0.02, 1.0);
        self.feedback = clamp(param_f64(spec, "feedback", 0.35), 0.0, 0.9) as f32;
        self.tone = clamp(param_f64(spec, "tone", 6_000.0), 400.0, 12_000.0);
        self.tone_filter
            .set_cutoff(self.tone, self.sample_rate, self.channels);
    }

    fn process(
        &mut self,
        buffer: &mut [f32],
        channels: usize,
        _context: crate::audio::plugins::PluginProcessContext,
    ) {
        self.channels = channels.max(1);
        self.delay.resize(1.05, self.sample_rate, self.channels);
        self.tone_filter.resize(self.channels);
        let delay_frames = (self.delay_time * self.sample_rate as f64).round() as usize;

        for frame in buffer.chunks_exact_mut(self.channels) {
            for (channel, sample) in frame.iter_mut().enumerate() {
                let delayed = self.delay.read(channel, delay_frames);
                let feedback_sample = self.tone_filter.process(channel, delayed);
                self.delay.write(
                    channel,
                    (*sample + feedback_sample * self.feedback).clamp(-4.0, 4.0),
                );
                *sample = delayed;
            }
            self.delay.advance();
        }
    }

    fn reset(&mut self) {
        self.delay.reset();
        self.tone_filter.reset();
    }
}

struct DistortionEffect {
    drive: f32,
}

impl DistortionEffect {
    fn new(spec: &AudioEffectSpec) -> Self {
        let mut effect = Self { drive: 160.0 };
        effect.set_params(spec);
        effect
    }
}

impl PluginInstance for DistortionEffect {
    fn set_params(&mut self, spec: &AudioEffectSpec) {
        self.drive = (clamp(param_f64(spec, "distortion", 0.4), 0.0, 1.0) * 400.0) as f32;
    }

    fn process(
        &mut self,
        buffer: &mut [f32],
        _channels: usize,
        _context: crate::audio::plugins::PluginProcessContext,
    ) {
        let k = self.drive;
        for sample in buffer.iter_mut() {
            let x = *sample;
            *sample = if k > 0.0 {
                ((std::f32::consts::PI + k) * x)
                    / (std::f32::consts::PI + k * x.abs()).max(0.000_001)
            } else {
                x
            };
        }
    }

    fn reset(&mut self) {}
}

struct TremoloEffect {
    sample_rate: u32,
    rate: f64,
    depth: f32,
    phase: f64,
}

impl TremoloEffect {
    fn new(spec: &AudioEffectSpec, sample_rate: u32) -> Self {
        let mut effect = Self {
            sample_rate,
            rate: 5.0,
            depth: 0.6,
            phase: 0.0,
        };
        effect.set_params(spec);
        effect
    }
}

impl PluginInstance for TremoloEffect {
    fn set_params(&mut self, spec: &AudioEffectSpec) {
        self.rate = clamp(param_f64(spec, "rate", 5.0), 0.1, 20.0);
        self.depth = clamp(param_f64(spec, "depth", 0.6), 0.0, 1.0) as f32;
    }

    fn process(
        &mut self,
        buffer: &mut [f32],
        channels: usize,
        _context: crate::audio::plugins::PluginProcessContext,
    ) {
        let channels = channels.max(1);
        let phase_step = std::f64::consts::TAU * self.rate / self.sample_rate as f64;
        for frame in buffer.chunks_exact_mut(channels) {
            let lfo = self.phase.sin() as f32;
            let gain = (1.0 - self.depth / 2.0) + lfo * (self.depth / 2.0);
            for sample in frame {
                *sample *= gain;
            }
            self.phase = (self.phase + phase_step) % std::f64::consts::TAU;
        }
    }

    fn reset(&mut self) {
        self.phase = 0.0;
    }
}

struct MuffledEffect {
    sample_rate: u32,
    channels: usize,
    cutoff: f64,
    lowpass: OnePoleLowpass,
}

impl MuffledEffect {
    fn new(spec: &AudioEffectSpec, sample_rate: u32, channels: usize) -> Self {
        let mut effect = Self {
            sample_rate,
            channels: channels.max(1),
            cutoff: 650.0,
            lowpass: OnePoleLowpass::new(channels, 650.0, sample_rate),
        };
        effect.set_params(spec);
        effect
    }
}

impl PluginInstance for MuffledEffect {
    fn set_params(&mut self, spec: &AudioEffectSpec) {
        let intensity = clamp(param_f64(spec, "intensity", 70.0), 0.0, 100.0);
        let norm = 1.0 - intensity / 100.0;
        self.cutoff = 300.0 * f64::powf(5_000.0 / 300.0, norm);
        self.lowpass
            .set_cutoff(self.cutoff, self.sample_rate, self.channels);
    }

    fn process(
        &mut self,
        buffer: &mut [f32],
        channels: usize,
        _context: crate::audio::plugins::PluginProcessContext,
    ) {
        self.channels = channels.max(1);
        self.lowpass.resize(self.channels);
        for frame in buffer.chunks_exact_mut(self.channels) {
            for (channel, sample) in frame.iter_mut().enumerate() {
                *sample = self.lowpass.process(channel, *sample);
            }
        }
    }

    fn reset(&mut self) {
        self.lowpass.reset();
    }
}

struct UnderwaterEffect {
    sample_rate: u32,
    channels: usize,
    cutoff: f64,
    lowpass: OnePoleLowpass,
}

impl UnderwaterEffect {
    fn new(spec: &AudioEffectSpec, sample_rate: u32, channels: usize) -> Self {
        let mut effect = Self {
            sample_rate,
            channels: channels.max(1),
            cutoff: 360.0,
            lowpass: OnePoleLowpass::new(channels, 360.0, sample_rate),
        };
        effect.set_params(spec);
        effect
    }
}

impl PluginInstance for UnderwaterEffect {
    fn set_params(&mut self, spec: &AudioEffectSpec) {
        self.cutoff = clamp(param_f64(spec, "cutoff", 360.0), 150.0, 1_200.0);
        self.lowpass
            .set_cutoff(self.cutoff, self.sample_rate, self.channels);
    }

    fn process(
        &mut self,
        buffer: &mut [f32],
        channels: usize,
        _context: crate::audio::plugins::PluginProcessContext,
    ) {
        self.channels = channels.max(1);
        self.lowpass.resize(self.channels);
        for frame in buffer.chunks_exact_mut(self.channels) {
            for (channel, sample) in frame.iter_mut().enumerate() {
                *sample = self.lowpass.process(channel, *sample);
            }
        }
    }

    fn reset(&mut self) {
        self.lowpass.reset();
    }
}

struct TelephoneEffect {
    sample_rate: u32,
    channels: usize,
    highpass: OnePoleHighpass,
    lowpass: OnePoleLowpass,
    quality: f64,
}

impl TelephoneEffect {
    fn new(spec: &AudioEffectSpec, sample_rate: u32, channels: usize) -> Self {
        let mut effect = Self {
            sample_rate,
            channels: channels.max(1),
            highpass: OnePoleHighpass::new(channels, 450.0, sample_rate),
            lowpass: OnePoleLowpass::new(channels, 2_750.0, sample_rate),
            quality: 50.0,
        };
        effect.set_params(spec);
        effect
    }
}

impl PluginInstance for TelephoneEffect {
    fn set_params(&mut self, spec: &AudioEffectSpec) {
        self.quality = clamp(param_f64(spec, "quality", 50.0), 0.0, 100.0);
        let hpf = 600.0 - (self.quality / 100.0) * 300.0;
        let lpf = 2_000.0 + (self.quality / 100.0) * 1_500.0;
        self.highpass
            .set_cutoff(hpf, self.sample_rate, self.channels);
        self.lowpass
            .set_cutoff(lpf, self.sample_rate, self.channels);
    }

    fn process(
        &mut self,
        buffer: &mut [f32],
        channels: usize,
        _context: crate::audio::plugins::PluginProcessContext,
    ) {
        self.channels = channels.max(1);
        self.highpass.resize(self.channels);
        self.lowpass.resize(self.channels);
        let drive = (30.0 - (self.quality / 100.0) * 25.0) as f32;
        for frame in buffer.chunks_exact_mut(self.channels) {
            for (channel, sample) in frame.iter_mut().enumerate() {
                let filtered = self.highpass.process(channel, *sample);
                let filtered = self.lowpass.process(channel, filtered);
                *sample = ((1.0 + drive * 0.03) * filtered).tanh();
            }
        }
    }

    fn reset(&mut self) {
        self.highpass.reset();
        self.lowpass.reset();
    }
}

struct BehindWallEffect {
    sample_rate: u32,
    channels: usize,
    muffling_cutoff: f64,
    room_size: f64,
    lowpass: OnePoleLowpass,
    delay: DelayLine,
}

impl BehindWallEffect {
    fn new(spec: &AudioEffectSpec, sample_rate: u32, channels: usize) -> Self {
        let mut effect = Self {
            sample_rate,
            channels: channels.max(1),
            muffling_cutoff: 250.0,
            room_size: 50.0,
            lowpass: OnePoleLowpass::new(channels, 250.0, sample_rate),
            delay: DelayLine::new(0.35, sample_rate, channels),
        };
        effect.set_params(spec);
        effect
    }
}

impl PluginInstance for BehindWallEffect {
    fn set_params(&mut self, spec: &AudioEffectSpec) {
        let muffling = clamp(param_f64(spec, "muffling", 80.0), 0.0, 100.0);
        let norm = 1.0 - muffling / 100.0;
        self.muffling_cutoff = 150.0 * f64::powf(2_000.0 / 150.0, norm);
        self.room_size = clamp(param_f64(spec, "roomSize", 50.0), 0.0, 100.0);
        self.lowpass
            .set_cutoff(self.muffling_cutoff, self.sample_rate, self.channels);
    }

    fn process(
        &mut self,
        buffer: &mut [f32],
        channels: usize,
        _context: crate::audio::plugins::PluginProcessContext,
    ) {
        self.channels = channels.max(1);
        self.lowpass.resize(self.channels);
        self.delay.resize(0.35, self.sample_rate, self.channels);
        let delay_s = 0.035 + self.room_size * 0.0025;
        let delay_frames = (delay_s * self.sample_rate as f64).round() as usize;
        let feedback = (0.12 + self.room_size * 0.004).min(0.55) as f32;

        for frame in buffer.chunks_exact_mut(self.channels) {
            for (channel, sample) in frame.iter_mut().enumerate() {
                let muffled = self.lowpass.process(channel, *sample) * 0.78;
                let tail = self.delay.read(channel, delay_frames);
                self.delay
                    .write(channel, (muffled + tail * feedback).clamp(-4.0, 4.0));
                *sample = muffled * 0.72 + tail * 0.28;
            }
            self.delay.advance();
        }
    }

    fn reset(&mut self) {
        self.lowpass.reset();
        self.delay.reset();
    }
}
