use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Hash, serde::Deserialize, serde::Serialize, ts_rs::TS,
)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub enum AudioPluginFormat {
    Clap,
    Lv2,
    Vst3,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct AudioPluginDescriptor {
    pub id: String,
    pub format: AudioPluginFormat,
    pub path: String,
    pub name: String,
    pub vendor: Option<String>,
    pub version: Option<String>,
    pub is_loadable: bool,
    pub status: AudioPluginStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct AudioPluginStatus {
    pub code: AudioPluginStatusCode,
    pub message: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "kebab-case")]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub enum AudioPluginStatusCode {
    Candidate,
    HostUnavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct AudioPluginScanRequest {
    #[serde(default)]
    pub formats: Vec<AudioPluginFormat>,
    #[serde(default)]
    pub custom_paths: Vec<String>,
    #[serde(default)]
    pub include_standard_paths: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize, ts_rs::TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../src/types/generated/native-monitor/")]
pub struct AudioPluginScanResult {
    pub plugins: Vec<AudioPluginDescriptor>,
    pub scanned_paths: Vec<String>,
}

pub trait AudioPluginBackend: Send + Sync {
    fn format(&self) -> AudioPluginFormat;
    fn discover(&self, paths: &[PathBuf]) -> Vec<AudioPluginDescriptor>;
}

pub struct CandidateBackend {
    format: AudioPluginFormat,
}

impl CandidateBackend {
    pub fn new(format: AudioPluginFormat) -> Self {
        Self { format }
    }
}

impl AudioPluginBackend for CandidateBackend {
    fn format(&self) -> AudioPluginFormat {
        self.format
    }

    fn discover(&self, paths: &[PathBuf]) -> Vec<AudioPluginDescriptor> {
        discover_candidates(self.format, paths)
    }
}

pub fn scan_audio_plugins(request: AudioPluginScanRequest) -> AudioPluginScanResult {
    let formats = normalize_formats(&request.formats);
    let paths = normalize_scan_paths(&request.custom_paths, request.include_standard_paths);
    let backends = formats
        .into_iter()
        .map(CandidateBackend::new)
        .collect::<Vec<_>>();
    let mut plugins = Vec::new();

    for backend in backends {
        plugins.extend(backend.discover(&paths));
    }

    plugins = enrich_descriptors(plugins);

    plugins.sort_by(|a, b| a.name.cmp(&b.name).then_with(|| a.path.cmp(&b.path)));

    AudioPluginScanResult {
        plugins,
        scanned_paths: paths
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect(),
    }
}

/// Turn discovered candidates into concrete entries where a host backend can
/// introspect them. For CLAP that means loading the bundle and enumerating the
/// plugins it contains (a single `.clap` may expose several), filling in real
/// name/vendor/version and marking them loadable. LV2/VST3 have no host backend
/// yet, so they pass through unchanged as candidates.
fn enrich_descriptors(plugins: Vec<AudioPluginDescriptor>) -> Vec<AudioPluginDescriptor> {
    let mut out = Vec::with_capacity(plugins.len());
    for descriptor in plugins {
        if descriptor.format != AudioPluginFormat::Clap {
            out.push(descriptor);
            continue;
        }

        match super::clap::describe_isolated(Path::new(&descriptor.path)) {
            Ok(contained) if !contained.is_empty() => {
                let path_hash = stable_path_id(&descriptor.path);
                for plugin in contained {
                    out.push(AudioPluginDescriptor {
                        id: format!("clap:{path_hash}:{}", plugin.id),
                        format: AudioPluginFormat::Clap,
                        path: descriptor.path.clone(),
                        name: plugin.name.unwrap_or_else(|| descriptor.name.clone()),
                        vendor: plugin.vendor,
                        version: plugin.version,
                        is_loadable: true,
                        status: AudioPluginStatus {
                            code: AudioPluginStatusCode::Candidate,
                            message: format!("CLAP plugin ready ({})", plugin.id),
                        },
                    });
                }
            }
            Ok(_) => out.push(with_status(
                descriptor,
                false,
                "Bundle exposed no CLAP plugins",
            )),
            Err(err) => out.push(with_status(
                descriptor,
                false,
                &format!("Failed to load: {err}"),
            )),
        }
    }
    out
}

fn with_status(
    mut descriptor: AudioPluginDescriptor,
    is_loadable: bool,
    message: &str,
) -> AudioPluginDescriptor {
    descriptor.is_loadable = is_loadable;
    descriptor.status = AudioPluginStatus {
        code: if is_loadable {
            AudioPluginStatusCode::Candidate
        } else {
            AudioPluginStatusCode::HostUnavailable
        },
        message: message.to_string(),
    };
    descriptor
}

fn normalize_formats(formats: &[AudioPluginFormat]) -> Vec<AudioPluginFormat> {
    let requested = if formats.is_empty() {
        vec![AudioPluginFormat::Clap]
    } else {
        formats.to_vec()
    };
    let mut seen = HashSet::new();
    requested
        .into_iter()
        .filter(|format| seen.insert(*format))
        .collect()
}

fn normalize_scan_paths(custom_paths: &[String], include_standard_paths: bool) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if include_standard_paths {
        paths.extend(standard_audio_plugin_paths());
    }
    paths.extend(custom_paths.iter().map(PathBuf::from));

    let mut seen = HashSet::new();
    paths
        .into_iter()
        .filter(|path| seen.insert(path.to_string_lossy().to_string()))
        .collect()
}

fn discover_candidates(format: AudioPluginFormat, roots: &[PathBuf]) -> Vec<AudioPluginDescriptor> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::new();
    for root in roots {
        visit_plugin_candidates(root, format, 0, &mut seen, &mut candidates);
    }
    candidates
}

fn visit_plugin_candidates(
    path: &Path,
    format: AudioPluginFormat,
    depth: usize,
    seen: &mut HashSet<String>,
    candidates: &mut Vec<AudioPluginDescriptor>,
) {
    if depth > 4 {
        return;
    }

    if is_plugin_path(path, format) {
        let key = path.to_string_lossy().to_string();
        if seen.insert(key.clone()) {
            candidates.push(AudioPluginDescriptor {
                id: format!("{}:{}", format_id(format), stable_path_id(&key)),
                format,
                path: key,
                name: path
                    .file_stem()
                    .and_then(|name| name.to_str())
                    .unwrap_or("Audio Plugin")
                    .to_string(),
                vendor: None,
                version: None,
                is_loadable: false,
                status: AudioPluginStatus {
                    code: AudioPluginStatusCode::HostUnavailable,
                    message: "Plugin host backend is not enabled yet".to_string(),
                },
            });
        }
        return;
    }

    let Ok(entries) = fs::read_dir(path) else {
        return;
    };

    for entry in entries.flatten() {
        let entry_path = entry.path();
        if entry_path.is_dir() || is_plugin_path(&entry_path, format) {
            visit_plugin_candidates(&entry_path, format, depth + 1, seen, candidates);
        }
    }
}

fn is_plugin_path(path: &Path, format: AudioPluginFormat) -> bool {
    let ext = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(str::to_ascii_lowercase);
    match format {
        AudioPluginFormat::Clap => ext.as_deref() == Some("clap"),
        AudioPluginFormat::Lv2 => ext.as_deref() == Some("lv2"),
        AudioPluginFormat::Vst3 => ext.as_deref() == Some("vst3"),
    }
}

fn format_id(format: AudioPluginFormat) -> &'static str {
    match format {
        AudioPluginFormat::Clap => "clap",
        AudioPluginFormat::Lv2 => "lv2",
        AudioPluginFormat::Vst3 => "vst3",
    }
}

