use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use anyhow::{anyhow, Context, Result};
use ffmpeg_next as ffmpeg;

use super::types::{MediaInfo, VideoFrame};
use super::utils::*;
use super::{VideoDecoder, VideoDecoderFactory};
use crate::media::hwaccel::{init_hwaccel_context, try_transfer_to_cpu, HwAccelContext};
use crate::media::types::HwAccelMode;

static FFMPEG_INIT: OnceLock<Result<(), String>> = OnceLock::new();

pub(crate) fn init_ffmpeg() -> Result<()> {
    let result = FFMPEG_INIT.get_or_init(|| ffmpeg::init().map_err(|e| format!("{e}")));
    match result {
        Ok(()) => Ok(()),
        Err(e) => Err(anyhow!("failed to initialize ffmpeg-next: {e}")),
    }
}

pub struct FfmpegNextDecoder {
    path: PathBuf,
    info: MediaInfo,
    ictx: ffmpeg::format::context::Input,
    decoder: ffmpeg::decoder::Video,
    scaler: Option<ffmpeg::software::scaling::Context>,
    scaler_input_format: ffmpeg::format::Pixel,
    scaler_input_width: u32,
    scaler_input_height: u32,
    yuv_scaler: Option<ffmpeg::software::scaling::Context>,
    yuv_scaler_input_format: ffmpeg::format::Pixel,
    yuv_scaler_input_width: u32,
    yuv_scaler_input_height: u32,
    stream_index: usize,
    stream_time_base: ffmpeg::Rational,
    /// Stream start PTS in seconds. Containers like MPEG-TS, or MP4s with an edit
    /// list, begin at a non-zero PTS; we subtract it so reported `pts_sec` is
    /// 0-based (timeline-relative) and add it back when seeking. Without this the
    /// export/monitor would request frame `t` but the decoder, reporting raw PTS
    /// `start + t`, would think it had already passed every target and freeze on
    /// the first frame for `start` seconds.
    start_time_sec: f64,
    eof_sent: bool,
    /// Frame-accurate seek target (stream-time seconds). After `seek`, libav lands on
    /// the nearest key frame ≤ target; `next_frame` drops frames with PTS noticeably
    /// less than target until the requested position is reached. `None` = no active seek.
    pub(crate) seek_target: Option<f64>,
    hwaccel: Option<HwAccelContext>,
    /// Last computed frame PTS (0-based seconds). Used as the base for the
    /// no-PTS fallback in `frame_pts_sec` — see its doc comment.
    last_pts_sec: f64,
}

impl FfmpegNextDecoder {
    pub fn open(
        path: &Path,
        max_output_long_edge: Option<u32>,
        hw_mode: HwAccelMode,
        vaapi_device: Option<&str>,
    ) -> Result<Self> {
        init_ffmpeg()?;

        let ictx = ffmpeg::format::input(path).with_context(|| {
            format!(
                "failed to open media through ffmpeg-next: {}",
                path.display()
            )
        })?;
        let input = ictx
            .streams()
            .best(ffmpeg::media::Type::Video)
            .ok_or_else(|| anyhow!("no video stream"))?;
        let stream_index = input.index();
        let stream_time_base = input.time_base();
        let start_time_sec = stream_start_time_sec(&input, stream_time_base);
        let fps = rational_to_f64(input.avg_frame_rate())
            .or_else(|| rational_to_f64(input.rate()))
            .unwrap_or(0.0);
        let duration_sec = input_duration_sec(&ictx, &input);
        let rotation = metadata_rotation(&input);
        let has_audio = ictx
            .streams()
            .any(|stream| stream.parameters().medium() == ffmpeg::media::Type::Audio);
        let parameters = input.parameters();
        let codec = parameters.id().name().to_string();

        let mut context_decoder = ffmpeg::codec::context::Context::from_parameters(parameters)
            .context("failed to create ffmpeg-next decoder context")?;
        let hwaccel = {
            // SAFETY: `context_decoder` owns a live `AVCodecContext*`. We only attach
            // the hw device before opening the codec, which is the libav-required point.
            let codec_ctx = unsafe { context_decoder.as_mut_ptr() };
            init_hwaccel_context(codec_ctx, hw_mode, vaapi_device)
        };
        let decoder = if codec == "vp9" && hwaccel.is_none() {
            if let Some(libvpx) = ffmpeg::decoder::find_by_name("libvpx-vp9") {
                context_decoder
                    .decoder()
                    .open_as(libvpx)
                    .context("failed to open ffmpeg-next libvpx-vp9 video decoder")?
                    .video()
                    .context("failed to open libvpx-vp9 as video decoder")?
            } else {
                context_decoder
                    .decoder()
                    .video()
                    .context("failed to open ffmpeg-next video decoder")?
            }
        } else {
            context_decoder
                .decoder()
                .video()
                .context("failed to open ffmpeg-next video decoder")?
        };

        let is_hdr = is_hdr_signal(
            decoder.color_transfer_characteristic(),
            decoder.color_primaries(),
        );

        let (visual_w, visual_h) = visual_dimensions(decoder.width(), decoder.height(), rotation);
        let (out_w, out_h) = compute_output_dims(visual_w, visual_h, max_output_long_edge);
        let (scaled_coded_w, scaled_coded_h) = coded_output_dimensions(out_w, out_h, rotation);
        let scaler_input_format = decoder.format();
        let scaler_input_width = decoder.width();
        let scaler_input_height = decoder.height();

        if hwaccel.is_some() {
            log::info!("[native-media] hwaccel enabled for {}", path.display());
        }

        Ok(Self {
            path: path.to_path_buf(),
            info: MediaInfo {
                duration_sec,
                width: scaled_coded_w,
                height: scaled_coded_h,
                rotation,
                fps,
                codec,
                has_audio,
                start_time_sec,
                is_hdr,
            },
            ictx,
            decoder,
            scaler: None,
            scaler_input_format,
            scaler_input_width,
            scaler_input_height,
            yuv_scaler: None,
            yuv_scaler_input_format: ffmpeg::format::Pixel::None,
            yuv_scaler_input_width: 0,
            yuv_scaler_input_height: 0,
            stream_index,
            stream_time_base,
            start_time_sec,
            eof_sent: false,
            seek_target: None,
            hwaccel,
            last_pts_sec: 0.0,
        })
    }

