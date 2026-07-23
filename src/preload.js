const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("petApp", {
  getSettings: () => ipcRenderer.invoke("settings:get"),
  setSettings: (patch) => ipcRenderer.invoke("settings:set", patch),
  setScale: (scale) => ipcRenderer.send("window:set-scale", scale),
  dragWindow: (delta) => ipcRenderer.send("window:drag", delta),
  quit: () => ipcRenderer.send("window:quit"),
  onSettingsChanged: (callback) => ipcRenderer.on("settings:changed", (_event, settings) => callback(settings)),
  onGlobalInput: (callback) => ipcRenderer.on("global-input", (_event, payload) => callback(payload))
});
