import clipboardy from "clipboardy";
import fs from "fs";

export const DEFAULT_SOURCE_FILE = "\\\\Client\\D$\\clipboard.txt";
export const DEFAULT_PASTE_POLL_MS = 500;
export const DEFAULT_HEARTBEAT_MS = 5000;

const retriableReadCodes = new Set([
  "EACCES",
  "EPERM",
  "EBUSY",
  "ENOENT",
  "ENOTFOUND",
]);

const validatePollMs = (pollMs) => {
  if (Number.isNaN(pollMs) || pollMs < 50) {
    throw new Error("PASTE_POLL_MS 必须是 >= 50 的数字");
  }
};

const validateHeartbeatMs = (heartbeatMs) => {
  if (Number.isNaN(heartbeatMs) || heartbeatMs < 1000) {
    throw new Error("HEARTBEAT_MS 必须是 >= 1000 的数字");
  }
};

export const createFileToClipboardSync = ({
  sourceFile = DEFAULT_SOURCE_FILE,
  pollMs = DEFAULT_PASTE_POLL_MS,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  onLog = () => {},
} = {}) => {
  validatePollMs(pollMs);
  validateHeartbeatMs(heartbeatMs);

  let lastFileContent = null;
  let times = 1;
  let readErrorShown = false;
  let lastLoopAt = Date.now();
  let lastSyncAt = 0;
  let heartbeatSeq = 0;
  let intervalId = null;
  let heartbeatId = null;

  const log = (level, message) => {
    onLog({
      source: "paste",
      level,
      message,
      timestamp: new Date().toISOString(),
    });
  };

  const tick = () => {
    lastLoopAt = Date.now();
    try {
      const newFileContent = fs.readFileSync(sourceFile, "utf8");
      if (readErrorShown) {
        log("info", `已恢复读取: ${sourceFile}`);
        readErrorShown = false;
      }

      if (newFileContent !== lastFileContent || times === 0) {
        clipboardy.writeSync(newFileContent);
        const preview = newFileContent.replace(/\r?\n/g, "\\n");
        log("info", `${times}. 文件内容已复制到剪贴板: ${preview.slice(0, 80)}`);
        times += 1;
        lastFileContent = newFileContent;
        lastSyncAt = Date.now();
      }
    } catch (err) {
      if (!readErrorShown) {
        const code = err.code || "unknown";
        if (retriableReadCodes.has(code)) {
          log("warn", `读取失败(code=${code})，继续重试: ${err.message}`);
        } else {
          log("error", `复制文件失败(code=${code}): ${err.message}`);
        }
        readErrorShown = true;
      }
    }
  };

  const heartbeat = () => {
    heartbeatSeq += 1;
    const now = Date.now();
    const idleMs = now - lastLoopAt;
    const syncText =
      lastSyncAt === 0 ? "尚未同步成功" : `${Math.round((now - lastSyncAt) / 1000)}s前`;
    log("debug", `[hb#${heartbeatSeq}] alive loopIdle=${idleMs}ms lastSync=${syncText}`);
  };

  return {
    start() {
      if (intervalId || heartbeatId) {
        return false;
      }

      tick();
      intervalId = setInterval(tick, pollMs);
      heartbeatId = setInterval(heartbeat, heartbeatMs);
      log(
        "info",
        `正在监听文件内容变化，源文件: ${sourceFile}，轮询: ${pollMs}ms，heartbeat: ${heartbeatMs}ms`
      );
      return true;
    },

    stop() {
      if (!intervalId && !heartbeatId) {
        return false;
      }

      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
      if (heartbeatId) {
        clearInterval(heartbeatId);
        heartbeatId = null;
      }
      log("info", "Paste 已停止，监听定时器已清理");
      return true;
    },

    isRunning() {
      return Boolean(intervalId);
    },

    getConfig() {
      return { sourceFile, pollMs, heartbeatMs };
    },
  };
};
