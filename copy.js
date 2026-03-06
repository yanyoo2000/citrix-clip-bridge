import {
  createClipboardToFileSync,
  DEFAULT_COPY_POLL_MS,
  DEFAULT_SYNC_FILE,
} from "./lib/copy-sync.js";

const targetFile = process.env.SYNC_FILE || DEFAULT_SYNC_FILE;
const pollMs = Number(process.env.COPY_POLL_MS || DEFAULT_COPY_POLL_MS);

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

process.on("uncaughtException", (err) => {
  console.error(`未捕获异常(code=${err.code || "unknown"}): ${err.message}`);
});

process.on("unhandledRejection", (reason) => {
  console.error("未处理 Promise 拒绝:", reason);
});

const service = createClipboardToFileSync({
  targetFile,
  pollMs,
  onLog: logToConsole,
});

service.start();

process.on("SIGINT", () => {
  service.stop();
  process.exit();
});
