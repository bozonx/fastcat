//! CLAP plugin backend for the native audio [`PluginHost`](super::PluginHost).
//!
//! Built on `clack-host` (safe wrapper over `clap-sys`). The tricky part is
//! clack's thread model: the main-thread instance handle
//! (`clack_host::prelude::PluginInstance`) is `!Send`, while `PluginHost` lives
//! behind an `Arc<Mutex<…>>` and is touched from several threads (realtime
//! producer, export, scrub). We therefore confine every clack object to a
//! single dedicated worker thread — the [`ClapEngine`] actor — and hand the
//! rest of the app only `Send` channel handles.
//!
//! Threading note: the worker plays BOTH the CLAP main-thread and audio-thread
//! roles, sequentially, on one OS thread. That is a valid minimal host — CLAP's
//! `[main-thread]`/`[audio-thread]` annotations exist to prevent data races, and
//! a single thread trivially serialises them. The realtime mixer reaches the
//! worker through a blocking request/response, which is acceptable because our
//! mix runs on a pre-render producer thread, not the hard cpal callback.
//!
//! Scope of this first cut: load a bundle, enumerate it (for the catalog scan),
//! instantiate + activate + process audio through the plugin's main audio port.
//! Parameter events, plugin `state` persistence and a plugin GUI are deliberately
//! left as follow-ups — the spec carries only a `params` map today and no UI
//! produces CLAP params yet.

use clack_extensions::audio_ports::{AudioPortInfoBuffer, PluginAudioPorts};
use clack_extensions::latency::PluginLatency;
use clack_host::prelude::*;
use std::collections::HashMap;
use std::ffi::OsString;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command as ProcessCommand, Stdio};
use std::sync::mpsc::{channel, Receiver, Sender};
// `clack_host::prelude` also exports a `PluginInstance`; alias it so it does not
// clash with our own `PluginInstance` trait (imported from `super`).
use clack_host::prelude::PluginInstance as ClapPluginInstance;

use super::catalog::AudioPluginFormat;
use super::{AudioEffectSpec, PluginBackend, PluginInstance};

/// Largest block (in frames) passed to a plugin's `process` in one call. The
/// plugin is activated with this as its `max_frames_count`; longer mix chunks
/// are split into blocks of at most this size.
const MAX_BLOCK: usize = 8192;

/// Minimal CLAP host handlers. We do not yet service main-thread callbacks,
/// param rescans or restart requests — enough to host well-behaved effects.
struct FastcatClapHostShared;

impl<'a> SharedHandler<'a> for FastcatClapHostShared {
    fn request_restart(&self) {}
    fn request_process(&self) {}
    fn request_callback(&self) {}
}

struct FastcatClapHost;

impl HostHandlers for FastcatClapHost {
    type Shared<'a> = FastcatClapHostShared;
    type MainThread<'a> = ();
    type AudioProcessor<'a> = ();
}

/// Metadata for one plugin inside a bundle, returned by [`describe`].
const DESCRIBE_HELPER_ARG: &str = "--fastcat-clap-describe";

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
pub struct ClapPluginDesc {
    pub id: String,
    pub name: Option<String>,
    pub vendor: Option<String>,
    pub version: Option<String>,
    pub features: Vec<String>,
}

/// A live, activated CLAP plugin owned by the worker thread. Holds the `!Send`
/// clack handles plus reusable de-interleave scratch so steady-state processing
/// allocates nothing.
struct LiveClap {
    path: PathBuf,
    instance: ClapPluginInstance<FastcatClapHost>,
    /// `None` once activation/processing has failed; the worker then passes
    /// audio through untouched so a broken plugin is inert, not fatal.
    processor: Option<StartedPluginAudioProcessor<FastcatClapHost>>,
    input_ports: AudioPorts,
    output_ports: AudioPorts,
    in_scratch: Vec<Vec<f32>>,
    out_scratch: Vec<Vec<f32>>,
    port_in: usize,
    port_out: usize,
    latency_samples: u32,
    steady_time: u64,
}

