# 仅保留 Android App：后续清理记录

2026-11-17 用户要求删除根目录列出的 11 个旧 EXE/APK 文件，并删除独立 H5 功能。本记录取代同日早先 APK-only 方案中“保留 H5 开发预览”的决定。

## 删除与构建

- 指定的 Portable/Setup v1.3.56 EXE，以及 v1.3.55、v1.3.56、v1.3.57、v1.4.0 至 v1.4.5 APK 均已从根目录移除，送入回收站。两个受 Git 管理的旧 APK 也从当前版本删除。
- 删除 build-h5.cmd、start-h5.cmd、dev:h5/build:h5/dev:app npm 入口、开发代理及其专用测试、Vite server/proxy 配置。
- App 请求只通过 AndroidRouter 原生桥；删除浏览器代理、uni.request 回退、浏览器 Cookie 管理和浏览器原厂后台交互。Android 的 localhost 原厂后台、全屏入口、登录会话恢复、后台历史及两种电量算法保留。
- `npm run build:app` 现在实际执行 Gradle assembleRelease，输出 Android APK。Vue/uni-H5/Vite 继续编译 APK 内嵌的 WebView 页面，这是 App 的内部实现，不是独立 H5 产品。
- 页面中间产物改为 `android-wrapper/app/build/compiledUi`，Gradle 同步到打包资源目录。旧 dist 和源目录下已弃用的 assets/www 产物已送入回收站；构建没有重新创建 dist。

## 验证

| 检查 | factory | gauge88-csv |
| --- | --- | --- |
| 完整 JavaScript 测试 | 285 通过，0 失败 | 285 通过，0 失败 |
| `npm run build:app` | 成功 | 成功 |
| 内部编译资源、Gradle 资源和 APK | 6 个文件逐字节一致 | 6 个文件逐字节一致 |
| JS 与 BuildConfig 电量配置 | factory | gauge88-csv |
| `/router-api`、`/battery-api`、桌面和互通符号 | JS/DEX 无残留 | JS/DEX 无残留 |
| APK 签名、包名、版本 | 与既有安装身份一致 | 与既有安装身份一致 |

版本仍为 `1.4.5`/`77`，包名 `cn.mu5120.console`，未发布或安装到手机。本轮没有修改原生 Java；上轮的原生测试结果不计作本轮新测试。新增行为回归先复现无原生桥时仍走浏览器请求、原厂后台回退浏览器的问题，修改后通过。打包和原生会话边界经过独立只读审查。

- 常规包 SHA256：`c61d40386403736085f7537e025215f5750723c55ce1b6e4c6ee7f7520bfe73b`。
- 88 端口包 SHA256：`15ffa5d6e717aabea149dd59c540ded579112d9409c50079b3c99e4c1229349d`。

两个新包仍存于 `release-apks/U50PRO-Console-v1.4.5-apk-only-{factory,gauge88-csv}.apk`，替换上轮同名构建。

## 额外旧产物清理与限制

桌面 release 目录中的历史安装器已回收，桌面专用 node_modules 缓存已移出项目至 `C:/Users/xiaoze/.codex/retired-u50pro-2026-11-17/desktop-node-modules`。部分已解包桌面产物移出项目，其余可释放文件已回收。

唯一仍被占用的旧文件是 `desktop/release/win-unpacked/resources/app.asar`。Windows Restart Manager 确认占用者为当前 Codex 的 ChatGPT.exe 子进程；删除和移动均因文件锁失败。为保持当前工作会话，没有终止该进程。这个文件不再被项目引用或进入 APK 构建；退出 Codex 后可清理。

永久删除命令被自动审批规则拦截后，指定安装包改用可恢复回收方式成功清理。本次没有重新要求用户批准已经明确要求删除的文件。
