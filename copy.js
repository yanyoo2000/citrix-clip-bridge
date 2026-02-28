import clipboardy from "clipboardy";
import fs from "fs";
import path from "path";

const targetFile = process.env.SYNC_FILE || "D:\\clipboard.txt";
const pollMs = Number(process.env.COPY_POLL_MS || 500);
const renameFallbackCodes = new Set(["EPERM", "EACCES", "EBUSY"]);
let lastClipboardContent = "";
let times = 1;
let clipboardReadFailed = false;
let writeErrorShown = false;

if (Number.isNaN(pollMs) || pollMs < 50) {
  throw new Error("COPY_POLL_MS 必须是 >= 50 的数字");
}

const ensureDir = (filePath) => {
  const dir = path.dirname(filePath);
  if (dir && dir !== ".") {
    fs.mkdirSync(dir, { recursive: true });
  }
};

const normalizePathCandidate = (line) => {
  const candidate = line.trim();
  if (!candidate) {
    return null;
  }
  if (candidate.startsWith("file://")) {
    try {
      const url = new URL(candidate);
      return decodeURIComponent(url.pathname).replace(/^\//, "");
    } catch (err) {
      return null;
    }
  }
  return candidate;
};

const isAbsolutePathLike = (value) => {
  return /^[a-zA-Z]:\\/.test(value) || /^\\\\/.test(value) || /^\//.test(value);
};

// If clipboard text is actually a copied file list from Explorer/Finder,
// every line will usually be an absolute path that exists.
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
      // Some Citrix/Windows environments intermittently block rename.
      // Fallback to direct overwrite to keep sync alive.
      fs.writeFileSync(targetFile, text, "utf8");
      try {
        fs.unlinkSync(tmpFile);
      } catch (cleanupErr) {
        // Ignore temporary file cleanup errors.
      }
      console.warn(`rename失败(code=${code})，已降级为直接写入`);
    }

    if (writeErrorShown) {
      console.log("文件写入已恢复正常");
      writeErrorShown = false;
    }
    const preview = text.replace(/\r?\n/g, "\\n");
    console.log(`${times}. 剪贴板内容已同步到 ${targetFile}: ${preview.slice(0, 80)}`);
    times++;
    return true;
  } catch (err) {
    try {
      fs.unlinkSync(tmpFile);
    } catch (cleanupErr) {
      // Ignore temporary file cleanup errors.
    }
    if (!writeErrorShown) {
      console.error(`保存文件失败(code=${err.code || "unknown"}): ${err.message}`);
      writeErrorShown = true;
    }
    return false;
  }
};

try {
  lastClipboardContent = clipboardy.readSync();
} catch (error) {
  console.log("初始化时未读到可用剪贴板内容，继续监听");
}

process.on("uncaughtException", (err) => {
  console.error(`未捕获异常(code=${err.code || "unknown"}): ${err.message}`);
});

process.on("unhandledRejection", (reason) => {
  console.error("未处理 Promise 拒绝:", reason);
});

const isStringClipboard = (text) => {
  if (typeof text !== "string") {
    throw new Error("剪贴板内容不是字符串");
  }
  return true;
};

const intervalId = setInterval(() => {
  try {
    const text = clipboardy.readSync();
    isStringClipboard(text);
    clipboardReadFailed = false;
    if (text !== lastClipboardContent) {
      if (isFileListText(text)) {
        console.log("检测到文件复制内容，已跳过同步");
        lastClipboardContent = text;
        return;
      }
      if (saveClipboardToFile(text)) {
        lastClipboardContent = text;
      }
    }
  } catch (error) {
    if (!clipboardReadFailed) {
      console.log("跳过...当前剪贴板内容不可用");
      clipboardReadFailed = true;
    }
  }
}, pollMs);

console.log(`正在监听剪贴板内容，输出文件: ${targetFile}，轮询: ${pollMs}ms`);

process.on("SIGINT", () => {
  clearInterval(intervalId);
  console.log("程序结束，清理定时器");
  process.exit();
});
