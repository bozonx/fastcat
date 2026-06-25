//! Cross-engine parity tests: the native (Tauri/vello/wgpu) video engine renders
//! the same shared scenes as the web (pixi.js/WebGPU) engine, and both must
//! produce the same perceptual hash for each frame.
//!
//! These tests load scene fixtures from `shared/scenes/`, resolve media paths
//! to `test/fixtures/media/`, render frames through the real GPU compositor,
//! compute an 8x8 average hash, and compare against golden hashes in
//! `shared/golden/frames.json`.
//!
//! Skips gracefully when ffmpeg or a wgpu adapter is unavailable.

mod common;

use std::path::{Path, PathBuf};

use app_lib::compositor::Compositor;
use app_lib::media::timeline_render::{build_export_scene, VideoDecoderCache};
use app_lib::monitor::scene::MonitorScene;
use serde::Deserialize;

// ── Perceptual hash (must match the TS implementation in frame-hash.ts) ──

fn compute_frame_hash(rgba: &[u8], width: usize, height: usize) -> String {
    let mut grid = [0.0f64; 64];
    let mut counts = [0.0f64; 64];
    let x_step = width as f64 / 8.0;
    let y_step = height as f64 / 8.0;

    for y in 0..height {
        let gy = (y as f64 / y_step).floor() as usize;
        let gy = gy.min(7);
        for x in 0..width {
            let gx = (x as f64 / x_step).floor() as usize;
            let gx = gx.min(7);
            let i = (y * width + x) * 4;
            let r = rgba[i] as f64;
            let g = rgba[i + 1] as f64;
            let b = rgba[i + 2] as f64;
            let luma = 0.299 * r + 0.587 * g + 0.114 * b;
            let idx = gy * 8 + gx;
            grid[idx] += luma;
            counts[idx] += 1.0;
        }
    }

    for i in 0..64 {
        if counts[i] > 0.0 {
            grid[i] /= counts[i];
        }
    }

    let mean: f64 = grid.iter().sum::<f64>() / 64.0;

    let mut hash: u128 = 0;
    for (i, &val) in grid.iter().enumerate() {
        if val > mean {
            hash |= 1u128 << (63 - i);
        }
    }

    format!("{:016x}", hash)
}

fn hamming_distance(a: &str, b: &str) -> usize {
    let a_val = u128::from_str_radix(a, 16).unwrap_or(0);
    let b_val = u128::from_str_radix(b, 16).unwrap_or(0);
    let diff = a_val ^ b_val;
    diff.count_ones() as usize
}

// ── Golden registry ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenSample {
    time_sec: f64,
    hash: String,
    tolerance: usize,
}

#[derive(Debug, Deserialize)]
struct GoldenEntry {
    scene: String,
    engine: String,
    samples: Vec<GoldenSample>,
}

#[derive(Debug, Deserialize)]
struct GoldenRegistry {
    entries: Vec<GoldenEntry>,
}

fn load_golden_registry() -> GoldenRegistry {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../shared/golden/frames.json");
    let raw = std::fs::read_to_string(&path)
        .unwrap_or_else(|_| String::from(r#"{"entries":[]}"#));
    serde_json::from_str(&raw).expect("golden frames.json must be valid")
}

fn find_golden<'r>(
    registry: &'r GoldenRegistry,
    scene: &str,
    engine: &str,
) -> Option<&'r GoldenEntry> {
    registry
        .entries
        .iter()
        .find(|e| e.scene == scene && e.engine == engine)
}

// ── Scene fixture loader ──

const DEFAULT_TOLERANCE: usize = 10;

fn default_tolerance() -> usize {
    DEFAULT_TOLERANCE
}

#[derive(Debug, Deserialize)]
struct SceneFixture {
    scene: serde_json::Value,
    sample_times_sec: Vec<f64>,
    #[serde(default = "default_tolerance")]
    tolerance: usize,
}

fn scenes_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../shared/scenes")
        .canonicalize()
        .expect("shared/scenes dir should exist")
}