impl LiveClap {
    /// De-interleave `interleaved` (of `channels`), run it through the plugin in
    /// `MAX_BLOCK`-sized blocks, and write the result back in place. Channel
    /// counts are adapted to the plugin's declared main-port width: extra plugin
    /// input channels are fed silence, and output channels beyond the plugin's
    /// width reuse its last channel.
    fn process_into(
        &mut self,
        interleaved: &mut [f32],
        channels: usize,
        context: super::PluginProcessContext,
    ) -> Result<(), ()> {
        let LiveClap {
            processor,
            input_ports,
            output_ports,
            in_scratch,
            out_scratch,
            port_in,
            port_out,
            steady_time,
            ..
        } = self;
        let Some(processor) = processor.as_mut() else {
            return Ok(()); // inert -> passthrough (interleaved already holds the dry signal)
        };
        let channels = channels.max(1);
        let frames_total = interleaved.len() / channels;
        let port_in = *port_in;
        let port_out = *port_out;
        let transport = context.transport_event();

        let mut offset = 0;
        while offset < frames_total {
            let n = (frames_total - offset).min(MAX_BLOCK);

            for c in 0..port_in {
                let dst = &mut in_scratch[c][..n];
                if port_in == 1 && channels > 1 {
                    for (f, slot) in dst.iter_mut().enumerate() {
                        let base = (offset + f) * channels;
                        let sum = (0..channels).map(|ch| interleaved[base + ch]).sum::<f32>();
                        *slot = sum / channels as f32;
                    }
                } else if c < channels {
                    for (f, slot) in dst.iter_mut().enumerate() {
                        *slot = interleaved[(offset + f) * channels + c];
                    }
                } else {
                    dst.fill(0.0);
                }
            }

            let input_audio = input_ports.with_input_buffers([AudioPortBuffer {
                latency: 0,
                channels: AudioPortBufferType::f32_input_only(
                    in_scratch
                        .iter_mut()
                        .take(port_in)
                        .map(|b| InputChannel::variable(&mut b[..n])),
                ),
            }]);
            let mut output_audio = output_ports.with_output_buffers([AudioPortBuffer {
                latency: 0,
                channels: AudioPortBufferType::f32_output_only(
                    out_scratch.iter_mut().take(port_out).map(|b| &mut b[..n]),
                ),
            }]);

            let in_events_buffer = EventBuffer::new();
            let input_events = InputEvents::from(&in_events_buffer);
            let mut out_events_buffer = EventBuffer::new();
            let mut output_events = OutputEvents::from(&mut out_events_buffer);

            let status = processor.process(
                &input_audio,
                &mut output_audio,
                &input_events,
                &mut output_events,
                Some(steady_time.wrapping_add(offset as u64)),
                transport.as_ref(),
            );
            if status.is_err() {
                return Err(());
            }

            for c in 0..channels {
                let src_c = c.min(port_out - 1);
                let src = &out_scratch[src_c][..n];
                for (f, sample) in src.iter().enumerate() {
                    interleaved[(offset + f) * channels + c] = *sample;
                }
            }

            offset += n;
        }
        *steady_time = steady_time.wrapping_add(frames_total as u64);
        Ok(())
    }

    fn reset(&mut self) {
        if let Some(processor) = self.processor.as_mut() {
            processor.reset();
        }
        self.steady_time = 0;
    }

    fn deactivate(&mut self) {
        if let Some(started) = self.processor.take() {
            let stopped = started.stop_processing();
            self.instance.deactivate(stopped);
        }
    }
}

/// Commands sent to the [`ClapEngine`] worker. Every variant that produces a
/// value carries a response `Sender`; the `Process` response is reused per
/// instance to avoid per-chunk channel allocation.
enum Command {
    Describe {
        path: PathBuf,
        resp: Sender<Result<Vec<ClapPluginDesc>, String>>,
    },
    Create {
        path: PathBuf,
        plugin_id: Option<String>,
        sample_rate: u32,
        channels: usize,
        resp: Sender<Result<u64, String>>,
    },
    Process {
        id: u64,
        channels: usize,
        buffer: Vec<f32>,
        context: super::PluginProcessContext,
        resp: Sender<Result<Vec<f32>, Vec<f32>>>,
    },
    Reset {
        id: u64,
    },
    GetLatency {
        id: u64,
        resp: Sender<u32>,
    },
    Destroy {
        id: u64,
    },
}

