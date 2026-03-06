import clipboardy from "clipboardy";
import fs from "fs";
import path from "path";

export const DEFAULT_SYNC_FILE = "D:\\clipboard.txt";
export const DEFAULT_COPY_POLL_MS = 500;

const renameFallbackCodes = new Set(["EPERM", "EACCES", "EBUSY"]);

const normalizePathCandidate = (line) => {
  const candidate = line.trim();
  if (!candidate) {
    return null;
  }

  if (candidate.startsWith("file://")) {
    try {
      const url = new URL(candidate);
      return decodeURIComponent(url.pathname).replace(/^\//, "");
    } catch {
      return null;
    }
  }

  return candidate;
};

const isAbsolutePathLike = (value) =>
  /^[a-zA-Z]:\\/.test(value) || /^\\\\/.test(value) || /^\//.test(value);

const ensureDir = (filePath) => {
  const dir = path.dirname(filePath);
  if (dir && dir !== ".") {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const isFileListText = (text) => {
  const lines = text
    .split(/\r?\n/)
    .map(normalizePathCandidate)
    .filter(Boolean);

  if (lines.length === 0) {
    return false;
  }

  if (!lines.every(isAbsolutePathLike)) {
    return false;
  }

  return lines.every((item) => fs.existsSync(item));
};

const validatePollMs = (pollMs) => {
  if (Number.isNaN(pollMs) || pollMs < 50) {
    throw new Error("COPY_POLL_MS 必须是 >= 50 的数字");
  }
};

export const createClipboardToFileSync = ({
  targetFile = DEFAULT_SYNC_FILE,
  pollMs = DEFAULT_COPY_POLL_MS,
  onLog = () => {},
} = {}) => {
  validatePollMs(pollMs);

  let lastClipboardContent = "";
  let times = 1;
  let clipboardReadFailed = false;
  let writeErrorShown = false;
  let intervalId = null;

  const log = (level, message) => {
    onLog({
      source: "copy",
      level,
      message,
      timestamp: new Date().toISOString(),
    });
  };

  const saveClipboardToFile = (text) => {
    const tmpFile = `${targetFile}.tmp-${process.pid}`;

    try {
      ensureDir(targetFile);
      fs.writeFileSync(tmpFile, text, "utf8");

      try {
        fs.renameSync(tmpFile, targetFile);
      } catch (renameErr) {
        const code = renameErr.code || "unknown";
        if (!renameFallbackCodes.has(code)) {
          throw renameErr;
        }

        fs.writeFileSync(targetFile, text, "utf8");
        try {
          fs.unlinkSync(tmpFile);
        } catch {
          // Ignore temporary file cleanup errors.
        }
        log("warn", `rename失败(code=${code})，已降级为直接写入`);
      }

      if (writeErrorShown) {
        log("info", "文件写入已恢复正常");
        writeErrorShown = false;
      }

      const preview = text.replace(/\r?\n/g, "\\n");
      log(
        "info",
        `${times}. 剪贴板内容已同步到 ${targetFile}: ${preview.slice(0, 80)}`
      );
      times += 1;
      return true;
    } catch (err) {
      try {
        fs.unlinkSync(tmpFile);
      } catch {
        // Ignore temporary file cleanup errors.
      }

      if (!writeErrorShown) {
        log(
          "error",
          `保存文件失败(code=${err.code || "unknown"}): ${err.message}`
        );
        writeErrorShown = true;
      }
      return false;
    }
  };

  const tick = () => {
    try {
      const text = clipboardy.readSync();
      if (typeof text !== "string") {
        throw new Error("剪贴板内容不是字符串");
      }

      clipboardReadFailed = false;
      if (text === lastClipboardContent) {
        return;
      }

      if (isFileListText(text)) {
        log("info", "检测到文件复制内容，已跳过同步");
        lastClipboardContent = text;
        return;
      }

      if (saveClipboardToFile(text)) {
        lastClipboardContent = text;
      }
    } catch {
      if (!clipboardReadFailed) {
        log("warn", "跳过...当前剪贴板内容不可用");
        clipboardReadFailed = true;
      }
    }
  };

  return {
    start() {
      if (intervalId) {
        return false;
      }

      try {
        lastClipboardContent = clipboardy.readSync();
      } catch {
        log("info", "初始化时未读到可用剪贴板内容，继续监听");
      }

      intervalId = setInterval(tick, pollMs);
      log(
        "info",
        `正在监听剪贴板内容，输出文件: ${targetFile}，轮询: ${pollMs}ms`
      );
      return true;
    },

    stop() {
      if (!intervalId) {
        return false;
      }

      clearInterval(intervalId);
      intervalId = null;
      log("info", "Copy 已停止，监听定时器已清理");
      return true;
    },

    isRunning() {
      return Boolean(intervalId);
    },

    getConfig() {
      return { targetFile, pollMs };
    },
  };
};
