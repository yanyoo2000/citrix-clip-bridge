import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("bridge", {
  getState: () => ipcRenderer.invoke("app:get-state"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  startSelected: () => ipcRenderer.invoke("runtime:start-selected"),
  stopSelected: () => ipcRenderer.invoke("runtime:stop-selected"),
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
