const { app, BrowserWindow, ipcMain, screen, Tray, Menu, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");
const { KEY_BINDINGS } = require("./input-state");
const { getAutoStart, setAutoStart } = require("./startup");

const BASE_WIDTH = 960;
const BASE_HEIGHT = 640;
const DEFAULT_SCALE = 0.65;
const MIN_SCALE = 0.15;
const MAX_SCALE = 1.35;
const SETTINGS_VERSION = 2;

let win;
let settings = { settingsVersion: SETTINGS_VERSION, scale: DEFAULT_SCALE, muted: false, accessory: null, gameMode: false, autoStart: false };
let inputHelper = null;
let cursorTimer = null;
let isQuitting = false;
let tray;
let helperFailures = 0;
let laughing = false;

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
  // Read the OS state instead of silently re-enabling an item disabled in Task Manager.
  settings.autoStart = false;
  if (process.platform === "win32") {
    try { settings.autoStart = getAutoStart(app); }
    catch (error) { console.error("Unable to read startup settings:", error.message); }
  }
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
  updateTrayMenu();
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
      sandbox: true,
      backgroundThrottling: true
    }
  });

  applyGameMode();
  win.removeMenu();
  win.loadFile(path.join(__dirname, "index.html"));
  win.webContents.on("context-menu", (_event, point) => {
    Menu.buildFromTemplate(petMenuItems()).popup({ window: win, x: point.x, y: point.y });
  });
  win.once("ready-to-show", () => {
    if (settings.gameMode) win.showInactive();
    else win.show();
    startGlobalInputMonitor();
  });
  win.on("closed", () => {
    win = null;
    stopGlobalInputMonitor();
  });
  win.on("minimize", () => { win.webContents.send("pet:action", "stop"); stopGlobalInputMonitor(); });
  win.on("restore", startGlobalInputMonitor);
}

function sendPetAction(action) {
  if (win && !win.isDestroyed()) win.webContents.send("pet:action", action);
}

function petMenuItems() {
  return [
    { label: "装扮", submenu: [
      ...[["eyePatch", "眼罩"], ["angry", "生气"], ["meow", "猫咪"]].map(([id, label]) => ({
        label, type: "checkbox", checked: settings.accessory === id,
        click: () => sendPetAction({ type: "accessory", id })
      })),
      { type: "separator" },
      { label: "清除装扮", enabled: Boolean(settings.accessory), click: () => sendPetAction({ type: "clear" }) }
    ] },
    { label: "动作", submenu: [
      { label: laughing ? "停止大笑" : "捧腹大笑", click: () => sendPetAction("laugh") }
    ] },
    { label: `大小（${Math.round(settings.scale * 100)}%）`, submenu: [
      { label: "缩小 5%", enabled: settings.scale > MIN_SCALE, click: () => applyScale(Math.round((settings.scale - 0.05) * 100) / 100) },
      { label: "放大 5%", enabled: settings.scale < MAX_SCALE, click: () => applyScale(Math.round((settings.scale + 0.05) * 100) / 100) },
      { type: "separator" },
      ...[15, 20, 25, 35, 50, 65, 80, 100, 135].map(percent => ({
        label: `${percent}%${percent === 65 ? "（默认）" : ""}`, type: "radio",
        checked: Math.abs(settings.scale * 100 - percent) < 0.01,
        click: () => applyScale(percent / 100)
      }))
    ] }
  ];
}

function updateTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: "显示奶蛙", click: showWindow },
    { label: "隐藏奶蛙", enabled: Boolean(win && win.isVisible()), click: () => {
      if (!win || win.isDestroyed()) return;
      sendPetAction("stop");
      win.hide();
      stopGlobalInputMonitor();
      updateTrayMenu();
    } },
    { type: "separator" },
    ...petMenuItems(),
    { type: "separator" },
    { label: "静音", type: "checkbox", checked: Boolean(settings.muted), click: item => {
      settings.muted = item.checked;
      saveSettings();
      sendSettings();
      updateTrayMenu();
    } },
    { label: "开机自启动", type: "checkbox", checked: Boolean(settings.autoStart), enabled: process.platform === "win32",
      click: item => {
        try { changeAutoStart(item.checked); }
        catch (error) { dialog.showErrorBox("无法更改开机自启动", error.message); }
      } },
    { label: "游戏模式（鼠标穿透 / 不抢焦点）", type: "checkbox", checked: Boolean(settings.gameMode),
      click: item => setGameMode(item.checked) },
    { type: "separator" },
    { label: "退出", click: () => app.quit() }
  ]));
}

function sendSettings() {
  if (win && !win.isDestroyed()) win.webContents.send("settings:changed", settings);
}

