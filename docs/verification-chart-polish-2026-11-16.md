# 1.4.5 折线图与首页信号入口验证

用户要求首页点击信号进入信号调优，并批准对所有折线图按“显示更清晰、操作更顺畅”统一优化。沿用安装到手机的授权，在原 1.4.4 上覆盖安装 1.4.5。原电池估算和五块首页保留，前序记录见 `verification-home-battery-2026-11-16.md` 和 `verification-home-telemetry-2026-11-16.md`。

## 实现

- 首页网络卡、信号卡均进入既有 `devices/radio` 网络调优页；调优页继续提供进入信号趋势的入口。
- 网速、温度、电量、信号趋势及调优页共用 `chart-options.js`。坐标、单位、图例和移动端高度统一；24 小时横轴带日期，网速按范围选择 B/s、KB/s、MB/s。
- 直接绘制采样值，取消温度平均和平滑、单点补造。超过 90 秒的采样间隔断开；电量来源或端点变化也断开，孤立点和最新点可见。CPU 别名合并，传感器使用稳定标识与颜色。
- 提示框显示采样时间、真实数值、单位与采集来源；不同时间的数据不标为同一时刻，缺失值不显示。内容转义，颜色标记不接受任意 HTML。窄屏长列表可滚动。
- 刷新、窗口尺寸改变和恢复前台时保留图例选择及页码；切换指标清理旧序列。取消动画、合并重复渲染、保留原生纵向滚动。
- 隐藏的点使用 `symbol: 'none'`，避免 11 × 1440 点生成大量无效显示对象。真实 ECharts 回归要求显示对象少于 200。
- 在真实 DOM 下纠正 uni H5 的 `wx` shim 引发的 ECharts 小程序环境误判，使 HTML 提示框及浏览器触摸事件正常；无 DOM 环境不改动。

本轮没有改变历史存储格式、原生采集、电池估算算法或路由器设置。既有信号历史采集选值逻辑保持原样；本轮验证的是曲线展示与交互。保留工作区已有修改，未暂存、提交或清理。

## 自动化与构建

- `node --test tests/*.test.mjs`：189 / 189 通过，0 失败、0 跳过。日志 `.superpowers/sdd/2026-11-16-chart-polish/tests.log`。
- 回归覆盖真实数据和缺口、来源变化、CPU 别名、低速精度、真实 ECharts 渲染、混合采样时间提示框、图例状态、触摸处理及 H5 环境修正。
- 独立审查确认提示框时间筛选和最终环境修正无必须修复的问题；最终环境修正另有 2 项定向回归通过。
- 最终 H5 构建 `DONE Build complete`，退出码 0。
- 最终 Android `assembleDebug assembleRelease assembleDebugAndroidTest`：`BUILD SUCCESSFUL`，84 个任务（9 executed、75 up-to-date），退出码 0。instrumentation APK 仅编译，本轮未在手机执行测试包。
- `git -c core.whitespace=cr-at-eol diff --check` 退出码 0，存在既有 LF/CRLF 规范化提示。

## 浏览器验证

最终构建通过隔离的生产 H5 浏览器 QA：

- 320 / 390 / 1440px 三种宽度，网速、温度、电量、信号四类图表，2 / 24 小时两个时间窗，共 24 组显示检查。
- 首页两处信号入口、调优页趋势入口及趋势切换，共 12 项导航检查。
- 5 项交互：触摸点开提示框、长温度列表内部滚动、实时刷新及尺寸变化和恢复保留图例状态、图表区域纵向拖动滚动页面、321 B/s 低速值正常显示。
- 多温度字段含 CPU 别名、十分钟缺口及密集全天历史；提示框保持在图表边界内，单位与日期可读。
- `passed: true`，`pageErrors: []`。使用隔离 fixture，未请求真实路由器、未进行设备写操作。ECharts 实例检查通过临时 HTTP 响应注入，不进入生产文件或 APK。

脚本：`.superpowers/sdd/2026-11-16-chart-polish/qa-charts.cjs`。

报告与截图目录：`C:/Users/xiaoze/.codex/visualizations/2026/11/16/01a1e215-3be3-7e61-8caa-4d8f59cb6976/chart-polish/`。

最终 `qa-results.json` 与截图已复核，包括 `temperature-24h-390-tooltip.png`、`signal-2h-320-tooltip.png`、`throughput-24h-1440-tooltip.png`、`radio-390.png`。目录中的旧 `*-missing-tooltip.png` 是修复前诊断图，不属于最终通过证据。

## 安装包与手机

- 交付：`D:/code/github/U50PRO-CON/U50PRO-Console-v1.4.5.apk`，1,118,839 字节。
- 包名 `cn.mu5120.console`，版本 `1.4.5` / `77`；相关 package、lock、manifest、Gradle 和 README 版本同步。本轮未重新打包桌面 EXE。
- release 非 debuggable、`BuildConfig.DEBUG=false`；原签名验证通过。
- APK 中 6 个网页文件与最终 `dist/build/h5` 逐文件 SHA-256 一致，无多余旧资源。

```text
APK SHA-256:
12c0f6b0d5c687ba9e120402472740d5139019c80726700e7b56dff4be57c847

签名证书 SHA-256:
30f26f85ad1c970de9c00ac9ba0e042f48855f065b73b6b64f7e7840b6323ff4
```

在 vivo V2231A（`10ACAS1SDH000Q3`）执行 `adb install -r`，返回 `Success`，退出码 0。

- 系统确认由 1.4.4 / 76 更新到 1.4.5 / 77；更新时间 `2026-11-16 14:16:20`。
- 首次安装时间 `2026-10-12 21:52:15`、CE / DE 数据 inode `677189 / 677192`、数据目录 `/data/user/0/cn.mu5120.console` 和签名标识 `d2e98540` 均保持一致；未卸载、未清除数据。
- 拉回已安装 `base.apk`，SHA-256 与交付文件完全一致；已安装包无 `DEBUGGABLE` 标记。
- 冷启动 `Status: ok`。首页仍自动连接原设备，信号、实际温度和电量正常展示。
- 真机点击首页信号面板、顶部网络卡均进入“网络调优”，无线质量趋势正常绘制；点击真实采样点出现日期、RSRP 值、dBm 与“前台”来源提示框。调优页按钮进入信号趋势，完成检查后返回首页。
- 真机依次查看温度、电量和网速 24 小时图，历史记录、采样缺口、日期、单位及最新点正常；温度曲线可点击显示实际温度和“息屏”等采集来源。
- 真机截图：`phone-home-1.4.5.png`、`phone-radio-1.4.5.png`、`phone-speed-entry-1.4.5.png`、`phone-radio-trend-1.4.5.png`、`phone-radio-tooltip-1.4.5.png`、`phone-signal-1.4.5.png`、`phone-temperature-1.4.5.png`、`phone-temperature-tooltip-1.4.5.png`、`phone-battery-1.4.5.png`、`phone-throughput-1.4.5.png`，均在上述截图目录。

安装元数据、哈希核对 `phone-verification.json` 为 `passed: true`。构建、签名、资源、安装、启动日志在 `.superpowers/sdd/2026-11-16-chart-polish/`。

## 验证边界

浏览器多传感器和密集曲线场景使用 fixture；真机检查当前实际数据和导航、点击提示框。未执行路由器锁频、扫描、校准、重启或设置变更，未进行长期息屏性能测量。原历史数据仍可见，但未逐条比对安装前后的历史记录。
