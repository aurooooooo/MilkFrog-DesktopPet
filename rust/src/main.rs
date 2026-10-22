#![cfg_attr(not(test), windows_subsystem = "windows")]
mod audio;
mod rig;
mod settings;
mod verify;
mod video;

use rig::{Input, Rig};
use settings::{wide, Settings};
use std::{cell::RefCell, collections::VecDeque, mem::size_of, ptr, time::Instant};
use windows::{
    core::{w, PCWSTR},
    Win32::{
        Foundation::*,
        Graphics::Gdi::*,
        Media::MediaFoundation::*,
        System::{Com::*, LibraryLoader::*, Threading::*},
        UI::{HiDpi::*, Input::KeyboardAndMouse::*, Shell::*, WindowsAndMessaging::*},
    },
};

const CLASS: PCWSTR = w!("MilkFrog.Native.Window");
const TRAY: u32 = WM_APP + 1;
const SHOW: u32 = WM_APP + 2;
const TIMER: usize = 1;
const PRESETS: [u16; 9] = [15, 20, 25, 35, 50, 65, 80, 100, 135];
enum Event {
    Tick,
    Menu(bool),
    Down,
    Move,
    Up,
    Escape,
    Show,
    Hide,
    Resize,
    Quit,
}
thread_local! {static EVENTS:RefCell<VecDeque<Event>>=const{RefCell::new(VecDeque::new())};}
fn push(event: Event) {
    EVENTS.with(|q| {
        let mut q = q.borrow_mut();
        if matches!(event, Event::Tick) && q.iter().any(|e| matches!(e, Event::Tick)) {
            return;
        }
        q.push_back(event);
    });
}
unsafe extern "system" fn wndproc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match msg {
        WM_TIMER => push(Event::Tick),
        WM_CONTEXTMENU => push(Event::Menu(false)),
        WM_LBUTTONDOWN => {
            let _ = SetCapture(hwnd);
            push(Event::Down);
        }
        WM_MOUSEMOVE => push(Event::Move),
        WM_LBUTTONUP => {
            let _ = ReleaseCapture();
            push(Event::Up);
        }
        WM_CAPTURECHANGED => push(Event::Up),
        WM_KEYDOWN if wp.0 == 27 => push(Event::Escape),
        WM_CLOSE => push(Event::Quit),
        WM_DPICHANGED | WM_DISPLAYCHANGE => push(Event::Resize),
        WM_SIZE if wp.0 == SIZE_MINIMIZED as usize => push(Event::Hide),
        SHOW => push(Event::Show),
        TRAY => match lp.0 as u32 {
            WM_RBUTTONUP | WM_CONTEXTMENU => push(Event::Menu(true)),
            WM_LBUTTONDBLCLK => push(Event::Show),
            _ => {}
        },
        WM_DESTROY => PostQuitMessage(0),
        _ => return DefWindowProcW(hwnd, msg, wp, lp),
    }
    LRESULT(0)
}

struct Surface {
    dc: HDC,
    bitmap: HBITMAP,
    old: HGDIOBJ,
    bits: *mut u8,
    w: u32,
    h: u32,
}
impl Surface {
    unsafe fn new(w: u32, h: u32) -> Result<Self, String> {
        let dc = CreateCompatibleDC(None);
        if dc.is_invalid() {
            return Err("Unable to create drawing context".into());
        }
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w as i32,
                biHeight: -(h as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits = ptr::null_mut();
        let bitmap = match CreateDIBSection(dc, &info, DIB_RGB_COLORS, &mut bits, None, 0) {
            Ok(b) => b,
            Err(e) => {
                let _ = DeleteDC(dc);
                return Err(e.to_string());
            }
        };
        let old = SelectObject(dc, bitmap);
        Ok(Self {
            dc,
            bitmap,
            old,
            bits: bits.cast(),
            w,
            h,
        })
    }
    unsafe fn present(&mut self, hwnd: HWND, rgba: &[u8]) -> Result<(), String> {
        let dest = std::slice::from_raw_parts_mut(self.bits, (self.w * self.h * 4) as usize);
        for (s, d) in rgba.chunks_exact(4).zip(dest.chunks_exact_mut(4)) {
            d.copy_from_slice(&[s[2], s[1], s[0], s[3]]);
        }
        let blend = BLENDFUNCTION {
            BlendOp: AC_SRC_OVER as u8,
            BlendFlags: 0,
            SourceConstantAlpha: 255,
            AlphaFormat: AC_SRC_ALPHA as u8,
        };
        UpdateLayeredWindow(
            hwnd,
            None,
            None,
            Some(&SIZE {
                cx: self.w as i32,
                cy: self.h as i32,
            }),
            self.dc,
            Some(&POINT::default()),
            COLORREF(0),
            Some(&blend),
            ULW_ALPHA,
        )
        .map_err(|e| e.to_string())
    }
}
impl Drop for Surface {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.old);
            let _ = DeleteObject(self.bitmap);
            let _ = DeleteDC(self.dc);
        }
    }
}

