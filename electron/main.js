import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from "electron";
import fs from "fs";
import path from "path";
import {
  createClipboardToFileSync,
  DEFAULT_COPY_POLL_MS,
  DEFAULT_SYNC_FILE,
} from "../lib/copy-sync.js";
import {
  createFileToClipboardSync,
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_PASTE_POLL_MS,
  DEFAULT_SOURCE_FILE,
} from "../lib/paste-sync.js";

const APP_NAME = "citrix-clip-bridge";
const MAX_LOG_ENTRIES = 100;
const START_HIDDEN_ARG = "--hidden";
const uiDefaults = {
  syncFile: "C:\\Users\\Public\\Documents\\clipboard-sync\\clipboard.txt",
  sourceFile: "\\\\Client\\C$\\Users\\Public\\Documents\\clipboard-sync\\clipboard.txt",
  copyPollMs: DEFAULT_COPY_POLL_MS,
  pastePollMs: DEFAULT_PASTE_POLL_MS,
  heartbeatMs: DEFAULT_HEARTBEAT_MS,
  launchAtLogin: false,
};

let mainWindow = null;
let tray = null;
let isQuitting = false;
let logEntries = [];
let config = { ...uiDefaults };
let copyService = null;
let pasteService = null;

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const getConfigPath = () => path.join(app.getPath("userData"), "config.json");
const shouldStartHidden = () => process.argv.includes(START_HIDDEN_ARG);

