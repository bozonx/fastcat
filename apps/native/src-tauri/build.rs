use std::env;
use std::fs;
use std::path::Path;

/// Hard render ceilings shared with the web compositor. The values are defined
/// once in `shared/effects/render-ceilings.json`; this build step turns them
/// into Rust constants so the native pass builder and the web pass builder
/// (which imports the same JSON) can never drift. Maps each JSON key to its
/// Rust constant name — add new ceilings here and in the JSON.
const RENDER_CEILINGS: &[(&str, &str)] = &[
    ("maxBlurRadius", "MAX_BLUR_RADIUS"),
    ("maxBloomRadius", "MAX_BLOOM_RADIUS"),
    ("maxColorMultiplier", "MAX_COLOR_MULTIPLIER"),
    ("maxBloomStrength", "MAX_BLOOM_STRENGTH"),
    ("maxChromaticAberration", "MAX_CHROMATIC_ABERRATION"),
    ("maxLevelsGamma", "MAX_LEVELS_GAMMA"),
    ("maxSharpen", "MAX_SHARPEN"),
    ("maxPixelate", "MAX_PIXELATE"),
    ("maxBlurFillScale", "MAX_BLUR_FILL_SCALE"),
];

fn generate_render_ceilings() {
    let json_path = "../../../packages/shared/effects/render-ceilings.json";
    println!("cargo:rerun-if-changed={json_path}");

    let raw =
        fs::read_to_string(json_path).unwrap_or_else(|e| panic!("failed to read {json_path}: {e}"));
    let parsed: serde_json::Value =
        serde_json::from_str(&raw).unwrap_or_else(|e| panic!("failed to parse {json_path}: {e}"));

    let mut out = String::from(
        "// @generated from shared/effects/render-ceilings.json by build.rs — do not edit.\n",
    );
    for (json_key, const_name) in RENDER_CEILINGS {
        let value = parsed
            .get(json_key)
            .and_then(serde_json::Value::as_f64)
            .unwrap_or_else(|| panic!("missing or non-numeric key `{json_key}` in {json_path}"));
        out.push_str(&format!("const {const_name}: f32 = {value:?}f32;\n"));
    }

    let dest = Path::new(&env::var("OUT_DIR").unwrap()).join("render_ceilings.rs");
    fs::write(&dest, out).expect("failed to write render_ceilings.rs");
}

fn main() {
    generate_render_ceilings();
    tauri_build::build()
}