fn load_scene(filename: &str) -> SceneFixture {
    let raw = std::fs::read_to_string(scenes_dir().join(filename))
        .unwrap_or_else(|e| panic!("failed to read scene {filename}: {e}"));
    serde_json::from_str(&raw)
        .unwrap_or_else(|e| panic!("failed to parse scene {filename}: {e}"))
}

/// A scene discovered at runtime from `shared/scenes/`.
struct DiscoveredScene {
    filename: String,
    tolerance: usize,
}

/// Scan `shared/scenes/` for all `*.json` files and return them sorted by name.
/// This replaces the former hardcoded SCENES array so that adding a new scene
/// is as simple as dropping a JSON file into the directory.
fn discover_scenes() -> Vec<DiscoveredScene> {
    let dir = scenes_dir();
    let mut scenes: Vec<DiscoveredScene> = Vec::new();

    for entry in std::fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("failed to read scenes dir {}: {e}", dir.display()))
    {
        let entry = entry.expect("dir entry");
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let filename = path
            .file_name()
            .and_then(|n| n.to_str())
            .expect("valid filename")
            .to_owned();

        let fixture = load_scene(&filename);
        scenes.push(DiscoveredScene {
            filename,
            tolerance: fixture.tolerance,
        });
    }

    scenes.sort_by(|a, b| a.filename.cmp(&b.filename));
    scenes
}

/// Resolve relative media paths in a scene to absolute paths under
/// `test/fixtures/media/`.
fn resolve_scene_media_paths(scene_json: &mut serde_json::Value) {
    if let Some(layers) = scene_json.get_mut("layers").and_then(|l| l.as_array_mut()) {
        let fixtures = common::fixtures_dir();
        for layer in layers {
            if let Some(path) = layer.get("path").and_then(|p| p.as_str()) {
                if !path.is_empty() {
                    let abs = fixtures.join(path);
                    layer["path"] = serde_json::Value::String(
                        abs.to_string_lossy().into_owned(),
                    );
                }
            }
        }
    }
}

#[test]
fn native_engine_parity_renders_all_scenes() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );
    skip_unless!(
        Compositor::is_gpu_available(),
        "no wgpu adapter (headless CI without software Vulkan)"
    );

    let scenes = discover_scenes();
    let registry = load_golden_registry();
    let mut compositor = Compositor::new();
    let dev_id = compositor.ensure_offscreen_device().expect("offscreen device");

    for scene_def in &scenes {
        let mut fixture = load_scene(&scene_def.filename);
        resolve_scene_media_paths(&mut fixture.scene);

        let monitor_scene: MonitorScene =
            serde_json::from_value(fixture.scene.clone())
                .unwrap_or_else(|e| panic!("failed to parse MonitorScene from {}: {e}", scene_def.filename));

        let width = monitor_scene.width.max(1);
        let height = monitor_scene.height.max(1);

        for &time_sec in &fixture.sample_times_sec {
            let mut cache = VideoDecoderCache::new();
            let compositor_scene = build_export_scene(
                &monitor_scene,
                time_sec,
                (width, height),
                &mut cache,
                None,
            )
            .unwrap_or_else(|e| panic!("build_export_scene failed for {} at t={time_sec}: {e}", scene_def.filename));

            let pixels = compositor
                .render_scene_to_pixels(dev_id, &compositor_scene, width, height)
                .unwrap_or_else(|e| panic!("render_scene_to_pixels failed for {} at t={time_sec}: {e}", scene_def.filename));

            let hash = compute_frame_hash(&pixels, width as usize, height as usize);

            // Look up golden entry for this scene + native engine.
            if let Some(entry) = find_golden(&registry, &scene_def.filename, "native") {
                if let Some(golden) = entry.samples.iter().find(|s| (s.time_sec - time_sec).abs() < 1e-6) {
                    // Treat placeholder hashes as "no golden yet" — print for import.
                    if golden.hash == "0000000000000000" {
                        eprintln!(
                            "GOLDEN[native] {} t={time_sec} hash={hash} tolerance={}",
                            scene_def.filename, scene_def.tolerance,
                        );
                    } else {
                        let distance = hamming_distance(&hash, &golden.hash);
                        assert!(
                            distance <= golden.tolerance,
                            "hash mismatch for \"{}\" native at t={time_sec}s: \
                             distance={distance} tolerance={} actual={hash} expected={}",
                            scene_def.filename, golden.tolerance, golden.hash,
                        );
                    }
                } else {
                    eprintln!(
                        "WARN: no golden sample for {} native at t={time_sec}s, hash={hash}",
                        scene_def.filename,
                    );
                }
            } else {
                // No golden yet — print the hash so the generator can capture it.
                eprintln!(
                    "GOLDEN[native] {} t={time_sec} hash={hash} tolerance={}",
                    scene_def.filename, scene_def.tolerance,
                );
            }
        }
    }
}