    /// FPS used to compute the frame-accurate seek tolerance; guarded against zero/invalid values.
    pub(crate) fn effective_fps(&self) -> f64 {
        self.info.effective_fps()
    }

    /// PTS of the decoded frame in 0-based (timeline-relative) seconds. The
    /// container's stream start time is subtracted so a file that begins at a
    /// non-zero PTS still reports its first frame at ~0s.
    ///
    /// A frame with no PTS at all (rare malformed/streamed source) would otherwise
    /// report a bogus `0.0` regardless of decode position — after a seek to `t > 0`
    /// this makes the frame permanently look "before the seek target" (dropped
    /// forever in the skip path, or cached under key 0 as a false floor-frame in the
    /// keep-preseek path). Fall back to one frame past the last known PTS instead, so
    /// the decoder's forward-progress accounting stays monotonic.
    fn frame_pts_sec(&mut self, decoded: &ffmpeg::util::frame::Video) -> f64 {
        let pts_sec = decoded
            .timestamp()
            .or_else(|| decoded.pts())
            .map(|pts| pts as f64 * rational_as_f64(self.stream_time_base) - self.start_time_sec)
            .unwrap_or_else(|| {
                let fallback = self.last_pts_sec + 1.0 / self.effective_fps();
                log::warn!(
                    "[native-media] decoded frame with no PTS for {}, using fallback {fallback:.6}s",
                    self.path.display()
                );
                fallback
            });
        self.last_pts_sec = pts_sec;
        pts_sec
    }

