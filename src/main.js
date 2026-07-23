const { app, BrowserWindow, ipcMain, screen } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const BASE_WIDTH = 960;
const BASE_HEIGHT = 640;
const DEFAULT_SCALE = 0.65;
const MIN_SCALE = 0.35;
const MAX_SCALE = 1.35;
const SETTINGS_VERSION = 2;

let win;
let settings = { settingsVersion: SETTINGS_VERSION, scale: DEFAULT_SCALE, muted: false, accessory: null };
let inputHelper = null;
let cursorTimer = null;
let isQuitting = false;

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  try {
    const parsed = JSON.parse(fs.readFileSync(settingsPath(), "utf8"));
    settings = { ...settings, ...parsed };
    if (parsed.settingsVersion !== SETTINGS_VERSION) {
      settings.scale = DEFAULT_SCALE;
    }
  } catch (_) {
    // First run.
  }
  settings.settingsVersion = SETTINGS_VERSION;
  settings.scale = clamp(Number(settings.scale) || DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
}

function saveSettings() {
  fs.mkdirSync(app.getPath("userData"), { recursive: true });
  fs.writeFileSync(settingsPath(), JSON.stringify(settings, null, 2), "utf8");
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function sizeForScale(scale) {
  return {
    width: Math.round(BASE_WIDTH * scale),
    height: Math.round(BASE_HEIGHT * scale)
  };
}

function keepInWorkArea(bounds) {
  const workArea = screen.getDisplayMatching(bounds).workArea;
  return {
    x: Math.max(workArea.x, Math.min(bounds.x, workArea.x + workArea.width - bounds.width)),
    y: Math.max(workArea.y, Math.min(bounds.y, workArea.y + workArea.height - bounds.height)),
    width: bounds.width,
    height: bounds.height
  };
}

function applyScale(scale) {
  if (!win || win.isDestroyed()) return;
  settings.scale = clamp(scale, MIN_SCALE, MAX_SCALE);
  const bounds = win.getBounds();
  const size = sizeForScale(settings.scale);
  const next = keepInWorkArea({ x: bounds.x, y: bounds.y, ...size });
  win.setBounds(next, false);
  saveSettings();
  win.webContents.send("settings:changed", settings);
}

function createWindow() {
  if (win && !win.isDestroyed()) {
    showWindow();
    return;
  }

  loadSettings();
  const workArea = screen.getPrimaryDisplay().workArea;
  const size = sizeForScale(settings.scale);

  win = new BrowserWindow({
    width: size.width,
    height: size.height,
    x: workArea.x + workArea.width - size.width - 24,
    y: workArea.y + workArea.height - size.height - 24,
    frame: false,
    transparent: true,
    resizable: false,
    hasShadow: false,
    skipTaskbar: false,
    alwaysOnTop: true,
    backgroundColor: "#00000000",
    icon: path.join(__dirname, "..", "assets", "icon.ico"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false
    }
  });

  win.setAlwaysOnTop(true, "screen-saver");
  win.removeMenu();
  win.loadFile(path.join(__dirname, "index.html"));
  win.once("ready-to-show", () => {
    win.show();
    startGlobalInputMonitor();
  });
  win.on("closed", () => {
    win = null;
    stopGlobalInputMonitor();
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  win.setBounds(keepInWorkArea(bounds), false);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
  win.setAlwaysOnTop(true, "screen-saver");
}

function sendGlobalInput(payload) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send("global-input", payload);
}

function startGlobalInputMonitor() {
  stopGlobalInputMonitor();
  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    sendGlobalInput({
      type: "cursor",
      point: screen.getCursorScreenPoint(),
      bounds: win.getBounds()
    });
  }, 33);

  if (process.platform !== "win32") return;

  const script = `
$ErrorActionPreference = "SilentlyContinue"
Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class NativeInput {
  [DllImport("user32.dll")]
  public static extern short GetAsyncKeyState(int vKey);
}
"@
$keys = @(8,9,13,27,32,33,34,35,36,37,38,39,40,45,46)
$keys += 48..57
$keys += 65..90
$keys += 96..111
$keys += 186..192
$keys += 219..222
$mouse = @(1,2)
$prevKeys = @{}
$prevMouse = @{}
foreach ($key in $keys) { $prevKeys[$key] = $false }
foreach ($button in $mouse) { $prevMouse[$button] = $false }
while ($true) {
  foreach ($key in $keys) {
    $down = (([NativeInput]::GetAsyncKeyState($key) -band 0x8000) -ne 0)
    if ($down -and -not $prevKeys[$key]) {
      [Console]::Out.WriteLine("{""type"":""key"",""vk"":" + $key + "}")
      [Console]::Out.Flush()
    }
    $prevKeys[$key] = $down
  }
  foreach ($button in $mouse) {
    $down = (([NativeInput]::GetAsyncKeyState($button) -band 0x8000) -ne 0)
    if ($down -and -not $prevMouse[$button]) {
      [Console]::Out.WriteLine("{""type"":""mouseDown"",""button"":" + $button + "}")
      [Console]::Out.Flush()
    }
    $prevMouse[$button] = $down
  }
  Start-Sleep -Milliseconds 28
}
`;
  const helperPath = path.join(app.getPath("userData"), "input-helper.ps1");
  fs.mkdirSync(path.dirname(helperPath), { recursive: true });
  fs.writeFileSync(helperPath, script, "utf8");

  inputHelper = spawn("powershell.exe", [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    helperPath
  ], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "ignore"]
  });

  let buffer = "";
  inputHelper.stdout.setEncoding("utf8");
  inputHelper.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        sendGlobalInput(JSON.parse(line));
      } catch (_) {
        // Ignore malformed helper output.
      }
    }
  });
  inputHelper.on("exit", () => {
    inputHelper = null;
    if (!isQuitting && win && !win.isDestroyed()) {
      setTimeout(startGlobalInputMonitor, 1000);
    }
  });
}

function stopGlobalInputMonitor() {
  if (cursorTimer) {
    clearInterval(cursorTimer);
    cursorTimer = null;
  }
  if (inputHelper) {
    const helper = inputHelper;
    inputHelper = null;
    helper.kill();
  }
}

app.setName("Yellow Jelly BongoCat");
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(createWindow);
  app.on("second-instance", () => {
    showWindow();
  });
  app.on("activate", () => {
    if (win && !win.isDestroyed()) showWindow();
    else createWindow();
  });
}

ipcMain.handle("settings:get", () => settings);
ipcMain.handle("settings:set", (_event, patch) => {
  settings = { ...settings, ...patch };
  settings.settingsVersion = SETTINGS_VERSION;
  settings.scale = clamp(Number(settings.scale) || DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  saveSettings();
  if (typeof patch.scale === "number") applyScale(settings.scale);
  else if (win && !win.isDestroyed()) win.webContents.send("settings:changed", settings);
  return settings;
});

ipcMain.on("window:set-scale", (_event, scale) => applyScale(Number(scale)));
ipcMain.on("window:quit", () => {
  isQuitting = true;
  stopGlobalInputMonitor();
  app.quit();
});
ipcMain.on("window:drag", (_event, delta) => {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  const size = sizeForScale(settings.scale);
  const next = keepInWorkArea({
    x: bounds.x + Math.round(delta.x),
    y: bounds.y + Math.round(delta.y),
    ...size
  });
  win.setBounds(next, false);
});

app.on("before-quit", () => {
  isQuitting = true;
  stopGlobalInputMonitor();
});

app.on("window-all-closed", () => {
  app.quit();
});
