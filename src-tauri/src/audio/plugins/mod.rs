//! Audio plugin host abstraction.
//!
//! This module provides the architecture for hosting external audio plugins
//! (LV2, CLAP, VST3) in the native audio pipeline. Currently it is a
//! placeholder — no real plugin format is implemented yet, but the hooks
//! are wired into the mixer so that adding LV2/CLAP later only requires
//! implementing the `PluginInstance` trait for each format.
//!
//! Design decisions for future implementers:
//!
//! 1. **Sample-rate safety:** Every plugin instance is keyed by the sample
//!    rate and channel count it was instantiated at. If the target layout
//!    changes (e.g. monitor device switched from 48 kHz to 44.1 kHz) a fresh
//!    instance is created for the new layout, so coefficients/delay lines are
//!    never reused across rates.
//!
//! 2. **No per-chunk allocation in the steady state:** `process` operates on a
//!    mutable `&mut [f32]` slice owned by the caller. Wet/dry blending reuses a
//!    scratch buffer kept on the host, so a stable graph allocates nothing per
//!    chunk after warmup.
//!
//! 3. **Channel layout:** Plugins receive interleaved f32. Mono plugins
//!    on stereo sources must be instantiated once per channel OR the host
//!    must split/merge. This is left to the concrete `PluginInstance`
//!    implementation.
//!
//! 4. **Stateful caching:** `PluginHost` keeps a HashMap of live instances
//!    keyed by `(layer_id, effect_id, sample_rate, channels)` — i.e. by stable
//!    identity, NOT by parameter values. When parameters change the *same*
//!    instance is kept and the new values are pushed via
//!    [`PluginInstance::set_params`], so delay lines / reverb tails are not
//!    destroyed on every knob tweak. Instances are removed only when the effect
//!    leaves the scene ([`PluginHost::retain_scene_specs`]).

use std::collections::{HashMap, HashSet};

pub mod catalog;
pub mod clap;

/// Specification of a single audio effect, sent from the frontend.
#[derive(Debug, Clone, PartialEq, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct AudioEffectSpec {
    pub id: String,
    #[serde(rename = "type")]
    pub effect_type: String,
    pub enabled: bool,
    /// Normalized 0..1 wet/dry mix applied by the host around the plugin's
    /// output (`out = dry * (1 - wet) + processed * wet`). At `wet >= 1.0` the
    /// dry signal is not retained, so there is no extra copy on the hot path.
    pub wet: f64,
    /// Plugin-specific parameters. Keys and ranges are defined by the
    /// plugin format (LV2 port symbol, CLAP param id, etc.).
    #[serde(default)]
    #[ts(type = "Record<string, unknown>")]
    pub params: std::collections::HashMap<String, serde_json::Value>,
    /// Reference to a scanned external plugin this effect maps to, when the
    /// effect is backed by a host format (CLAP/LV2/VST3) rather than a built-in
    /// DSP block. `None` for built-in effects. The host uses this to pick the
    /// backend and locate the binary; `effect_type` stays a stable category so
    /// the frontend does not need to special-case plugin ids.
    #[serde(default)]
    pub plugin: Option<AudioPluginRef>,
}

/// Locator that ties an [`AudioEffectSpec`] to a concrete plugin binary
/// discovered by the catalog scan. Format-agnostic so the same shape serves
/// CLAP, LV2 and VST3.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct AudioPluginRef {
    /// Which host backend loads this plugin.
    pub format: catalog::AudioPluginFormat,
    /// Absolute path to the plugin bundle/binary (from the scan descriptor).
    pub path: String,
    /// Sub-plugin identity within a bundle that exposes several plugins (e.g. a
    /// CLAP factory plugin id). `None` selects the bundle's first/only plugin.
    #[serde(default)]
    pub plugin_id: Option<String>,
}

/// A live, stateful plugin instance.
pub trait PluginInstance: Send {
    /// Push the current parameter values into the instance. Called once on
    /// creation and again whenever the spec's parameters change, so the
    /// instance can update gains/coefficients without being rebuilt.
    fn set_params(&mut self, spec: &AudioEffectSpec);