    fn decode_frame(&mut self, decoded: &mut ffmpeg::util::frame::Video) -> Result<VideoFrame> {
        // If the decoder produced a hardware frame, download it to system memory first.
        let sw_frame = if let Some(ref ctx) = self.hwaccel {
            try_transfer_to_cpu(decoded, ctx)?
        } else {
            None
        };
        let decoded = if let Some(ref sw) = sw_frame {
            sw
        } else {
            decoded
        };

        if self.scaler.is_none()
            || decoded.format() != self.scaler_input_format
            || decoded.width() != self.scaler_input_width
            || decoded.height() != self.scaler_input_height
        {
            log::info!(
                "[native-media] scaler input parameters changed ({:?}, {}x{}) -> ({:?}, {}x{}); recreating scaler",
                self.scaler_input_format,
                self.scaler_input_width,
                self.scaler_input_height,
                decoded.format(),
                decoded.width(),
                decoded.height()
            );
            self.scaler = Some(
                ffmpeg::software::scaling::Context::get(
                    decoded.format(),
                    decoded.width(),
                    decoded.height(),
                    ffmpeg::format::Pixel::RGBA,
                    self.info.width,
                    self.info.height,
                    ffmpeg::software::scaling::flag::Flags::BILINEAR,
                )
                .context("failed to recreate ffmpeg-next scaler")?,
            );
            self.scaler_input_format = decoded.format();
            self.scaler_input_width = decoded.width();
            self.scaler_input_height = decoded.height();
        }

        let mut rgba = ffmpeg::util::frame::Video::empty();
        self.scaler
            .as_mut()
            .context("RGBA scaler missing")?
            .run(decoded, &mut rgba)
            .context("failed to scale decoded video frame to RGBA")?;

        let coded_width = rgba.width();
        let coded_height = rgba.height();
        let row_bytes = coded_width as usize * 4;
        let mut pixels = vec![0u8; row_bytes * coded_height as usize];
        for row in 0..coded_height as usize {
            let src_start = row * rgba.stride(0);
            let dst_start = row * row_bytes;
            pixels[dst_start..dst_start + row_bytes]
                .copy_from_slice(&rgba.data(0)[src_start..src_start + row_bytes]);
        }

        let pts_sec = self.frame_pts_sec(decoded);

        Ok(VideoFrame {
            width: coded_width,
            height: coded_height,
            pixels,
            yuv: None,
            pts_sec,
            texture: None,
        })
    }

    fn decode_frame_for_gpu(
        &mut self,
        decoded_frame: &mut ffmpeg::util::frame::Video,
    ) -> Result<VideoFrame> {
        let sw_frame = if let Some(ref ctx) = self.hwaccel {
            try_transfer_to_cpu(decoded_frame, ctx)?
        } else {
            None
        };
        let decoded: &ffmpeg::util::frame::Video = if let Some(ref sw) = sw_frame {
            sw
        } else {
            &*decoded_frame
        };

        if !is_supported_yuv_fast_path(decoded.format()) {
            return self.decode_frame(decoded_frame);
        }

        let color = yuv_color(decoded);
        let (width, height, yuv) =
            if decoded.width() == self.info.width && decoded.height() == self.info.height {
                match decoded.format() {
                    ffmpeg::format::Pixel::NV12 => (
                        decoded.width(),
                        decoded.height(),
                        copy_nv12_frame(decoded, color),
                    ),
                    ffmpeg::format::Pixel::YUV420P | ffmpeg::format::Pixel::YUVJ420P => (
                        decoded.width(),
                        decoded.height(),
                        copy_yuv420p_as_nv12_frame(decoded, color),
                    ),
                    _ => return self.decode_frame(decoded_frame),
                }
            } else {
                let mut scaled = ffmpeg::util::frame::Video::empty();
                if self.yuv_scaler.is_none()
                    || decoded.format() != self.yuv_scaler_input_format
                    || decoded.width() != self.yuv_scaler_input_width
                    || decoded.height() != self.yuv_scaler_input_height
                {
                    self.yuv_scaler = Some(
                        ffmpeg::software::scaling::Context::get(
                            decoded.format(),
                            decoded.width(),
                            decoded.height(),
                            ffmpeg::format::Pixel::NV12,
                            self.info.width,
                            self.info.height,
                            ffmpeg::software::scaling::flag::Flags::BILINEAR,
                        )
                        .context("failed to create ffmpeg-next YUV scaler")?,
                    );
                    self.yuv_scaler_input_format = decoded.format();
                    self.yuv_scaler_input_width = decoded.width();
                    self.yuv_scaler_input_height = decoded.height();
                }
                self.yuv_scaler
                    .as_mut()
                    .context("YUV scaler missing")?
                    .run(decoded, &mut scaled)
                    .context("failed to scale decoded video frame to NV12")?;
                if scaled.format() != ffmpeg::format::Pixel::NV12 {
                    return self.decode_frame(decoded_frame);
                }
                (
                    scaled.width(),
                    scaled.height(),
                    copy_nv12_frame(&scaled, color),
                )
            };

        Ok(VideoFrame {
            width,
            height,
            pixels: Vec::new(),
            yuv: Some(yuv),
            pts_sec: self.frame_pts_sec(decoded),
            texture: None,
        })
    }

