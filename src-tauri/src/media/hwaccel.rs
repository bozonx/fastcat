//! Hardware-accelerated video decode helpers.
//!
//! Interim implementation: we initialise a hwaccel device through
//! `ffmpeg-sys-next`, decode on the GPU, then download the frame to
//! CPU-accessible memory with `av_hwframe_transfer_data`.  The frame is
//! still converted to RGBA on the CPU and uploaded to wgpu — this avoids
//! the heavy software decode step while keeping the rest of the pipeline
//! unchanged.
//!
//! True zero-copy (GPU texture → wgpu without CPU readback) is left for
//! a future R&D track because wgpu 29 does not expose stable cross-platform
//! external-memory import.

use std::ffi::{c_char, c_int, CString};

use anyhow::{anyhow, Context, Result};
use ffmpeg_next as ffmpeg;

use super::types::HwAccelMode;

/// Opaque handle to a hardware decode context.
/// Keeps the `AVBufferRef` alive as long as the decoder needs it.
pub struct HwAccelContext {
    hw_device_ref: *mut ffmpeg_sys_next::AVBufferRef,
}

impl Drop for HwAccelContext {
    fn drop(&mut self) {
        if !self.hw_device_ref.is_null() {
            // SAFETY: `hw_device_ref` is non-null and was created by libav*.
            // av_buffer_unref is the correct deallocation routine for AVBufferRef.
            unsafe {
                ffmpeg_sys_next::av_buffer_unref(&mut self.hw_device_ref);
            }
        }
    }
}

/// Try to initialise a hardware decoder for `decoder`.
///
/// * `hw_mode` – typed hardware acceleration mode (`Auto`, `Vaapi`, etc.).
/// * `vaapi_device` – e.g. `"/dev/dri/renderD128"` (Linux only).
///
/// Returns `None` if hwaccel is disabled or the requested backend could not
/// be created (graceful fallback to software decode).
pub fn init_hwaccel(
    decoder: &mut ffmpeg::decoder::Video,
    hw_mode: HwAccelMode,
    vaapi_device: Option<&str>,
) -> Option<HwAccelContext> {
    if hw_mode == HwAccelMode::None {
        return None;
    }

    // SAFETY: `decoder` is a live `ffmpeg::decoder::Video`; `as_mut_ptr()` returns the
    // underlying `AVCodecContext*` which remains valid as long as the decoder is alive.
    let codec_ctx = unsafe { decoder.as_mut_ptr() };
    if codec_ctx.is_null() {
        log::warn!("[hwaccel] decoder context is null");
        return None;
    }

    #[cfg(target_os = "linux")]
    if matches!(
        hw_mode,
        HwAccelMode::Auto | HwAccelMode::Vaapi | HwAccelMode::Nvdec
    ) {
        match try_vaapi(codec_ctx, vaapi_device) {
            Ok(ctx) => return Some(ctx),
            Err(e) => log::warn!("[hwaccel] VAAPI init failed: {e}"),
        }
    }

    #[cfg(target_os = "macos")]
    if matches!(hw_mode, HwAccelMode::Auto | HwAccelMode::Vaapi) {
        match try_videotoolbox(codec_ctx) {
            Ok(ctx) => return Some(ctx),
            Err(e) => log::warn!("[hwaccel] VideoToolbox init failed: {e}"),
        }
    }

    #[cfg(target_os = "windows")]
    if matches!(hw_mode, HwAccelMode::Auto | HwAccelMode::Nvdec) {
        match try_d3d11va(codec_ctx) {
            Ok(ctx) => return Some(ctx),
            Err(e) => log::warn!("[hwaccel] D3D11VA init failed: {e}"),
        }
    }

    log::info!("[hwaccel] falling back to software decode");
    None
}

/// If `decoded` is a hardware frame, transfer it to a software frame.
/// Returns `Ok(None)` if the frame is already in system memory.
pub fn try_transfer_to_cpu(
    decoded: &mut ffmpeg::util::frame::Video,
    _ctx: &HwAccelContext,
) -> Result<Option<ffmpeg::util::frame::Video>> {
    if !is_hw_pixel_format(decoded.format()) {
        return Ok(None);
    }

    // SAFETY: `decoded` is a live `ffmpeg::util::frame::Video`; the pointer is valid
    // for the lifetime of the frame and is immediately cast to the raw AVFrame type.
    let hw_frame = unsafe { decoded.as_mut_ptr() };
    if hw_frame.is_null() {
        return Err(anyhow!("hw frame pointer is null"));
    }

    let mut sw_frame = ffmpeg::util::frame::Video::empty();
    // SAFETY: `sw_frame` was just created and is empty; the pointer is valid for the
    // duration of this function.
    let sw_ptr = unsafe { sw_frame.as_mut_ptr() };

    // Transfer data from GPU frame to CPU frame.
    // SAFETY: Both pointers are valid, non-null AVFrame pointers. `sw_ptr` points to an
    // empty frame that will receive the transferred data, and `hw_frame` points to a
    // hardware frame previously produced by the decoder.
    let ret = unsafe { ffmpeg_sys_next::av_hwframe_transfer_data(sw_ptr, hw_frame, 0) };
    if ret < 0 {
        return Err(anyhow!(
            "av_hwframe_transfer_data failed: {}",
            ffmpeg_error_str(ret)
        ));
    }

    Ok(Some(sw_frame))
}

