const state = {
  logs: [],
};

const elements = {
  syncFile: document.querySelector("#syncFile"),
  sourceFile: document.querySelector("#sourceFile"),
  copyPollMs: document.querySelector("#copyPollMs"),
  pastePollMs: document.querySelector("#pastePollMs"),
  heartbeatMs: document.querySelector("#heartbeatMs"),
  launchAtLogin: document.querySelector("#launchAtLogin"),
  appState: document.querySelector("#appState"),
  copyState: document.querySelector("#copyState"),
  pasteState: document.querySelector("#pasteState"),
  defaultSyncFile: document.querySelector("#defaultSyncFile"),
  defaultSourceFile: document.querySelector("#defaultSourceFile"),
  defaultCopyPollMs: document.querySelector("#defaultCopyPollMs"),
  defaultPastePollMs: document.querySelector("#defaultPastePollMs"),
  defaultHeartbeatMs: document.querySelector("#defaultHeartbeatMs"),
  saveMessage: document.querySelector("#saveMessage"),
  logs: document.querySelector("#logs"),
  saveConfigButton: document.querySelector("#saveConfigButton"),
  startAllButton: document.querySelector("#startAllButton"),
  stopAllButton: document.querySelector("#stopAllButton"),
  startCopyButton: document.querySelector("#startCopyButton"),
  stopCopyButton: document.querySelector("#stopCopyButton"),
  startPasteButton: document.querySelector("#startPasteButton"),
  stopPasteButton: document.querySelector("#stopPasteButton"),
  clearLogsButton: document.querySelector("#clearLogsButton"),
};

const renderStatus = (runtime) => {
  const allRunning = runtime.copyRunning && runtime.pasteRunning;
  const anyRunning = runtime.copyRunning || runtime.pasteRunning;

  elements.appState.textContent = allRunning ? "双向同步中" : anyRunning ? "部分运行中" : "全部已停止";
  elements.copyState.textContent = runtime.copyRunning ? "运行中" : "已停止";
  elements.pasteState.textContent = runtime.pasteRunning ? "运行中" : "已停止";

  elements.startAllButton.disabled = allRunning;
  elements.stopAllButton.disabled = !anyRunning;
  elements.startCopyButton.disabled = runtime.copyRunning;
  elements.stopCopyButton.disabled = !runtime.copyRunning;
  elements.startPasteButton.disabled = runtime.pasteRunning;
  elements.stopPasteButton.disabled = !runtime.pasteRunning;
};

const renderDefaults = (defaults) => {
  elements.defaultSyncFile.textContent = defaults.syncFile;
  elements.defaultSourceFile.textContent = defaults.sourceFile;
  elements.defaultCopyPollMs.textContent = defaults.copyPollMs;
  elements.defaultPastePollMs.textContent = defaults.pastePollMs;
  elements.defaultHeartbeatMs.textContent = defaults.heartbeatMs;
};

const renderConfig = (config) => {
  elements.syncFile.value = config.syncFile ?? "";
  elements.sourceFile.value = config.sourceFile ?? "";
  elements.copyPollMs.value = config.copyPollMs ?? "";
  elements.pastePollMs.value = config.pastePollMs ?? "";
  elements.heartbeatMs.value = config.heartbeatMs ?? "";
  elements.launchAtLogin.checked = Boolean(config.launchAtLogin);
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
  renderStatus(snapshot.runtime);
  renderDefaults(snapshot.defaults);
  state.logs = snapshot.logs ?? [];
  renderLogs();
};

const readConfigForm = () => ({
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
  withAction(() => window.bridge.saveConfig(nextConfig), "配置已保存");
});

elements.startAllButton.addEventListener("click", () => {
  withAction(() => window.bridge.startAll(), "Copy / Paste 已全部启动");
});

elements.stopAllButton.addEventListener("click", () => {
  withAction(() => window.bridge.stopAll(), "Copy / Paste 已全部停止");
});

elements.startCopyButton.addEventListener("click", () => {
  withAction(() => window.bridge.startCopy(), "Copy 已启动");
});

elements.stopCopyButton.addEventListener("click", () => {
  withAction(() => window.bridge.stopCopy(), "Copy 已停止");
});

elements.startPasteButton.addEventListener("click", () => {
  withAction(() => window.bridge.startPaste(), "Paste 已启动");
});

elements.stopPasteButton.addEventListener("click", () => {
  withAction(() => window.bridge.stopPaste(), "Paste 已停止");
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
    showMessage("配置修改后会立即同步到后台");
  } catch (error) {
    showMessage(`初始化失败: ${error.message}`, true);
  }
});
