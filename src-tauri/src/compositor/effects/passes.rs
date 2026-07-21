//! Effect pass construction: turns the declarative `EffectSpec` list into the ordered
//! GPU pass schedule (`EffectPass`) and per-pass `EffectUniform` payloads. Split out of
//! `effects/mod.rs`, which keeps the GPU pipeline/dispatch (`EffectPipeline`).

use super::{
    EffectQuality, EffectSpec, MAX_BLOOM_RADIUS, MAX_BLOOM_STRENGTH, MAX_BLUR_FILL_SCALE,
    MAX_BLUR_RADIUS, MAX_CHROMATIC_ABERRATION, MAX_COLOR_MULTIPLIER, MAX_LEVELS_GAMMA,
    MAX_PIXELATE, MAX_SHARPEN,
};

#[repr(C)]
#[derive(Clone, Copy, Default, bytemuck::Pod, bytemuck::Zeroable)]
pub(super) struct EffectUniform {
    pub(super) mode: u32,
    pub(super) width: u32,
    pub(super) height: u32,
    pub(super) seed: u32,
    pub(super) p0: f32,
    pub(super) p1: f32,
    pub(super) p2: f32,
    pub(super) p3: f32,
    pub(super) p4: f32,
    pub(super) p5: f32,
    pub(super) p6: f32,
    pub(super) p7: f32,
}

/// Logical buffer slot a pass reads from / writes to. The pass scheduler routes
/// these to concrete texture views in `apply_effects`. Explicit routing (instead
/// of an implicit ping-pong) lets multi-pass effects like bloom keep the running
/// image intact in a dedicated buffer while their internal passes ping-pong, so
/// the compose step blends glow over the *current* image (post earlier effects),
/// not the pristine source frame.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub(super) enum Buf {
    /// Original source frame for this layer (read-only).
    Input,
    Ping,
    Pong,
    /// Third scratch buffer; needed when an effect must pin one image while
    /// ping-ponging two others (bloom).
    Aux,
    /// Final owned output handed back to the caller.
    Owned,
}

#[derive(Clone)]
pub(super) struct EffectPass {
    pub(super) uniform: EffectUniform,
    pub(super) custom_source: Option<String>,
    pub(super) src: Buf,
    pub(super) secondary: Buf,
    pub(super) dst: Buf,
}

#[derive(Clone, Copy)]
pub(super) struct BlurContentRect {
    pub(super) offset_x: u32,
    pub(super) offset_y: u32,
    pub(super) width: u32,
    pub(super) height: u32,
}

#[derive(Clone, Copy, Default)]
pub(super) struct BuildPassOptions {
    pub(super) spatial_scale_height: Option<u32>,
    pub(super) content_rect: Option<BlurContentRect>,
}

/// Padding (in target px) the frame must be grown by so blur can bleed past the
/// original rectangle. Only `GaussianBlur` effects that opted into `bleed`
/// contribute — everything else (opaque-video blur, bloom, internal pixel blur)
/// stays unpadded and clamps to the frame edges, so it never darkens borders.
pub(super) fn calculate_padding(effects: &[EffectSpec], scale: f32) -> u32 {
    let mut max_r = 0.0f32;
    for effect in effects {
        if let EffectSpec::GaussianBlur {
            radius,
            bleed: true,
            ..
        } = effect
        {
            let r = radius * scale;
            if r > max_r {
                max_r = r;
            }
        }
    }
    (max_r * 2.0).ceil() as u32
}

/// Scale factor for spatial effect parameters (blur radius, pixelate size,
/// chromatic aberration, …) that the user specifies in "pixels @1080p". The effect
/// texture is the frame at its real resolution (preview-scaled or export full-res),
/// so without normalization the same radius produced a DIFFERENT visual scale in
/// preview and in export. We normalize to a height of 1080 → the effect becomes a
/// fixed fraction of the frame and matches between preview/export and across
/// different source resolutions.
pub(super) fn spatial_scale(height: u32) -> f32 {
    (height as f32 / 1080.0).clamp(0.1, 8.0)
}

