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

// ── Color signature (must match computeColorSignature in perceptual-hash.ts) ──
//
// The luma aHash above is colour-blind: a red layer rendered green hashes the
// same. The 2x2 mean-colour signature (12 bytes → 24 hex chars) catches hue
// errors the aHash misses, and is compared via L1 distance.

const COLOR_CELLS: usize = 2;

/// Default colour-signature tolerance (matches `DEFAULT_COLOR_TOLERANCE` in TS):
/// total L1 distance across the 12 signature bytes.
const DEFAULT_COLOR_TOLERANCE: usize = 240;

fn compute_color_signature(rgba: &[u8], width: usize, height: usize) -> String {
    let cells = COLOR_CELLS * COLOR_CELLS;
    let mut sum_r = vec![0.0f64; cells];
    let mut sum_g = vec![0.0f64; cells];
    let mut sum_b = vec![0.0f64; cells];
    let mut counts = vec![0.0f64; cells];

    let x_step = width as f64 / COLOR_CELLS as f64;
    let y_step = height as f64 / COLOR_CELLS as f64;

    for y in 0..height {
        let gy = ((y as f64 / y_step).floor() as usize).min(COLOR_CELLS - 1);
        for x in 0..width {
            let gx = ((x as f64 / x_step).floor() as usize).min(COLOR_CELLS - 1);
            let i = (y * width + x) * 4;
            let idx = gy * COLOR_CELLS + gx;
            sum_r[idx] += rgba[i] as f64;
            sum_g[idx] += rgba[i + 1] as f64;
            sum_b[idx] += rgba[i + 2] as f64;
            counts[idx] += 1.0;
        }
    }

    let mut out = String::with_capacity(cells * 6);
    for idx in 0..cells {
        let n = if counts[idx] > 0.0 { counts[idx] } else { 1.0 };
        let r = (sum_r[idx] / n).round().clamp(0.0, 255.0) as u8;
        let g = (sum_g[idx] / n).round().clamp(0.0, 255.0) as u8;
        let b = (sum_b[idx] / n).round().clamp(0.0, 255.0) as u8;
        out.push_str(&format!("{:02x}{:02x}{:02x}", r, g, b));
    }
    out
}

fn color_signature_distance(a: &str, b: &str) -> usize {
    assert_eq!(a.len(), b.len(), "color signature length mismatch");
    let mut total = 0usize;
    let mut i = 0;
    while i < a.len() {
        let av = u8::from_str_radix(&a[i..i + 2], 16).unwrap_or(0) as i32;
        let bv = u8::from_str_radix(&b[i..i + 2], 16).unwrap_or(0) as i32;
        total += (av - bv).unsigned_abs() as usize;
        i += 2;
    }
    total
}

// ── Golden registry ──

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoldenSample {
    time_sec: f64,
    hash: String,
    tolerance: usize,
    #[serde(default)]
    color_sig: Option<String>,
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

/// Explicit sentinel for a not-yet-generated golden hash. Distinct from a real
/// all-zero aHash (`0000000000000000`), which is the legitimate hash of a
/// *uniform* frame (e.g. a transition resolved to a solid background) and is
/// validated normally via its colour signature.
const PENDING_HASH: &str = "pending";

fn load_golden_registry() -> GoldenRegistry {
    let path =
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../shared/golden/frames.json");
    let raw = std::fs::read_to_string(&path).unwrap_or_else(|_| String::from(r#"{"entries":[]}"#));
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

fn default_color_tolerance() -> usize {
    DEFAULT_COLOR_TOLERANCE
}

#[derive(Debug, Deserialize)]
struct SceneFixture {
    scene: serde_json::Value,
    sample_times_sec: Vec<f64>,
    #[serde(default = "default_tolerance")]
    tolerance: usize,
    /// Per-scene cross-engine colour-signature tolerance. A handful of scenes
    /// (vector shapes, adjustment layers, heavy transforms) render with
    /// genuinely different mean colour between web (pixi) and native (vello) and
    /// raise this to document that divergence. Defaults to the global ceiling.
    #[serde(default = "default_color_tolerance")]
    color_tolerance: usize,
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
    serde_json::from_str(&raw).unwrap_or_else(|e| panic!("failed to parse scene {filename}: {e}"))
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
                    layer["path"] = serde_json::Value::String(abs.to_string_lossy().into_owned());
                }
            }
        }
    }
}