    /// Core decode loop.
    ///
    /// `prefer_yuv` — pass YUV planes instead of scaling to RGBA when the GPU pipeline is active.
    /// `keep_preseek` — when `true`, intra-GOP frames that are chronologically *before* the active
    ///   seek target are returned to the caller instead of being silently discarded. This lets the
    ///   warm-up path opportunistically cache GOP-interior frames (backward-scrub without re-seek).
    fn next_frame_with_mode(
        &mut self,
        prefer_yuv: bool,
        keep_preseek: bool,
    ) -> Result<Option<VideoFrame>> {
        loop {
            let mut decoded = ffmpeg::util::frame::Video::empty();
            match self.decoder.receive_frame(&mut decoded) {
                Ok(()) => {
                    // Frame-accurate seek: after jumping to the key frame, skip (or optionally
                    // keep) frames that lag behind the target by more than half a frame.
                    if let Some(target) = self.seek_target {
                        let tolerance = 0.5 / self.effective_fps();
                        if self.frame_pts_sec(&decoded) < target - tolerance {
                            if keep_preseek {
                                // Emit this pre-seek frame so the caller can cache it —
                                // do NOT clear seek_target yet; we haven't reached target.
                                return if prefer_yuv {
                                    self.decode_frame_for_gpu(&mut decoded).map(Some)
                                } else {
                                    self.decode_frame(&mut decoded).map(Some)
                                };
                            }
                            continue;
                        }
                        self.seek_target = None;
                    }
                    return if prefer_yuv {
                        self.decode_frame_for_gpu(&mut decoded).map(Some)
                    } else {
                        self.decode_frame(&mut decoded).map(Some)
                    };
                }
                Err(ffmpeg::Error::Other { errno }) if errno == ffmpeg::error::EAGAIN => {}
                Err(ffmpeg::Error::Eof) => {
                    self.seek_target = None;
                    return Ok(None);
                }
                Err(error) => return Err(error).context("failed to receive ffmpeg-next frame"),
            }

            if self.eof_sent {
                return Ok(None);
            }

            let mut packet = None;
            for (stream, next_packet) in self.ictx.packets() {
                if stream.index() == self.stream_index {
                    packet = Some(next_packet);
                    break;
                }
            }

            if let Some(packet) = packet {
                self.decoder
                    .send_packet(&packet)
                    .context("failed to send packet to ffmpeg-next decoder")?;
            } else {
                self.decoder
                    .send_eof()
                    .context("failed to send EOF to ffmpeg-next decoder")?;
                self.eof_sent = true;
            }
        }
    }
}

impl VideoDecoder for FfmpegNextDecoder {
    fn info(&self) -> &MediaInfo {
        &self.info
    }

    fn seek(&mut self, time_sec: f64) -> Result<()> {
        let target = time_sec.max(0.0);
        // `avformat_seek_file` (stream index -1) takes an absolute timestamp in
        // AV_TIME_BASE units, so add the stream start offset back: the caller works
        // in 0-based seconds but the container's frames live at `start + target`.
        let absolute = target + self.start_time_sec;
        let ts = (absolute * 1_000_000.0).round() as i64;
        self.ictx.seek(ts, ..ts).with_context(|| {
            format!(
                "failed to seek ffmpeg-next decoder for {}",
                self.path.display()
            )
        })?;
        self.decoder.flush();
        self.eof_sent = false;
        // libav lands on the nearest key frame ≤ target; remember the target so that
        // `next_frame` decodes and discards intra-GOP frames until the requested position.
        self.seek_target = Some(target);
        Ok(())
    }

    fn next_frame(&mut self) -> Result<Option<VideoFrame>> {
        self.next_frame_with_mode(false, false)
    }

    fn next_frame_for_gpu(&mut self) -> Result<Option<VideoFrame>> {
        self.next_frame_with_mode(true, false)
    }

    fn next_frame_keep_preseek(&mut self) -> Result<Option<VideoFrame>> {
        self.next_frame_with_mode(false, true)
    }

    fn next_frame_keep_preseek_for_gpu(&mut self) -> Result<Option<VideoFrame>> {
        self.next_frame_with_mode(true, true)
    }
}

/// Real implementation backed by `ffmpeg-next`.
pub struct FfmpegNextDecoderFactory;

impl VideoDecoderFactory for FfmpegNextDecoderFactory {
    fn open(
        &self,
        path: &Path,
        max_output_long_edge: Option<u32>,
        hw_mode: HwAccelMode,
        vaapi_device: Option<&str>,
    ) -> Result<Box<dyn VideoDecoder>> {
        Ok(Box::new(FfmpegNextDecoder::open(
            path,
            max_output_long_edge,
            hw_mode,
            vaapi_device,
        )?))
    }
}
