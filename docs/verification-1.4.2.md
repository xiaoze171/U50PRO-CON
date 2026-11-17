# 1.4.2 验证记录

日期：2026-11-15。用户已授权实现并覆盖安装，确认“原厂电量接口”读取 `battery_vol_percent / battery_value`，另一选项通过自定义 IP、端口读取 `/state.json` 的 `soc`。

## 功能与界面

- 设置新增“电量来源”二级页面，可选择原厂接口或自定义接口。IP 留空跟随路由器地址，默认端口 88；当前保存为自定义接口、空 IP、端口 88。
- 来源、IP 和端口保存并传入 Android 后台服务，重启后恢复。编辑草稿与已保存配置分离，连接设置不会覆盖电量设置。
- 自定义接口不可用、读数无效或过期时显示“—”，不回退为原厂百分比，不写入虚假的电量样本。优先使用 `X-Gauge-Age`，有效范围 0–5 秒；保留原始响应，数值显示至两位小数。
- 历史记录保留百分比来源和接口地址；切换来源或地址后不会混用变化速率和续航估算，同一分钟内的来源转换也能保留。
- 电量设置采用紧凑浅色布局：两等宽选项、13px 字体和 38px 高输入框、76px 保存按钮。Wi-Fi 原始 `-80` 仍显示“读数异常”，保留诊断原值。
- 桌面端电量请求的会话隔离贯穿重定向链，避免路径改变后发送或覆盖原厂登录 Cookie；这一修复不涉及 Android 交付包。

## 验证

- 最终 JavaScript 全套测试：72 项通过、0 失败；桌面历史自检：16 项通过。包含自定义接口解析、代理、保存切换和两项异步旧请求竞态回归。
- 桌面重定向回归使用本地服务器先复现 Cookie 泄漏，再修复通过；两次重定向的电量请求始终不发送或写入登录 Cookie，原厂重定向仍发送并更新会话。相关四项代理测试均通过。
- JVM 验证通过：`NativeBatteryGaugeTest`、`NativeMonitorGaugeHistoryTest`、`NativeBatteryHistoryTest`、`MonitorSourceTest`、`MonitorTemperatureTest`。原生同分钟来源与地址切换回归先复现失败，再修复通过。
- H5 生产构建及 Android debug/release 构建成功；`git diff --check` 通过。
- vivo V2231A（`10ACAS1SDH000Q3`）测试版验证原厂约 50%、自定义 88 端口约 20%、不可达 89 端口显示“—”、端口 0 拒绝保存。三种模式均完成强制停止后恢复设置及原生悬浮窗采样验证；不可达接口百分比为 null，没有原厂回退。最终恢复空 IP、端口 88。
- 设置编辑回归通过：未保存的来源不生效，离开后重进重置未保存端口，保存连接配置保留电量来源。
- 最终测试版检查 17 个页面，包括首页、趋势、温度、电池、信号、设备、网络调优、设备详情、短信、写短信和设置的二级页面：无横向溢出、无脚本异常；返回正常。
- 设置页检查 320、411、1440 宽度均无横向溢出。短信头部约 98.8 CSS px，无空验证码行；自动轮询旋转次数 0，手动刷新完成后停止旋转。没有发送或删除真实短信。
- 电池历史最旧时间 `1794735573893` 保持不变；最终页面回归时可读取 215 条电池记录。
- 独立复查核对了来源选择、保存恢复、失效处理、历史隔离与前台竞态修复，12 项针对性测试通过。原生集成及最终 UI 未完成充分的独立审查，不声称完整独立审查通过。

## 正式安装

- 交付：项目根目录 `U50PRO-Console-v1.4.2.apk`，版本 1.4.2 / versionCode 74。
- release 签名 SHA-256 与原安装相同：`30f26f85ad1c970de9c00ac9ba0e042f48855f065b73b6b64f7e7840b6323ff4`。
- `adb install -r` 返回 `Success`。系统确认 1.4.2 / 74，无 `DEBUGGABLE` 标记，无 WebView 调试 socket。
- `firstInstallTime=2026-10-12 21:52:15`、`ceDataInode=677189`、`deDataInode=677192` 均未改变；没有卸载或清除数据。
- 从手机拉取已安装 `base.apk`，与交付 APK 的 SHA-256 一致：`c71c0f80247b41d840c99e4f45e888654e9120c36db48d3309460374f9bf4d15`。
- 正式包首页与设置截图确认已有连接、历史曲线及自定义电量正常，当前约 19%；设置显示原厂/自定义选项、空 IP、端口 88 和 `http://192.168.0.1:88/state.json`。最终停留首页。

机器记录与截图位于 `C:/Users/xiaoze/.codex/visualizations/2026/11/15/01a1de93-eab2-7340-b590-1c40a6b35b43/u50-app-compact`，主要文件为 `phone-verification-1.4.2.json`、`phone-battery-persistence-1.4.2.json`、`phone-battery-editor-1.4.2.json`、`battery-layout-1.4.2.json`、`phone-sms-refresh-verification-1.4.2.json`、`phone-release-install-1.4.2.json`、`phone-release-home-142.png`、`phone-release-battery-settings-142.png`、`js-tests-final-1.4.2.log` 和 `desktop-history-tests-final-1.4.2.log`。

用户选择后台权限稍后配置，本轮不作长期息屏稳定性通过声明。专用 Vite、Chrome 测试进程及 ADB 9226 转发已关闭。临时 `.qa-native` 编译文件的删除被自动执行检查拒绝（仅返回 `blocked by policy`），已保留，不影响交付包。
