const MODE_LABELS = {
  copy: "Copy",
  paste: "Paste",
};

const state = {
  logs: [],
  savedConfig: null,
};

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
  controlMode: document.querySelector("#controlMode"),
  copyConfigPanel: document.querySelector("#copyConfigPanel"),
  pasteConfigPanel: document.querySelector("#pasteConfigPanel"),
  defaultSyncFile: document.querySelector("#defaultSyncFile"),
  defaultSourceFile: document.querySelector("#defaultSourceFile"),
  defaultCopyPollMs: document.querySelector("#defaultCopyPollMs"),
  defaultPastePollMs: document.querySelector("#defaultPastePollMs"),
  defaultHeartbeatMs: document.querySelector("#defaultHeartbeatMs"),
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
  elements.controlMode.textContent = modeLabel;
  elements.startSelectedButton.textContent = `启动 ${modeLabel}`;
  elements.stopSelectedButton.textContent = `停止 ${modeLabel}`;
  elements.startSelectedButton.disabled = isRunning;
  elements.stopSelectedButton.disabled = !isRunning;
};

const renderDefaults = (defaults) => {
  elements.defaultSyncFile.textContent = defaults.syncFile;
  elements.defaultSourceFile.textContent = defaults.sourceFile;
  elements.defaultCopyPollMs.textContent = defaults.copyPollMs;
  elements.defaultPastePollMs.textContent = defaults.pastePollMs;
  elements.defaultHeartbeatMs.textContent = defaults.heartbeatMs;
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

const readConfigForm = () => ({
  runMode: getSelectedMode(),
  syncFile: elements.syncFile.value.trim(),
  sourceFile: elements.sourceFile.value.trim(),
  copyPollMs: Number(elements.copyPollMs.value),
  pastePollMs: Number(elements.pastePollMs.value),
  heartbeatMs: Number(elements.heartbeatMs.value),
  launchAtLogin: elements.launchAtLogin.checked,
});

const showMessage = (message, isError = false) => {
  elements.saveMessage.textContent = message;
  elements.saveMessage.style.color = isError ? "#ff9b9b" : "";
};

const withAction = async (action, successMessage) => {
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
  withAction(() => window.bridge.saveConfig(nextConfig), `配置已保存，当前模式为 ${modeLabel}`);
});

elements.startSelectedButton.addEventListener("click", () => {
  const modeLabel = MODE_LABELS[state.savedConfig?.runMode] ?? "Copy";
  withAction(() => window.bridge.startSelected(), `${modeLabel} 已启动`);
});

elements.stopSelectedButton.addEventListener("click", () => {
  const modeLabel = MODE_LABELS[state.savedConfig?.runMode] ?? "Copy";
  withAction(() => window.bridge.stopSelected(), `${modeLabel} 已停止`);
});

elements.launchAtLogin.addEventListener("change", () => {
  withAction(
    () => window.bridge.setLaunchAtLogin(elements.launchAtLogin.checked),
    `开机自启动已${elements.launchAtLogin.checked ? "开启" : "关闭"}`
  );
});

elements.clearLogsButton.addEventListener("click", () => {
  withAction(() => window.bridge.clearLogs(), "日志缓冲已清空");
});

elements.runModeInputs.forEach((input) => {
  input.addEventListener("change", () => {
    toggleModePanels(getSelectedMode());
    showMessage("模式已切换，保存后生效");
  });
});

window.bridge.onStateChanged((snapshot) => {
  renderSnapshot(snapshot);
});

window.bridge.onLogEntry((entry) => {
  state.logs = [...state.logs, entry].slice(-100);
  renderLogs();
});

window.addEventListener("DOMContentLoaded", async () => {
  try {
    const snapshot = await window.bridge.getState();
    renderSnapshot(snapshot);
    showMessage("每次只能运行一种模式，切换模式后请先保存配置");
  } catch (error) {
    showMessage(`初始化失败: ${error.message}`, true);
  }
});
