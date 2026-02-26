import clipboardy from "clipboardy";
import fs from "fs";

let targetFile = "\\\\Client\\D$\\clipboard.txt";
let lastFileContent = fs.readFileSync(targetFile, "utf8");
let times = 0;

// 定义一个函数用于保存剪切板内容到txt文件
const writeTextToClipboard = () => {
  try {
    const newFileContent = fs.readFileSync(targetFile, "utf8").trim()
    if (newFileContent !== lastFileContent || times === 0) {
      clipboardy.writeSync(newFileContent);
      console.log(times + ". 文件内容已复制到剪切板");
      times++;
      lastFileContent = newFileContent;
    }
  } catch (err) {
    console.error("复制文件时出现错误: " + err);
  }
};

// 定时检查文件内容变化并复制到剪贴板
writeTextToClipboard();
const intervalId = setInterval(() => {
  writeTextToClipboard();
}, 500);
console.log("正在监听文件内容变化...");

// 程序结束时清理定时器
process.on("SIGINT", () => {
  clearInterval(intervalId);
  console.log("程序结束，清理定时器");
  process.exit();
});
