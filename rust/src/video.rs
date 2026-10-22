use std::{path::Path, time::Instant};
use tiny_skia::Pixmap;
use windows::{
    core::{Interface, PCWSTR},
    Win32::Media::MediaFoundation::*,
};

// Windows H.264 decoder reads one frame at a time. The second half contains
// the alpha channel, so no video-sized frame cache or browser is needed.
pub struct Video {
    reader: IMFSourceReader,
    pub frame: Pixmap,
    pub started: Instant,
    next_time: i64,
    pub frames: u32,
    stride: i32,
}
impl Video {
    pub unsafe fn open(path: &Path) -> windows::core::Result<Self> {
        let mut attr = None;
        MFCreateAttributes(&mut attr, 2)?;
        let attr = attr.unwrap();
        attr.SetUINT32(&MF_SOURCE_READER_ENABLE_VIDEO_PROCESSING, 1)?;
        let wide: Vec<u16> = path
            .as_os_str()
            .to_string_lossy()
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let reader = MFCreateSourceReaderFromURL(PCWSTR(wide.as_ptr()), &attr)?;
        reader.SetStreamSelection(MF_SOURCE_READER_ALL_STREAMS.0 as u32, false)?;
        reader.SetStreamSelection(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32, true)?;
        let media = MFCreateMediaType()?;
        media.SetGUID(&MF_MT_MAJOR_TYPE, &MFMediaType_Video)?;
        media.SetGUID(&MF_MT_SUBTYPE, &MFVideoFormat_RGB32)?;
        reader.SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32, None, &media)?;
        let media = reader.GetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32)?;
        let size = media.GetUINT64(&MF_MT_FRAME_SIZE)?;
        let (w, h) = ((size >> 32) as u32, size as u32);
        if w != 896 || h != 576 {
            return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                0x8007000du32 as i32,
            )));
        }
        let stride = media.GetUINT32(&MF_MT_DEFAULT_STRIDE).unwrap_or(w * 4) as i32;
        Ok(Self {
            reader,
            frame: Pixmap::new(w / 2, h).unwrap(),
            started: Instant::now(),
            next_time: 0,
            frames: 0,
            stride,
        })
    }
    pub unsafe fn tick(&mut self) -> windows::core::Result<Option<bool>> {
        if self.started.elapsed().as_nanos() / 100 < self.next_time.max(0) as u128 {
            return Ok(Some(false));
        }
        let mut flags = 0;
        let mut sample = None;
        let mut stamp = 0;
        self.reader.ReadSample(
            MF_SOURCE_READER_FIRST_VIDEO_STREAM.0 as u32,
            0,
            None,
            Some(&mut flags),
            Some(&mut stamp),
            Some(&mut sample),
        )?;
        if flags & MF_SOURCE_READERF_ENDOFSTREAM.0 as u32 != 0 {
            return Ok(None);
        }
        let Some(sample) = sample else {
            return Ok(Some(false));
        };
        let buffer = sample.ConvertToContiguousBuffer()?;
        // IMF2DBuffer exposes the real scanline direction, including bottom-up RGB.
        if let Ok(two) = buffer.cast::<IMF2DBuffer>() {
            let mut first = std::ptr::null_mut();
            let mut pitch = 0;
            two.Lock2D(&mut first, &mut pitch)?;
            self.copy_frame(first, pitch);
            two.Unlock2D()?;
        } else {
            let mut data = std::ptr::null_mut();
            let mut length = 0;
            buffer.Lock(&mut data, None, Some(&mut length))?;
            if length >= 896 * 576 * 4 {
                let first = if self.stride < 0 {
                    data.offset((575 * (-self.stride)) as isize)
                } else {
                    data
                };
                self.copy_frame(first, self.stride);
            }
            buffer.Unlock()?;
        }
        self.frames += 1;
        self.next_time = stamp + 10_000_000 / 24;
        Ok(Some(true))
    }
    unsafe fn copy_frame(&mut self, first: *const u8, pitch: i32) {
        for y in 0..576usize {
            let row =
                std::slice::from_raw_parts(first.offset(y as isize * pitch as isize), 896 * 4);
            let dest = &mut self.frame.data_mut()[y * 448 * 4..(y + 1) * 448 * 4];
            for x in 0..448usize {
                let a = row[(x + 448) * 4 + 1] as u16;
                let a = if a <= 3 { 0 } else { a };
                dest[x * 4] = (row[x * 4 + 2] as u16 * a / 255) as u8;
                dest[x * 4 + 1] = (row[x * 4 + 1] as u16 * a / 255) as u8;
                dest[x * 4 + 2] = (row[x * 4] as u16 * a / 255) as u8;
                dest[x * 4 + 3] = a as u8;
            }
        }
    }
}