// ── Frame-hash shared fixture (locks the hash impl against perceptual-hash.ts) ──

#[derive(Debug, Deserialize)]
struct FrameHashFixture {
    cases: Vec<FrameHashCase>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FrameHashCase {
    name: String,
    width: usize,
    height: usize,
    background: [u8; 4],
    rects: Vec<FrameHashRect>,
    expected_hash: String,
    expected_color_sig: String,
}

#[derive(Debug, Deserialize)]
struct FrameHashRect {
    x: usize,
    y: usize,
    w: usize,
    h: usize,
    color: [u8; 4],
}

/// Rebuild an RGBA frame from its procedural description (mirrored in the TS
/// test `frame-hash.parity.test.ts`).
fn build_parity_frame(
    width: usize,
    height: usize,
    background: [u8; 4],
    rects: &[FrameHashRect],
) -> Vec<u8> {
    let mut buf = vec![0u8; width * height * 4];
    for p in 0..(width * height) {
        buf[p * 4] = background[0];
        buf[p * 4 + 1] = background[1];
        buf[p * 4 + 2] = background[2];
        buf[p * 4 + 3] = background[3];
    }
    for r in rects {
        for y in r.y..(r.y + r.h) {
            for x in r.x..(r.x + r.w) {
                let i = (y * width + x) * 4;
                buf[i] = r.color[0];
                buf[i + 1] = r.color[1];
                buf[i + 2] = r.color[2];
                buf[i + 3] = r.color[3];
            }
        }
    }
    buf
}

/// The native hash implementation must reproduce the golden values computed by
/// the canonical TS implementation, byte-for-byte. This is the lock that keeps
/// the two independent hash copies from silently diverging and invalidating
/// every golden-frame parity comparison. Needs no GPU or ffmpeg.
#[test]
fn frame_hash_matches_shared_parity_fixture() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../shared/parity/frame-hash.cases.json");
    let raw = std::fs::read_to_string(&path).expect("frame-hash.cases.json must exist");
    let fixture: FrameHashFixture =
        serde_json::from_str(&raw).expect("frame-hash.cases.json must be valid");

    assert!(!fixture.cases.is_empty(), "fixture must have cases");

