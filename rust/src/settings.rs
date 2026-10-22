use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use windows::{
    core::{w, PCWSTR},
    Win32::{Foundation::*, System::Registry::*},
};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(default, rename_all = "camelCase")]
pub struct Settings {
    pub scale: f32,
    pub muted: bool,
    pub accessory: Option<String>,
    pub game_mode: bool,
}
impl Default for Settings {
    fn default() -> Self {
        Self {
            scale: 0.65,
            muted: false,
            accessory: None,
            game_mode: false,
        }
    }
}
impl Settings {
    pub fn normalize(&mut self) {
        self.scale = if self.scale.is_finite() {
            self.scale.clamp(0.15, 1.35)
        } else {
            0.65
        };
        if !matches!(
            self.accessory.as_deref(),
            Some("eyePatch" | "angry" | "meow")
        ) {
            self.accessory = None;
        }
    }
    pub fn accessory_id(&self) -> u8 {
        match self.accessory.as_deref() {
            Some("eyePatch") => 1,
            Some("angry") => 2,
            Some("meow") => 3,
            _ => 0,
        }
    }
    pub fn set_accessory(&mut self, id: u8) {
        self.accessory = match id {
            1 => Some("eyePatch".into()),
            2 => Some("angry".into()),
            3 => Some("meow".into()),
            _ => None,
        };
    }
    pub fn load(test: bool) -> Self {
        let path = dir(test).join("settings.json");
        let mut paths = vec![path];
        if !test {
            if let Some(appdata) = std::env::var_os("APPDATA") {
                for name in ["MilkFrog DesktopPet", "milkfrog-desktop-pet"] {
                    paths.push(PathBuf::from(&appdata).join(name).join("settings.json"));
                }
            }
        }
        for path in paths {
            if let Ok(bytes) = fs::read(path) {
                if let Ok(mut s) = serde_json::from_slice::<Self>(&bytes) {
                    s.normalize();
                    return s;
                }
            }
        }
        Self::default()
    }
    pub fn save(&self, test: bool) -> std::io::Result<()> {
        let folder = dir(test);
        fs::create_dir_all(&folder)?;
        let bytes = serde_json::to_vec_pretty(self)?;
        let temp = folder.join("settings.json.tmp");
        fs::write(&temp, bytes)?;
        // MoveFileEx replaces an existing file atomically on the same Windows volume.
        use windows::Win32::Storage::FileSystem::{
            MoveFileExW, MOVEFILE_REPLACE_EXISTING, MOVEFILE_WRITE_THROUGH,
        };
        unsafe {
            MoveFileExW(
                PCWSTR(wide(temp.to_string_lossy().as_ref()).as_ptr()),
                PCWSTR(wide(folder.join("settings.json").to_string_lossy().as_ref()).as_ptr()),
                MOVEFILE_REPLACE_EXISTING | MOVEFILE_WRITE_THROUGH,
            )
            .map_err(std::io::Error::other)
        }
    }
}
pub fn dir(test: bool) -> PathBuf {
    if test {
        return std::env::current_dir()
            .unwrap()
            .join(".test-artifacts/rust");
    }
    PathBuf::from(std::env::var_os("APPDATA").unwrap_or_else(|| std::env::temp_dir().into()))
        .join("MilkFrogRust")
}
pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}
const RUN: PCWSTR = w!("Software\\Microsoft\\Windows\\CurrentVersion\\Run");
const APPROVED: PCWSTR =
    w!("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run");
const LOGIN: PCWSTR = w!("MilkFrog DesktopPet");
pub unsafe fn auto_start() -> bool {
    let mut buffer = [0u16; 2048];
    let mut bytes = std::mem::size_of_val(&buffer) as u32;
    if RegGetValueW(
        HKEY_CURRENT_USER,
        RUN,
        LOGIN,
        RRF_RT_REG_SZ,
        None,
        Some(buffer.as_mut_ptr().cast()),
        Some(&mut bytes),
    ) != ERROR_SUCCESS
    {
        return false;
    }
    let actual = String::from_utf16_lossy(
        &buffer[..buffer.iter().position(|&c| c == 0).unwrap_or(buffer.len())],
    );
    let expected = format!(
        "\"{}\"",
        std::env::current_exe().unwrap_or_default().display()
    );
    if !actual.eq_ignore_ascii_case(&expected) {
        return false;
    }
    let mut approved = [0u8; 32];
    let mut length = approved.len() as u32;
    let result = RegGetValueW(
        HKEY_CURRENT_USER,
        APPROVED,
        LOGIN,
        RRF_RT_REG_BINARY,
        None,
        Some(approved.as_mut_ptr().cast()),
        Some(&mut length),
    );
    result != ERROR_SUCCESS || !matches!(approved[0], 3 | 7)
}
pub unsafe fn set_auto_start(enabled: bool) -> Result<(), String> {
    let mut key = HKEY::default();
    RegCreateKeyExW(
        HKEY_CURRENT_USER,
        RUN,
        0,
        PCWSTR::null(),
        REG_OPTION_NON_VOLATILE,
        KEY_SET_VALUE,
        None,
        &mut key,
        None,
    )
    .ok()
    .map_err(|e| e.to_string())?;
    let result = if enabled {
        let text = wide(&format!(
            "\"{}\"",
            std::env::current_exe()
                .map_err(|e| e.to_string())?
                .display()
        ));
        let bytes = std::slice::from_raw_parts(text.as_ptr().cast(), text.len() * 2);
        RegSetValueExW(key, LOGIN, 0, REG_SZ, Some(bytes))
    } else {
        RegDeleteValueW(key, LOGIN)
    };
    let _ = RegCloseKey(key);
    if result != ERROR_SUCCESS && (result != ERROR_FILE_NOT_FOUND || enabled) {
        return Err(format!("Windows startup error: {}", result.0));
    }
    if enabled && !auto_start() {
        return Err("Windows 已禁用此启动项，请在任务管理器的‘启动应用’中启用。".into());
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn validated_old_settings() {
        let mut s: Settings = serde_json::from_str(
            r#"{"scale":0.01,"muted":true,"accessory":"meow","gameMode":true,"settingsVersion":2}"#,
        )
        .unwrap();
        s.normalize();
        assert_eq!(s.scale, 0.15);
        assert_eq!(s.accessory_id(), 3);
        assert!(s.game_mode);
        s.scale = 2.;
        s.normalize();
        assert_eq!(s.scale, 1.35);
    }
}
