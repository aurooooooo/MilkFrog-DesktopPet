use super::*;
use serde_json::{json, Value};
use windows::Win32::System::ProcessStatus::*;

fn check(ok: bool, message: &str) -> Result<(), String> {
    if ok {
        Ok(())
    } else {
        Err(message.into())
    }
}
unsafe fn memory(label: &str) -> Result<Value, String> {
    let mut info = PROCESS_MEMORY_COUNTERS_EX {
        cb: size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
        ..Default::default()
    };
    GetProcessMemoryInfo(
        GetCurrentProcess(),
        &mut info as *mut _ as *mut PROCESS_MEMORY_COUNTERS,
        info.cb,
    )
    .map_err(|e| e.to_string())?;
    Ok(
        json!({"stage":label,"workingSetMiB":info.WorkingSetSize as f64/1048576.,"privateMiB":info.PrivateUsage as f64/1048576.}),
    )
}
unsafe fn cpu_seconds() -> Result<f64, String> {
    let mut created = FILETIME::default();
    let mut exited = FILETIME::default();
    let mut kernel = FILETIME::default();
    let mut user = FILETIME::default();
    GetProcessTimes(
        GetCurrentProcess(),
        &mut created,
        &mut exited,
        &mut kernel,
        &mut user,
    )
    .map_err(|e| e.to_string())?;
    let ticks = |f: FILETIME| ((f.dwHighDateTime as u64) << 32) | f.dwLowDateTime as u64;
    Ok((ticks(kernel) + ticks(user)) as f64 / 10_000_000.)
}
unsafe fn pump(app: &mut App, seconds: f32) -> Result<(), String> {
    let start = Instant::now();
    while start.elapsed().as_secs_f32() < seconds {
        let mut msg = MSG::default();
        while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
            let _ = TranslateMessage(&msg);
            DispatchMessageW(&msg);
        }
        loop {
            let event = EVENTS.with(|q| q.borrow_mut().pop_front());
            let Some(event) = event else {
                break;
            };
            if !matches!(event, Event::Menu(_) | Event::Tick) {
                check(app.event(event)?, "Unexpected quit event")?;
            }
        }
        app.tick()?;
        std::thread::sleep(std::time::Duration::from_millis(28));
    }
    Ok(())
}
fn screenshot(app: &App, name: &str) -> Result<(), String> {
    app.rig
        .canvas
        .save_png(settings::dir(true).join(format!("{name}.png")))
        .map_err(|e| e.to_string())
}