    for c in &fixture.cases {
        let frame = build_parity_frame(c.width, c.height, c.background, &c.rects);
        let hash = compute_frame_hash(&frame, c.width, c.height);
        let color_sig = compute_color_signature(&frame, c.width, c.height);

        assert_eq!(
            hash, c.expected_hash,
            "aHash mismatch for \"{}\": native={hash} expected={}",
            c.name, c.expected_hash,
        );
        assert_eq!(
            color_sig, c.expected_color_sig,
            "color signature mismatch for \"{}\": native={color_sig} expected={}",
            c.name, c.expected_color_sig,
        );
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
    let dev_id = compositor
        .ensure_offscreen_device()
        .expect("offscreen device");

    for scene_def in &scenes {
        let mut fixture = load_scene(&scene_def.filename);
        resolve_scene_media_paths(&mut fixture.scene);

        let monitor_scene: MonitorScene = serde_json::from_value(fixture.scene.clone())
            .unwrap_or_else(|e| {
                panic!(
                    "failed to parse MonitorScene from {}: {e}",
                    scene_def.filename
                )
            });

        let width = monitor_scene.width.max(1);
        let height = monitor_scene.height.max(1);

        for &time_sec in &fixture.sample_times_sec {
            let mut cache = VideoDecoderCache::new();
            let compositor_scene =
                build_export_scene(&monitor_scene, time_sec, (width, height), &mut cache, None)
                    .unwrap_or_else(|e| {
                        panic!(
                            "build_export_scene failed for {} at t={time_sec}: {e}",
                            scene_def.filename
                        )
                    });

            let pixels = compositor
                .render_scene_to_pixels(dev_id, &compositor_scene, width, height)
                .unwrap_or_else(|e| {
                    panic!(
                        "render_scene_to_pixels failed for {} at t={time_sec}: {e}",
                        scene_def.filename
                    )
                });

            let hash = compute_frame_hash(&pixels, width as usize, height as usize);
            let color_sig = compute_color_signature(&pixels, width as usize, height as usize);

            // Look up golden entry for this scene + native engine.
            if let Some(entry) = find_golden(&registry, &scene_def.filename, "native") {
                if let Some(golden) = entry
                    .samples
                    .iter()
                    .find(|s| (s.time_sec - time_sec).abs() < 1e-6)
                {
                    // Treat pending hashes as "no golden yet" — print for import.
                    if golden.hash == PENDING_HASH {
                        eprintln!(
                            "GOLDEN[native] {} t={time_sec} hash={hash} colorSig={color_sig} tolerance={}",
                            scene_def.filename, scene_def.tolerance,
                        );
                    } else {
                        let distance = hamming_distance(&hash, &golden.hash);
                        assert!(
                            distance <= golden.tolerance,
                            "hash mismatch for \"{}\" native at t={time_sec}s: \
                             distance={distance} tolerance={} actual={hash} expected={}",
                            scene_def.filename,
                            golden.tolerance,
                            golden.hash,
                        );

                        // Colour signature catches hue errors the luma aHash misses.
                        if let Some(expected_sig) = &golden.color_sig {
                            let color_dist = color_signature_distance(&color_sig, expected_sig);
                            assert!(
                                color_dist <= DEFAULT_COLOR_TOLERANCE,
                                "color mismatch for \"{}\" native at t={time_sec}s: \
                                 distance={color_dist} tolerance={DEFAULT_COLOR_TOLERANCE} \
                                 actual={color_sig} expected={expected_sig}",
                                scene_def.filename,
                            );
                        }
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
                    "GOLDEN[native] {} t={time_sec} hash={hash} colorSig={color_sig} tolerance={}",
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
    let dev_id = compositor
        .ensure_offscreen_device()
        .expect("offscreen device");

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

        let monitor_scene: MonitorScene = serde_json::from_value(fixture.scene.clone())
            .unwrap_or_else(|e| {
                panic!(
                    "failed to parse MonitorScene from {}: {e}",
                    scene_def.filename
                )
            });

        let width = monitor_scene.width.max(1);
        let height = monitor_scene.height.max(1);

        for &time_sec in &fixture.sample_times_sec {
            let mut cache = VideoDecoderCache::new();
            let compositor_scene =
                build_export_scene(&monitor_scene, time_sec, (width, height), &mut cache, None)
                    .expect("build_export_scene");

            let pixels = compositor
                .render_scene_to_pixels(dev_id, &compositor_scene, width, height)
                .expect("render_scene_to_pixels");

            let native_hash = compute_frame_hash(&pixels, width as usize, height as usize);
            let native_sig = compute_color_signature(&pixels, width as usize, height as usize);

            // Compare native hash against web golden hash.
            if let Some(web_sample) = web_entry
                .samples
                .iter()
                .find(|s| (s.time_sec - time_sec).abs() < 1e-6)
            {
                // Skip pending hashes — they haven't been generated yet.
                if web_sample.hash == PENDING_HASH {
                    eprintln!(
                        "GOLDEN[native] {} t={time_sec} hash={native_hash} colorSig={native_sig} tolerance={}",
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
                    scene_def.filename,
                    web_sample.hash,
                );

                // Cross-engine colour parity (catches hue divergence between engines).
                if let Some(web_sig) = &web_sample.color_sig {
                    let color_tol = fixture.color_tolerance;
                    let color_dist = color_signature_distance(&native_sig, web_sig);
                    assert!(
                        color_dist <= color_tol,
                        "cross-engine color mismatch for \"{}\" at t={time_sec}s: \
                         distance={color_dist} tolerance={color_tol} \
                         native={native_sig} web={web_sig}",
                        scene_def.filename,
                    );
                }
            }

            // Also verify native hash matches its own golden.
            if let Some(native_sample) = native_entry
                .samples
                .iter()
                .find(|s| (s.time_sec - time_sec).abs() < 1e-6)
            {
                // Skip pending native hashes.
                if native_sample.hash == PENDING_HASH {
                    continue;
                }
                let distance = hamming_distance(&native_hash, &native_sample.hash);
                assert!(
                    distance <= native_sample.tolerance,
                    "native self-parity mismatch for \"{}\" at t={time_sec}s: \
                     distance={distance} tolerance={} actual={native_hash} expected={}",
                    scene_def.filename,
                    native_sample.tolerance,
                    native_sample.hash,
                );
            }
        }
    }
}
