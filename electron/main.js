import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage } from "electron";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  createClipboardToFileSync,
  DEFAULT_COPY_POLL_MS,
} from "../lib/copy-sync.js";
import {
  createFileToClipboardSync,
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_PASTE_POLL_MS,
} from "../lib/paste-sync.js";

const APP_NAME = "citrix-sync-clipboard";
const START_HIDDEN_ARG = "--hidden";
const RUN_MODE_COPY = "copy";
const RUN_MODE_PASTE = "paste";
const DEFAULT_UI_SYNC_FILE = "C:\\Users\\Public\\Documents\\clipboard-sync\\clipboard.txt";
const DEFAULT_UI_SOURCE_FILE = "\\\\Client\\C$\\Users\\Public\\Documents\\clipboard-sync\\clipboard.txt";
const MODE_LABELS = {
  [RUN_MODE_COPY]: "Copy",
  [RUN_MODE_PASTE]: "Paste",
};
const uiDefaults = {
  runMode: RUN_MODE_COPY,
  syncFile: DEFAULT_UI_SYNC_FILE,
  sourceFile: DEFAULT_UI_SOURCE_FILE,
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
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PRELOAD_PATH = path.join(__dirname, "preload.js");

if (!app.requestSingleInstanceLock()) {
  app.quit();
}

const getConfigPath = () => path.join(app.getPath("userData"), "config.json");
const shouldStartHidden = () => process.argv.includes(START_HIDDEN_ARG);

const createTrayIcon = (state) => {
  const color = state.isRunning ? "#17c964" : "#6c7480";
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
    runMode:
      rawConfig.runMode === RUN_MODE_PASTE ? RUN_MODE_PASTE : RUN_MODE_COPY,
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

const getActiveMode = () => {
  if (copyService?.isRunning()) {
    return RUN_MODE_COPY;
  }

  if (pasteService?.isRunning()) {
    return RUN_MODE_PASTE;
  }

  return null;
};

const getRuntimeState = () => {
  const activeMode = getActiveMode();
  return {
    runMode: config.runMode,
    activeMode,
    isRunning: Boolean(activeMode),
  };
};

function appendLog(entry) {
  const normalizedEntry = {
    timestamp: new Date().toISOString(),
    source: "app",
    level: "info",
    ...entry,
  };

  logEntries = [...logEntries, normalizedEntry];
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("log:entry", normalizedEntry);
  }
}

const getSnapshot = () => ({
  config,
  runtime: getRuntimeState(),
  logs: logEntries,
  defaults: {
    runMode: RUN_MODE_COPY,
    syncFile: DEFAULT_UI_SYNC_FILE,
    sourceFile: DEFAULT_UI_SOURCE_FILE,
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

const stopServices = () => {
  copyService?.stop();
  pasteService?.stop();
};

const startConfiguredMode = () => {
  if (config.runMode === RUN_MODE_COPY) {
    pasteService?.stop();
    copyService.start();
    return;
  }

  copyService?.stop();
  pasteService.start();
};

const rebuildServices = () => {
  const wasRunning = Boolean(getActiveMode());
  stopServices();

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

  if (wasRunning) {
    startConfiguredMode();
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
    `${APP_NAME} | mode:${MODE_LABELS[config.runMode]} status:${runtime.isRunning ? "on" : "off"}`
  );

  const menu = Menu.buildFromTemplate([
    { label: "打开窗口", click: () => showWindow() },
    { label: `当前模式: ${MODE_LABELS[config.runMode]}`, enabled: false },
    {
      label: runtime.isRunning ? `停止 ${MODE_LABELS[config.runMode]}` : `启动 ${MODE_LABELS[config.runMode]}`,
      click: () => {
        if (runtime.isRunning) {
          stopSelected();
          return;
        }

        startSelected();
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
    width: 1280,
    height: 860,
    minWidth: 1080,
    minHeight: 760,
    show: !startHidden,
    title: APP_NAME,
    backgroundColor: "#0d1117",
    webPreferences: {
      preload: PRELOAD_PATH,
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

const startSelected = () => {
  startConfiguredMode();
  broadcastState();
  return getSnapshot();
};

const stopSelected = () => {
  if (config.runMode === RUN_MODE_COPY) {
    copyService.stop();
  } else {
    pasteService.stop();
  }
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

  ipcMain.handle("runtime:start-selected", () => {
    return startSelected();
  });

  ipcMain.handle("runtime:stop-selected", () => {
    return stopSelected();
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
  appendLog({
    source: "app",
    level: "info",
    message: `preload: ${PRELOAD_PATH} (${fs.existsSync(PRELOAD_PATH) ? "ok" : "missing"})`,
  });
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
  stopServices();
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