struct App {
    hwnd: HWND,
    icon: HICON,
    settings: Settings,
    rig: Rig,
    surface: Surface,
    input: Input,
    audio: audio::Audio,
    video: Option<video::Video>,
    mf_started: bool,
    visible: bool,
    test: bool,
    dirty: bool,
    animating: bool,
    last: Instant,
    drag: Option<(POINT, bool)>,
    voice_seed: u64,
    taskbar_created: u32,
}
impl App {
    unsafe fn new(test: bool) -> Result<Self, String> {
        let instance = GetModuleHandleW(None).map_err(|e| e.to_string())?;
        let icon = LoadIconW(instance, PCWSTR(1usize as *const u16)).map_err(|e| e.to_string())?;
        let class = WNDCLASSW {
            lpfnWndProc: Some(wndproc),
            hInstance: instance.into(),
            lpszClassName: CLASS,
            hIcon: icon,
            hCursor: LoadCursorW(None, IDC_ARROW).unwrap_or_default(),
            ..Default::default()
        };
        RegisterClassW(&class);
        let settings = if test {
            Settings::default()
        } else {
            Settings::load(false)
        };
        let dpi = GetDpiForSystem() as f32 / 96.;
        let width = (960. * settings.scale * dpi).round() as u32;
        let height = (640. * settings.scale * dpi).round() as u32;
        let work = monitor_work(POINT::default());
        let hwnd = CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW,
            CLASS,
            w!("MilkFrog 奶蛙 · Rust"),
            WS_POPUP,
            work.right - width as i32 - 24,
            work.bottom - height as i32 - 24,
            width as i32,
            height as i32,
            None,
            None,
            instance,
            None,
        )
        .map_err(|e| e.to_string())?;
        let mut app = Self {
            hwnd,
            icon,
            settings,
            rig: Rig::new(width, height),
            surface: Surface::new(width, height)?,
            input: Input::default(),
            audio: audio::Audio::default(),
            video: None,
            mf_started: false,
            visible: true,
            test,
            dirty: true,
            animating: true,
            last: Instant::now(),
            drag: None,
            voice_seed: std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos() as u64
                | 1,
            taskbar_created: RegisterWindowMessageW(w!("TaskbarCreated")),
        };
        app.audio.muted = app.settings.muted;
        app.audio.silent = test;
        app.rig.accessory(app.settings.accessory_id());
        app.game_mode();
        app.render()?;
        if !test {
            app.tray(NIM_ADD);
            let _ = ShowWindow(hwnd, SW_SHOWNOACTIVATE);
            SetTimer(hwnd, TIMER, 28, None);
        }
        Ok(app)
    }
    fn save(&self) {
        if let Err(e) = self.settings.save(self.test) {
            self.error(&format!("无法保存设置：{e}"));
        }
    }
    fn error(&self, text: &str) {
        if self.test {
            eprintln!("{text}");
        } else {
            unsafe {
                MessageBoxW(
                    self.hwnd,
                    PCWSTR(wide(text).as_ptr()),
                    w!("MilkFrog"),
                    MB_OK | MB_ICONERROR,
                );
            }
        }
    }
    unsafe fn tray(&self, action: NOTIFY_ICON_MESSAGE) {
        let mut data = NOTIFYICONDATAW {
            cbSize: size_of::<NOTIFYICONDATAW>() as u32,
            hWnd: self.hwnd,
            uID: 1,
            uFlags: NIF_ICON | NIF_MESSAGE | NIF_TIP,
            uCallbackMessage: TRAY,
            hIcon: self.icon,
            ..Default::default()
        };
        let tip = wide("MilkFrog 奶蛙 · Rust");
        data.szTip[..tip.len()].copy_from_slice(&tip);
        let _ = Shell_NotifyIconW(action, &data);
    }
    unsafe fn game_mode(&self) {
        let mut style = WS_EX_LAYERED | WS_EX_TOPMOST | WS_EX_TOOLWINDOW;
        if self.settings.game_mode {
            style |= WS_EX_TRANSPARENT | WS_EX_NOACTIVATE;
        }
        SetWindowLongPtrW(self.hwnd, GWL_EXSTYLE, style.0 as isize);
        let _ = SetWindowPos(
            self.hwnd,
            HWND_TOPMOST,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
    unsafe fn scale(&mut self, scale: f32) -> Result<(), String> {
        self.settings.scale = if scale.is_finite() {
            scale.clamp(0.15, 1.35)
        } else {
            0.65
        };
        let dpi = GetDpiForWindow(self.hwnd).max(96) as f32 / 96.;
        let (w, h) = (
            (960. * self.settings.scale * dpi).round() as u32,
            (640. * self.settings.scale * dpi).round() as u32,
        );
        let surface = Surface::new(w, h)?;
        let mut bounds = RECT::default();
        GetWindowRect(self.hwnd, &mut bounds).map_err(|e| e.to_string())?;
        self.surface = surface;
        self.rig.resize(w, h);
        let p = keep_in_work(
            POINT {
                x: bounds.left,
                y: bounds.top,
            },
            w as i32,
            h as i32,
        );
        let _ = SetWindowPos(
            self.hwnd,
            HWND_TOPMOST,
            p.x,
            p.y,
            w as i32,
            h as i32,
            SWP_NOACTIVATE,
        );
        self.render()?;
        self.save();
        Ok(())
    }
    unsafe fn render(&mut self) -> Result<(), String> {
        if let Some(video) = &self.video {
            self.rig.draw_video(&video.frame);
        } else {
            self.rig.draw(&self.input);
        }
        self.dirty = false;
        self.surface.present(self.hwnd, self.rig.canvas.data())
    }
    unsafe fn stop_media(&mut self) {
        self.video = None;
        self.audio.stop();
        if self.mf_started {
            let _ = MFShutdown();
            self.mf_started = false;
        }
        self.dirty = true;
        self.animating = true;
    }
    unsafe fn laugh(&mut self) -> Result<(), String> {
        if self.video.is_some() {
            self.stop_media();
            return Ok(());
        }
        self.audio.stop();
        let folder = settings::dir(self.test);
        std::fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let file = folder.join("laugh-0.4.0.mp4");
        let bytes = include_bytes!("../assets/laugh-packed.mp4");
        if std::fs::read(&file).ok().as_deref() != Some(bytes.as_slice()) {
            std::fs::write(&file, bytes).map_err(|e| e.to_string())?;
        }
        MFStartup(MF_VERSION, MFSTARTUP_FULL).map_err(|e| e.to_string())?;
        self.mf_started = true;
        match video::Video::open(&file) {
            Ok(mut video) => {
                video.tick().map_err(|e| e.to_string())?;
                self.video = Some(video);
                self.audio.effect(audio::LAUGH);
                self.render()?;
                Ok(())
            }
            Err(e) => {
                self.stop_media();
                Err(format!(
                    "无法播放大笑视频：{e}。请确认 Windows 已启用媒体功能。"
                ))
            }
        }
    }
    fn update_key(&mut self, vk: u16, down: bool) {
        if self.input.key(vk, down) {
            self.dirty = true;
            self.animating = true;
        }
    }
    unsafe fn poll_input(&mut self) {
        for vk in rig::KEYS {
            let down = GetAsyncKeyState(vk as i32) as u16 & 0x8000 != 0;
            self.update_key(vk, down);
        }
        for (i, vk) in [1, 2].into_iter().enumerate() {
            let down = GetAsyncKeyState(vk) as u16 & 0x8000 != 0;
            if down != self.input.buttons[i] {
                self.input.buttons[i] = down;
                self.animating = true;
                self.dirty = true;
            }
        }
        let mut point = POINT::default();
        if GetCursorPos(&mut point).is_ok() {
            let mut display = MONITORINFO {
                cbSize: size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            if GetMonitorInfoW(
                MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST),
                &mut display,
            )
            .as_bool()
            {
                let r = display.rcMonitor;
                let cursor = [
                    ((point.x - r.left) as f32 / (r.right - r.left) as f32 * 2. - 1.)
                        .clamp(-1., 1.),
                    ((point.y - r.top) as f32 / (r.bottom - r.top) as f32 * 2. - 1.).clamp(-1., 1.),
                ];
                if cursor != self.input.cursor {
                    self.input.cursor = cursor;
                    self.dirty = true;
                    self.animating = true;
                }
            }
        }
    }
    unsafe fn tick(&mut self) -> Result<(), String> {
        self.audio.poll();
        if !self.visible {
            return Ok(());
        }
        if !self.test {
            self.poll_input();
        }
        let dt = self.last.elapsed().as_secs_f32() * 1000.;
        self.last = Instant::now();
        if self.video.is_some() {
            match self
                .video
                .as_mut()
                .unwrap()
                .tick()
                .map_err(|e| e.to_string())?
            {
                None => self.stop_media(),
                Some(true) => {
                    self.render()?;
                    return Ok(());
                }
                Some(false) => return Ok(()),
            }
        }
        if self.animating || self.dirty {
            self.animating = self.rig.step(&self.input, dt);
            self.render()?;
        }
        Ok(())
    }
    unsafe fn show(&mut self) {
        self.visible = true;
        let mut r = RECT::default();
        let _ = GetWindowRect(self.hwnd, &mut r);
        let p = keep_in_work(
            POINT {
                x: r.left,
                y: r.top,
            },
            self.surface.w as i32,
            self.surface.h as i32,
        );
        let _ = SetWindowPos(
            self.hwnd,
            HWND_TOPMOST,
            p.x,
            p.y,
            0,
            0,
            SWP_NOSIZE | SWP_NOACTIVATE,
        );
        if !self.test {
            let _ = ShowWindow(self.hwnd, SW_SHOWNOACTIVATE);
            SetTimer(self.hwnd, TIMER, 28, None);
        }
        self.dirty = true;
        self.animating = true;
        self.last = Instant::now();
    }
    unsafe fn hide(&mut self) {
        self.stop_media();
        self.visible = false;
        self.input = Input::default();
        self.drag = None;
        let _ = KillTimer(self.hwnd, TIMER);
        let _ = ShowWindow(self.hwnd, SW_HIDE);
    }
    unsafe fn build_menu(&self, tray: bool) -> Result<HMENU, String> {
        let root = CreatePopupMenu().map_err(|e| e.to_string())?;
        let result = (|| -> Result<(), String> {
            if tray {
                item(root, 10, "显示奶蛙", false, true)?;
                item(root, 11, "隐藏奶蛙", false, self.visible)?;
                separator(root)?;
            }
            let dress = CreatePopupMenu().map_err(|e| e.to_string())?;
            for (id, label) in [(1, "眼罩"), (2, "生气"), (3, "猫咪")] {
                item(
                    dress,
                    100 + id,
                    label,
                    self.settings.accessory_id() == id as u8,
                    true,
                )?;
            }
            separator(dress)?;
            item(
                dress,
                104,
                "清除装扮",
                false,
                self.settings.accessory_id() != 0,
            )?;
            submenu(root, dress, "装扮")?;
            let action = CreatePopupMenu().map_err(|e| e.to_string())?;
            item(
                action,
                200,
                if self.video.is_some() {
                    "停止大笑"
                } else {
                    "捧腹大笑"
                },
                false,
                true,
            )?;
            submenu(root, action, "动作")?;
            let size = CreatePopupMenu().map_err(|e| e.to_string())?;
            item(size, 300, "缩小 5%", false, self.settings.scale > 0.1501)?;
            item(size, 301, "放大 5%", false, self.settings.scale < 1.3499)?;
            separator(size)?;
            for (i, p) in PRESETS.into_iter().enumerate() {
                item(
                    size,
                    400 + i as u32,
                    &format!("{}%{}", p, if p == 65 { "（默认）" } else { "" }),
                    (self.settings.scale * 100. - p as f32).abs() < 0.01,
                    true,
                )?;
            }
            submenu(
                root,
                size,
                &format!("大小（{:.0}%）", self.settings.scale * 100.),
            )?;
            if tray {
                separator(root)?;
                item(root, 500, "静音", self.settings.muted, true)?;
                item(root, 501, "开机自启动", settings::auto_start(), true)?;
                item(
                    root,
                    502,
                    "游戏模式（鼠标穿透 / 不抢焦点）",
                    self.settings.game_mode,
                    true,
                )?;
                separator(root)?;
                item(root, 900, "退出", false, true)?;
            }
            Ok(())
        })();
        if let Err(error) = result {
            let _ = DestroyMenu(root);
            return Err(error);
        }
        Ok(root)
    }
    unsafe fn menu(&mut self, tray: bool) -> Result<bool, String> {
        let menu = self.build_menu(tray)?;
        let mut point = POINT::default();
        let _ = GetCursorPos(&mut point);
        let _ = SetForegroundWindow(self.hwnd);
        let id = TrackPopupMenu(
            menu,
            TPM_RETURNCMD | TPM_RIGHTBUTTON,
            point.x,
            point.y,
            0,
            self.hwnd,
            None,
        )
        .0 as u32;
        let _ = DestroyMenu(menu);
        let _ = PostMessageW(self.hwnd, WM_NULL, WPARAM(0), LPARAM(0));
        self.command(id)
    }
    unsafe fn command(&mut self, id: u32) -> Result<bool, String> {
        match id {
            10 => self.show(),
            11 => self.hide(),
            101..=104 => {
                self.stop_media();
                let next = if id == 104 || self.settings.accessory_id() == (id - 100) as u8 {
                    0
                } else {
                    (id - 100) as u8
                };
                let changed = next != self.settings.accessory_id();
                self.settings.set_accessory(next);
                self.rig.accessory(next);
                self.save();
                if changed {
                    if id == 104 {
                        self.audio.effect(audio::TAP);
                    } else {
                        self.voice_seed ^= self.voice_seed << 13;
                        self.voice_seed ^= self.voice_seed >> 7;
                        self.voice_seed ^= self.voice_seed << 17;
                        self.audio
                            .effect(audio::VOICES[(self.voice_seed % 4) as usize]);
                    }
                }
            }
            200 => {
                if !self.visible {
                    self.show();
                }
                self.laugh()?;
            }
            300 => self.scale(((self.settings.scale * 100. - 5.).round()) / 100.)?,
            301 => self.scale(((self.settings.scale * 100. + 5.).round()) / 100.)?,
            400..=408 => self.scale(PRESETS[(id - 400) as usize] as f32 / 100.)?,
            500 => {
                self.settings.muted = !self.settings.muted;
                self.audio.muted = self.settings.muted;
                if self.settings.muted {
                    self.audio.stop();
                } else if let Some(video) = &self.video {
                    self.audio
                        .effect_at(audio::LAUGH, video.started.elapsed().as_secs_f64());
                }
                self.save();
            }
            501 => {
                if !self.test {
                    settings::set_auto_start(!settings::auto_start())?;
                }
            }
            502 => {
                self.settings.game_mode = !self.settings.game_mode;
                self.game_mode();
                self.save();
            }
            900 => return Ok(false),
            _ => {}
        }
        Ok(true)
    }
    unsafe fn event(&mut self, event: Event) -> Result<bool, String> {
        match event {
            Event::Tick => {
                if let Err(e) = self.tick() {
                    self.stop_media();
                    self.error(&e);
                }
            }
            Event::Menu(tray) => return self.menu(tray),
            Event::Show => self.show(),
            Event::Hide => self.hide(),
            Event::Resize => self.scale(self.settings.scale)?,
            Event::Quit => return Ok(false),
            Event::Escape => self.stop_media(),
            Event::Down => {
                let mut point = POINT::default();
                let _ = GetCursorPos(&mut point);
                self.drag = Some((point, false));
            }
            Event::Move => {
                if let Some((previous, mut moving)) = self.drag {
                    let mut now = POINT::default();
                    let _ = GetCursorPos(&mut now);
                    let (dx, dy) = (now.x - previous.x, now.y - previous.y);
                    if dx.abs() + dy.abs() > 3 {
                        moving = true;
                    }
                    if moving {
                        let mut r = RECT::default();
                        let _ = GetWindowRect(self.hwnd, &mut r);
                        let p = keep_in_work(
                            POINT {
                                x: r.left + dx,
                                y: r.top + dy,
                            },
                            self.surface.w as i32,
                            self.surface.h as i32,
                        );
                        let _ = SetWindowPos(
                            self.hwnd,
                            HWND_TOPMOST,
                            p.x,
                            p.y,
                            0,
                            0,
                            SWP_NOSIZE | SWP_NOACTIVATE,
                        );
                        self.drag = Some((now, true));
                    }
                }
            }
            Event::Up => {
                if let Some((_, moving)) = self.drag.take() {
                    if !moving {
                        if self.video.is_some() {
                            self.stop_media();
                        } else {
                            self.audio.effect(audio::CLICK);
                        }
                    }
                }
            }
        }
        Ok(true)
    }
}
impl Drop for App {
    fn drop(&mut self) {
        unsafe {
            self.stop_media();
            let _ = KillTimer(self.hwnd, TIMER);
            if !self.test {
                self.tray(NIM_DELETE);
            }
            let _ = DestroyWindow(self.hwnd);
        }
    }
}
unsafe fn item(
    menu: HMENU,
    id: u32,
    label: &str,
    checked: bool,
    enabled: bool,
) -> Result<(), String> {
    let mut flags = MF_STRING;
    if checked {
        flags |= MF_CHECKED;
    }
    if !enabled {
        flags |= MF_GRAYED;
    }
    AppendMenuW(menu, flags, id as usize, PCWSTR(wide(label).as_ptr())).map_err(|e| e.to_string())
}
unsafe fn separator(menu: HMENU) -> Result<(), String> {
    AppendMenuW(menu, MF_SEPARATOR, 0, PCWSTR::null()).map_err(|e| e.to_string())
}
unsafe fn submenu(parent: HMENU, child: HMENU, label: &str) -> Result<(), String> {
    AppendMenuW(
        parent,
        MF_POPUP,
        child.0 as usize,
        PCWSTR(wide(label).as_ptr()),
    )
    .map_err(|e| e.to_string())
}
unsafe fn monitor_work(point: POINT) -> RECT {
    let mut info = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    let _ = GetMonitorInfoW(MonitorFromPoint(point, MONITOR_DEFAULTTONEAREST), &mut info);
    info.rcWork
}
unsafe fn keep_in_work(p: POINT, w: i32, h: i32) -> POINT {
    let r = monitor_work(p);
    POINT {
        x: p.x.clamp(r.left, (r.right - w).max(r.left)),
        y: p.y.clamp(r.top, (r.bottom - h).max(r.top)),
    }
}

unsafe fn run() -> Result<(), String> {
    let test = std::env::args().any(|a| a == "--self-test");
    let _ = SetProcessDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2);
    CoInitializeEx(None, COINIT_APARTMENTTHREADED)
        .ok()
        .map_err(|e| e.to_string())?;
    let mutex = CreateMutexW(
        None,
        false,
        if test {
            w!("Local\\MilkFrog.Native.Test")
        } else {
            w!("Local\\MilkFrog.Native.DesktopPet")
        },
    )
    .map_err(|e| e.to_string())?;
    if GetLastError() == ERROR_ALREADY_EXISTS {
        if let Ok(hwnd) = FindWindowW(CLASS, PCWSTR::null()) {
            let _ = PostMessageW(hwnd, SHOW, WPARAM(0), LPARAM(0));
        }
        let _ = CloseHandle(mutex);
        CoUninitialize();
        return Ok(());
    }
    let result = (|| -> Result<(), String> {
        let mut app = App::new(test)?;
        if test {
            return verify::run(&mut app);
        }
        let mut msg = MSG::default();
        'outer: loop {
            let code = GetMessageW(&mut msg, None, 0, 0).0;
            if code <= 0 {
                break;
            }
            if msg.message == app.taskbar_created {
                app.tray(NIM_ADD);
            }
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
            loop {
                let event = EVENTS.with(|q| q.borrow_mut().pop_front());
                let Some(event) = event else {
                    break;
                };
                match app.event(event) {
                    Ok(true) => {}
                    Ok(false) => break 'outer,
                    Err(e) => app.error(&e),
                }
            }
        }
        Ok(())
    })();
    let _ = CloseHandle(mutex);
    CoUninitialize();
    result
}
fn main() {
    unsafe {
        if let Err(e) = run() {
            if std::env::args().any(|a| a == "--self-test") {
                let _ = std::fs::create_dir_all(settings::dir(true));
                let _ = std::fs::write(settings::dir(true).join("failure.txt"), e);
                std::process::exit(1);
            } else {
                MessageBoxW(
                    None,
                    PCWSTR(wide(&e).as_ptr()),
                    w!("MilkFrog 启动失败"),
                    MB_OK | MB_ICONERROR,
                );
            }
        }
    }
}
