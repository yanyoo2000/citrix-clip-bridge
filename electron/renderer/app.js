const MODE_LABELS = {
  copy: "Copy",
  paste: "Paste",
};
const FALLBACK_DEFAULTS = {
  syncFile: "C:\\Users\\Public\\Documents\\clipboard-sync\\clipboard.txt",
  sourceFile: "\\\\Client\\C$\\Users\\Public\\Documents\\clipboard-sync\\clipboard.txt",
  copyPollMs: 500,
  pastePollMs: 500,
  heartbeatMs: 5000,
};

const state = {
  logs: [],
  savedConfig: null,
  defaults: null,
};
const bridge = window.bridge;
const REQUIRED_BRIDGE_METHODS = [
  "getState",
  "saveConfig",
  "startSelected",
  "stopSelected",
  "clearLogs",
  "setLaunchAtLogin",
];

const missingRequiredBridgeMethods = REQUIRED_BRIDGE_METHODS.filter(
  (method) => typeof bridge?.[method] !== "function"
);
const isBridgeReady = missingRequiredBridgeMethods.length === 0;
const supportsStateSubscription = typeof bridge?.onStateChanged === "function";
const supportsLogSubscription = typeof bridge?.onLogEntry === "function";

const elements = {
  runModeInputs: Array.from(document.querySelectorAll('input[name="runMode"]')),
  syncFile: document.querySelector("#syncFile"),
  sourceFile: document.querySelector("#sourceFile"),
  copyPollMs: document.querySelector("#copyPollMs"),
  pastePollMs: document.querySelector("#pastePollMs"),
  heartbeatMs: document.querySelector("#heartbeatMs"),
  launchAtLogin: document.querySelector("#launchAtLogin"),
  appState: document.querySelector("#appState"),
  selectedMode: document.querySelector("#selectedMode"),
  modeState: document.querySelector("#modeState"),
  copyConfigPanel: document.querySelector("#copyConfigPanel"),
  pasteConfigPanel: document.querySelector("#pasteConfigPanel"),
  saveMessage: document.querySelector("#saveMessage"),
  logs: document.querySelector("#logs"),
  saveConfigButton: document.querySelector("#saveConfigButton"),
  startSelectedButton: document.querySelector("#startSelectedButton"),
  stopSelectedButton: document.querySelector("#stopSelectedButton"),
  clearLogsButton: document.querySelector("#clearLogsButton"),
};

const getSelectedMode = () =>
  elements.runModeInputs.find((input) => input.checked)?.value ?? "copy";

const toggleModePanels = (mode) => {
  elements.copyConfigPanel.hidden = mode !== "copy";
  elements.pasteConfigPanel.hidden = mode !== "paste";
};

const renderStatus = (config, runtime) => {
  const modeLabel = MODE_LABELS[config.runMode] ?? "Copy";
  const isRunning = Boolean(runtime.isRunning);

  elements.appState.textContent = `${modeLabel} 模式${isRunning ? "运行中" : "已停止"}`;
  elements.selectedMode.textContent = modeLabel;
  elements.modeState.textContent = isRunning ? "运行中" : "已停止";
  elements.startSelectedButton.disabled = isRunning;
  elements.stopSelectedButton.disabled = !isRunning;
};

const renderDefaults = (defaults) => {
  state.defaults = { ...FALLBACK_DEFAULTS, ...(defaults ?? {}) };
  elements.syncFile.placeholder = state.defaults.syncFile;
  elements.sourceFile.placeholder = state.defaults.sourceFile;
  elements.copyPollMs.placeholder = String(state.defaults.copyPollMs);
  elements.pastePollMs.placeholder = String(state.defaults.pastePollMs);
  elements.heartbeatMs.placeholder = String(state.defaults.heartbeatMs);
};

const renderConfig = (config) => {
  state.savedConfig = config;
  elements.runModeInputs.forEach((input) => {
    input.checked = input.value === config.runMode;
  });
  elements.syncFile.value = config.syncFile ?? "";
  elements.sourceFile.value = config.sourceFile ?? "";
  elements.copyPollMs.value = config.copyPollMs ?? "";
  elements.pastePollMs.value = config.pastePollMs ?? "";
  elements.heartbeatMs.value = config.heartbeatMs ?? "";
  elements.launchAtLogin.checked = Boolean(config.launchAtLogin);
  toggleModePanels(config.runMode);
};

const formatTime = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
};

const renderLogs = () => {
  if (state.logs.length === 0) {
    elements.logs.innerHTML = '<div class="empty">暂无日志</div>';
    return;
  }

  elements.logs.innerHTML = state.logs
    .slice()
    .reverse()
    .map(
      (entry) => `
        <article class="log-item ${entry.level}">
          <span class="time">${formatTime(entry.timestamp)}</span>
          <span class="source">${entry.source}</span>
          <span class="level">${entry.level}</span>
          <span class="message">${entry.message}</span>
        </article>
      `
    )
    .join("");
};