/// Handle to the CLAP worker thread. Cloneable `Sender` only, so it is `Send`
/// and can live inside the shared `PluginHost`.
pub struct ClapEngine {
    tx: Sender<Command>,
}

/// A pre-closed channel used as a placeholder when the worker thread fails to
/// spawn, so `engine()` can hand back a handle whose sends simply fail.
fn dead_channel() -> Sender<Command> {
    let (tx, _rx) = channel();
    tx
}

impl ClapEngine {
    fn spawn(name: &str) -> std::io::Result<Self> {
        let (tx, rx) = channel::<Command>();
        std::thread::Builder::new()
            .name(name.to_string())
            .spawn(move || worker_loop(rx))?;
        Ok(Self { tx })
    }

    fn send(&self, cmd: Command) -> Result<(), ()> {
        self.tx.send(cmd).map_err(|_| ())
    }
}

/// Block on loading `path` and enumerating the plugins it contains. Used by the
/// catalog scan. Returns an error string on any load/enumeration failure.
pub fn describe(path: &Path) -> Result<Vec<ClapPluginDesc>, String> {
    let (resp, rx) = channel();
    let engine = ClapEngine::spawn("fastcat-clap-scan")
        .map_err(|err| format!("CLAP scan thread unavailable: {err}"))?;
    engine
        .send(Command::Describe {
            path: path.to_path_buf(),
            resp,
        })
        .map_err(|_| "CLAP host thread unavailable".to_string())?;
    rx.recv()
        .map_err(|_| "CLAP host thread stopped".to_string())?
}

pub fn describe_isolated(path: &Path) -> Result<Vec<ClapPluginDesc>, String> {
    let exe = std::env::current_exe().map_err(|err| format!("locate helper executable: {err}"))?;
    let output = ProcessCommand::new(exe)
        .arg(DESCRIBE_HELPER_ARG)
        .arg(path)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|err| format!("run CLAP scan helper: {err}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!(
            "CLAP scan helper exited with {}{}",
            output.status,
            if stderr.trim().is_empty() {
                String::new()
            } else {
                format!(": {}", stderr.trim())
            }
        ));
    }

    serde_json::from_slice(&output.stdout).map_err(|err| format!("parse CLAP scan helper: {err}"))
}

pub fn run_describe_helper_from_args<I>(args: I) -> bool
where
    I: IntoIterator<Item = OsString>,
{
    let mut args = args.into_iter();
    let _exe = args.next();
    let Some(mode) = args.next() else {
        return false;
    };
    if mode != DESCRIBE_HELPER_ARG {
        return false;
    }

    let Some(path) = args.next() else {
        let _ = writeln!(std::io::stderr(), "missing CLAP bundle path");
        std::process::exit(2);
    };
    match describe(Path::new(&path)) {
        Ok(plugins) => {
            if let Err(err) = serde_json::to_writer(std::io::stdout(), &plugins) {
                let _ = writeln!(std::io::stderr(), "write CLAP description: {err}");
                std::process::exit(1);
            }
            true
        }
        Err(err) => {
            let _ = writeln!(std::io::stderr(), "{err}");
            std::process::exit(1);
        }
    }
}

// ---------------------------------------------------------------------------
// Worker thread
// ---------------------------------------------------------------------------