/// Pick a scratch buffer (`Ping`/`Pong`/`Aux`) not in `avoid`. Linear chains
/// only ever exclude one buffer, so they alternate ping/pong and never touch
/// `Aux`; bloom excludes two and so reaches for the third.
fn pick_scratch(avoid: &[Buf]) -> Buf {
    for candidate in [Buf::Ping, Buf::Pong, Buf::Aux] {
        if !avoid.contains(&candidate) {
            return candidate;
        }
    }
    Buf::Ping
}

/// Op code + clamped param of the fused point-wise chain (mode 24) — mirror of
/// the web `fusablePointwiseOp`. Params carry the same clamps as the standalone
/// modes so a fused run is math-identical to the individual passes.
fn fusable_pointwise_op(effect: &EffectSpec) -> Option<(f32, f32)> {
    match effect {
        EffectSpec::Brightness { value } => Some((1.0, value.clamp(0.0, MAX_COLOR_MULTIPLIER))),
        EffectSpec::Contrast { value } => Some((2.0, value.clamp(0.0, MAX_COLOR_MULTIPLIER))),
        EffectSpec::Saturation { value } => Some((3.0, value.clamp(0.0, MAX_COLOR_MULTIPLIER))),
        EffectSpec::Hue { degrees } => Some((4.0, *degrees)),
        EffectSpec::Invert { mix } => Some((5.0, mix.clamp(0.0, 1.0))),
        _ => None,
    }
}

/// Ops a single mode-24 pass can hold: 4 (op, param) pairs in p0..p7.
const FUSED_CHAIN_CAPACITY: usize = 4;

/// Emits a single-effect pass (the pre-fusion behaviour of the generic arm).
fn push_single(
    passes: &mut Vec<EffectPass>,
    cur: &mut Buf,
    effect: &EffectSpec,
    width: u32,
    height: u32,
) {
    if let Some((uniform, custom_source)) = effect_uniform(effect, width, height) {
        let dst = pick_scratch(&[*cur]);
        passes.push(EffectPass {
            uniform,
            custom_source,
            src: *cur,
            secondary: *cur,
            dst,
        });
        *cur = dst;
    }
}

/// Flushes accumulated consecutive fusable effects: runs of >=2 become mode-24
/// passes (chunks of up to FUSED_CHAIN_CAPACITY, a trailing single keeps its
/// standalone mode). Chunking must mirror the web builder exactly.
fn flush_fused(
    passes: &mut Vec<EffectPass>,
    cur: &mut Buf,
    pending: &mut Vec<(&EffectSpec, f32, f32)>,
    width: u32,
    height: u32,
) {
    while !pending.is_empty() {
        if pending.len() == 1 {
            let (spec, _, _) = pending.remove(0);
            push_single(passes, cur, spec, width, height);
            continue;
        }
        let take = pending.len().min(FUSED_CHAIN_CAPACITY);
        let mut uniform = EffectUniform {
            mode: 24,
            width,
            height,
            ..Default::default()
        };
        for (i, (_, op, param)) in pending.drain(0..take).enumerate() {
            match i {
                0 => {
                    uniform.p0 = op;
                    uniform.p1 = param;
                }
                1 => {
                    uniform.p2 = op;
                    uniform.p3 = param;
                }
                2 => {
                    uniform.p4 = op;
                    uniform.p5 = param;
                }
                _ => {
                    uniform.p6 = op;
                    uniform.p7 = param;
                }
            }
        }
        let dst = pick_scratch(&[*cur]);
        passes.push(EffectPass {
            uniform,
            custom_source: None,
            src: *cur,
            secondary: *cur,
            dst,
        });
        *cur = dst;
    }
}

