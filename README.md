# citrix-clip-bridge

`citrix-clip-bridge` 是一个用于 Citrix 场景的剪贴板桥接工具。它通过一个共享文本文件，在本地 Windows 机器和 Citrix 会话之间同步剪贴板文本。

这个工具适合用于 Citrix 原生剪贴板不稳定、不可用、延迟高，或者被策略限制的场景。一端负责监听剪贴板并写入文件，另一端负责监听文件并把内容写回本地剪贴板。

## 工作原理

项目包含两个核心脚本：

- `copy.js`：监听当前环境的剪贴板，把文本变化写入同步文件
- `paste.js`：监听同步文件，把文件变化写回当前环境的剪贴板

典型流程如下：

1. 在产生新剪贴板内容的一侧运行 `copy.js`
2. 将内容写入一个两边都能访问到的共享路径
3. 在另一侧运行 `paste.js`，把文件变化同步回该侧的剪贴板

仓库内自带的批处理脚本使用的是一组常见的 Citrix 路径映射：

- `copy.bat` 写入 `C:\Users\Public\Documents\clipboard-sync\clipboard.txt`
- `paste.bat` 读取 `\\Client\C$\Users\Public\Documents\clipboard-sync\clipboard.txt`

## 运行要求

- 建议使用 Node.js 16 或更高版本
- 两边环境都需要能访问同一个同步文件路径
- 适用于 Windows 与 Citrix 会话之间的文件路径映射场景

## 安装

```bash
npm install
```

## 使用方法

### 启动写入端

写入端负责监听剪贴板，并把文本内容写入同步文件。

```bash
node copy.js
```

也可以直接使用批处理脚本：

```bat
copy.bat
```

### 启动读取端

读取端负责监听同步文件，并把新内容写入当前环境的剪贴板。

```bash
node paste.js
```

也可以直接使用批处理脚本：

```bat
paste.bat
```

通常是两边各运行一个脚本，共同组成完整的桥接链路。

## 环境变量

### `copy.js`

- `SYNC_FILE`：写入剪贴板文本的目标文件路径
- `COPY_POLL_MS`：轮询剪贴板的时间间隔，单位毫秒，最小值为 `50`

默认值：

- `SYNC_FILE=D:\clipboard.txt`
- `COPY_POLL_MS=500`

### `paste.js`

- `SOURCE_FILE`：需要监听并读取的源文件路径
- `PASTE_POLL_MS`：轮询文件变化的时间间隔，单位毫秒，最小值为 `50`
- `HEARTBEAT_MS`：心跳日志输出间隔，单位毫秒，最小值为 `1000`

默认值：

- `SOURCE_FILE=\\Client\D$\clipboard.txt`
- `PASTE_POLL_MS=500`
- `HEARTBEAT_MS=5000`

## 行为说明

- 当前只同步文本剪贴板内容
- 如果检测到剪贴板内容是文件路径列表，会主动跳过，不做同步
- `copy.js` 会优先通过临时文件加重命名的方式写入；如果在 Windows 或 Citrix 环境下重命名失败，会降级为直接覆盖写入
- `paste.js` 遇到 `EACCES`、`EPERM`、`EBUSY`、`ENOENT`、`ENOTFOUND` 这类临时读取错误时会持续重试

## 示例

本地机器：

```bat
set "SYNC_FILE=C:\Users\Public\Documents\clipboard-sync\clipboard.txt"
node copy.js
```

Citrix 会话中：

```bat
set "SOURCE_FILE=\\Client\C$\Users\Public\Documents\clipboard-sync\clipboard.txt"
node paste.js
```

## 限制

- 目前只支持文本，不支持图片、富文本或二进制剪贴板内容
- 两边必须能稳定访问同一个文件路径
- 当前实现基于轮询，不是事件驱动，因此同步是“接近实时”而不是严格实时