function changeAutoStart(enabled) {
  if (process.platform !== "win32") throw new Error("此功能目前仅支持 Windows。");
  settings.autoStart = setAutoStart(app, enabled);
  if (settings.autoStart !== enabled) throw new Error("Windows 未启用此启动项，请检查系统“启动应用”设置。");
  saveSettings();
  updateTrayMenu();
  if (win && !win.isDestroyed()) win.webContents.send("settings:changed", settings);
}

function applyGameMode() {
  if (!win || win.isDestroyed()) return;
  win.setIgnoreMouseEvents(Boolean(settings.gameMode));
  win.setFocusable(!settings.gameMode);
  win.setAlwaysOnTop(true, "floating");
  win.setSkipTaskbar(Boolean(settings.gameMode));
}

function setGameMode(enabled) {
  settings.gameMode = Boolean(enabled);
  applyGameMode();
  saveSettings();
  updateTrayMenu();
  if (win && !win.isDestroyed()) win.webContents.send("settings:changed", settings);
}

function showWindow() {
  if (!win || win.isDestroyed()) return;
  const bounds = win.getBounds();
  win.setBounds(keepInWorkArea(bounds), false);
  if (win.isMinimized()) win.restore();
  if (settings.gameMode) win.showInactive();
  else { win.show(); win.focus(); }
  win.setAlwaysOnTop(true, "floating");
  if (!cursorTimer) startGlobalInputMonitor();
  updateTrayMenu();
}

function sendGlobalInput(payload) {
  if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
  win.webContents.send("global-input", payload);
}

function startGlobalInputMonitor() {
  stopGlobalInputMonitor();
  let previousPoint = null;
  cursorTimer = setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const point = screen.getCursorScreenPoint();
    if (previousPoint && point.x === previousPoint.x && point.y === previousPoint.y) return;
    previousPoint = point;
    sendGlobalInput({
      type: "cursor",
      point,
      displayBounds: screen.getDisplayNearestPoint(point).bounds
    });
  }, 33);

  if (process.platform !== "win32") return;

  const helperPath = app.isPackaged
    ? path.join(process.resourcesPath, "input", "MilkFrog.Input.exe")
    : path.join(__dirname, "..", "build", "native", "MilkFrog.Input.exe");
  if (!fs.existsSync(helperPath)) {
    console.error("Input helper missing. Run node scripts/build-input.cjs before starting.");
    return;
  }
  const helper = spawn(helperPath, [], {
    windowsHide: true,
    stdio: ["pipe", "pipe", "ignore"]
  });
  inputHelper = helper;

  let buffer = "";
  inputHelper.stdout.setEncoding("utf8");
  inputHelper.stdout.on("data", (chunk) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const payload = JSON.parse(line);
        if ((["keyDown", "keyUp"].includes(payload.type) && Object.hasOwn(KEY_BINDINGS, payload.vk)) ||
          (["mouseDown", "mouseUp"].includes(payload.type) && [1, 2].includes(payload.button))) sendGlobalInput(payload);
      } catch (_) {
        // Ignore malformed helper output.
      }
    }
  });
  helper.on("error", error => console.error("Input helper failed:", error.message));
  inputHelper.on("exit", () => {
    if (inputHelper !== helper) return;
    inputHelper = null;
    sendGlobalInput({ type: "reset" });
    if (!isQuitting && win && !win.isDestroyed() && ++helperFailures <= 3) {
      setTimeout(() => {
        if (!isQuitting && win && !win.isDestroyed() && !inputHelper) startGlobalInputMonitor();
      }, 1000);
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
  sendGlobalInput({ type: "reset" });
}

app.setName("MilkFrog DesktopPet");
// A small, mostly static 2D pet does not need a dedicated hardware-accelerated canvas pipeline.
app.disableHardwareAcceleration();
app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.whenReady().then(() => {
    createWindow();
    tray = new Tray(path.join(__dirname, "..", "assets", "icon.ico"));
    tray.setToolTip("MilkFrog 奶蛙桌宠");
    tray.on("double-click", showWindow);
    updateTrayMenu();
  });
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
  if (typeof patch.autoStart === "boolean") changeAutoStart(patch.autoStart);
  settings = { ...settings, ...patch };
  settings.settingsVersion = SETTINGS_VERSION;
  settings.scale = clamp(Number(settings.scale) || DEFAULT_SCALE, MIN_SCALE, MAX_SCALE);
  if (typeof patch.gameMode === "boolean") setGameMode(patch.gameMode);
  saveSettings();
  if (typeof patch.scale === "number") applyScale(settings.scale);
  else if (win && !win.isDestroyed()) win.webContents.send("settings:changed", settings);
  updateTrayMenu();
  return settings;
});

ipcMain.on("pet:laughing", (_event, active) => {
  laughing = Boolean(active);
  updateTrayMenu();
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
