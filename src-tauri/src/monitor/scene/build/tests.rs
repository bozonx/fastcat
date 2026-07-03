#[cfg(test)]
#[allow(clippy::module_inception)]
mod tests {
    use crate::compositor::scene::{BlendMode, ShapeGeometry, ShapeLayer, Transform};
    use crate::monitor::scene::build::*;
    use crate::monitor::scene::{LayerKind, SceneLayer, SceneLayerTransform};
    use serde_json::json;
    use vello::peniko::Color;

    fn test_shape_kind() -> crate::compositor::scene::LayerKind {
        crate::compositor::scene::LayerKind::Shape(ShapeLayer {
            geometry: ShapeGeometry::Rectangle {
                width: 1.0,
                height: 1.0,
                corner_radius: 0.0,
            },
            fill: Color::WHITE,
            stroke: Color::TRANSPARENT,
            stroke_width: 0.0,
            natural_size: (1920, 1080),
        })
    }

    fn layer_with_crop(kind: &str, source_orientation: &str) -> SceneLayer {
        serde_json::from_value(json!({
            "id": "crop-test",
            "kind": kind,
            "timeline_start_sec": 0.0,
            "timeline_end_sec": 1.0,
            "source_start_sec": 0.0,
            "source_orientation": source_orientation,
            "z": 1,
            "opacity": 1.0,
            "transform": {
                "x": 960.0,
                "y": 540.0,
                "crop_top": 10.0,
                "crop_bottom": 20.0,
                "crop_left": 30.0,
                "crop_right": 40.0
            }
        }))
        .unwrap()
    }

    #[test]
    fn maps_full_blend_mode_set() {
        assert_eq!(parse_blend_mode("multiply"), BlendMode::Multiply);
        assert_eq!(parse_blend_mode("overlay"), BlendMode::Overlay);
        assert_eq!(parse_blend_mode("color-dodge"), BlendMode::ColorDodge);
        assert_eq!(parse_blend_mode("hard-light"), BlendMode::HardLight);
        assert_eq!(parse_blend_mode("difference"), BlendMode::Difference);
        assert_eq!(parse_blend_mode("luminosity"), BlendMode::Luminosity);
        assert_eq!(parse_blend_mode("add"), BlendMode::Add);
        assert_eq!(parse_blend_mode("unknown"), BlendMode::Normal);
    }

    #[test]
    fn parses_short_and_long_hex() {
        let c = parse_color("#f00", 1.0);
        assert_eq!(
            (c.to_rgba8().r, c.to_rgba8().g, c.to_rgba8().b),
            (255, 0, 0)
        );
        let c2 = parse_color("00ff00", 0.5);
        assert_eq!(c2.to_rgba8().g, 255);
        assert_eq!(c2.to_rgba8().a, 128);
    }

    #[test]
    fn parses_four_digit_rgba_hex() {
        let c = parse_color("#f008", 1.0);
        let rgba = c.to_rgba8();
        assert_eq!((rgba.r, rgba.g, rgba.b), (255, 0, 0));
        assert_eq!(rgba.a, 0x88);
    }

    #[test]
    fn background_virtual_kind_fills_wide_scene() {
        let layer: SceneLayer = serde_json::from_value(json!({
            "id": "bg",
            "kind": "background",
            "timeline_start_sec": 0.0,
            "timeline_end_sec": 1.0,
            "source_start_sec": 0.0,
            "z": 0,
            "opacity": 1.0,
            "background_color": "#112233"
        }))
        .unwrap();

        let kind = build_virtual_kind(&layer, (1920, 1080)).expect("background shape");
        match kind {
            crate::compositor::scene::LayerKind::Shape(shape) => {
                assert_eq!(shape.natural_size, (1920, 1080));
                match shape.geometry {
                    ShapeGeometry::Rectangle { width, height, .. } => {
                        assert!((width - (1920.0 / 1080.0)).abs() < 1e-9);
                        assert!((height - 1.0).abs() < 1e-9);
                    }
                    _ => panic!("background must be a rectangle"),
                }
            }
            _ => panic!("background must render as shape"),
        }
    }

    #[test]
    fn finalize_layer_remaps_raster_crop_for_90_degree_source_orientation() {
        let layer = layer_with_crop("video", "90");
        let output = finalize_layer(&layer, test_shape_kind(), (1920, 1080), 0.0);

        assert_eq!(output.transform.crop_top, 40.0);
        assert_eq!(output.transform.crop_right, 20.0);
        assert_eq!(output.transform.crop_bottom, 30.0);
        assert_eq!(output.transform.crop_left, 10.0);
    }

    #[test]
    fn finalize_layer_remaps_raster_crop_for_270_degree_source_orientation() {
        let layer = layer_with_crop("video", "270");
        let output = finalize_layer(&layer, test_shape_kind(), (1920, 1080), 0.0);

        assert_eq!(output.transform.crop_top, 30.0);
        assert_eq!(output.transform.crop_right, 10.0);
        assert_eq!(output.transform.crop_bottom, 40.0);
        assert_eq!(output.transform.crop_left, 20.0);
    }

