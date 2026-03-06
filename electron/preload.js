import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("bridge", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  startCopy: () => ipcRenderer.invoke("runtime:start-copy"),
  stopCopy: () => ipcRenderer.invoke("runtime:stop-copy"),
  startPaste: () => ipcRenderer.invoke("runtime:start-paste"),
  stopPaste: () => ipcRenderer.invoke("runtime:stop-paste"),
  startAll: () => ipcRenderer.invoke("runtime:start-all"),
  stopAll: () => ipcRenderer.invoke("runtime:stop-all"),
  clearLogs: () => ipcRenderer.invoke("logs:clear"),
  setLaunchAtLogin: (enabled) =>
    ipcRenderer.invoke("app:set-launch-at-login", enabled),
  onStateChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("state:changed", listener);
    return () => ipcRenderer.removeListener("state:changed", listener);
  },
  onLogEntry: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("log:entry", listener);
    return () => ipcRenderer.removeListener("log:entry", listener);
  },
});