    /// Process `buffer` of interleaved f32 audio in-place. `channels` is the
    /// interleaved channel count (the sample rate is fixed at instantiation).
    fn process(&mut self, buffer: &mut [f32], channels: usize);

    /// Reset internal state (delay lines, envelopes, etc.) while keeping the
    /// instance alive. Called on seek/discontinuity so the plugin doesn't
    /// smear across the gap.
    fn reset(&mut self);
}

/// Placeholder passthrough — currently the only implementation.
struct PassthroughPlugin;

impl PluginInstance for PassthroughPlugin {
    fn set_params(&mut self, _spec: &AudioEffectSpec) {}
    fn process(&mut self, _buffer: &mut [f32], _channels: usize) {}
    fn reset(&mut self) {}
}

struct MultiplyPlugin;

impl PluginInstance for MultiplyPlugin {
    fn set_params(&mut self, _spec: &AudioEffectSpec) {}
    fn process(&mut self, buffer: &mut [f32], _channels: usize) {
        for sample in buffer.iter_mut() {
            *sample *= 2.0;
        }
    }
    fn reset(&mut self) {}
}

/// A factory that turns an [`AudioEffectSpec`] into a live [`PluginInstance`]
/// for one class of effect — a built-in DSP block or an external plugin format
/// (CLAP/LV2/VST3). This is the sole extension point for new host formats:
/// implement `PluginBackend` and register it via [`PluginHost::register_backend`];
/// nothing else in the host, mixer or cache is format-aware.
///
/// Instantiation may be expensive (dlopen + activate for external formats), so
/// the host only ever calls [`PluginBackend::instantiate`] off the realtime
/// audio thread — either lazily on the first `apply_effects` of a spec, or
/// ahead of time via [`PluginHost::prewarm_specs`].
pub trait PluginBackend: Send + Sync {
    /// Whether this backend owns the given spec. The first registered backend
    /// that returns `true` builds the instance; specs no backend claims fall
    /// through to a passthrough so an unknown/unavailable plugin is inert
    /// rather than fatal.
    fn can_handle(&self, spec: &AudioEffectSpec) -> bool;

    /// Build an instance for a fixed `(sample_rate, channels)` layout. The host
    /// pushes the current parameters via [`PluginInstance::set_params`] right
    /// after this returns, so implementations need not read params here.
    fn instantiate(
        &self,
        spec: &AudioEffectSpec,
        sample_rate: u32,
        channels: usize,
    ) -> Box<dyn PluginInstance>;
}

/// Built-in effects that ship with the app, plus the `test-multiply` fixture
/// used by tests. External formats (CLAP/LV2/VST3) are added as their own
/// backends and are not handled here.
struct BuiltinBackend;

impl PluginBackend for BuiltinBackend {
    fn can_handle(&self, spec: &AudioEffectSpec) -> bool {
        spec.effect_type == "test-multiply"
    }

    fn instantiate(
        &self,
        _spec: &AudioEffectSpec,
        _sample_rate: u32,
        _channels: usize,
    ) -> Box<dyn PluginInstance> {
        Box::new(MultiplyPlugin)
    }
}

/// Cache key for a live plugin instance — stable identity, not parameters.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct InstanceKey {
    layer_id: String,
    effect_id: String,
    sample_rate: u32,
    channels: usize,
}

/// A cached instance plus the spec last pushed into it, so the host can detect
/// parameter changes without recreating the instance.
struct CachedInstance {
    instance: Box<dyn PluginInstance>,
    applied_spec: AudioEffectSpec,
}

/// Host that owns and reuses plugin instances across chunks.
pub struct PluginHost {
    instances: HashMap<InstanceKey, CachedInstance>,
    /// Registered backends, consulted in registration order to build instances.
    /// A spec no backend claims falls through to [`PassthroughPlugin`].
    backends: Vec<Box<dyn PluginBackend>>,
    /// Reused dry-signal buffer for wet/dry blending; grows to the largest
    /// chunk seen and is then reused without reallocating.
    scratch: Vec<f32>,
    #[cfg(test)]
    pub reset_all_count: usize,
}

