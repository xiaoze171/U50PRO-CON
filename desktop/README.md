# U50 Pro 控制台 · 桌面端（Electron）

桌面端是一个 Electron 外壳，**加载与 H5/安卓完全相同的界面构建**（`../dist/build/h5`），
通过 `preload.js` 暴露的 `window.DesktopRouter` 桥把路由器请求交给主进程处理
（主进程注入 `Origin/Referer/Cookie`、走局域网 HTTP），因此页面业务逻辑零改动、
与安卓 `AndroidRouter` 桥一一对应。

## 目录

| 文件 | 作用 | 对应安卓 |
|---|---|---|
| `main.js` | 主进程：建窗、加载 H5、桥接 IPC、会话/后台缓存 | `MainActivity` |
| `preload.js` | 暴露 `window.DesktopRouter`（方法面对齐 `AndroidRouter`） | `RouterBridge` 的 @JavascriptInterface 面 |
| `router-http.js` | 局域网路由器 HTTP 客户端（白名单/头/Cookie/重定向） | `RouterBridge.request()` |
| `session.js` | 共享单会话 Cookie | `RouterSession` |
| `store.js` | 窗口状态 / 后台电池历史持久化 | `BackgroundMonitorService` 的持久化部分 |

> Phase B 起会新增 `sync-server.js` / `discovery.js`（局域网互通），并在 `preload.js`
> 追加 `syncGetPeers / syncSetRole / syncPublish / syncFetch` 等方法。

## 开发运行

```bat
:: 仓库根目录
build-h5.cmd            :: 或 npm run build:h5
cd desktop
npm install
npm start
```

或直接用根目录的 `start-exe.cmd`（自动构建 H5 + 安装依赖 + 启动）。

## 打包 EXE

```bat
:: 仓库根目录，一键：构建 H5 → 安装依赖 → electron-builder 出 EXE
build-exe.cmd
```

产物在 `desktop/release/`：

- `U50PRO-Console-Setup-v1.3.21.exe` —— NSIS 安装版
- `U50PRO-Console-Portable-v1.3.21.exe` —— 便携版（免安装）

## 说明

- 主进程只允许访问局域网地址（`10.x` / `192.168.x` / `172.16-31.x` / `*.local` / localhost），
  与安卓 `isLocalRouterHost` 同源，防止桥被用作任意 HTTP 代理。
- 未提供应用图标时使用 Electron 默认图标；如需自定义，在 `build` 配置中加 `win.icon`。