const createTrayIcon = (state) => {
  const color = state.copyRunning && state.pasteRunning ? "#17c964" : state.copyRunning || state.pasteRunning ? "#f5a524" : "#6c7480";
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
      <rect x="1" y="1" width="14" height="14" rx="4" fill="#11161f"/>
      <path d="M4 8h8" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
      <path d="M8 4v8" stroke="${color}" stroke-width="2" stroke-linecap="round"/>
    </svg>
  `;
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  );
};

const loadConfig = () => {
  const configPath = getConfigPath();

  try {
    if (!fs.existsSync(configPath)) {
      return { ...uiDefaults };
    }

    const raw = fs.readFileSync(configPath, "utf8");
    const parsed = JSON.parse(raw);
    return normalizeConfig({ ...uiDefaults, ...parsed });
  } catch (error) {
    appendLog({
      source: "app",
      level: "error",
      message: `读取配置失败: ${error.message}`,
    });
    return { ...uiDefaults };
  }
};

const saveConfig = () => {
  const configPath = getConfigPath();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), "utf8");
};

const normalizeConfig = (rawConfig) => {
  const nextConfig = {
    syncFile: String(rawConfig.syncFile ?? uiDefaults.syncFile).trim() || uiDefaults.syncFile,
    sourceFile:
      String(rawConfig.sourceFile ?? uiDefaults.sourceFile).trim() || uiDefaults.sourceFile,
    copyPollMs: Number(rawConfig.copyPollMs ?? uiDefaults.copyPollMs),
    pastePollMs: Number(rawConfig.pastePollMs ?? uiDefaults.pastePollMs),
    heartbeatMs: Number(rawConfig.heartbeatMs ?? uiDefaults.heartbeatMs),
    launchAtLogin: Boolean(rawConfig.launchAtLogin),
  };

  if (Number.isNaN(nextConfig.copyPollMs) || nextConfig.copyPollMs < 50) {
    throw new Error("COPY_POLL_MS 必须是 >= 50 的数字");
  }
  if (Number.isNaN(nextConfig.pastePollMs) || nextConfig.pastePollMs < 50) {
    throw new Error("PASTE_POLL_MS 必须是 >= 50 的数字");
  }
  if (Number.isNaN(nextConfig.heartbeatMs) || nextConfig.heartbeatMs < 1000) {
    throw new Error("HEARTBEAT_MS 必须是 >= 1000 的数字");
  }

  return nextConfig;
};

const getRuntimeState = () => ({
  copyRunning: copyService?.isRunning() ?? false,
  pasteRunning: pasteService?.isRunning() ?? false,
});

function appendLog(entry) {
  const normalizedEntry = {
    timestamp: new Date().toISOString(),
    source: "app",
    level: "info",
    ...entry,
  };

  logEntries = [...logEntries, normalizedEntry].slice(-MAX_LOG_ENTRIES);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("log:entry", normalizedEntry);
  }
}

const getSnapshot = () => ({
  config,
  runtime: getRuntimeState(),
  logs: logEntries,
  defaults: {
    syncFile: DEFAULT_SYNC_FILE,
    sourceFile: DEFAULT_SOURCE_FILE,
    copyPollMs: DEFAULT_COPY_POLL_MS,
    pastePollMs: DEFAULT_PASTE_POLL_MS,
    heartbeatMs: DEFAULT_HEARTBEAT_MS,
  },
});

const broadcastState = () => {
  const snapshot = getSnapshot();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("state:changed", snapshot);
  }
  refreshTray();
};

const clearLogs = () => {
  logEntries = [];
};

const rebuildServices = () => {
  const copyWasRunning = copyService?.isRunning() ?? false;
  const pasteWasRunning = pasteService?.isRunning() ?? false;

  if (copyWasRunning) {
    copyService.stop();
  }
  if (pasteWasRunning) {
    pasteService.stop();
  }

  copyService = createClipboardToFileSync({
    targetFile: config.syncFile,
    pollMs: Number(config.copyPollMs),
    onLog: appendLog,
  });

  pasteService = createFileToClipboardSync({
    sourceFile: config.sourceFile,
    pollMs: Number(config.pastePollMs),
    heartbeatMs: Number(config.heartbeatMs),
    onLog: appendLog,
  });

  if (copyWasRunning) {
    copyService.start();
  }
  if (pasteWasRunning) {
    pasteService.start();
  }
};

const updateLaunchAtLogin = (enabled) => {
  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    args: [START_HIDDEN_ARG],
  });
  config.launchAtLogin = enabled;
  saveConfig();
  appendLog({
    source: "app",
    level: "info",
    message: `开机自启动已${enabled ? "开启" : "关闭"}`,
  });
  broadcastState();
};

const refreshTray = () => {
  if (!tray) {
    return;
  }

  const runtime = getRuntimeState();
  tray.setImage(createTrayIcon(runtime));
  tray.setToolTip(
    `${APP_NAME} | copy:${runtime.copyRunning ? "on" : "off"} paste:${runtime.pasteRunning ? "on" : "off"}`
  );

  const menu = Menu.buildFromTemplate([
    { label: "打开窗口", click: () => showWindow() },
    {
      label: runtime.copyRunning && runtime.pasteRunning ? "停止全部" : "启动全部",
      click: () => {
        if (runtime.copyRunning && runtime.pasteRunning) {
          stopAll();
          return;
        }

        startAll();
      },
    },
    { type: "separator" },
    {
      label: runtime.copyRunning ? "停止 Copy" : "启动 Copy",
      click: () => {
        if (runtime.copyRunning) {
          stopCopy();
          return;
        }

        startCopy();
      },
    },
    {
      label: runtime.pasteRunning ? "停止 Paste" : "启动 Paste",
      click: () => {
        if (runtime.pasteRunning) {
          stopPaste();
          return;
        }

        startPaste();
      },
    },
    { type: "separator" },
    {
      label: config.launchAtLogin ? "关闭开机自启动" : "开启开机自启动",
      click: () => updateLaunchAtLogin(!config.launchAtLogin),
    },
    { type: "separator" },
    {
      label: "退出",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(menu);
};

const showWindow = () => {
  if (!mainWindow) {
    return;
  }

  mainWindow.show();
  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.focus();
};

const createWindow = () => {
  const startHidden = shouldStartHidden();
  mainWindow = new BrowserWindow({
    width: 960,
    height: 720,
    minWidth: 860,
    minHeight: 620,
    show: !startHidden,
    title: APP_NAME,
    backgroundColor: "#0d1117",
    webPreferences: {
      preload: path.join(app.getAppPath(), "electron", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(app.getAppPath(), "electron", "renderer", "index.html"));

  if (startHidden) {
    mainWindow.once("ready-to-show", () => {
      mainWindow.hide();
    });
  }

  mainWindow.on("close", (event) => {
    if (isQuitting) {
      return;
    }

    event.preventDefault();
    mainWindow.hide();
  });
};

const startCopy = () => {
  copyService.start();
  broadcastState();
  return getSnapshot();
};

const stopCopy = () => {
  copyService.stop();
  broadcastState();
  return getSnapshot();
};

const startPaste = () => {
  pasteService.start();
  broadcastState();
  return getSnapshot();
};

const stopPaste = () => {
  pasteService.stop();
  broadcastState();
  return getSnapshot();
};

const startAll = () => {
  copyService.start();
  pasteService.start();
  appendLog({ source: "app", level: "info", message: "Copy / Paste 已全部启动" });
  broadcastState();
  return getSnapshot();
};

const stopAll = () => {
  copyService.stop();
  pasteService.stop();
  appendLog({ source: "app", level: "info", message: "Copy / Paste 已全部停止" });
  broadcastState();
  return getSnapshot();
};

const createTray = () => {
  tray = new Tray(createTrayIcon(getRuntimeState()));
  tray.on("double-click", showWindow);
  refreshTray();
};

const registerIpc = () => {
  ipcMain.handle("app:get-state", () => getSnapshot());

  ipcMain.handle("config:save", (_event, nextConfig) => {
    config = normalizeConfig({
      ...config,
      ...nextConfig,
    });
    saveConfig();
    rebuildServices();
    appendLog({ source: "app", level: "info", message: "配置已保存" });
    broadcastState();
    return getSnapshot();
  });

  ipcMain.handle("runtime:start-copy", () => {
    return startCopy();
  });

  ipcMain.handle("runtime:stop-copy", () => {
    return stopCopy();
  });

  ipcMain.handle("runtime:start-paste", () => {
    return startPaste();
  });

  ipcMain.handle("runtime:stop-paste", () => {
    return stopPaste();
  });

  ipcMain.handle("runtime:start-all", () => {
    return startAll();
  });

  ipcMain.handle("runtime:stop-all", () => {
    return stopAll();
  });

  ipcMain.handle("app:set-launch-at-login", (_event, enabled) => {
    updateLaunchAtLogin(Boolean(enabled));
    return getSnapshot();
  });

  ipcMain.handle("logs:clear", () => {
    clearLogs();
    broadcastState();
    return getSnapshot();
  });
};

app.whenReady().then(() => {
  config = loadConfig();
  config.launchAtLogin = app.getLoginItemSettings().openAtLogin;
  rebuildServices();
  registerIpc();
  createWindow();
  createTray();
  appendLog({
    source: "app",
    level: "info",
    message: "应用已启动，窗口关闭后会最小化到托盘",
  });
  broadcastState();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
      broadcastState();
      return;
    }

    showWindow();
  });
});

app.on("second-instance", () => {
  showWindow();
});

app.on("before-quit", () => {
  isQuitting = true;
  copyService?.stop();
  pasteService?.stop();
});

process.on("uncaughtException", (error) => {
  appendLog({
    source: "app",
    level: "error",
    message: `未捕获异常(code=${error.code || "unknown"}): ${error.message}`,
  });
});

process.on("unhandledRejection", (reason) => {
  appendLog({
    source: "app",
    level: "error",
    message: `未处理 Promise 拒绝: ${String(reason)}`,
  });
});
