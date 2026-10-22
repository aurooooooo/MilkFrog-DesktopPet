use std::{cell::UnsafeCell, mem::size_of, ptr};
use windows::{core::PSTR, Win32::Media::Audio::*};

pub const TAP: &[u8] = include_bytes!("../assets/keyboard-tap.wav");
pub const CLICK: &[u8] = include_bytes!("../assets/click-laugh.wav");
pub const LAUGH: &[u8] = include_bytes!("../assets/laugh.wav");
pub const VOICES: [&[u8]; 4] = [
    include_bytes!("../assets/gagadilaxia.wav"),
    include_bytes!("../assets/gajiaosei.wav"),
    include_bytes!("../assets/ganbadie.wav"),
    include_bytes!("../assets/andi.wav"),
];

fn pcm(bytes: &'static [u8]) -> Option<&'static [u8]> {
    if bytes.get(..4)? != b"RIFF" || bytes.get(8..12)? != b"WAVE" {
        return None;
    }
    let mut i = 12;
    while i + 8 <= bytes.len() {
        let n = u32::from_le_bytes(bytes[i + 4..i + 8].try_into().ok()?) as usize;
        let chunk = bytes.get(i + 8..i + 8 + n)?;
        if &bytes[i..i + 4] == b"fmt "
            && (chunk.len() < 16
                || chunk[0..2] != [1, 0]
                || chunk[2..4] != [1, 0]
                || chunk[4..8] != 24000u32.to_le_bytes()
                || chunk[14..16] != [16, 0])
        {
            return None;
        }
        if &bytes[i..i + 4] == b"data" {
            return Some(chunk);
        }
        i += 8 + n + (n % 2);
    }
    None
}
// The header address and PCM bytes stay alive until waveOutReset completes.
pub struct Sound {
    device: HWAVEOUT,
    header: Box<UnsafeCell<WAVEHDR>>,
    _silent_pcm: Option<Box<[u8]>>,
}
impl Sound {
    pub fn play(bytes: &'static [u8], silent: bool) -> Result<Self, String> {
        Self::play_from(bytes, silent, 0.)
    }
    pub fn play_from(bytes: &'static [u8], silent: bool, seconds: f64) -> Result<Self, String> {
        unsafe {
            let data = pcm(bytes).ok_or("Invalid embedded PCM")?;
            let offset = ((seconds.max(0.) * 24000.) as usize)
                .saturating_mul(2)
                .min(data.len());
            let data = &data[offset..];
            if data.is_empty() {
                return Err("Audio has ended".into());
            }
            let silent_pcm = if silent {
                Some(vec![0u8; data.len()].into_boxed_slice())
            } else {
                None
            };
            let data = silent_pcm.as_deref().unwrap_or(data);
            let format = WAVEFORMATEX {
                wFormatTag: 1,
                nChannels: 1,
                nSamplesPerSec: 24000,
                nAvgBytesPerSec: 48000,
                nBlockAlign: 2,
                wBitsPerSample: 16,
                cbSize: 0,
            };
            let mut device = HWAVEOUT::default();
            if waveOutOpen(
                Some(&mut device),
                u32::MAX,
                &format,
                0,
                0,
                WAVE_FORMAT_DIRECT,
            ) != 0
            {
                return Err("Windows audio device unavailable".into());
            }
            let header = Box::new(UnsafeCell::new(WAVEHDR {
                lpData: PSTR(data.as_ptr() as *mut u8),
                dwBufferLength: data.len() as u32,
                ..Default::default()
            }));
            let n = size_of::<WAVEHDR>() as u32;
            if waveOutPrepareHeader(device, header.get(), n) != 0 {
                let _ = waveOutClose(device);
                return Err("Unable to prepare audio".into());
            }
            let sound = Self {
                device,
                header,
                _silent_pcm: silent_pcm,
            };
            if waveOutWrite(device, sound.header.get(), n) != 0 {
                return Err("Unable to play audio".into());
            }
            Ok(sound)
        }
    }
    pub fn done(&self) -> bool {
        unsafe { ptr::read_volatile(ptr::addr_of!((*self.header.get()).dwFlags)) & WHDR_DONE != 0 }
    }
}
impl Drop for Sound {
    fn drop(&mut self) {
        unsafe {
            waveOutReset(self.device);
            waveOutUnprepareHeader(self.device, self.header.get(), size_of::<WAVEHDR>() as u32);
            waveOutClose(self.device);
        }
    }
}
#[derive(Default)]
pub struct Audio {
    pub keyboard: Option<Sound>,
    pub effect: Option<Sound>,
    pub muted: bool,
    pub silent: bool,
}
impl Audio {
    pub fn poll(&mut self) {
        if self.keyboard.as_ref().is_some_and(Sound::done) {
            self.keyboard = None;
        }
        if self.effect.as_ref().is_some_and(Sound::done) {
            self.effect = None;
        }
    }
    pub fn tap(&mut self) {
        if !self.muted && self.keyboard.is_none() {
            self.keyboard = Sound::play(TAP, self.silent).ok();
        }
    }
    pub fn effect(&mut self, bytes: &'static [u8]) {
        self.effect_at(bytes, 0.);
    }
    pub fn effect_at(&mut self, bytes: &'static [u8], seconds: f64) {
        self.effect = None;
        if !self.muted {
            self.effect = Sound::play_from(bytes, self.silent, seconds).ok();
        }
    }
    pub fn stop(&mut self) {
        self.keyboard = None;
        self.effect = None;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn all_assets_are_native_pcm() {
        for bytes in [TAP, CLICK, LAUGH].into_iter().chain(VOICES) {
            assert!(!pcm(bytes).unwrap().is_empty());
        }
    }
}