fn worker_loop(rx: Receiver<Command>) {
    let mut entries: HashMap<PathBuf, PluginEntry> = HashMap::new();
    let mut instances: HashMap<u64, LiveClap> = HashMap::new();
    let mut next_id: u64 = 1;

    while let Ok(cmd) = rx.recv() {
        match cmd {
            Command::Describe { path, resp } => {
                let _ = resp.send(describe_bundle(&mut entries, &path));
            }
            Command::Create {
                path,
                plugin_id,
                sample_rate,
                channels,
                resp,
            } => {
                let result = create_live(
                    &mut entries,
                    &path,
                    plugin_id.as_deref(),
                    sample_rate,
                    channels,
                );
                match result {
                    Ok(live) => {
                        let id = next_id;
                        next_id += 1;
                        instances.insert(id, live);
                        let _ = resp.send(Ok(id));
                    }
                    Err(err) => {
                        let _ = resp.send(Err(err));
                    }
                }
            }
            Command::Process {
                id,
                channels,
                mut buffer,
                context,
                resp,
            } => {
                let result = if let Some(live) = instances.get_mut(&id) {
                    match live.process_into(&mut buffer, channels, context) {
                        Ok(()) => Ok(buffer),
                        Err(()) => Err(buffer),
                    }
                } else {
                    Ok(buffer)
                };
                let _ = resp.send(result);
            }
            Command::Reset { id } => {
                if let Some(live) = instances.get_mut(&id) {
                    live.reset();
                }
            }
            Command::GetLatency { id, resp } => {
                let latency = instances
                    .get(&id)
                    .map(|live| live.latency_samples)
                    .unwrap_or(0);
                let _ = resp.send(latency);
            }
            Command::Destroy { id } => {
                if let Some(mut live) = instances.remove(&id) {
                    let path = live.path.clone();
                    live.deactivate();
                    if !instances.values().any(|other| other.path == path) {
                        entries.remove(&path);
                    }
                }
            }
        }
    }

    // Channel closed: tear down every live instance cleanly.
    for (_, mut live) in instances.drain() {
        live.deactivate();
    }
}

fn get_or_load_entry<'e>(
    entries: &'e mut HashMap<PathBuf, PluginEntry>,
    path: &Path,
) -> Result<&'e PluginEntry, String> {
    if !entries.contains_key(path) {
        // SAFETY: loading a CLAP bundle runs the plugin's entry-init code. The
        // path comes from the user's configured scan roots; there is no way to
        // load a shared library fully safely, and this matches how every CLAP
        // host operates.
        let entry = unsafe { PluginEntry::load(path) }
            .map_err(|e| format!("load {}: {e}", path.display()))?;
        entries.insert(path.to_path_buf(), entry);
    }
    Ok(entries.get(path).expect("entry just inserted"))
}

fn describe_bundle(
    entries: &mut HashMap<PathBuf, PluginEntry>,
    path: &Path,
) -> Result<Vec<ClapPluginDesc>, String> {
    let entry = get_or_load_entry(entries, path)?;
    let factory = entry
        .get_plugin_factory()
        .ok_or_else(|| "bundle exposes no plugin factory".to_string())?;

    let mut out = Vec::new();
    for descriptor in factory.plugin_descriptors() {
        let Some(id) = descriptor.id() else { continue };
        let features = descriptor
            .features()
            .map(cstr_to_string)
            .collect::<Vec<_>>();
        if !is_supported_audio_effect_features(&features) {
            continue;
        }
        out.push(ClapPluginDesc {
            id: id.to_string_lossy().into_owned(),
            name: descriptor.name().map(cstr_to_string),
            vendor: descriptor.vendor().map(cstr_to_string),
            version: descriptor.version().map(cstr_to_string),
            features,
        });
    }
    Ok(out)
}