#[test]
fn native_engine_cross_engine_parity_vs_web_golden() {
    skip_unless!(
        common::has_ffmpeg() && common::has_ffprobe(),
        "ffmpeg/ffprobe not installed"
    );
    skip_unless!(
        Compositor::is_gpu_available(),
        "no wgpu adapter (headless CI without software Vulkan)"
    );

    let registry = load_golden_registry();
    let mut compositor = Compositor::new();
    let dev_id = compositor.ensure_offscreen_device().expect("offscreen device");

    let scenes = discover_scenes();

    for scene_def in &scenes {
        // Only test scenes that have BOTH web and native golden entries.
        let web_entry = match find_golden(&registry, &scene_def.filename, "web") {
            Some(e) => e,
            None => continue,
        };
        let native_entry = match find_golden(&registry, &scene_def.filename, "native") {
            Some(e) => e,
            None => continue,
        };

        let mut fixture = load_scene(&scene_def.filename);
        resolve_scene_media_paths(&mut fixture.scene);

        let monitor_scene: MonitorScene =
            serde_json::from_value(fixture.scene.clone())
                .unwrap_or_else(|e| panic!("failed to parse MonitorScene from {}: {e}", scene_def.filename));

        let width = monitor_scene.width.max(1);
        let height = monitor_scene.height.max(1);

        for &time_sec in &fixture.sample_times_sec {
            let mut cache = VideoDecoderCache::new();
            let compositor_scene = build_export_scene(
                &monitor_scene,
                time_sec,
                (width, height),
                &mut cache,
                None,
            )
            .expect("build_export_scene");

            let pixels = compositor
                .render_scene_to_pixels(dev_id, &compositor_scene, width, height)
                .expect("render_scene_to_pixels");

            let native_hash = compute_frame_hash(&pixels, width as usize, height as usize);

            // Compare native hash against web golden hash.
            if let Some(web_sample) = web_entry.samples.iter().find(|s| (s.time_sec - time_sec).abs() < 1e-6) {
                // Skip placeholder hashes — they haven't been generated yet.
                if web_sample.hash == "0000000000000000" {
                    eprintln!(
                        "GOLDEN[native] {} t={time_sec} hash={native_hash} tolerance={}",
                        scene_def.filename, scene_def.tolerance,
                    );
                    continue;
                }

                let tolerance = web_sample.tolerance.max(scene_def.tolerance);
                let distance = hamming_distance(&native_hash, &web_sample.hash);
                assert!(
                    distance <= tolerance,
                    "cross-engine mismatch for \"{}\" at t={time_sec}s: \
                     distance={distance} tolerance={tolerance} \
                     native={native_hash} web={}",
                    scene_def.filename, web_sample.hash,
                );
            }

            // Also verify native hash matches its own golden.
            if let Some(native_sample) = native_entry.samples.iter().find(|s| (s.time_sec - time_sec).abs() < 1e-6) {
                // Skip placeholder native hashes.
                if native_sample.hash == "0000000000000000" {
                    continue;
                }
                let distance = hamming_distance(&native_hash, &native_sample.hash);
                assert!(
                    distance <= native_sample.tolerance,
                    "native self-parity mismatch for \"{}\" at t={time_sec}s: \
                     distance={distance} tolerance={} actual={native_hash} expected={}",
                    scene_def.filename, native_sample.tolerance, native_sample.hash,
                );
            }
        }
    }
}
