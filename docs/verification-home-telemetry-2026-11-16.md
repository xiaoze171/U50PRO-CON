# 1.4.4 首页信号与温度改版验证

用户在 1.4.3 电池方案完成并安装后，要求重做留白过多的首页，并批准五块布局：运营商与上下行、电量及两个时间项、信号、温度、流量/设备/短信一行入口。手机纵向，宽屏两列。原电池估算实现及 1.4.3 安装证据见 `verification-home-battery-2026-11-16.md`。

## 实现范围

- `DashboardHome.vue` 展示当前信号的 RSRP、RSRQ、SINR、RSSI、频段、PCI、ARFCN、带宽和 CA；温度只列实际返回的传感器，异常独立标记。点击面板进入原趋势页。
- `home-telemetry.js` 按 LTE / NR / NSA 选择整组字段；NSA 分列 NR 与 LTE 锚点。不用邻区或锁频列表代替当前小区，不用 RSSI 代替 RSRP。SA 无已确认带宽时显示缺失。
- `index.vue` 在完整 dashboard 合并时记录 `telemetryTimestamp / telemetrySource / telemetryStale`。电池后台回补只推进电池信息，不推进信号和非电池温度的采集时间。
- 电池温度保持所选电量来源，要求 5 秒内采集；Gauge 另要求有效状态及有限且未过期的 `validUntil`。不从过期原始值或其他电量来源兜底。
- 保留独立的预计充满 / 剩余可用、手动刷新反馈、自动安静轮询和原有趋势功能。

未提交、未清理既有工作区修改。生产改动限首页组件、数据展示、版本信息及随包网页资源；本轮未修改原生采集和电池算法。

## 验证记录

- 新鲜度回归先失败后修复：原始 Gauge 保留温度过期仍显示、完整快照元数据未隔离两个用例在原实现失败；修复后 dashboard navigation 22 项通过。
- 全量 JS：`node --test tests/*.test.mjs`，166 / 166 通过，无跳过或失败。包括 13 项首页遥测模型测试，以及 Gauge 温度有效期、来源一致性、电池单独恢复不续期旧遥测等回归。
- 两轮独立只读审查未发现阻塞问题；额外使用真实 Vue 响应式计算验证电池单独恢复、Gauge 0°C、有效期边界及新快照清空温度。
- 最终 CSS 在视口至少 360px 时将四个信号指标并排、驻留信息三列排列；320px 保留两列，宽屏保留两列主面板。
- 最终 H5 构建输出 `DONE Build complete`，退出码 0。Android debug / release / instrumentation APK 均编译成功，84 个任务（31 executed、53 up-to-date），退出码 0。instrumentation APK 本轮未在手机执行；原生采集与电池算法本轮未改动。
- `git -c core.whitespace=cr-at-eol diff --check` 退出码 0；只有既有文件换行规范化提示。

## 安装包验证

- 包名 `cn.mu5120.console`，版本 `1.4.4` / `76`；根目录和桌面 package / lock、manifest、Gradle 版本同步，未重新打包桌面 EXE。
- release 非 debuggable，`BuildConfig.DEBUG=false`；沿用原签名，`apksigner verify` 通过。
- APK 内 6 个网页文件与最终 `dist/build/h5` 逐文件 SHA-256 一致，无多余旧网页资源。
- 复制前确认交付路径不存在，复制后核对 SHA-256 一致。
- 交付文件：`D:/code/github/U50PRO-CON/U50PRO-Console-v1.4.4.apk`，666,948 字节。

```text
APK SHA-256:
18a7284f917229bb22e3874d6760636ec3bec8fc9d7f130f156f6e5297d5a18e

签名证书 SHA-256:
30f26f85ad1c970de9c00ac9ba0e042f48855f065b73b6b64f7e7840b6323ff4
```

## 浏览器与真机界面

最终生产 H5 的隔离浏览器 QA 通过，结果文件 `qa-results.json` 为 `passed: true`：

- 320 / 360 / 390 / 411 / 768 / 1440 六种宽度均无横向溢出，五块布局和七个可点击入口符合预期；最小点击区域 93.33 × 55.5px。
- 七条导航与趋势页保留；首页没有图表画布。LTE / SA / NSA 分组、残留字段隔离、严格数字、零值、缺失值清空、采集失败过期、CPU 别名去重、温度边界及电量来源隔离均通过。
- 至少 360px 时，单组信号卡由约 341px 收紧到约 244px；390 / 411 首屏完整显示第一行电池温度。320px 保持可读两列，温度读数需向下滚动。
- `pageErrors=[]`，126 次 fixture 请求全部为 `GET router.test`，无真实设备请求和设备写操作。外部版本查询及框架图片请求保持阻止。
- 1440px 两列布局完整展示五块内容；局部卡片截图临时隐藏固定底栏，完整首页截图和首屏测量保留实际底栏。

截图目录：`C:/Users/xiaoze/.codex/visualizations/2026/11/16/01a1e215-3be3-7e61-8caa-4d8f59cb6976/home-telemetry/`。浏览器图片包括 `home-390.png`、`home-411.png`、`home-1440.png`、`home-nsa-signal.png`、`home-stale.png`；最终真机图为 `phone-home-1.4.4-final.png`。

## 手机覆盖安装

沿用用户“安装到手机”的授权，在唯一在线 vivo V2231A（`10ACAS1SDH000Q3`）执行 `adb install -r U50PRO-Console-v1.4.4.apk`。退出码 0，返回 `Success`。

- 安装前 1.4.3 / 75，安装后系统确认 1.4.4 / 76，更新时间 `2026-11-16 11:14:40`。
- 首次安装时间 `2026-10-12 21:52:15`、CE / DE 数据 inode `677189 / 677192`、数据目录 `/data/user/0/cn.mu5120.console` 和签名标识 `d2e98540` 均保持一致；未卸载或清数据。
- 从手机拉回 `base.apk`，SHA-256 与交付文件相同；安装后的应用无 `DEBUGGABLE` 标记。
- 冷启动返回 `Status: ok`，随后唤醒屏幕并关闭通知面板，等待系统动画完成后取得最终首页截图。早期锁屏及动画截图不作为界面通过证据。
- 最终真机首页五块完整可见，自动连接原设备。截图时为 SA / China Unicom，NR n78、PCI 226、ARFCN 627264，RSRP −105 dBm、RSRQ −12 dB、SINR 13 dB、RSSI −91.2 dBm；未确认的 SA 带宽和 CA 显示缺失。
- 电量 90.32%、放电中、预计可用约 24 小时 55 分钟；电池温度 33.8°C、射频 PA 34°C、Modem 35°C，Wi-Fi 芯片显示“读数异常”。这些是截图时刻的设备读数，非固定展示值。
- 保留已有顶部悬浮监测；未修改路由器、电量来源或后台设置。

安装前后元数据及哈希的自动核对结果见 `phone-verification.json`，`passed: true`。

过程日志：`.superpowers/sdd/2026-11-16-home-telemetry/`。

## 验证边界

LTE / NSA 切换和异常字段使用隔离 fixture 验证；真机确认当前 SA 及实际温度显示，未执行真实网络制式或充放电切换。真实路由器不执行锁频、校准、重启、短信操作或配置变更。fixture 不能替代真实状态切换，构建结果也不代表长期息屏运行结论。1.4.3 已有的最旧历史时间未直接比对限制继续保留。