fn create_live(
    entries: &mut HashMap<PathBuf, PluginEntry>,
    path: &Path,
    plugin_id: Option<&str>,
    sample_rate: u32,
    channels: usize,
) -> Result<LiveClap, String> {
    let host_info = HostInfo::new(
        "FastCat",
        "FastCat",
        "https://fastcat.app",
        env!("CARGO_PKG_VERSION"),
    )
    .map_err(|e| format!("host info: {e}"))?;

    let entry = get_or_load_entry(entries, path)?;
    let factory = entry
        .get_plugin_factory()
        .ok_or_else(|| "bundle exposes no plugin factory".to_string())?;

    // Pick the requested plugin, or the first one the bundle exposes.
    let descriptor = factory
        .plugin_descriptors()
        .find(|d| match (plugin_id, d.id()) {
            (Some(want), Some(id)) => id.to_bytes() == want.as_bytes(),
            (None, Some(_)) => true,
            _ => false,
        })
        .ok_or_else(|| "no matching plugin in bundle".to_string())?;
    let descriptor_id = descriptor
        .id()
        .ok_or_else(|| "plugin descriptor has no id".to_string())?;
    let features = descriptor
        .features()
        .map(cstr_to_string)
        .collect::<Vec<_>>();
    if !is_supported_audio_effect_features(&features) {
        return Err("CLAP instruments and non-audio effects are not supported".to_string());
    }

    let mut instance = ClapPluginInstance::<FastcatClapHost>::new(
        |_| FastcatClapHostShared,
        |_| (),
        entry,
        descriptor_id,
        &host_info,
    )
    .map_err(|e| format!("instantiate: {e}"))?;

    let (port_in, port_out) = query_port_channels(&mut instance, channels);
    let latency_samples = query_latency_samples(&mut instance);

    let config = PluginAudioConfiguration {
        sample_rate: f64::from(sample_rate),
        min_frames_count: 1,
        max_frames_count: MAX_BLOCK as u32,
    };
    let stopped = instance
        .activate(|_, _| (), config)
        .map_err(|e| format!("activate: {e}"))?;
    let started = stopped
        .start_processing()
        .map_err(|e| format!("start_processing: {e}"))?;

    Ok(LiveClap {
        path: path.to_path_buf(),
        instance,
        processor: Some(started),
        input_ports: AudioPorts::with_capacity(port_in, 1),
        output_ports: AudioPorts::with_capacity(port_out, 1),
        in_scratch: vec![vec![0.0; MAX_BLOCK]; port_in],
        out_scratch: vec![vec![0.0; MAX_BLOCK]; port_out],
        port_in,
        port_out,
        latency_samples,
        steady_time: 0,
    })
}

/// Query the plugin's main input/output audio-port channel counts, falling back
/// to `fallback` when the audio-ports extension is absent or empty.
fn query_port_channels(
    instance: &mut ClapPluginInstance<FastcatClapHost>,
    fallback: usize,
) -> (usize, usize) {
    let mut handle = instance.plugin_handle();
    let Some(ports) = handle.shared().get_extension::<PluginAudioPorts>() else {
        return (fallback.max(1), fallback.max(1));
    };

    let mut buffer = AudioPortInfoBuffer::new();
    let read = |ports: &PluginAudioPorts,
                handle: &mut PluginMainThreadHandle,
                buffer: &mut AudioPortInfoBuffer,
                is_input: bool| {
        if ports.count(handle, is_input) == 0 {
            return fallback.max(1);
        }
        ports
            .get(handle, 0, is_input, buffer)
            .map(|info| (info.channel_count as usize).max(1))
            .unwrap_or_else(|| fallback.max(1))
    };

    let port_in = read(&ports, &mut handle, &mut buffer, true);
    let port_out = read(&ports, &mut handle, &mut buffer, false);
    (port_in, port_out)
}

fn query_latency_samples(instance: &mut ClapPluginInstance<FastcatClapHost>) -> u32 {
    let mut handle = instance.plugin_handle();
    handle
        .shared()
        .get_extension::<PluginLatency>()
        .map(|latency| latency.get(&mut handle))
        .unwrap_or(0)
}

fn is_supported_audio_effect_features(features: &[String]) -> bool {
    features.iter().any(|feature| feature == "audio-effect")
        && !features.iter().any(|feature| feature == "instrument")
}

fn cstr_to_string(value: &std::ffi::CStr) -> String {
    value.to_string_lossy().into_owned()
}

// ---------------------------------------------------------------------------
// Backend + instance (the Send-only side handed to PluginHost)
// ---------------------------------------------------------------------------

