# Rust Code Quality Review Report

> **Re-audited 2026-06-26.** The previous version of this report (2026-06-07) was
> written against an older module layout (`audio/decode.rs`, `media/decode.rs`,
> `monitor/runtime.rs`) that has since been split into directory modules. Most of
> its Critical/High findings are now resolved. This version reflects the current
> state of `src-tauri/src/` (~38K LOC, 84 files).

## Executive Summary

The Rust codebase is **mature and well-architected**, not a prototype. Strong
points: clean layering with documented module contracts, GPU/real-time resources
isolated to their owning thread, idiomatic error handling at boundaries, and a
**clippy-clean build (0 warnings)**. The remaining findings are minor and
stylistic — no critical issues outstanding.

---

## Resolved Since 2026-06-07

| Prev. finding | Status |
|---|---|
| `assert!` panic in the audio callback (`audio/output.rs`) | **Fixed** — asserts now exist only in tests; the callback path no longer panics. |
| Weak path-scope validation (`lib.rs`) | **Fixed** — `fs_scope_cmd.rs` now canonicalizes paths (`canonicalize_scope_path`) before `reject_dangerous_scope_path`. |
| Non-standard `#[cfg(dev)]` | **Fixed** — no longer present. |
| Missing `power_preference` / GPU adapter selection | **Fixed** — `WGPU_POWER_PREF=high` set before GPU init, with a SAFETY comment. |
| IPC boilerplate (`ensure_monitor().map_err().send().map_err()`) | **Fixed** — extracted `send_monitor_cmd` helper, now used by all monitor commands. |
| Manual LRU in `timeline_render` | Addressed — the `lru` crate is a dependency and used across the cache layer. |

---

## Strengths (current)

1. **Clippy-clean.** `cargo clippy` reports 0 warnings. `#[allow]` suppressions
   are minimal (~14, mostly `dead_code` and justified `too_many_arguments` /
   `needless_range_loop` in numeric code).
2. **Documented layering.** Every module carries a `//!` header describing its
   layout, contracts, and invariants (see `audio/mod.rs`, `compositor/mod.rs`,
   `monitor/mod.rs`). Dependency direction is one-way: `engine` → `monitor` →
   `compositor`/`audio`/`media`.
3. **GPU/RT isolation.** `VideoEngine` holds only a `Mutex<Option<Arc<MonitorHandle>>>`;
   the wgpu device and Vello renderer live inside the monitor thread, where the
   non-`Send` resources can be mutated safely.
4. **Idiomatic errors.** `anyhow::Result` internally, `Result<_, String>` at the
   Tauri command boundary. 51 files carry `#[cfg(test)]` modules.
5. **`unsafe` under control.** 16 occurrences total, each with a SAFETY rationale.

---

## Remaining Findings (minor)

### Low — Large files

Several files are long enough to strain readability (clippy does not flag them):

| File | Lines |
|---|---|
| `audio/decode/mod.rs` | 2693 |
| `compositor/scene.rs` | 1767 |
| `audio/mix.rs` | 1765 |
| `compositor/engine/mod.rs` | 1610 |
| `monitor/runtime/mod.rs` | 1595 |

**Recommendation**: split by sub-module on next touch, as already done for
`media/decode/`, `media/ffmpeg/`, and `monitor/scene/build/`.

### Low — `unwrap()` in non-test code

~116 occurrences outside tests. Audit hot paths and prefer `?` / `unwrap_or`
where the input is not statically guaranteed.

### Low — Heuristic FFmpeg output parsing

`parse_ffmpeg_components` (in `ipc/media_cmd.rs`) still parses human-readable
`ffmpeg -encoders/-decoders` output. FFmpeg's text format is not a stable API;
`-print_format json` would be more robust.

---

## Recommended Actions

1. **Done this pass**: translated the last Russian source comments to English
   (AGENTS.md convention); routed `monitor_set_viewport` through `send_monitor_cmd`.
2. **Opportunistic**: split `audio/decode/mod.rs` and `compositor/scene.rs` when
   next modifying them.
3. **Optional**: switch FFmpeg capability probing to JSON output.