impl Default for PluginHost {
    fn default() -> Self {
        Self::new()
    }
}

impl PluginHost {
    pub fn new() -> Self {
        Self {
            instances: HashMap::new(),
            backends: vec![Box::new(BuiltinBackend), Box::new(clap::ClapBackend)],
            scratch: Vec::new(),
            #[cfg(test)]
            reset_all_count: 0,
        }
    }

    /// Register an additional plugin backend (e.g. a CLAP host). Backends are
    /// consulted in registration order; the first that `can_handle` a spec owns
    /// it. Call once at startup before audio flows — the registry is not locked
    /// per chunk, so adding a backend mid-playback is not supported.
    pub fn register_backend(&mut self, backend: Box<dyn PluginBackend>) {
        self.backends.push(backend);
    }

    /// Build an instance for `spec` at the given layout, routing through the
    /// registered backends and falling back to passthrough. Associated (not a
    /// method) so callers can split-borrow `backends` alongside `instances`.
    /// May be expensive — never call from the realtime audio thread.
    fn build_instance(
        backends: &[Box<dyn PluginBackend>],
        spec: &AudioEffectSpec,
        sample_rate: u32,
        channels: usize,
    ) -> CachedInstance {
        let mut instance = backends
            .iter()
            .find(|backend| backend.can_handle(spec))
            .map(|backend| backend.instantiate(spec, sample_rate, channels))
            .unwrap_or_else(|| Box::new(PassthroughPlugin) as Box<dyn PluginInstance>);
        instance.set_params(spec);
        CachedInstance {
            instance,
            applied_spec: spec.clone(),
        }
    }

    /// Pre-create instances for `specs` on `layer_id` without processing audio,
    /// so the realtime path finds them already cached. Intended to be called
    /// from the scene-update (main) thread whenever the effect graph changes,
    /// keeping expensive dlopen/activate work off the audio thread. A no-op for
    /// specs whose instance already exists at this `(sample_rate, channels)`
    /// layout. Not yet wired on the realtime path — the built-in backends
    /// instantiate cheaply, so lazy creation in `apply_effects` suffices; wire
    /// this once a backend with costly instantiation (CLAP) is registered and
    /// the realtime target layout is threaded to the scene-update call site.
    pub fn prewarm_specs(
        &mut self,
        layer_id: &str,
        sample_rate: u32,
        channels: usize,
        specs: &[AudioEffectSpec],
    ) {
        let Self {
            instances,
            backends,
            ..
        } = self;
        for spec in specs.iter().filter(|s| s.enabled) {
            let key = InstanceKey {
                layer_id: layer_id.to_string(),
                effect_id: spec.id.clone(),
                sample_rate,
                channels,
            };
            instances
                .entry(key)
                .or_insert_with(|| Self::build_instance(backends, spec, sample_rate, channels));
        }
    }

    /// Apply all enabled effects in `specs` to `buffer` in order.
    /// `layer_id` identifies the layer so instances can be cached per-layer.
    pub fn apply_effects(
        &mut self,
        layer_id: &str,
        buffer: &mut [f32],
        sample_rate: u32,
        channels: usize,
        specs: &[AudioEffectSpec],
    ) {
        // Split-borrow so the wet/dry blend can touch `scratch` while a cached
        // instance is mutably borrowed out of `instances`.
        let Self {
            instances,
            scratch,
            backends,
            ..
        } = self;

        for spec in specs.iter().filter(|s| s.enabled) {
            let key = InstanceKey {
                layer_id: layer_id.to_string(),
                effect_id: spec.id.clone(),
                sample_rate,
                channels,
            };

            let cached = instances
                .entry(key)
                .or_insert_with(|| Self::build_instance(backends, spec, sample_rate, channels));

            // Parameters changed → push them into the live instance instead of
            // rebuilding it, preserving internal state.
            if cached.applied_spec != *spec {
                cached.instance.set_params(spec);
                cached.applied_spec = spec.clone();
            }

            let wet = (spec.wet as f32).clamp(0.0, 1.0);
            if wet >= 1.0 {
                cached.instance.process(buffer, channels);
            } else {
                // Keep the dry signal, process the wet path, then blend. The
                // plugin still runs at wet == 0 so its internal state advances.
                scratch.clear();
                scratch.extend_from_slice(buffer);
                cached.instance.process(buffer, channels);
                for (out, dry) in buffer.iter_mut().zip(scratch.iter()) {
                    *out = *dry * (1.0 - wet) + *out * wet;
                }
            }
        }
    }

