import clipboardy from "clipboardy";
import fs from "fs";

const targetFile = process.env.SOURCE_FILE || "\\\\Client\\D$\\clipboard.txt";
const pollMs = Number(process.env.PASTE_POLL_MS || 500);
const heartbeatMs = Number(process.env.HEARTBEAT_MS || 5000);
const retriableReadCodes = new Set(["EACCES", "EPERM", "EBUSY", "ENOENT", "ENOTFOUND"]);
let lastFileContent = null;
let times = 0;
let readErrorShown = false;
let lastLoopAt = Date.now();
let lastSyncAt = 0;
let heartbeatSeq = 0;

if (Number.isNaN(pollMs) || pollMs < 50) {
  throw new Error("PASTE_POLL_MS 必须是 >= 50 的数字");
}
if (Number.isNaN(heartbeatMs) || heartbeatMs < 1000) {
  throw new Error("HEARTBEAT_MS 必须是 >= 1000 的数字");
}

const writeTextToClipboard = () => {
  lastLoopAt = Date.now();
  try {
    const newFileContent = fs.readFileSync(targetFile, "utf8");
    if (readErrorShown) {
      console.log(`已恢复读取: ${targetFile}`);
      readErrorShown = false;
    }
    if (newFileContent !== lastFileContent || times === 0) {
      clipboardy.writeSync(newFileContent);
      const preview = newFileContent.replace(/\r?\n/g, "\\n");
      console.log(`${times}. 文件内容已复制到剪贴板: ${preview.slice(0, 80)}`);
      times++;
      lastFileContent = newFileContent;
      lastSyncAt = Date.now();
    }
  } catch (err) {
    if (!readErrorShown) {
      const code = err.code || "unknown";
      if (retriableReadCodes.has(code)) {
        console.error(`读取失败(code=${code})，继续重试: ${err.message}`);
      } else {
        console.error(`复制文件失败(code=${code}): ${err.message}`);
      }
      readErrorShown = true;
    }
  }
};

// 定时检查文件内容变化并复制到剪贴板
writeTextToClipboard();
const intervalId = setInterval(() => {
  writeTextToClipboard();
}, pollMs);
const heartbeatId = setInterval(() => {
  heartbeatSeq++;
  const now = Date.now();
  const idleMs = now - lastLoopAt;
  const syncText = lastSyncAt === 0 ? "尚未同步成功" : `${Math.round((now - lastSyncAt) / 1000)}s前`;
  console.log(`[hb#${heartbeatSeq}] alive loopIdle=${idleMs}ms lastSync=${syncText}`);
}, heartbeatMs);
console.log(
  `正在监听文件内容变化，源文件: ${targetFile}，轮询: ${pollMs}ms，heartbeat: ${heartbeatMs}ms`
);

// 程序结束时清理定时器
process.on("SIGINT", () => {
  clearInterval(intervalId);
  clearInterval(heartbeatId);
  console.log("程序结束，清理定时器");
  process.exit();
});