pub unsafe fn run(app: &mut App) -> Result<(), String> {
    let out = settings::dir(true);
    std::fs::create_dir_all(&out).map_err(|e| e.to_string())?;
    let _ = std::fs::remove_file(out.join("failure.txt"));
    let _ = std::fs::remove_file(out.join("result.json"));
    let mut samples = Vec::new();
    pump(app, 2.)?;
    samples.push(memory("idle")?);
    screenshot(app, "idle")?;
    let mut idle_pixel_difference = None;
    let reference = std::env::current_dir()
        .unwrap()
        .join(".test-artifacts/rust-before-crop/idle.png");
    if reference.exists() {
        let old = tiny_skia::Pixmap::load_png(reference).map_err(|e| e.to_string())?;
        if old.width() == app.rig.canvas.width() && old.height() == app.rig.canvas.height() {
            let difference = old
                .data()
                .iter()
                .zip(app.rig.canvas.data())
                .map(|(&a, &b)| a.abs_diff(b) as u64)
                .sum::<u64>() as f64
                / old.data().len() as f64;
            check(difference < 1.5, "Cropping changed the accepted image")?;
            idle_pixel_difference = Some(difference);
        }
    }
    app.poll_input();
    app.input = Input::default();
    app.dirty = true;
    app.animating = true;
    let menu = app.build_menu(false)?;
    check(
        GetMenuItemCount(menu) == 3,
        "Pet menu must have exactly 3 categories",
    )?;
    let _ = DestroyMenu(menu);
    let menu = app.build_menu(true)?;
    check(
        GetMenuItemCount(menu) > 3,
        "Tray must include system settings",
    )?;
    let _ = DestroyMenu(menu);
    for vk in rig::KEYS {
        app.input.key(vk, true);
        app.animating = true;
        app.dirty = true;
        app.audio.tap();
        pump(app, 0.12)?;
        check(app.input.keys.contains(&vk), "Held key missing")?;
        app.input.key(vk, false);
    }
    app.input.key(87, true);
    app.input.key(32, true);
    app.input.key(160, true);
    app.input.buttons = [true, true];
    app.input.cursor = [1., 1.];
    app.dirty = true;
    app.animating = true;
    pump(app, 1.)?;
    screenshot(app, "combo")?;
    check(app.input.keys == [87, 32, 160], "Combination order changed")?;
    let start = Instant::now();
    let moving_cpu = cpu_seconds()?;
    while start.elapsed().as_secs_f32() < 4. {
        let t = start.elapsed().as_secs_f32();
        app.input.cursor = [(t * 2.).sin(), (t * 2.).cos()];
        app.dirty = true;
        app.animating = true;
        app.audio.tap();
        pump(app, 0.03)?;
    }
    let moving_cpu_percent_one_core =
        (cpu_seconds()? - moving_cpu) / start.elapsed().as_secs_f64() * 100.;
    samples.push(memory("moving-with-audio")?);
    app.input = Input::default();
    app.animating = true;
    for (id, name) in [(101, "eye-patch"), (102, "angry"), (103, "meow")] {
        app.command(id)?;
        pump(app, 0.5)?;
        screenshot(app, name)?;
        check(
            app.audio.effect.is_some(),
            "Accessory voice did not open Windows audio",
        )?;
    }
    app.command(104)?;
    pump(app, 0.1)?;
    check(app.settings.accessory_id() == 0, "Clear accessory failed")?;
    app.command(502)?;
    let flags = GetWindowLongPtrW(app.hwnd, GWL_EXSTYLE) as u32;
    check(
        flags & WS_EX_TRANSPARENT.0 != 0 && flags & WS_EX_NOACTIVATE.0 != 0,
        "Game mode must pass through without activation",
    )?;
    app.command(101)?;
    check(
        app.audio.effect.is_some(),
        "Game mode must allow accessory voice",
    )?;
    app.command(502)?;
    app.command(104)?;
    app.command(500)?;
    app.command(102)?;
    check(app.audio.effect.is_none(), "Mute must suppress voices")?;
    app.command(104)?;
    app.command(500)?;
    app.command(200)?;
    pump(app, 2.5)?;
    check(
        app.video.as_ref().is_some_and(|v| v.frames > 20),
        "Video frames did not decode",
    )?;
    let frame = &app.video.as_ref().unwrap().frame;
    check(frame.data()[3] < 8, "Laugh background must be transparent")?;
    check(
        frame.pixels().iter().any(|p| p.alpha() > 250),
        "Laugh subject must be opaque",
    )?;
    screenshot(app, "laugh")?;
    samples.push(memory("laughing")?);
    app.command(500)?;
    check(
        app.audio.effect.is_none(),
        "Mute during laugh must stop audio",
    )?;
    app.command(500)?;
    check(
        app.audio.effect.is_some(),
        "Unmute during laugh must resume from current time",
    )?;
    let start = Instant::now();
    while app.video.is_some() && start.elapsed().as_secs() < 21 {
        pump(app, 0.04)?;
    }
    check(app.video.is_none(), "Video must end and release decoder")?;
    check(
        !app.mf_started,
        "Media Foundation must shut down after video",
    )?;
    pump(app, 1.)?;
    samples.push(memory("after-media")?);
    app.command(200)?;
    pump(app, 0.1)?;
    app.command(200)?;
    check(app.video.is_none(), "Second laugh action must stop video")?;
    app.command(200)?;
    let _ = PostMessageW(app.hwnd, WM_KEYDOWN, WPARAM(27), LPARAM(0));
    pump(app, 0.1)?;
    check(app.video.is_none(), "Escape window message must stop video")?;
    for scale in [0.15, 0.35, 0.65, 1.35] {
        app.scale(scale)?;
        pump(app, 0.15)?;
        screenshot(app, &format!("size-{}", (scale * 100.).round() as u32))?;
        check(
            app.rig.canvas.width() == app.surface.w,
            "Canvas must follow size",
        )?;
    }
    app.scale(0.01)?;
    check(app.settings.scale == 0.15, "Lower bound must stay 15%")?;
    app.command(300)?;
    check(app.settings.scale == 0.15, "Minus action must clamp at 15%")?;
    app.scale(2.)?;
    check(app.settings.scale == 1.35, "Upper bound must stay 135%")?;
    app.scale(0.65)?;
    let gdi_before = GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS);
    for i in 0..20 {
        app.scale(if i % 2 == 0 { 0.15 } else { 0.65 })?;
    }
    let gdi_after = GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS);
    check(gdi_after <= gdi_before + 2, "Resizing leaked GDI objects")?;
    let saved = Settings::load(true);
    check(
        (saved.scale - app.settings.scale).abs() < 0.001 && saved.muted == app.settings.muted,
        "Saved settings did not round trip",
    )?;
    samples.push(memory("after-resizing")?);
    app.command(200)?;
    app.hide();
    check(
        !app.visible && app.video.is_none() && app.audio.effect.is_none(),
        "Hide must stop input and media",
    )?;
    pump(app, 0.2)?;
    app.show();
    pump(app, 0.2)?;
    app.hide();
    let _ = PostMessageW(app.hwnd, SHOW, WPARAM(0), LPARAM(0));
    pump(app, 0.1)?;
    check(app.visible, "Show window message must restore visibility")?;
    let result = json!({"passed":true,"version":env!("CARGO_PKG_VERSION"),"processes":1,"dimensions":[app.surface.w,app.surface.h],"movingCpuPercentOneCore":moving_cpu_percent_one_core,"gdiObjectsBeforeAfter":[gdi_before,gdi_after],"idlePixelMeanAbsoluteDifferenceAfterCrop":idle_pixel_difference,"samples":samples,"checks":["native-transparent-window","three-category-menu","seven-keys-and-combinations","physical-mouse-axes","accessories-and-random-voice","game-mode-styles-and-audio","mute","full-laugh-playback-and-alpha","stop-and-hide-release","15-to-135-percent","settings-save","resize-gdi-ownership","window-message-dispatch"]});
    std::fs::write(
        out.join("result.json"),
        serde_json::to_vec_pretty(&result).unwrap(),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