    /// Apply master-bus effects post-mix. Uses a stable synthetic layer id so
    /// master effect instances are cached independently from per-layer effects.
    pub fn apply_master_effects(
        &mut self,
        buffer: &mut [f32],
        sample_rate: u32,
        channels: usize,
        specs: &[AudioEffectSpec],
    ) {
        self.apply_effects("__master_bus", buffer, sample_rate, channels, specs);
    }

    /// Reset internal state of all instances belonging to `layer_id` while
    /// keeping them cached. Call on a per-layer discontinuity.
    pub fn reset_layer(&mut self, layer_id: &str) {
        for (key, cached) in self.instances.iter_mut() {
            if key.layer_id == layer_id {
                cached.instance.reset();
            }
        }
    }

    /// Reset internal state of ALL instances (keeping them cached). Call on a
    /// global seek/flush so no plugin smears audio across the gap.
    pub fn reset_all(&mut self) {
        for cached in self.instances.values_mut() {
            cached.instance.reset();
        }
        #[cfg(test)]
        {
            self.reset_all_count += 1;
        }
    }

    /// Drop instances that no longer exist in the current scene/effect graph.
    /// This is the sole lifecycle GC; the hot `apply_effects` path does not
    /// prune.
    pub fn retain_scene_specs<'a, I>(&mut self, layers: I, master_specs: &[AudioEffectSpec])
    where
        I: IntoIterator<Item = (&'a str, &'a [AudioEffectSpec])>,
    {
        let mut active: HashSet<(&str, &str)> = HashSet::new();
        for (layer_id, specs) in layers {
            for spec in specs.iter().filter(|s| s.enabled) {
                active.insert((layer_id, spec.id.as_str()));
            }
        }
        for spec in master_specs.iter().filter(|s| s.enabled) {
            active.insert(("__master_bus", spec.id.as_str()));
        }

        self.instances
            .retain(|key, _| active.contains(&(key.layer_id.as_str(), key.effect_id.as_str())));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn spec(id: &str) -> AudioEffectSpec {
        AudioEffectSpec {
            id: id.into(),
            effect_type: "passthrough".into(),
            enabled: true,
            wet: 1.0,
            params: Default::default(),
            plugin: None,
        }
    }

    #[test]
    fn passthrough_does_not_modify_buffer() {
        let mut plugin = PassthroughPlugin;
        let original = vec![0.5f32, -0.5f32, 1.0f32, -1.0f32];
        let mut buf = original.clone();
        plugin.process(&mut buf, 2);
        assert_eq!(buf, original);
    }

    #[test]
    fn passthrough_reset_is_noop() {
        let mut plugin = PassthroughPlugin;
        plugin.reset(); // must not panic
    }

    #[test]
    fn host_applies_enabled_effects_only() {
        let mut host = PluginHost::new();
        let mut buf = vec![1.0f32; 4];
        let mut disabled = spec("fx1");
        disabled.enabled = false;
        host.apply_effects("layer-1", &mut buf, 48_000, 2, &[disabled]);
        assert_eq!(buf, vec![1.0f32; 4]);
        assert!(host.instances.is_empty());
    }

    #[test]
    fn host_caches_instances_per_layer_and_effect() {
        let mut host = PluginHost::new();
        let fx = spec("fx1");

        host.apply_effects(
            "layer-1",
            &mut [1.0f32; 4],
            48_000,
            2,
            std::slice::from_ref(&fx),
        );
        assert_eq!(host.instances.len(), 1);

        // Same key reuses the cached instance.
        host.apply_effects(
            "layer-1",
            &mut [1.0f32; 4],
            48_000,
            2,
            std::slice::from_ref(&fx),
        );
        assert_eq!(host.instances.len(), 1);

        // Different id → new instance.
        host.apply_effects("layer-1", &mut [1.0f32; 4], 48_000, 2, &[spec("fx2")]);
        assert_eq!(host.instances.len(), 2);
    }

    #[test]
    fn param_change_reuses_instance_and_pushes_new_params() {
        let mut host = PluginHost::new();
        let mut fx = spec("fx1");
        host.apply_effects(
            "layer-1",
            &mut [1.0f32; 4],
            48_000,
            2,
            std::slice::from_ref(&fx),
        );
        assert_eq!(host.instances.len(), 1);

        // Tweak a parameter: the instance must be kept (stable key), not rebuilt.
        fx.params.insert("gain".into(), serde_json::json!(0.5));
        host.apply_effects(
            "layer-1",
            &mut [1.0f32; 4],
            48_000,
            2,
            std::slice::from_ref(&fx),
        );
        assert_eq!(host.instances.len(), 1);

        let cached = host.instances.values().next().unwrap();
        assert_eq!(
            cached.applied_spec.params.get("gain"),
            Some(&serde_json::json!(0.5))
        );
    }

    #[test]
    fn separate_instance_per_sample_rate() {
        let mut host = PluginHost::new();
        let fx = spec("fx1");
        host.apply_effects(
            "layer-1",
            &mut [1.0f32; 4],
            48_000,
            2,
            std::slice::from_ref(&fx),
        );
        host.apply_effects(
            "layer-1",
            &mut [1.0f32; 4],
            44_100,
            2,
            std::slice::from_ref(&fx),
        );
        assert_eq!(host.instances.len(), 2);
    }

    #[test]
    fn reset_all_keeps_instances() {
        let mut host = PluginHost::new();
        host.apply_effects("layer-1", &mut [1.0f32; 4], 48_000, 2, &[spec("fx1")]);
        assert_eq!(host.instances.len(), 1);
        host.reset_all(); // resets state, keeps the cache
        assert_eq!(host.instances.len(), 1);
    }

    #[test]
    fn reset_layer_keeps_instances() {
        let mut host = PluginHost::new();
        host.apply_effects("layer-1", &mut [1.0f32; 4], 48_000, 2, &[spec("fx1")]);
        host.apply_effects("layer-2", &mut [1.0f32; 4], 48_000, 2, &[spec("fx1")]);
        assert_eq!(host.instances.len(), 2);
        host.reset_layer("layer-1"); // resets state only, removes nothing
        assert_eq!(host.instances.len(), 2);
    }

    #[test]
    fn retain_scene_specs_drops_absent_effects() {
        let mut host = PluginHost::new();
        host.apply_effects("layer-1", &mut [1.0f32; 4], 48_000, 2, &[spec("fx1")]);
        host.apply_effects("layer-2", &mut [1.0f32; 4], 48_000, 2, &[spec("fx2")]);
        assert_eq!(host.instances.len(), 2);

        // Only layer-1/fx1 remains in the scene.
        let fx1 = [spec("fx1")];
        host.retain_scene_specs([("layer-1", fx1.as_slice())], &[]);
        assert_eq!(host.instances.len(), 1);
        assert!(host.instances.keys().all(|k| k.layer_id == "layer-1"));
    }

    #[test]
    fn wet_zero_blends_back_to_dry() {
        // Passthrough's wet output == dry, so any wet value is a no-op here,
        // but the dry/blend path must run without panicking or sizing wrong.
        let mut host = PluginHost::new();
        let mut fx = spec("fx1");
        fx.wet = 0.0;
        let mut buf = vec![0.25f32, -0.5, 0.75, -1.0];
        host.apply_effects("layer-1", &mut buf, 48_000, 2, &[fx]);
        assert_eq!(buf, vec![0.25f32, -0.5, 0.75, -1.0]);
    }

    /// A stand-in for a future format backend (CLAP/LV2/VST3): claims its own
    /// `effect_type` and produces an instance that adds 1.0 so the test can
    /// prove the registry, not a hardcoded branch, selected it.
    struct AddOneBackend;

    impl PluginBackend for AddOneBackend {
        fn can_handle(&self, spec: &AudioEffectSpec) -> bool {
            spec.effect_type == "add-one"
        }

        fn instantiate(
            &self,
            _spec: &AudioEffectSpec,
            _sample_rate: u32,
            _channels: usize,
        ) -> Box<dyn PluginInstance> {
            struct AddOne;
            impl PluginInstance for AddOne {
                fn set_params(&mut self, _spec: &AudioEffectSpec) {}
                fn process(&mut self, buffer: &mut [f32], _channels: usize) {
                    for sample in buffer.iter_mut() {
                        *sample += 1.0;
                    }
                }
                fn reset(&mut self) {}
            }
            Box::new(AddOne)
        }
    }

    #[test]
    fn registered_backend_handles_its_own_specs() {
        let mut host = PluginHost::new();
        host.register_backend(Box::new(AddOneBackend));
        let mut fx = spec("fx1");
        fx.effect_type = "add-one".into();
        let mut buf = vec![0.0f32; 4];
        host.apply_effects("layer-1", &mut buf, 48_000, 2, &[fx]);
        assert_eq!(buf, vec![1.0f32; 4]);
    }

    #[test]
    fn unclaimed_effect_type_falls_through_to_passthrough() {
        // No backend claims "passthrough", so the host must leave audio intact
        // rather than error — an unknown/unavailable plugin is inert.
        let mut host = PluginHost::new();
        let mut buf = vec![0.25f32, -0.5, 0.75, -1.0];
        host.apply_effects("layer-1", &mut buf, 48_000, 2, &[spec("fx1")]);
        assert_eq!(buf, vec![0.25f32, -0.5, 0.75, -1.0]);
    }

    #[test]
    fn prewarm_creates_instances_reused_by_realtime_path() {
        let mut host = PluginHost::new();
        let fx = spec("fx1");
        host.prewarm_specs("layer-1", 48_000, 2, std::slice::from_ref(&fx));
        assert_eq!(host.instances.len(), 1);

        // The realtime path must reuse the prewarmed instance, not build a new
        // one at the same layout.
        host.apply_effects(
            "layer-1",
            &mut [1.0f32; 4],
            48_000,
            2,
            std::slice::from_ref(&fx),
        );
        assert_eq!(host.instances.len(), 1);
    }

    #[test]
    fn prewarm_skips_disabled_specs() {
        let mut host = PluginHost::new();
        let mut fx = spec("fx1");
        fx.enabled = false;
        host.prewarm_specs("layer-1", 48_000, 2, &[fx]);
        assert!(host.instances.is_empty());
    }

    #[test]
    fn plugin_ref_survives_json_roundtrip() {
        let mut fx = spec("fx1");
        fx.plugin = Some(AudioPluginRef {
            format: catalog::AudioPluginFormat::Clap,
            path: "/usr/lib/clap/synth.clap".into(),
            plugin_id: Some("com.example.synth".into()),
        });
        let json = serde_json::to_string(&fx).unwrap();
        let back: AudioEffectSpec = serde_json::from_str(&json).unwrap();
        assert_eq!(back, fx);
    }

    #[test]
    fn plugin_ref_defaults_to_none_when_absent() {
        let json = r#"{"id":"fx1","type":"passthrough","enabled":true,"wet":1.0}"#;
        let spec: AudioEffectSpec = serde_json::from_str(json).unwrap();
        assert_eq!(spec.plugin, None);
    }
}
