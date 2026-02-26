import clipboardy from "clipboardy";
import fs from "fs";

let lastClipboardContent = "";
let times = 1;
let isClipboardContentString = true;

// 初始化 lastClipboardContent
try {
  lastClipboardContent = clipboardy.readSync();
} catch (error) {
  console.log("初始化时剪切板内容不是string或为空，设置为默认值");
}

const saveClipboardToTxt = (text) => {
  try {
    fs.writeFileSync("D:\\clipboard.txt", text + "\n");
    console.log(times + ". 剪切板内容已保存到clipboard.txt文件中: ");
    isClipboardContentString = true;
    console.log(text.slice(0, 50) + " ......");
    times++;
  } catch (err) {
    console.error("保存文件时出现错误: " + err);
  }
};

const intervalId = setInterval(() => {
  try {
    const text = clipboardy.readSync();
    if (typeof text !== 'string') {
      throw new Error("剪切板内容不是string");
    }
    if (text !== lastClipboardContent) {
      saveClipboardToTxt(text);
      lastClipboardContent = text;
    }
  } catch (error) {
    if (!isClipboardContentString) {
      return;
    }
    console.log("跳过...当前剪切板的内容不是string或为空");
    isClipboardContentString = false;
  }
}, 1000);

console.log("正在监听剪切板内容…");

process.on("SIGINT", () => {
  clearInterval(intervalId);
  console.log("程序结束，清理定时器");
  process.exit();
});