/// Separable gaussian blur (horizontal then vertical) reading from `cur` and
/// returning the buffer holding the result.
#[allow(clippy::too_many_arguments)]
fn push_blur(
    passes: &mut Vec<EffectPass>,
    cur: Buf,
    radius: f32,
    blur_type: &str,
    width: u32,
    height: u32,
    tap_budget: f32,
    content_rect: Option<BlurContentRect>,
    bleed: bool,
) -> Buf {
    if radius <= 0.0 {
        return cur;
    }
    // "Blur past edges" (bleed): run the blur in premultiplied-alpha space so the
    // content edge feathers softly OUTWARD with its real colour (transparent
    // padding contributes (0,0,0,0) → only the alpha composite darkens over black,
    // never the colour). Flagged per pass — mode 4 (H / radial) via p6, final V
    // (mode 14) via p2 (which also un-premultiplies). Routing is the plain
    // ping-pong (premult blur only reads its own input). Mirror of the web builder.
    let bleed_flag = if bleed { 1.0 } else { 0.0 };
    if blur_type == "radial" {
        let t1 = pick_scratch(&[cur]);
        let rect = content_rect.unwrap_or(BlurContentRect {
            offset_x: 0,
            offset_y: 0,
            width,
            height,
        });
        passes.push(EffectPass {
            uniform: EffectUniform {
                mode: 4,
                width,
                height,
                seed: 0,
                p0: radius,
                p1: 2.0, // 2.0 = Radial
                p2: rect.offset_x as f32 / width as f32,
                p3: rect.offset_y as f32 / height as f32,
                p4: rect.width as f32 / width as f32,
                p5: rect.height as f32 / height as f32,
                p6: bleed_flag,
                p7: tap_budget,
            },
            custom_source: None,
            src: cur,
            secondary: cur,
            dst: t1,
        });
        t1
    } else {
        let type_val = if blur_type == "box" { 1.0 } else { 0.0 };
        let t1 = pick_scratch(&[cur]);
        passes.push(EffectPass {
            uniform: EffectUniform {
                mode: 4,
                width,
                height,
                seed: 0,
                p0: radius,
                p1: type_val,
                p6: bleed_flag,
                p7: tap_budget,
                ..Default::default()
            },
            custom_source: None,
            src: cur,
            secondary: cur,
            dst: t1,
        });
        let t2 = pick_scratch(&[t1]);
        passes.push(EffectPass {
            uniform: EffectUniform {
                mode: 14,
                width,
                height,
                seed: 0,
                p0: radius,
                p1: type_val,
                p2: bleed_flag,
                p7: tap_budget,
                ..Default::default()
            },
            custom_source: None,
            src: t1,
            secondary: t1,
            dst: t2,
        });
        t2
    }
}

/// Already-clamped bloom shaping parameters (see the caller, which mirrors the
/// web pass builder's clamps byte-for-byte).
struct BloomParams {
    threshold: f32,
    strength: f32,
    radius: f32,
    knee: f32,
}