fn stable_path_id(path: &str) -> String {
    let mut hash = 0xcbf29ce484222325u64;
    for byte in path.as_bytes() {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn standard_audio_plugin_paths() -> Vec<PathBuf> {
    let mut paths = Vec::new();

    #[cfg(target_os = "linux")]
    {
        if let Some(home) = std::env::var_os("HOME") {
            let home = PathBuf::from(home);
            paths.push(home.join(".clap"));
            paths.push(home.join(".lv2"));
            paths.push(home.join(".vst3"));
            paths.push(home.join(".local/lib/clap"));
            paths.push(home.join(".local/lib/lv2"));
            paths.push(home.join(".local/lib/vst3"));
        }
        paths.push(PathBuf::from("/usr/lib/clap"));
        paths.push(PathBuf::from("/usr/lib/lv2"));
        paths.push(PathBuf::from("/usr/lib/vst3"));
        paths.push(PathBuf::from("/usr/local/lib/clap"));
        paths.push(PathBuf::from("/usr/local/lib/lv2"));
        paths.push(PathBuf::from("/usr/local/lib/vst3"));
    }

    #[cfg(target_os = "macos")]
    {
        if let Some(home) = std::env::var_os("HOME") {
            let home = PathBuf::from(home);
            paths.push(home.join("Library/Audio/Plug-Ins/CLAP"));
            paths.push(home.join("Library/Audio/Plug-Ins/LV2"));
            paths.push(home.join("Library/Audio/Plug-Ins/VST3"));
        }
        paths.push(PathBuf::from("/Library/Audio/Plug-Ins/CLAP"));
        paths.push(PathBuf::from("/Library/Audio/Plug-Ins/LV2"));
        paths.push(PathBuf::from("/Library/Audio/Plug-Ins/VST3"));
    }

    #[cfg(target_os = "windows")]
    {
        if let Some(common_files) = std::env::var_os("CommonProgramFiles") {
            let common_files = PathBuf::from(common_files);
            paths.push(common_files.join("CLAP"));
            paths.push(common_files.join("LV2"));
            paths.push(common_files.join("VST3"));
        }
    }

    paths
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_to_clap_when_formats_are_empty() {
        assert_eq!(normalize_formats(&[]), vec![AudioPluginFormat::Clap]);
    }

    #[test]
    fn removes_duplicate_formats() {
        assert_eq!(
            normalize_formats(&[
                AudioPluginFormat::Clap,
                AudioPluginFormat::Clap,
                AudioPluginFormat::Vst3,
            ]),
            vec![AudioPluginFormat::Clap, AudioPluginFormat::Vst3]
        );
    }

    #[test]
    fn detects_plugin_extensions() {
        assert!(is_plugin_path(
            Path::new("synth.clap"),
            AudioPluginFormat::Clap
        ));
        assert!(is_plugin_path(Path::new("amp.lv2"), AudioPluginFormat::Lv2));
        assert!(is_plugin_path(
            Path::new("eq.vst3"),
            AudioPluginFormat::Vst3
        ));
        assert!(!is_plugin_path(
            Path::new("eq.vst3"),
            AudioPluginFormat::Clap
        ));
    }
}
