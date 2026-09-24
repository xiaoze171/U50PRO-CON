# v1.3.55 验证记录

日期：2026-09-24。接续 Claude 的后台采集任务，完成采集来源显示、顶部背景统一，并按最新要求移除电池图滑块。

- 来源：前台 `foreground`、后台 `background`、亮屏悬浮窗 `overlay`、息屏 `screenOff`；旧记录 `unknown`。采集时确定来源，归档、回补和跨设备合并保留标签。
- UI：曲线提示和续航列表显示来源，设置页显示最近 24 小时原生分钟归档来源计数。状态栏与顶部栏均为 `#EEF1F7`，使用深色系统图标。电池图无底部滑块。
- `node --test tests/*.test.mjs`：11 项通过。
- `node desktop/history-selftest.mjs`：16 项通过。
- 原生 JVM 存储验证：`tests/java/MonitorSourceTest.java` 使用真实 org.json，通过来源分类、分钟去重、重启及回补测试。
- Android V2231A 实机：`MonitorHistoryTest` 5 项通过。
- 实机连续归档：10:16 和 10:17 为 `overlay`，10:18 为 `background`，10:19 为 `screenOff`，10:20 为 `foreground`。返回前台后，读取 WebView 本地历史确认四种来源均已回补到信号及电池历史。
- 截图像素验证：系统状态栏与页面顶部栏背景均为 RGB `(238, 241, 247)`；电池记录来源标签可见，图下无滑块。
- H5、Android debug、Android test、Android release 构建通过。手机已覆盖安装 debug 包用于实机验证；发布包位于项目根目录 `U50PRO-Console-v1.3.55.apk`，已逐文件核对内嵌页面资源与最新构建一致。
- APK SHA-256：`B4D4F995EBA60BEF84C3EBE900758817FB1E22BFDE3EE379762AFDC27ABF0ED0`。

手机的悬浮窗开关已恢复为验证前的开启状态。