/// Bloom: extract bright pass → blur → compose over the *running* image. The
/// running image (`cur`) is pinned in `base` for the whole effect so compose
/// blends glow on top of earlier effects' output, not the pristine source.
fn push_bloom(
    passes: &mut Vec<EffectPass>,
    cur: Buf,
    params: BloomParams,
    width: u32,
    height: u32,
    tap_budget: f32,
) -> Buf {
    let BloomParams {
        threshold,
        strength,
        radius,
        knee,
    } = params;
    if radius <= 0.0 {
        return cur;
    }
    let base = cur;
    // Bright-pass extract (mode 15): base -> a. p0=threshold, p1=knee.
    let a = pick_scratch(&[base]);
    passes.push(EffectPass {
        uniform: EffectUniform {
            mode: 15,
            width,
            height,
            seed: 0,
            p0: threshold,
            p1: knee,
            ..Default::default()
        },
        custom_source: None,
        src: base,
        secondary: base,
        dst: a,
    });
    // Blur the mask: a -> b (h) -> a (v). `b` is the third buffer (Aux), so
    // `base` stays intact for compose.
    let b = pick_scratch(&[base, a]);
    passes.push(EffectPass {
        uniform: EffectUniform {
            mode: 4,
            width,
            height,
            seed: 0,
            p0: radius,
            p7: tap_budget,
            ..Default::default()
        },
        custom_source: None,
        src: a,
        secondary: a,
        dst: b,
    });
    passes.push(EffectPass {
        uniform: EffectUniform {
            mode: 14,
            width,
            height,
            seed: 0,
            p0: radius,
            p7: tap_budget,
            ..Default::default()
        },
        custom_source: None,
        src: b,
        secondary: b,
        dst: a,
    });
    // Compose (mode 18): running image (base) + blurred glow (a) -> b.
    passes.push(EffectPass {
        uniform: EffectUniform {
            mode: 18,
            width,
            height,
            seed: 0,
            p0: 0.0,
            p1: strength,
            ..Default::default()
        },
        custom_source: None,
        src: base,
        secondary: a,
        dst: b,
    });
    b
}

/// Post-effect mix pass: blends the effect result (bound to input_tex/src)
/// with the original image (bound to secondary_tex) by `mix` factor.
fn push_mix(
    passes: &mut Vec<EffectPass>,
    effect_result: Buf,
    original: Buf,
    mix: f32,
    width: u32,
    height: u32,
) -> Buf {
    let dst = pick_scratch(&[effect_result, original]);
    passes.push(EffectPass {
        uniform: EffectUniform {
            mode: 19,
            width,
            height,
            seed: 0,
            p0: mix.clamp(0.0, 1.0),
            ..Default::default()
        },
        custom_source: None,
        src: effect_result,
        secondary: original,
        dst,
    });
    dst
}

/// Builds the blur-fill pass chain (all at frame dims): cover-place the source
/// into a full-frame background plate (mode 20), separably blur it (modes 4/14,
/// skipped when the radius is zero), desaturate/dim/tint the plate (mode 22),
/// then composite the contain-fit sharp foreground over it (mode 21). `blur` is
/// the raw radius in px @1080p; it is height-normalized and clamped here.
#[allow(clippy::too_many_arguments)]
pub(super) fn build_blur_fill_passes(
    frame_w: u32,
    frame_h: u32,
    iw: u32,
    ih: u32,
    fg_scale: f32,
    bg_scale: f32,
    blur: f32,
    bg_dim: f32,
    bg_saturation: f32,
    tint_color: [u8; 4],
    tint_strength: f32,
    fg_offset_y: f32,
    quality: EffectQuality,
) -> Vec<EffectPass> {
    let radius = (blur * spatial_scale(frame_h)).clamp(0.0, MAX_BLUR_RADIUS);
    let iwf = iw as f32;
    let ihf = ih as f32;
    let mut passes: Vec<EffectPass> = Vec::new();
    // Cover-place the source into the background plate (Ping).
    passes.push(EffectPass {
        uniform: EffectUniform {
            mode: 20,
            width: frame_w,
            height: frame_h,
            seed: 0,
            p0: iwf,
            p1: ihf,
            p2: bg_scale.clamp(0.01, MAX_BLUR_FILL_SCALE),
            ..Default::default()
        },
        custom_source: None,
        src: Buf::Input,
        secondary: Buf::Input,
        dst: Buf::Ping,
    });
    if radius > 0.0 {
        passes.push(EffectPass {
            uniform: EffectUniform {
                mode: 4,
                width: frame_w,
                height: frame_h,
                seed: 0,
                p0: radius,
                p7: quality.tap_budget(),
                ..Default::default()
            },
            custom_source: None,
            src: Buf::Ping,
            secondary: Buf::Ping,
            dst: Buf::Pong,
        });
        passes.push(EffectPass {
            uniform: EffectUniform {
                mode: 14,
                width: frame_w,
                height: frame_h,
                seed: 0,
                p0: radius,
                p7: quality.tap_budget(),
                ..Default::default()
            },
            custom_source: None,
            src: Buf::Pong,
            secondary: Buf::Pong,
            dst: Buf::Ping,
        });
    }
    // Adjust the (blurred) plate in Ping → Pong: desaturate, dim, tint.
    passes.push(EffectPass {
        uniform: EffectUniform {
            mode: 22,
            width: frame_w,
            height: frame_h,
            seed: 0,
            p0: bg_dim.clamp(0.0, 1.0),
            p1: bg_saturation.clamp(0.0, 2.0),
            p2: tint_color[0] as f32 / 255.0,
            p3: tint_color[1] as f32 / 255.0,
            p4: tint_color[2] as f32 / 255.0,
            p5: tint_strength.clamp(0.0, 1.0),
            ..Default::default()
        },
        custom_source: None,
        src: Buf::Ping,
        secondary: Buf::Ping,
        dst: Buf::Pong,
    });
    // Composite the sharp foreground over the prepared background (Pong).
    passes.push(EffectPass {
        uniform: EffectUniform {
            mode: 21,
            width: frame_w,
            height: frame_h,
            seed: 0,
            p0: iwf,
            p1: ihf,
            p2: fg_scale.clamp(0.01, MAX_BLUR_FILL_SCALE),
            p3: fg_offset_y.clamp(-0.5, 0.5),
            ..Default::default()
        },
        custom_source: None,
        src: Buf::Input,
        secondary: Buf::Pong,
        dst: Buf::Owned,
    });
    passes
}

