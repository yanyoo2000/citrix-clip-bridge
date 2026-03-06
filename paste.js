import {
  createFileToClipboardSync,
  DEFAULT_HEARTBEAT_MS,
  DEFAULT_PASTE_POLL_MS,
  DEFAULT_SOURCE_FILE,
} from "./lib/paste-sync.js";

const targetFile = process.env.SOURCE_FILE || DEFAULT_SOURCE_FILE;
const pollMs = Number(process.env.PASTE_POLL_MS || DEFAULT_PASTE_POLL_MS);
const heartbeatMs = Number(process.env.HEARTBEAT_MS || DEFAULT_HEARTBEAT_MS);

const logToConsole = ({ level, message }) => {
  if (level === "error") {
    console.error(message);
    return;
  }

  if (level === "warn") {
    console.warn(message);
    return;
  }

  console.log(message);
};

const service = createFileToClipboardSync({
  sourceFile: targetFile,
  pollMs,
  heartbeatMs,
  onLog: logToConsole,
});

process.on("uncaughtException", (err) => {
  console.error(`未捕获异常(code=${err.code || "unknown"}): ${err.message}`);
});

process.on("unhandledRejection", (reason) => {
  console.error("未处理 Promise 拒绝:", reason);
});

service.start();

process.on("SIGINT", () => {
  service.stop();
  process.exit();
});
