# APK-only 验证记录 · 2026-11-17

用户确认删除 EXE 产品及全部设备互通，包括手机之间的数据同步、设备发现与采集器选举。Android 的路由器访问、本机前后台采集、历史回补、悬浮窗、原厂后台和 APK 更新继续保留。

## 实现

- 删除受 Git 管理的 Electron 桌面源码、依赖清单、锁文件、EXE 启动/构建脚本及桌面专用测试。
- 删除前端互通设置、角色、选举、发布/接收生命周期及 DesktopRouter 通道；页面直接访问路由器，历史合并只用于本机恢复。
- 删除 Android SyncServer、DiscoveryBeacon、互通桥接方法和组播权限；保留 HTTP/历史任务释放及原厂后台的 localhost 代理。
- 将路由器登录哈希移至 RouterAuth，保持 UTF-8、十六进制大写及动态 LD 的双层 SHA256 语义。
- H5/Vue/Vite 继续生成 APK 页面。开发代理不再依赖桌面模块，保留局域网地址约束、Cookie 隔离和响应大小限制。
- 历史文档及已有未跟踪安装包、工具目录保留。

## 验证

两种配置分别执行完整 JavaScript 测试及发布构建；原生测试通过显式 Profile 参数生成对应 BuildConfig。

| 检查 | 常规版 factory | 88 端口版 gauge88-csv |
| --- | --- | --- |
| `node --test tests/*.test.mjs` | 283 通过，0 失败 | 283 通过，0 失败 |
| `./tests/run-native-battery-tests.ps1 -Profile ...` | 12 组 JVM 测试通过 | 12 组 JVM 测试通过 |
| 共享 CSV 解析/估算用例 | 57 通过 | 57 通过 |
| `gradle :app:assembleRelease :app:compileDebugAndroidTestJavaWithJavac --offline --console plain` | 通过 | 通过 |
| APK 网页文件与当前生成资源 | 6 个文件逐字节一致 | 6 个文件逐字节一致 |
| BuildConfig 与网页配置常量 | factory | gauge88-csv |
| JS/DEX 中已删除的互通和桌面符号 | 无残留 | 无残留 |
| Android 组播权限 | 已删除 | 已删除 |

两包均为 `cn.mu5120.console`、版本 `1.4.5`、versionCode `77`。签名校验通过，且与此前安装的常规版签名证书一致，SHA256 为 `30f26f85ad1c970de9c00ac9ba0e042f48855f065b73b6b64f7e7840b6323ff4`。

两包均包含 RouterAuth、RouterBridge、BackgroundMonitorService、MonitorHistoryStore、StockProxyServer、RouterSession 和 UpdateBridge；不包含 SyncServer、DiscoveryBeacon、DesktopRouter 或互通桥接方法。

生成文件位于 `release-apks/`：

- `U50PRO-Console-v1.4.5-apk-only-factory.apk`，SHA256 `1500d63148d837a89e2e52a4de1110eab87df4b772c76ebcf395d0c3ce9b38f3`。
- `U50PRO-Console-v1.4.5-apk-only-gauge88-csv.apk`，SHA256 `40d9aeb88f06fdc32a57aee728b6d6fd6da1791613f24810061116d7e9d293c6`。

本轮运行了 JVM 测试和 Android instrumentation 源码编译，没有在手机上执行 instrumentation，也没有安装这两个新包。构建保留已有旧 SDK 元数据、实验配置及弃用 API 提示，退出码为 0。

## 审查与修正

前端/打包、Android 原生分别经过独立只读审查，无待修复问题。完整 JavaScript 验证发现新增的原厂后台测试缺少 VM 上下文中的 stockOpenMode：复现为 24 通过/1 失败，补充实际 Android navigate 模式后为 25 通过/0 失败，保留了 URL、会话与 busy 状态断言；独立复审通过，两种配置完整测试均通过。

开发代理独立导入测试在移除桌面依赖前复现 MODULE_NOT_FOUND，修正后 4 项代理测试通过。新增原生回归覆盖固定/非 ASCII 登录向量、真实 LOGIN 请求及 Cookie、桥接 HTTP/历史线程池和 localhost 代理释放，以及本机历史摘要。

详细测试、构建和 APK 验证日志随本记录保存。分支验收要求：`codex/daily-monitor-ui` 与 `codex/battery-88-csv` 仅 `config/battery-profile.json` 不同，其余源代码及 UI 相同。