/// [`PluginBackend`] that hosts CLAP plugins referenced by a spec whose
/// `plugin.format` is [`AudioPluginFormat::Clap`].
pub struct ClapBackend {
    engine: ClapEngine,
}

impl ClapBackend {
    pub fn new() -> Self {
        Self {
            engine: ClapEngine::spawn("fastcat-clap-host")
                .unwrap_or_else(|_| ClapEngine { tx: dead_channel() }),
        }
    }
}

impl Default for ClapBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl PluginBackend for ClapBackend {
    fn can_handle(&self, spec: &AudioEffectSpec) -> bool {
        spec.plugin
            .as_ref()
            .is_some_and(|plugin| matches!(plugin.format, AudioPluginFormat::Clap))
    }

    fn instantiate(
        &self,
        spec: &AudioEffectSpec,
        sample_rate: u32,
        channels: usize,
    ) -> Box<dyn PluginInstance> {
        Box::new(ClapInstance::new(&self.engine, spec, sample_rate, channels))
    }
}

/// The `Send` half of a hosted CLAP plugin: a channel to the worker plus a
/// reusable response channel and transport buffer. When `alive` is false the
/// instance passes audio through untouched.
struct ClapInstance {
    id: u64,
    tx: Option<Sender<Command>>,
    proc_tx: Sender<Result<Vec<f32>, Vec<f32>>>,
    proc_rx: Receiver<Result<Vec<f32>, Vec<f32>>>,
    scratch: Vec<f32>,
    alive: bool,
    latency_samples: u32,
}

impl ClapInstance {
    fn new(engine: &ClapEngine, spec: &AudioEffectSpec, sample_rate: u32, channels: usize) -> Self {
        let (proc_tx, proc_rx) = channel::<Result<Vec<f32>, Vec<f32>>>();
        let mut instance = Self {
            id: 0,
            tx: None,
            proc_tx,
            proc_rx,
            scratch: Vec::new(),
            alive: false,
            latency_samples: 0,
        };

        let Some(plugin) = spec.plugin.as_ref() else {
            log::warn!(
                "CLAP effect {} has no plugin reference; passing audio through",
                spec.id
            );
            return instance;
        };
        let (resp, rx) = channel();
        let sent = engine.send(Command::Create {
            path: PathBuf::from(&plugin.path),
            plugin_id: plugin.plugin_id.clone(),
            sample_rate,
            channels,
            resp,
        });
        if sent.is_err() {
            return instance;
        }

        match rx.recv() {
            Ok(Ok(id)) => {
                instance.id = id;
                instance.tx = Some(engine.tx.clone());
                instance.alive = true;
                instance.latency_samples = query_instance_latency(engine, id).unwrap_or(0);
            }
            Ok(Err(err)) => {
                log::warn!(
                    "CLAP plugin {} failed to load ({err}); passing audio through",
                    plugin.path
                );
            }
            Err(_) => {}
        }
        instance
    }
}

impl PluginInstance for ClapInstance {
    fn set_params(&mut self, _spec: &AudioEffectSpec) {
        // Parameter events are a follow-up; the spec carries no CLAP param ids
        // yet and no UI produces them.
    }

    fn latency_samples(&self) -> u32 {
        self.latency_samples
    }

    fn process(
        &mut self,
        buffer: &mut [f32],
        channels: usize,
        context: super::PluginProcessContext,
    ) {
        if !self.alive {
            return;
        }
        let Some(tx) = self.tx.as_ref() else {
            return;
        };

        let mut payload = std::mem::take(&mut self.scratch);
        payload.clear();
        payload.extend_from_slice(buffer);

        if tx
            .send(Command::Process {
                id: self.id,
                channels,
                buffer: payload,
                context,
                resp: self.proc_tx.clone(),
            })
            .is_err()
        {
            self.alive = false;
            return;
        }

        match self.proc_rx.recv() {
            Ok(Ok(out)) => {
                if out.len() == buffer.len() {
                    buffer.copy_from_slice(&out);
                }
                self.scratch = out;
            }
            Ok(Err(out)) => {
                self.alive = false;
                self.scratch = out;
            }
            Err(_) => {
                self.alive = false;
            }
        }
    }