#[cfg(test)]
pub(super) fn build_passes(
    effects: &[EffectSpec],
    width: u32,
    height: u32,
    quality: EffectQuality,
) -> Vec<EffectPass> {
    build_passes_with_options(effects, width, height, quality, BuildPassOptions::default())
}

pub(super) fn build_passes_with_options(
    effects: &[EffectSpec],
    width: u32,
    height: u32,
    quality: EffectQuality,
    options: BuildPassOptions,
) -> Vec<EffectPass> {
    let scale = spatial_scale(options.spatial_scale_height.unwrap_or(height));
    let mut passes: Vec<EffectPass> = Vec::new();
    // The buffer currently holding the running image; effects chain off it.
    let mut cur = Buf::Input;
    // Consecutive fusable point-wise effects accumulate here and flush as
    // mode-24 passes; see `flush_fused`.
    let mut pending: Vec<(&EffectSpec, f32, f32)> = Vec::new();

    for effect in effects {
        if let Some((op, param)) = fusable_pointwise_op(effect) {
            pending.push((effect, op, param));
            continue;
        }
        flush_fused(&mut passes, &mut cur, &mut pending, width, height);
        match effect {
            EffectSpec::GaussianBlur {
                radius,
                blur_type,
                mix,
                bleed,
                ..
            } => {
                let base = cur;
                cur = push_blur(
                    &mut passes,
                    cur,
                    (*radius * scale).clamp(0.0, MAX_BLUR_RADIUS),
                    blur_type,
                    width,
                    height,
                    quality.tap_budget(),
                    options.content_rect,
                    *bleed,
                );
                if *mix < 1.0 {
                    cur = push_mix(&mut passes, cur, base, *mix, width, height);
                }
            }
            EffectSpec::GaussianBlurPixels { radius, mix } => {
                let base = cur;
                cur = push_blur(
                    &mut passes,
                    cur,
                    // Raw-pixel radius (no height scale), but still bounded by the
                    // shared render ceiling — mirror of the web pass builder
                    // (`WebGpuComputeRunner.ts` gaussian-blur-pixels case).
                    radius.clamp(0.0, MAX_BLUR_RADIUS),
                    "gaussian",
                    width,
                    height,
                    quality.tap_budget(),
                    options.content_rect,
                    false,
                );
                if *mix < 1.0 {
                    cur = push_mix(&mut passes, cur, base, *mix, width, height);
                }
            }
            EffectSpec::Bloom {
                threshold,
                strength,
                radius,
                knee,
                mix,
            } => {
                let base = cur;
                cur = push_bloom(
                    &mut passes,
                    cur,
                    // Clamp must mirror the web pass builder
                    // (`WebGpuComputeRunner.ts` bloom case) byte-for-byte.
                    BloomParams {
                        threshold: threshold.clamp(0.0, 1.0),
                        strength: strength.clamp(0.0, MAX_BLOOM_STRENGTH),
                        radius: (*radius * scale).clamp(0.0, MAX_BLOOM_RADIUS),
                        knee: knee.clamp(0.0, 1.0),
                    },
                    width,
                    height,
                    quality.tap_budget(),
                );
                if *mix < 1.0 {
                    cur = push_mix(&mut passes, cur, base, *mix, width, height);
                }
            }
            _ => {
                push_single(&mut passes, &mut cur, effect, width, height);
            }
        }
    }
    flush_fused(&mut passes, &mut cur, &mut pending, width, height);

    // The final result must land in the owned output texture handed back to the
    // caller; everything before it ping-pongs through the scratch buffers.
    if let Some(last) = passes.last_mut() {
        last.dst = Buf::Owned;
    }
    passes
}