const renderSnapshot = (snapshot) => {
  renderConfig(snapshot.config);
  renderStatus(snapshot.config, snapshot.runtime);
  renderDefaults(snapshot.defaults);
  state.logs = snapshot.logs ?? [];
  renderLogs();
};

const toNumberOrFallback = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const readConfigForm = () => {
  const defaults = { ...FALLBACK_DEFAULTS, ...(state.defaults ?? {}) };
  const syncFile = elements.syncFile.value.trim();
  const sourceFile = elements.sourceFile.value.trim();

  return {
    runMode: getSelectedMode(),
    syncFile: syncFile || defaults.syncFile || "",
    sourceFile: sourceFile || defaults.sourceFile || "",
    copyPollMs: toNumberOrFallback(elements.copyPollMs.value, defaults.copyPollMs),
    pastePollMs: toNumberOrFallback(elements.pastePollMs.value, defaults.pastePollMs),
    heartbeatMs: toNumberOrFallback(elements.heartbeatMs.value, defaults.heartbeatMs),
    launchAtLogin: elements.launchAtLogin.checked,
  };
};

const showMessage = (message, isError = false) => {
  elements.saveMessage.textContent = message;
  elements.saveMessage.style.color = isError ? "#ff9b9b" : "";
};

const withAction = async (action, successMessage) => {
  if (!isBridgeReady) {
    const detail = missingRequiredBridgeMethods.length
      ? `缺少方法: ${missingRequiredBridgeMethods.join(", ")}`
      : "bridge 未注入";
    showMessage(
      `Bridge API 不可用（${detail}）。请通过 Electron 启动应用（npm start），不要直接打开 index.html`,
      true
    );
    return;
  }

  try {
    const snapshot = await action();
    renderSnapshot(snapshot);
    if (successMessage) {
      showMessage(successMessage);
    }
  } catch (error) {
    showMessage(error.message, true);
  }
};

elements.saveConfigButton.addEventListener("click", () => {
  const nextConfig = readConfigForm();
  const modeLabel = MODE_LABELS[nextConfig.runMode] ?? "Copy";
  withAction(() => bridge.saveConfig(nextConfig), `配置已保存，当前模式为 ${modeLabel}`);
});

elements.startSelectedButton.addEventListener("click", () => {
  const modeLabel = MODE_LABELS[state.savedConfig?.runMode] ?? "Copy";
  withAction(() => bridge.startSelected(), `${modeLabel} 已启动`);
});

elements.stopSelectedButton.addEventListener("click", () => {
  const modeLabel = MODE_LABELS[state.savedConfig?.runMode] ?? "Copy";
  withAction(() => bridge.stopSelected(), `${modeLabel} 已停止`);
});

elements.launchAtLogin.addEventListener("change", () => {
  withAction(
    () => bridge.setLaunchAtLogin(elements.launchAtLogin.checked),
    `开机自启动已${elements.launchAtLogin.checked ? "开启" : "关闭"}`
  );
});

elements.clearLogsButton.addEventListener("click", () => {
  withAction(() => bridge.clearLogs(), "日志缓冲已清空");
});

elements.runModeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    toggleModePanels(getSelectedMode());
    showMessage("模式已切换，保存后生效");
  });
});

if (isBridgeReady && supportsStateSubscription) {
  bridge.onStateChanged((snapshot) => {
    renderSnapshot(snapshot);
  });
}

if (isBridgeReady && supportsLogSubscription) {
  bridge.onLogEntry((entry) => {
    state.logs = [...state.logs, entry];
    renderLogs();
  });
}

window.addEventListener("DOMContentLoaded", async () => {
  if (!isBridgeReady) {
    renderDefaults(FALLBACK_DEFAULTS);
    renderConfig({
      runMode: "copy",
      syncFile: FALLBACK_DEFAULTS.syncFile,
      sourceFile: FALLBACK_DEFAULTS.sourceFile,
      copyPollMs: FALLBACK_DEFAULTS.copyPollMs,
      pastePollMs: FALLBACK_DEFAULTS.pastePollMs,
      heartbeatMs: FALLBACK_DEFAULTS.heartbeatMs,
      launchAtLogin: false,
    });
    renderStatus({ runMode: "copy" }, { isRunning: false });
    renderLogs();
    const detail = missingRequiredBridgeMethods.length
      ? `缺少方法: ${missingRequiredBridgeMethods.join(", ")}`
      : "bridge 未注入";
    showMessage(
      `Bridge API 不可用（${detail}）。请通过 Electron 启动应用（npm start），不要直接打开 index.html`,
      true
    );
    return;
  }

  try {
    const snapshot = await bridge.getState();
    renderSnapshot(snapshot);
    showMessage("每次只能运行一种模式，切换模式后请先保存配置");
  } catch (error) {
    showMessage(`初始化失败: ${error.message}`, true);
  }
});