    #[test]
    fn finalize_layer_builds_shader_transition_info_from_transition_in() {
        let layer: SceneLayer = serde_json::from_value(json!({
            "id": "to",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 1.0,
            "transition_in": {
                "type": "wipe",
                "duration_sec": 2.0,
                "curve": "linear",
                "from_layer_id": "from",
                "spec": {
                    "type": "wipe",
                    "angle_deg": 45.0,
                    "softness": 0.25
                }
            }
        }))
        .unwrap();

        let output = finalize_layer(&layer, test_shape_kind(), (1920, 1080), 11.0);
        let transition = output.transition.expect("transition info");
        assert_eq!(
            transition.source,
            crate::compositor::scene::TransitionSource::Layer("from".into())
        );
        assert_eq!(
            transition.edge,
            crate::compositor::scene::TransitionEdge::In
        );
        assert!((transition.progress - 0.5).abs() < 1e-6);
        match transition.spec {
            crate::compositor::transitions::TransitionSpec::Wipe {
                angle_deg,
                softness,
            } => {
                assert_eq!(angle_deg, 45.0);
                assert_eq!(softness, 0.25);
            }
            _ => panic!("expected wipe transition"),
        }
    }

    #[test]
    fn finalize_layer_builds_shader_transition_for_dissolve_with_from_layer() {
        let layer: SceneLayer = serde_json::from_value(json!({
            "id": "to",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 1.0,
            "transition_in": {
                "type": "dissolve",
                "duration_sec": 2.0,
                "curve": "linear",
                "from_layer_id": "from",
                "spec": { "type": "crossfade" }
            }
        }))
        .unwrap();

        let output = finalize_layer(&layer, test_shape_kind(), (1920, 1080), 11.0);
        let transition = output
            .transition
            .expect("dissolve must produce shader transition");
        assert_eq!(
            transition.source,
            crate::compositor::scene::TransitionSource::Layer("from".into())
        );
        assert!((transition.progress - 0.5).abs() < 1e-6);
        assert!(matches!(
            transition.spec,
            crate::compositor::transitions::TransitionSpec::Crossfade
        ));
        // And alpha must NOT be faded (the shader already blends) — otherwise double fade.
        assert!((output.opacity - 1.0).abs() < 1e-6);
    }

    #[test]
    fn finalize_layer_dissolve_without_from_layer_fades_via_opacity() {
        let layer: SceneLayer = serde_json::from_value(json!({
            "id": "first",
            "kind": "video",
            "timeline_start_sec": 0.0,
            "timeline_end_sec": 10.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 1.0,
            "transition_in": {
                "type": "dissolve",
                "duration_sec": 2.0,
                "curve": "linear",
                "spec": { "type": "crossfade" }
            }
        }))
        .unwrap();

        let output = finalize_layer(&layer, test_shape_kind(), (1920, 1080), 1.0);
        assert!(output.transition.is_none());
        assert!((output.opacity - 0.5).abs() < 1e-5);
    }

    #[test]
    fn finalize_layer_builds_background_shader_transition_without_adjacent_layer() {
        let layer: SceneLayer = serde_json::from_value(json!({
            "id": "to",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 1.0,
            "transition_in": {
                "type": "wipe",
                "duration_sec": 2.0,
                "curve": "linear",
                "mode": "background",
                "spec": {
                    "type": "wipe",
                    "angle_deg": 0.0,
                    "softness": 0.1
                }
            }
        }))
        .unwrap();

        let output = finalize_layer(&layer, test_shape_kind(), (1920, 1080), 11.0);
        let transition = output.transition.expect("background transition info");
        assert_eq!(
            transition.source,
            crate::compositor::scene::TransitionSource::Background
        );
        assert_eq!(
            transition.edge,
            crate::compositor::scene::TransitionEdge::In
        );
        assert!((transition.progress - 0.5).abs() < 1e-6);
    }

    #[test]
    fn finalize_layer_builds_transparent_out_shader_transition() {
        let layer: SceneLayer = serde_json::from_value(json!({
            "id": "out",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 1.0,
            "transition_out": {
                "type": "wipe",
                "duration_sec": 2.0,
                "curve": "linear",
                "mode": "transparent",
                "spec": {
                    "type": "wipe",
                    "angle_deg": 0.0,
                    "softness": 0.1
                }
            }
        }))
        .unwrap();

        let output = finalize_layer(&layer, test_shape_kind(), (1920, 1080), 19.0);
        let transition = output.transition.expect("transparent transition info");
        assert_eq!(
            transition.source,
            crate::compositor::scene::TransitionSource::Transparent
        );
        assert_eq!(
            transition.edge,
            crate::compositor::scene::TransitionEdge::Out
        );
        assert!((transition.progress - 0.5).abs() < 1e-6);
    }

    #[test]
    fn finalize_layer_ignores_non_dissolve_transition_out() {
        let layer: SceneLayer = serde_json::from_value(json!({
            "id": "out",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 1.0,
            "transition_out": {
                "type": "wipe",
                "duration_sec": 2.0,
                "curve": "linear",
                "spec": {
                    "type": "wipe",
                    "angle_deg": 45.0,
                    "softness": 0.25
                }
            }
        }))
        .unwrap();

        let output = finalize_layer(&layer, test_shape_kind(), (1920, 1080), 19.0);
        assert!(output.transition.is_none());
    }

    #[test]
    fn finalize_layer_remaps_raster_crop_for_180_degree_source_orientation() {
        let layer = layer_with_crop("video", "180");
        let output = finalize_layer(&layer, test_shape_kind(), (1920, 1080), 0.0);

        assert_eq!(output.transform.crop_top, 20.0);
        assert_eq!(output.transform.crop_right, 30.0);
        assert_eq!(output.transform.crop_bottom, 10.0);
        assert_eq!(output.transform.crop_left, 40.0);
    }