/// Builds the `EffectUniform` (and optional custom WGSL source) for a
/// single-pass effect. Multi-pass effects (blur, bloom) are routed in
/// `build_passes`; this returns `None` for them.
pub(super) fn effect_uniform(
    effect: &EffectSpec,
    width: u32,
    height: u32,
) -> Option<(EffectUniform, Option<String>)> {
    let scale = spatial_scale(height);
    let base = |mode, p0, p1, p2, p3, p4, p5, seed| EffectUniform {
        mode,
        width,
        height,
        seed,
        p0,
        p1,
        p2,
        p3,
        p4,
        p5,
        p6: 0.0,
        p7: 0.0,
    };
    let uniform = match effect {
        EffectSpec::Brightness { value } => base(
            1,
            value.clamp(0.0, MAX_COLOR_MULTIPLIER),
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0,
        ),
        EffectSpec::Contrast { value } => base(
            2,
            value.clamp(0.0, MAX_COLOR_MULTIPLIER),
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0,
        ),
        EffectSpec::Saturation { value } => base(
            3,
            value.clamp(0.0, MAX_COLOR_MULTIPLIER),
            0.0,
            0.0,
            0.0,
            0.0,
            0.0,
            0,
        ),
        // Multi-pass; routed in build_passes. BlurFill is reframed by the engine
        // via `apply_blur_fill` (it changes the output size) and never reaches
        // the generic chain.
        EffectSpec::GaussianBlur { .. }
        | EffectSpec::GaussianBlurPixels { .. }
        | EffectSpec::Bloom { .. }
        | EffectSpec::BlurFill { .. } => return None,
        // Bidirectional: positive sharpens (unsharp mask), negative softens.
        // p1 = sample step in px (resolution-normalized so sharpening looks the
        // same fraction-of-frame at any resolution).
        EffectSpec::Sharpen { amount, mix } => base(
            5,
            amount.clamp(-MAX_SHARPEN, MAX_SHARPEN),
            scale.max(1.0),
            mix.clamp(0.0, 1.0),
            0.0,
            0.0,
            0.0,
            0,
        ),
        EffectSpec::Pixelate { size, mix } => base(
            6,
            (size * scale).clamp(1.0, MAX_PIXELATE),
            mix.clamp(0.0, 1.0),
            0.0,
            0.0,
            0.0,
            0.0,
            0,
        ),
        EffectSpec::Vignette {
            strength,
            radius,
            softness,
            mix,
        } => base(
            8,
            strength.clamp(0.0, 1.0),
            radius.clamp(0.0, 1.0),
            softness.clamp(0.001, 1.0),
            mix.clamp(0.0, 1.0),
            0.0,
            0.0,
            0,
        ),
        EffectSpec::Noise {
            amount,
            seed,
            noise_type,
            scale,
            mix,
        } => {
            let type_val = match noise_type.as_str() {
                "perlin" => 1.0,
                "simplex" => 2.0,
                _ => 0.0,
            };
            base(
                9,
                amount.clamp(0.0, 1.0),
                type_val,
                *scale,
                mix.clamp(0.0, 1.0),
                0.0,
                0.0,
                *seed,
            )
        }
        EffectSpec::ChromaticAberration {
            amount,
            angle_deg,
            mix,
        } => base(
            10,
            (amount * scale).clamp(0.0, MAX_CHROMATIC_ABERRATION),
            *angle_deg,
            mix.clamp(0.0, 1.0),
            0.0,
            0.0,
            0.0,
            0,
        ),
        EffectSpec::ColorTone {
            color_rgba,
            amount,
            blend_mode,
            preserve_luminance,
            range,
        } => {
            let blend_val = match blend_mode.as_str() {
                "multiply" => 1.0,
                "screen" => 2.0,
                "overlay" => 3.0,
                "soft-light" => 4.0,
                _ => 0.0,
            };
            let range_val = match range.as_str() {
                "shadows" => 1.0,
                "midtones" => 2.0,
                "highlights" => 3.0,
                _ => 0.0,
            };
            let mut uniform = base(
                23,
                color_rgba[0] as f32 / 255.0,
                color_rgba[1] as f32 / 255.0,
                color_rgba[2] as f32 / 255.0,
                amount.clamp(0.0, 1.0),
                blend_val,
                if *preserve_luminance { 1.0 } else { 0.0 },
                0,
            );
            uniform.p6 = range_val;
            uniform
        }
        EffectSpec::Hue { degrees } => base(11, *degrees, 0.0, 0.0, 0.0, 0.0, 0.0, 0),
        EffectSpec::Levels {
            in_black,
            in_white,
            gamma,
            out_black,
            out_white,
            mix,
        } => base(
            12,
            in_black.clamp(0.0, 1.0),
            in_white.clamp(0.001, 1.0),
            gamma.clamp(0.01, MAX_LEVELS_GAMMA),
            out_black.clamp(0.0, 1.0),
            out_white.clamp(0.0, 1.0),
            mix.clamp(0.0, 1.0),
            0,
        ),
        EffectSpec::ChromaKey {
            key_rgba,
            threshold,
            smoothness,
        } => base(
            13,
            key_rgba[0] as f32 / 255.0,
            key_rgba[1] as f32 / 255.0,
            key_rgba[2] as f32 / 255.0,
            threshold.clamp(0.0, 1.0),
            smoothness.clamp(0.0001, 1.0),
            0.0,
            0,
        ),
        EffectSpec::Invert { mix } => base(25, mix.clamp(0.0, 1.0), 0.0, 0.0, 0.0, 0.0, 0.0, 0),
        EffectSpec::CustomWgsl { source, params } => {
            let mut p = [0.0f32; 8];
            if let serde_json::Value::Object(map) = params {
                for (i, pi) in p.iter_mut().enumerate() {
                    let key = format!("p{}", i);
                    if let Some(v) = map.get(&key).and_then(|v| v.as_f64()) {
                        *pi = v as f32;
                    }
                }
            }
            return Some((
                EffectUniform {
                    mode: 0,
                    width,
                    height,
                    seed: 0,
                    p0: p[0],
                    p1: p[1],
                    p2: p[2],
                    p3: p[3],
                    p4: p[4],
                    p5: p[5],
                    p6: p[6],
                    p7: p[7],
                },
                Some(source.clone()),
            ));
        }
    };
    Some((uniform, None))
}