    fn reset(&mut self) {
        if let Some(tx) = self.tx.as_ref() {
            let _ = tx.send(Command::Reset { id: self.id });
        }
    }
}

fn query_instance_latency(engine: &ClapEngine, id: u64) -> Result<u32, ()> {
    let (resp, rx) = channel();
    engine.send(Command::GetLatency { id, resp })?;
    rx.recv().map_err(|_| ())
}

impl Drop for ClapInstance {
    fn drop(&mut self) {
        if let Some(tx) = self.tx.as_ref() {
            let _ = tx.send(Command::Destroy { id: self.id });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::audio::plugins::catalog::AudioPluginFormat;
    use crate::audio::plugins::AudioPluginRef;

    fn clap_spec(path: &str) -> AudioEffectSpec {
        AudioEffectSpec {
            id: "fx".into(),
            effect_type: "clap".into(),
            enabled: true,
            wet: 1.0,
            params: Default::default(),
            plugin: Some(AudioPluginRef {
                format: AudioPluginFormat::Clap,
                path: path.into(),
                plugin_id: None,
            }),
        }
    }

    #[test]
    fn backend_claims_only_specs_with_a_clap_plugin_ref() {
        let backend = ClapBackend::new();
        assert!(backend.can_handle(&clap_spec("/x.clap")));

        let mut without_ref = clap_spec("/x.clap");
        without_ref.plugin = None;
        assert!(!backend.can_handle(&without_ref));
    }

    #[test]
    fn missing_plugin_binary_passes_audio_through() {
        // Loading a nonexistent bundle must fail gracefully: the instance goes
        // inert and leaves the buffer untouched rather than erroring or silencing.
        let backend = ClapBackend::new();
        let mut instance =
            backend.instantiate(&clap_spec("/nonexistent/fastcat-test.clap"), 48_000, 2);
        let original = vec![0.25f32, -0.5, 0.75, -1.0];
        let mut buffer = original.clone();
        instance.process(
            &mut buffer,
            2,
            crate::audio::plugins::PluginProcessContext::at(0.0, 48_000),
        );
        assert_eq!(buffer, original);
    }

    #[test]
    fn describe_missing_bundle_is_error_not_panic() {
        assert!(describe(Path::new("/nonexistent/fastcat-test.clap")).is_err());
    }

    #[test]
    fn feature_filter_allows_audio_effects_only() {
        assert!(is_supported_audio_effect_features(&[
            "audio-effect".to_string(),
            "stereo".to_string(),
        ]));
        assert!(!is_supported_audio_effect_features(&[
            "instrument".to_string(),
            "synthesizer".to_string(),
        ]));
        assert!(!is_supported_audio_effect_features(&[
            "audio-effect".to_string(),
            "instrument".to_string(),
        ]));
    }

    #[test]
    #[ignore = "needs a real CLAP bundle; set FASTCAT_TEST_CLAP=/path/to/plugin.clap and run with --ignored"]
    fn real_plugin_loads_and_processes() {
        let Ok(path) = std::env::var("FASTCAT_TEST_CLAP") else {
            eprintln!("FASTCAT_TEST_CLAP not set; skipping");
            return;
        };
        let described = describe(Path::new(&path)).expect("describe should succeed");
        assert!(!described.is_empty(), "bundle should expose a plugin");
        eprintln!("described: {described:?}");

        let backend = ClapBackend::new();
        let mut instance = backend.instantiate(&clap_spec(&path), 48_000, 2);
        let mut buffer = vec![0.1f32; 2 * 512];
        instance.process(
            &mut buffer,
            2,
            crate::audio::plugins::PluginProcessContext::at(0.0, 48_000),
        );
        assert!(
            buffer.iter().all(|s| s.is_finite()),
            "output must be finite"
        );
        eprintln!("processed 512 stereo frames without panic");
    }
}