    #[test]
    fn finalize_layer_keeps_non_raster_crop_in_local_space() {
        let layer = layer_with_crop("shape", "90");
        let output = finalize_layer(&layer, test_shape_kind(), (1920, 1080), 0.0);

        assert_eq!(output.transform.crop_top, 10.0);
        assert_eq!(output.transform.crop_right, 40.0);
        assert_eq!(output.transform.crop_bottom, 20.0);
        assert_eq!(output.transform.crop_left, 30.0);
    }

    #[test]
    fn test_compute_transition_opacity() {
        let build_layer = |json_val: serde_json::Value| -> SceneLayer {
            serde_json::from_value(json_val).unwrap()
        };

        // 1. No transitions
        let layer_no_trans = build_layer(json!({
            "id": "1",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 0.8
        }));

        assert_eq!(compute_transition_opacity(&layer_no_trans, 0.0, 0.8), 0.8);
        assert_eq!(compute_transition_opacity(&layer_no_trans, 5.0, 0.8), 0.8);
        assert_eq!(compute_transition_opacity(&layer_no_trans, 10.0, 0.8), 0.8);

        // 2. Transition In (duration = 2.0 sec, linear, dissolve)
        let layer_trans_in = build_layer(json!({
            "id": "2",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 0.8,
            "transition_in": {
                "type": "dissolve",
                "duration_sec": 2.0,
                "curve": "linear"
            }
        }));

        assert_eq!(compute_transition_opacity(&layer_trans_in, 0.0, 0.8), 0.0);
        assert!((compute_transition_opacity(&layer_trans_in, 1.0, 0.8) - 0.4).abs() < 1e-5);
        assert_eq!(compute_transition_opacity(&layer_trans_in, 2.0, 0.8), 0.8);
        assert_eq!(compute_transition_opacity(&layer_trans_in, 5.0, 0.8), 0.8);

        // 3. Transition Out (duration = 2.0 sec, linear, dissolve)
        let layer_trans_out = build_layer(json!({
            "id": "3",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 0.8,
            "transition_out": {
                "type": "dissolve",
                "duration_sec": 2.0,
                "curve": "linear"
            }
        }));

        assert_eq!(compute_transition_opacity(&layer_trans_out, 5.0, 0.8), 0.8);
        assert_eq!(compute_transition_opacity(&layer_trans_out, 8.0, 0.8), 0.8);
        assert!((compute_transition_opacity(&layer_trans_out, 9.0, 0.8) - 0.4).abs() < 1e-5);
        assert_eq!(compute_transition_opacity(&layer_trans_out, 10.0, 0.8), 0.0);

        // 4. Overlapping Transitions (transition_in 6.0 sec, transition_out 6.0 sec, duration 10.0 sec)
        let layer_overlap = build_layer(json!({
            "id": "4",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 1.0,
            "transition_in": {
                "type": "dissolve",
                "duration_sec": 6.0,
                "curve": "linear"
            },
            "transition_out": {
                "type": "dissolve",
                "duration_sec": 6.0,
                "curve": "linear"
            }
        }));

        let op_in = compute_transition_opacity(&layer_overlap, 2.0, 1.0);
        assert!((op_in - 2.0 / 6.0).abs() < 1e-5);

        let op_out = compute_transition_opacity(&layer_overlap, 8.0, 1.0);
        assert!((op_out - 2.0 / 6.0).abs() < 1e-5);

        // 5. Bezier Curves (smooth)
        let layer_bezier = build_layer(json!({
            "id": "5",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 1.0,
            "transition_in": {
                "type": "dissolve",
                "duration_sec": 2.0,
                "curve": "smooth"
            }
        }));
        let op_smooth = compute_transition_opacity(&layer_bezier, 1.0, 1.0);
        assert!((op_smooth - 0.5).abs() < 1e-5);
    }

    #[test]
    fn compute_transition_opacity_non_dissolve_overlap_keeps_base_opacity() {
        let layer: SceneLayer = serde_json::from_value(json!({
            "id": "overlap",
            "kind": "video",
            "timeline_start_sec": 10.0,
            "timeline_end_sec": 20.0,
            "source_start_sec": 0.0,
            "z": 1,
            "opacity": 0.8,
            "transition_in": {
                "type": "wipe",
                "duration_sec": 6.0,
                "curve": "linear"
            },
            "transition_out": {
                "type": "slide",
                "duration_sec": 6.0,
                "curve": "linear"
            }
        }))
        .unwrap();

        // During overlap (t=4..6) opacity must stay at base because neither
        // transition is a dissolve.
        assert_eq!(compute_transition_opacity(&layer, 4.0, 0.8), 0.8);
        assert_eq!(compute_transition_opacity(&layer, 5.0, 0.8), 0.8);
        assert_eq!(compute_transition_opacity(&layer, 6.0, 0.8), 0.8);
    }