// ---------------------------------------------------------------------------
// Linux VAAPI
// ---------------------------------------------------------------------------

fn create_hwaccel_context(
    codec_ctx: *mut ffmpeg_sys_next::AVCodecContext,
    name: &str,
    device: Option<&str>,
) -> Result<HwAccelContext> {
    let name_c = CString::new(name).context("invalid hwaccel name")?;
    let hw_type = unsafe { ffmpeg_sys_next::av_hwdevice_find_type_by_name(name_c.as_ptr()) };
    if hw_type == ffmpeg_sys_next::AVHWDeviceType::AV_HWDEVICE_TYPE_NONE {
        return Err(anyhow!("{name} is not supported by this FFmpeg build"));
    }

    let mut hw_device_ref: *mut ffmpeg_sys_next::AVBufferRef = std::ptr::null_mut();
    let device_c = device
        .map(|d| CString::new(d).context("invalid device path"))
        .transpose()?;
    let device_ptr = device_c.as_ref().map_or(std::ptr::null(), |c| c.as_ptr());

    let ret = unsafe {
        ffmpeg_sys_next::av_hwdevice_ctx_create(
            &mut hw_device_ref,
            hw_type,
            device_ptr,
            std::ptr::null_mut(),
            0,
        )
    };
    if ret < 0 {
        return Err(anyhow!(
            "av_hwdevice_ctx_create failed for {name}: {}",
            ffmpeg_error_str(ret)
        ));
    }

    // SAFETY: `hw_device_ref` is valid; `codec_ctx` is valid decoder context.
    unsafe {
        (*codec_ctx).hw_device_ctx = ffmpeg_sys_next::av_buffer_ref(hw_device_ref);
    }

    if let Some(dev) = device {
        log::info!("[hwaccel] {name} initialised on {dev}");
    } else {
        log::info!("[hwaccel] {name} initialised");
    }
    Ok(HwAccelContext { hw_device_ref })
}

#[cfg(target_os = "linux")]
fn try_vaapi(
    codec_ctx: *mut ffmpeg_sys_next::AVCodecContext,
    device: Option<&str>,
) -> Result<HwAccelContext> {
    let dev = device.unwrap_or("/dev/dri/renderD128");
    create_hwaccel_context(codec_ctx, "vaapi", Some(dev))
}

// ---------------------------------------------------------------------------
// macOS VideoToolbox
// ---------------------------------------------------------------------------

#[cfg(target_os = "macos")]
fn try_videotoolbox(codec_ctx: *mut ffmpeg_sys_next::AVCodecContext) -> Result<HwAccelContext> {
    create_hwaccel_context(codec_ctx, "videotoolbox", None)
}

// ---------------------------------------------------------------------------
// Windows D3D11VA
// ---------------------------------------------------------------------------

#[cfg(target_os = "windows")]
fn try_d3d11va(codec_ctx: *mut ffmpeg_sys_next::AVCodecContext) -> Result<HwAccelContext> {
    create_hwaccel_context(codec_ctx, "d3d11va", None)
}

// ---------------------------------------------------------------------------
// Stubs for platforms where the backend is not compiled in
// ---------------------------------------------------------------------------

#[cfg(not(target_os = "linux"))]
fn try_vaapi(
    _codec_ctx: *mut ffmpeg_sys_next::AVCodecContext,
    _device: Option<&str>,
) -> Result<HwAccelContext> {
    Err(anyhow!("VAAPI is only available on Linux"))
}

#[cfg(not(target_os = "macos"))]
#[allow(dead_code)]
fn try_videotoolbox(_codec_ctx: *mut ffmpeg_sys_next::AVCodecContext) -> Result<HwAccelContext> {
    Err(anyhow!("VideoToolbox is only available on macOS"))
}

#[cfg(not(target_os = "windows"))]
#[allow(dead_code)]
fn try_d3d11va(_codec_ctx: *mut ffmpeg_sys_next::AVCodecContext) -> Result<HwAccelContext> {
    Err(anyhow!("D3D11VA is only available on Windows"))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn is_hw_pixel_format(pixel: ffmpeg::format::Pixel) -> bool {
    matches!(
        pixel,
        ffmpeg::format::Pixel::VAAPI
            | ffmpeg::format::Pixel::DXVA2_VLD
            | ffmpeg::format::Pixel::D3D11VA_VLD
            | ffmpeg::format::Pixel::D3D11
            | ffmpeg::format::Pixel::VIDEOTOOLBOX
            | ffmpeg::format::Pixel::MEDIACODEC
            | ffmpeg::format::Pixel::CUDA
            | ffmpeg::format::Pixel::QSV
    )
}

fn ffmpeg_error_str(err: c_int) -> String {
    let mut buf = [0u8; 256];
    // SAFETY: `buf` is a fixed-size array on the stack; the pointer and length are valid
    // for the duration of the call. `av_strerror` will not write past `buf.len()`.
    unsafe {
        ffmpeg_sys_next::av_strerror(err, buf.as_mut_ptr() as *mut c_char, buf.len());
    }
    // Find null terminator
    let len = buf.iter().position(|&b| b == 0).unwrap_or(buf.len());
    String::from_utf8_lossy(&buf[..len]).to_string()
}