    #[test]
    fn test_rasterize_svg_caching() {
        use std::io::Write;
        let path = std::env::temp_dir().join("test_fastcat_svg.svg");
        let svg_content = r#"<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="red"/></svg>"#;
        let mut file = std::fs::File::create(&path).unwrap();
        file.write_all(svg_content.as_bytes()).unwrap();
        file.sync_all().unwrap();

        // First rasterization
        let (img1, size1) = rasterize_svg(&path, 100).unwrap();
        assert_eq!(size1, (100, 100));

        // Second rasterization (should hit cache)
        let (img2, size2) = rasterize_svg(&path, 100).unwrap();
        assert_eq!(size2, (100, 100));

        // Verify pixel data equality
        assert_eq!(img1.data.as_ref(), img2.data.as_ref());

        // Cleanup
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_svg_rasterizer_struct_direct_use() {
        use std::io::Write;
        let path = std::env::temp_dir().join("test_fastcat_svg_struct.svg");
        let svg_content = r#"<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="blue"/></svg>"#;
        {
            let mut file = std::fs::File::create(&path).unwrap();
            file.write_all(svg_content.as_bytes()).unwrap();
            file.sync_all().unwrap();
        }

        let rasterizer = SvgRasterizer::new();
        let (img, size) = rasterizer.rasterize_svg(&path, 64).unwrap();
        assert_eq!(size, (64, 64));
        assert_eq!(img.data.as_ref().len(), 64 * 64 * 4);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn test_build_text_layer_auto_size_and_metrics() {
        let style = json!({
            "fontSize": 48.0,
            "fontFamily": "Inter",
            "letterSpacing": 2.0,
            "padding": {
                "top": 10.0,
                "right": 20.0,
                "bottom": 15.0,
                "left": 25.0
            },
            "paddingLinked": false,
            "borderEnabled": true,
            "borderWidth": 4.0,
            "borderColor": "#ff0000",
            "backgroundEnabled": true,
            "backgroundColor": "#0000ff",
            "backgroundRadius": 8.0,
            "backgroundShadowEnabled": true,
            "backgroundShadowBlur": 10.0,
            "backgroundShadowSpread": 5.0,
            "backgroundShadowOffsetX": 3.0,
            "backgroundShadowOffsetY": 4.0,
            "textShadowEnabled": true,
            "textShadowBlur": 5.0,
            "textShadowSpread": 2.0,
            "textShadowOffsetX": 1.0,
            "textShadowOffsetY": 2.0,
            "align": "left",
            "verticalAlign": "top"
        });

        let sl = SceneLayer {
            id: "text-layer-1".into(),
            kind: LayerKind::Text,
            path: "".into(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 10.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 10.0,
            source_duration_sec: None,
            speed: 1.0,
            freeze_frame_source_sec: None,
            source_orientation: None,
            z: 1,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            background_color: None,
            text: Some("Test".into()),
            style: Some(style),
            shape_type: None,
            fill_color: None,
            stroke_color: None,
            stroke_width: None,
            shape_config: None,
            snap_to_pixel_grid: false,
            transform: None,
            transition_in: None,
            transition_out: None,
            effects: Vec::new(),
        };

        let text_layer = build_text_layer(&sl, (1920, 1080));

        assert_eq!(text_layer.text, "Test");
        assert_eq!(text_layer.font_family, "Inter");
        assert_eq!(text_layer.letter_spacing, 2.0);
        assert_eq!(text_layer.padding_top, 10.0);
        assert_eq!(text_layer.padding_left, 25.0);
        assert_eq!(text_layer.border_width, 4.0);
        assert_eq!(text_layer.background_radius, 8.0);

        assert!(text_layer.natural_size.0 > 0);
        assert!(text_layer.natural_size.1 > 0);
        assert!(text_layer.frame_width > 0.0);
        assert!(text_layer.frame_height > 0.0);
        assert!(text_layer.shadow_left > 0.0);
    }

    fn text_layer_with_style(style: serde_json::Value) -> crate::compositor::scene::TextLayer {
        text_layer_with_text_and_style("Test", style)
    }

    fn text_layer_with_text_and_style(
        text: &str,
        style: serde_json::Value,
    ) -> crate::compositor::scene::TextLayer {
        let sl = SceneLayer {
            id: "text-bg".into(),
            kind: LayerKind::Text,
            path: "".into(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 10.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 10.0,
            source_duration_sec: None,
            speed: 1.0,
            freeze_frame_source_sec: None,
            source_orientation: None,
            z: 1,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            background_color: None,
            text: Some(text.into()),
            style: Some(style),
            shape_type: None,
            fill_color: None,
            stroke_color: None,
            stroke_width: None,
            shape_config: None,
            snap_to_pixel_grid: false,
            transform: None,
            transition_in: None,
            transition_out: None,
            effects: Vec::new(),
        };
        build_text_layer(&sl, (1920, 1080))
    }

    #[test]
    fn explicit_background_enabled_false_overrides_present_color() {
        // Regression: an explicit `backgroundEnabled:false` must disable the background
        // even with a saved non-empty `backgroundColor` (previously OR prevented disabling).
        let layer = text_layer_with_style(json!({
            "backgroundEnabled": false,
            "backgroundColor": "#0000ff",
        }));
        assert!(!layer.background_enabled);

        // Without an explicit flag — enable based on a non-empty color (like web).
        let layer = text_layer_with_style(json!({ "backgroundColor": "#0000ff" }));
        assert!(layer.background_enabled);

        // An explicit true stays enabled.
        let layer = text_layer_with_style(json!({ "backgroundEnabled": true }));
        assert!(layer.background_enabled);
    }

    #[test]
    fn linked_padding_applies_left_to_all_edges() {
        // Linked padding (default): all sides = left.
        let layer = text_layer_with_style(json!({
            "padding": { "top": 5.0, "right": 5.0, "bottom": 5.0, "left": 40.0 },
        }));
        assert_eq!(layer.padding_top, 40.0);
        assert_eq!(layer.padding_right, 40.0);
        assert_eq!(layer.padding_bottom, 40.0);
        assert_eq!(layer.padding_left, 40.0);

        // Unlinked — each side independent.
        let layer = text_layer_with_style(json!({
            "paddingLinked": false,
            "padding": { "top": 5.0, "right": 10.0, "bottom": 15.0, "left": 20.0 },
        }));
        assert_eq!(layer.padding_top, 5.0);
        assert_eq!(layer.padding_right, 10.0);
        assert_eq!(layer.padding_bottom, 15.0);
        assert_eq!(layer.padding_left, 20.0);
    }

    #[test]
    fn padding_is_clamped_to_web_range() {
        // Mirror web `normalizeTextPadding`: negative -> 0, oversized -> 10000.
        // render_scale is 1.0 at 1920x1080, so design-space values map 1:1.
        let layer = text_layer_with_style(json!({
            "paddingLinked": false,
            "padding": { "top": -50.0, "right": 999999.0, "bottom": 0.0, "left": 12.0 },
        }));
        assert_eq!(layer.padding_top, 0.0);
        assert_eq!(layer.padding_right, 10_000.0);
        assert_eq!(layer.padding_bottom, 0.0);
        assert_eq!(layer.padding_left, 12.0);
    }

    #[test]
    fn explicit_text_height_is_minimum_when_content_needs_more_space() {
        let short = text_layer_with_style(json!({
            "fontSize": 40.0,
            "height": 200.0,
            "padding": 10.0,
        }));
        assert_eq!(short.frame_height, 200.0);

        let sl = SceneLayer {
            id: "text-multiline".into(),
            kind: LayerKind::Text,
            path: "".into(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 10.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 10.0,
            source_duration_sec: None,
            speed: 1.0,
            freeze_frame_source_sec: None,
            source_orientation: None,
            z: 1,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            background_color: None,
            text: Some("one\ntwo\nthree\nfour\nfive".into()),
            style: Some(json!({
                "fontSize": 40.0,
                "height": 80.0,
                "padding": 10.0,
                "verticalAlign": "middle"
            })),
            shape_type: None,
            fill_color: None,
            stroke_color: None,
            stroke_width: None,
            shape_config: None,
            snap_to_pixel_grid: false,
            transform: None,
            transition_in: None,
            transition_out: None,
            effects: Vec::new(),
        };

        let multiline = build_text_layer(&sl, (1920, 1080));
        assert!(multiline.frame_height > 80.0);
        assert_eq!(
            multiline.frame_height,
            multiline.text_block_height + multiline.padding_top + multiline.padding_bottom
        );
    }

    #[test]
    fn explicit_text_width_wraps_multiline_content_through_parley() {
        let unwrapped = text_layer_with_text_and_style(
            "short\nthis is a much longer wrapped line",
            json!({
                "fontSize": 48.0,
                "lineHeight": 1.2,
                "padding": 0.0
            }),
        );
        let wrapped = text_layer_with_text_and_style(
            "short\nthis is a much longer wrapped line",
            json!({
                "width": 260.0,
                "fontSize": 48.0,
                "lineHeight": 1.2,
                "padding": 0.0,
                "align": "left"
            }),
        );

        assert_eq!(wrapped.max_width, Some(260.0));
        assert_eq!(wrapped.frame_width, 260.0);
        assert!(
            wrapped.text_block_height > unwrapped.text_block_height,
            "expected parley break_all_lines to add visual lines: wrapped={} unwrapped={}",
            wrapped.text_block_height,
            unwrapped.text_block_height
        );
        assert!(
            wrapped.text_block_height >= 48.0 * 1.2 * 3.0,
            "expected at least three laid-out lines, got height {}",
            wrapped.text_block_height
        );
    }

    #[test]
    fn test_build_text_layer_scales_style_to_scene_resolution() {
        let sl = SceneLayer {
            id: "text-layer-720p".into(),
            kind: LayerKind::Text,
            path: "".into(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 10.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 10.0,
            source_duration_sec: None,
            speed: 1.0,
            freeze_frame_source_sec: None,
            source_orientation: None,
            z: 1,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            background_color: None,
            text: Some("Test".into()),
            style: Some(json!({
                "fontSize": 64.0,
                "letterSpacing": 3.0,
                "padding": 12.0,
                "width": 220.0
            })),
            shape_type: None,
            fill_color: None,
            stroke_color: None,
            stroke_width: None,
            shape_config: None,
            snap_to_pixel_grid: false,
            transform: None,
            transition_in: None,
            transition_out: None,
            effects: Vec::new(),
        };

        // 720p scene → render_scale = min(1280/1920, 720/1080) = 2/3. Design-space
        // style values are scaled down accordingly, matching the web compositor.
        let text_layer = build_text_layer(&sl, (1280, 720));

        let scale = 2.0 / 3.0;
        assert!((text_layer.font_size - (64.0 * scale) as f32).abs() < 0.01);
        assert!((text_layer.letter_spacing - (3.0 * scale) as f32).abs() < 0.01);
        assert!((text_layer.padding_top - (12.0 * scale) as f32).abs() < 0.01);
        let max_width = text_layer.max_width.expect("explicit width");
        assert!((max_width - (220.0 * scale) as f32).abs() < 0.01);
    }

    #[test]
    fn parse_color_named_colors() {
        let red = parse_color("red", 1.0);
        assert_eq!(
            red.to_rgba8(),
            vello::peniko::Color::from_rgba8(255, 0, 0, 255).to_rgba8()
        );
        let white = parse_color("White", 0.5);
        assert_eq!(white.to_rgba8().a, 128);
    }

    #[test]
    fn parse_color_rgb_format() {
        let c = parse_color("rgb(10, 20, 30)", 1.0);
        assert_eq!(
            c.to_rgba8(),
            vello::peniko::Color::from_rgba8(10, 20, 30, 255).to_rgba8()
        );
    }

    #[test]
    fn parse_color_rgba_format() {
        let c = parse_color("rgba(10, 20, 30, 0.5)", 1.0);
        assert_eq!(c.to_rgba8().a, 128);
        let c2 = parse_color("rgba(10, 20, 30, 0.5)", 0.5);
        assert_eq!(c2.to_rgba8().a, 64);
    }

    #[test]
    fn parse_color_hex_still_works() {
        let c = parse_color("#ff00aa", 1.0);
        assert_eq!(
            c.to_rgba8(),
            vello::peniko::Color::from_rgba8(255, 0, 170, 255).to_rgba8()
        );
    }

    #[test]
    fn parse_color_unknown_returns_transparent() {
        let c = parse_color("not_a_color", 1.0);
        assert_eq!(c.to_rgba8(), Color::TRANSPARENT.to_rgba8());
    }

    #[test]
    fn parse_color_empty_returns_transparent() {
        let c = parse_color("", 1.0);
        assert_eq!(c.to_rgba8(), Color::TRANSPARENT.to_rgba8());
    }

    #[test]
    fn parse_color_transparent_keyword() {
        let c = parse_color("transparent", 1.0);
        assert_eq!(c.to_rgba8(), Color::TRANSPARENT.to_rgba8());
        let c2 = parse_color("TrAnSpArEnT", 0.5);
        assert_eq!(c2.to_rgba8(), Color::TRANSPARENT.to_rgba8());
    }

    #[test]
    fn parse_color_rgb_with_floats() {
        let c = parse_color("rgb(255.7, 128.2, 64.9)", 1.0);
        assert_eq!(
            c.to_rgba8(),
            Color::from_rgba8(255, 128, 65, 255).to_rgba8()
        );
    }

    #[test]
    fn parse_color_rgb_with_percentages() {
        let c = parse_color("rgb(100%, 50%, 0%)", 1.0);
        assert_eq!(c.to_rgba8(), Color::from_rgba8(255, 128, 0, 255).to_rgba8());
    }

    #[test]
    fn finalize_layer_bakes_text_anchor_offset() {
        let layer = SceneLayer {
            id: "t".into(),
            kind: LayerKind::Text,
            path: "".into(),
            timeline_start_sec: 0.0,
            timeline_end_sec: 5.0,
            source_start_sec: 0.0,
            source_range_duration_sec: 5.0,
            source_duration_sec: None,
            speed: 1.0,
            freeze_frame_source_sec: None,
            source_orientation: None,
            z: 1,
            opacity: 1.0,
            blend_mode: BlendMode::Normal,
            background_color: None,
            text: Some("Hello".into()),
            style: Some(serde_json::json!({
                "fontSize": 64.0,
                "align": "center",
                "backgroundShadowEnabled": true,
                "backgroundShadowBlur": 10.0,
                "backgroundShadowOffsetX": 20.0,
            })),
            shape_type: None,
            fill_color: None,
            stroke_color: None,
            stroke_width: None,
            shape_config: None,
            snap_to_pixel_grid: false,
            transform: Some(SceneLayerTransform {
                x: 100.0,
                y: 200.0,
                scale_x: 1.0,
                scale_y: 1.0,
                rotation_deg: 0.0,
                anchor_x: 0.5, // center anchor
                anchor_y: 0.5,
                crop_top: 0.0,
                crop_bottom: 0.0,
                crop_left: 0.0,
                crop_right: 0.0,
                flip_horizontal: false,
                flip_vertical: false,
            }),
            transition_in: None,
            transition_out: None,
            effects: Vec::new(),
        };
        let scene_size = (1920u32, 1080u32);
        let kind = build_virtual_kind(&layer, scene_size).unwrap();
        let out = finalize_layer(&layer, kind, scene_size, 0.0);
        // With a positive shadow offset, the natural size is asymmetric.
        // The baked x/y must deviate from the raw 100/200 to keep the frame
        // center at the user's position.
        assert!(
            out.transform.x != 100.0,
            "center anchor with asymmetric shadow must bake a non-zero offset"
        );
    }

    fn snap_test_layer(kind: &str, snap_to_pixel_grid: bool, x: f64, y: f64) -> SceneLayer {
        serde_json::from_value(json!({
            "id": "snap-test",
            "kind": kind,
            "timeline_start_sec": 0.0,
            "timeline_end_sec": 1.0,
            "source_start_sec": 0.0,
            "z": 0,
            "opacity": 1.0,
            "text": "Hi",
            "shape_type": "circle",
            "snap_to_pixel_grid": snap_to_pixel_grid,
            "transform": {
                "x": x,
                "y": y
            }
        }))
        .unwrap()
    }

    /// Device-space origin of the layer's local (0,0) under the snap-safe affine:
    /// `to_affine` places it at `transform.x - anchor_x * natural_width`. This is
    /// the quantity that must land on a whole pixel for the (locally-integer)
    /// background/border rects and text origin to rasterize crisply at 1:1.
    fn local_origin(out: &crate::compositor::scene::Layer, natural: (u32, u32)) -> (f64, f64) {
        (
            out.transform.x - out.transform.anchor_x * natural.0 as f64,
            out.transform.y - out.transform.anchor_y * natural.1 as f64,
        )
    }

    #[test]
    fn finalize_layer_rounds_local_origin_for_snapped_text() {
        let layer = snap_test_layer("text", true, 13.4, -7.6);
        let kind = build_virtual_kind(&layer, (1920, 1080)).unwrap();
        let natural = kind.natural_size();
        let out = finalize_layer(&layer, kind, (1920, 1080), 0.0);
        let (ox, oy) = local_origin(&out, natural);
        assert_eq!(ox.fract(), 0.0);
        assert_eq!(oy.fract(), 0.0);
    }

    #[test]
    fn finalize_layer_rounds_local_origin_for_snapped_shape() {
        let layer = snap_test_layer("shape", true, 13.4, -7.6);
        let kind = build_virtual_kind(&layer, (1920, 1080)).unwrap();
        let natural = kind.natural_size();
        let out = finalize_layer(&layer, kind, (1920, 1080), 0.0);
        let (ox, oy) = local_origin(&out, natural);
        assert_eq!(ox.fract(), 0.0);
        assert_eq!(oy.fract(), 0.0);
    }

    #[test]
    fn finalize_layer_leaves_origin_fractional_when_snap_disabled() {
        let layer = snap_test_layer("shape", false, 13.4, -7.6);
        let kind = build_virtual_kind(&layer, (1920, 1080)).unwrap();
        let natural = kind.natural_size();
        let out = finalize_layer(&layer, kind, (1920, 1080), 0.0);
        let (ox, oy) = local_origin(&out, natural);
        assert!(ox.fract() != 0.0);
        assert!(oy.fract() != 0.0);
    }

    #[test]
    fn finalize_layer_leaves_origin_fractional_when_rotated() {
        let mut layer = snap_test_layer("shape", true, 13.4, -7.6);
        if let Some(t) = layer.transform.as_mut() {
            t.rotation_deg = 45.0;
        }
        let kind = build_virtual_kind(&layer, (1920, 1080)).unwrap();
        let natural = kind.natural_size();
        let out = finalize_layer(&layer, kind, (1920, 1080), 0.0);
        let (ox, oy) = local_origin(&out, natural);
        assert!(ox.fract() != 0.0);
        assert!(oy.fract() != 0.0);
    }

    #[test]
    fn build_virtual_kind_shape_snaps_stroke_width_and_size_by_rounding_not_ceiling() {
        // No stroke: raw size = min(103, 2000) * 0.8 = 82.4, whose fractional part
        // is < 0.5 — round() and ceil() diverge (82 vs 83), proving snap uses round.
        let layer_snap = snap_test_layer("shape", true, 0.0, 0.0);
        let layer_no_snap = snap_test_layer("shape", false, 0.0, 0.0);
        let scene_size = (103u32, 2000u32);

        let snapped = build_virtual_kind(&layer_snap, scene_size).unwrap();
        let unsnapped = build_virtual_kind(&layer_no_snap, scene_size).unwrap();

        assert_eq!(snapped.natural_size().0, 82);
        assert_eq!(unsnapped.natural_size().0, 83);
    }

    #[test]
    fn build_text_layer_snap_keeps_frame_and_border_geometry_pixel_aligned() {
        // Regression: rounding only the outer `natural_width`/`natural_height` left
        // `frame_x`/`frame_width`/`border_outset`/padding fractional, so `draw_text`
        // (scene.rs) still drew the background/border rects at sub-pixel local
        // coordinates even though the layer's own final position was snapped —
        // visible as a blurred border edge and slightly soft text. An asymmetric
        // shadow offset (X but not Y) is exactly what used to desync the frame
        // width/height from the rounded natural size.
        let style = json!({
            "fontSize": 37.0,
            "padding": { "top": 6.3, "right": 6.3, "bottom": 6.3, "left": 6.3 },
            "borderEnabled": true,
            "borderWidth": 1.0,
            "backgroundEnabled": true,
            "backgroundShadowEnabled": true,
            "backgroundShadowBlur": 4.0,
            "backgroundShadowOffsetX": 3.0,
            "backgroundShadowOffsetY": 0.0,
        });
        let sl: SceneLayer = serde_json::from_value(json!({
            "id": "snap-frame-test",
            "kind": "text",
            "timeline_start_sec": 0.0,
            "timeline_end_sec": 1.0,
            "source_start_sec": 0.0,
            "z": 0,
            "opacity": 1.0,
            "text": "Text",
            "style": style,
            "snap_to_pixel_grid": true
        }))
        .unwrap();

        let layer = build_text_layer(&sl, (1920, 1080));

        // frame_x/frame_y (recomputed the same way `scene::draw_text` does) plus the
        // frame size plus the mirrored border outset must land exactly on the
        // rounded natural size — i.e. every contributing measurement is itself an
        // integer, not just their unrounded sum.
        let border_outset = layer.border_width + layer.border_offset;
        assert_eq!(border_outset.fract(), 0.0, "border_outset must be a whole pixel");
        assert_eq!(layer.frame_width.fract(), 0.0, "frame_width must be a whole pixel");
        assert_eq!(layer.frame_height.fract(), 0.0, "frame_height must be a whole pixel");
        assert_eq!(layer.shadow_left.fract(), 0.0, "shadow_left must be a whole pixel");
        assert_eq!(layer.shadow_right.fract(), 0.0, "shadow_right must be a whole pixel");
        assert_eq!(layer.padding_left.fract(), 0.0, "padding_left must be a whole pixel");
        assert_eq!(layer.padding_top.fract(), 0.0, "padding_top must be a whole pixel");

        let reconstructed_width =
            layer.frame_width + border_outset * 2.0 + layer.shadow_left + layer.shadow_right;
        assert_eq!(reconstructed_width, layer.natural_size.0 as f32);
    }

    #[test]
    fn build_text_layer_no_snap_leaves_frame_geometry_fractional() {
        let style = json!({
            "fontSize": 37.0,
            "padding": { "top": 6.3, "right": 6.3, "bottom": 6.3, "left": 6.3 },
            "borderEnabled": true,
            "borderWidth": 1.0,
            "backgroundEnabled": true,
        });
        let sl: SceneLayer = serde_json::from_value(json!({
            "id": "no-snap-frame-test",
            "kind": "text",
            "timeline_start_sec": 0.0,
            "timeline_end_sec": 1.0,
            "source_start_sec": 0.0,
            "z": 0,
            "opacity": 1.0,
            "text": "Text",
            "style": style,
            "snap_to_pixel_grid": false
        }))
        .unwrap();

        let layer = build_text_layer(&sl, (1920, 1080));
        assert!(layer.padding_left.fract() != 0.0);
    }

    #[test]
    fn scene_layer_transform_into_compositor_transform() {
        let slt = SceneLayerTransform {
            x: 10.0,
            y: 20.0,
            scale_x: 2.0,
            scale_y: 3.0,
            rotation_deg: 45.0,
            anchor_x: 0.5,
            anchor_y: 0.25,
            crop_top: 1.0,
            crop_bottom: 2.0,
            crop_left: 3.0,
            crop_right: 4.0,
            flip_horizontal: false,
            flip_vertical: false,
        };
        let t: Transform = Transform::from(&slt);
        assert_eq!(t.x, 10.0);
        assert_eq!(t.y, 20.0);
        assert_eq!(t.scale_x, 2.0);
        assert_eq!(t.scale_y, 3.0);
        assert_eq!(t.rotation_deg, 45.0);
        assert_eq!(t.anchor_x, 0.5);
        assert_eq!(t.anchor_y, 0.25);
        assert_eq!(t.crop_top, 1.0);
        assert_eq!(t.crop_bottom, 2.0);
        assert_eq!(t.crop_left, 3.0);
        assert_eq!(t.crop_right, 4.0);
    }

    /// Cross-engine parity contract. This test and the TS test
    /// `test/unit/utils/video-editor/text-shadow-frame.parity.test.ts` read the
    /// SAME fixture, so the native `build_text_layer` and the web
    /// `computeTextLayoutMetrics` shadow/border bounding-box math can never
    /// drift apart. See the fixture's `_comment` for why frame size is pinned
    /// (explicit width/height dominate the text-measured auto size).
    #[test]
    fn text_shadow_frame_matches_shared_parity_fixture() {
        const FIXTURE: &str =
            include_str!("../../../../../shared/parity/text-shadow-frame.cases.json");
        let parsed: serde_json::Value =
            serde_json::from_str(FIXTURE).expect("valid parity fixture json");
        let cases = parsed["cases"].as_array().expect("cases array");
        assert!(!cases.is_empty(), "fixture has cases");

        for c in cases {
            let name = c["name"].as_str().unwrap_or("?");
            let text = c["text"].as_str().unwrap_or("").to_string();
            let style = c["style"].clone();

            let sl: SceneLayer = serde_json::from_value(json!({
                "id": "text-parity",
                "kind": "text",
                "timeline_start_sec": 0.0,
                "timeline_end_sec": 10.0,
                "source_start_sec": 0.0,
                "z": 1,
                "opacity": 1.0,
                "text": text,
                "style": style,
            }))
            .unwrap();

            let layer = build_text_layer(&sl, (1920, 1080));
            let exp = &c["expected"];
            let approx = |a: f32, b: f64, field: &str| {
                assert!(
                    ((a as f64) - b).abs() < 1e-6,
                    "case `{name}` {field}: got {a}, expected {b}"
                );
            };

            approx(
                layer.frame_width,
                exp["frameWidth"].as_f64().unwrap(),
                "frameWidth",
            );
            approx(
                layer.frame_height,
                exp["frameHeight"].as_f64().unwrap(),
                "frameHeight",
            );
            approx(
                layer.shadow_left,
                exp["shadowLeft"].as_f64().unwrap(),
                "shadowLeft",
            );
            approx(
                layer.shadow_top,
                exp["shadowTop"].as_f64().unwrap(),
                "shadowTop",
            );
            approx(
                layer.shadow_right,
                exp["shadowRight"].as_f64().unwrap(),
                "shadowRight",
            );
            approx(
                layer.shadow_bottom,
                exp["shadowBottom"].as_f64().unwrap(),
                "shadowBottom",
            );

            let background_width = layer.frame_width
                + layer.border_width * 2.0
                + layer.shadow_left
                + layer.shadow_right;
            let background_height = layer.frame_height
                + layer.border_width * 2.0
                + layer.shadow_top
                + layer.shadow_bottom;
            approx(
                background_width,
                exp["backgroundWidth"].as_f64().unwrap(),
                "backgroundWidth",
            );
            approx(
                background_height,
                exp["backgroundHeight"].as_f64().unwrap(),
                "backgroundHeight",
            );

            let frame_x = layer.border_width + layer.shadow_left;
            let frame_y = layer.border_width + layer.shadow_top;
            approx(frame_x, exp["frameX"].as_f64().unwrap(), "frameX");
            approx(frame_y, exp["frameY"].as_f64().unwrap(), "frameY");
        }
    }
}
