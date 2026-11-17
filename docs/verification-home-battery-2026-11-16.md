# 首页与电池时间预估验证记录

日期：2026-11-16。执行计划：`docs/superpowers/plans/2026-11-16-home-battery-estimate.md`；设计：`docs/superpowers/specs/2026-11-16-home-battery-design.md`。

本轮已完成实现、离线回归、浏览器检查、H5 / Android 构建与最终 release APK 核验。随后用户明确要求“安装到手机”，已完成 1.4.3 覆盖安装及启动检查。工作基于 `codex/daily-monitor-ui` 的既有未提交修改，保留原工作区内容；未提交 Git commit、未清理用户文件、未清除应用数据。

## 实现结果

- 首页移除网速折线图，保留趋势页图表；突出网络、电量及独立的“预计充满 / 剩余可用”，提供用量、温度、设备、短信入口。手机卡片纵向排列，较宽屏幕并排显示。
- JS 与原生共同使用 schema 2 同源测量，严格校验数值、单位、模式与身份。自定义接口失败时不改用原厂数字；USB 接入不直接等同于净充电。电池详情温度、电流、电压、容量均跟随当前电量来源。
- 最近 5 分钟电流按实际时间间隔做梯形积分，至少 60 秒覆盖、3 个采样时刻后估算。来源、端点、模式、boot、容量或锚点改变，以及超过 120 秒的间隔会分段；不跨断线补算。
- 续航口径到 0%；充满与续航结果独立。充电且 SOC ≥95% 时显示“缓充中”，满充确认、低电流、低压、缺失值各有状态。只有电流或容量缺失时才允许连续 10–30 分钟 SOC 历史兼容估算。
- 前台和原生保存带 `segmentId / blockId / revision` 的分钟统计。恢复时按身份、覆盖和版本去重，采用完整、不重叠的统计块，采集权交接不二次积分。
- 已恢复或转发的统计只能用于窗口计算；只有实际采集产生且精确匹配的 `currentStatsUpdates` 才能创建对应历史归档。历史记录时间使用真实读数时间，与积分覆盖的起止时间分开。LAN 发布和接收都移除本机归档归属标记。
- 新鲜度采用固定的 `capturedAt / validUntil`，恢复、慢请求或页面重算不续期。后台回补同步恢复电池摘要、状态、时间和来源；陈旧摘要保留历史，但不展示实时估时。
- live 同步仅发送小型测量、统计和独立结果，不发送完整 samples；查看端沿用采集器结果及计算时间。归档保持分钟 / 状态边界节奏，不新增每秒重写完整 24 小时历史。

## 自动化回归

以下命令均在 `D:/code/github/U50PRO-CON` 执行。Windows 命令使用隐藏控制台的 PTY 模式；浏览器子进程使用 `windowsHide: true`。

| 检查 | 实际结果 |
| --- | --- |
| 全套 JS | 151 项通过，0 失败，退出码 0 |
| 桌面历史 | 16 项通过，退出码 0 |
| 桌面选举 | 14 项通过，退出码 0 |
| 桌面同步 | 29 项通过，退出码 0 |
| 原生 JVM | 7 类全部通过，退出码 0 |
| `git diff --check` | 退出码 0；只有既有换行转换提示 |

```powershell
node --test --test-reporter=tap tests/*.test.mjs > .superpowers/sdd/2026-11-16-home-battery-estimate/final-js-tests.tap
node desktop/history-selftest.mjs
node desktop/election-selftest.mjs
node desktop/sync-selftest.js
& ./tests/run-native-battery-tests.ps1
git diff --check
```

JVM 实际使用 `D:/config/jdk1.8.0_181/bin/javac.exe` 与 `java.exe`，以 Java 8 编译当前 main Java 和 `tests/java/*.java`，运行以下类：

1. `NativeBatteryGaugeTest`
2. `NativeBatteryCurrentWindowTest`
3. `NativeMonitorGaugeHistoryTest`
4. `NativeBatteryHistoryTest`
5. `MonitorSourceTest`
6. `MonitorTemperatureTest`
7. `NativeSyncPublicationTest`

可重复运行入口是 `tests/run-native-battery-tests.ps1`。其编译 / 执行命令为：

```powershell
& javac -encoding UTF-8 -source 8 -target 8 -cp $classPath -d $output @sources
& java -cp "$output;$classPath" "cn.mu5120.console.$test" $fixturePath
```

`$classPath` 按以下顺序组成，真实 org.json 位于 Android stub 前：

- `C:/Users/xiaoze/.gradle/caches/modules-2/files-2.1/org.json/json/20180813/8566b2b0391d9d4479ea225645c6ed47ef17fe41/json-20180813.jar`
- `.android-sdk/platforms/android-30/android.jar`
- `android-wrapper/app/build/intermediates/compile_and_runtime_not_namespaced_r_class_jar/debug/R.jar`

共享 fixture 为 `tests/fixtures/battery-estimate-cases.json`，编译输出在 `.superpowers/sdd/2026-11-16-home-battery-estimate/jvm-classes`。JVM 测试覆盖同源归一、解析积分、分钟拆分、重复采样、身份往返切换、非重叠恢复、历史原子替换、真实采集归属及同步缓存。编译有 deprecated API 提示，无错误。

## 浏览器验证

使用本次生产 H5 产物及本地隔离 fixture，命令：

```powershell
node .superpowers/sdd/2026-11-16-home-battery-estimate/qa-home.cjs
```

退出码 0，`qa-results.json` 的 `passed` 为 true，`pageErrors` 为空。没有调用真实路由器、设备写接口或短信发送。浏览器和临时静态服务结束后均已关闭。

检查宽度为 320、360、390、411、768、1440px，六种宽度均无横向溢出；首页 canvas 数量为 0，最小入口高度为 53.5px。768 / 1440px 网络卡与电池卡并排。另验证：

- 信号、电池、用量、温度、设备、短信六项导航正常，趋势页网速图仍存在。
- 电池详情显示 fixture 的 31°C，而非原厂的 45°C；净电流 −400.00mA、电压 4.000V、容量 8000mAh。
- 自动轮询不旋转，手动刷新开始旋转并在完成后停止。
- 实际零速显示 `0.0 B/s`，缺失速率为 `—`；长接口诊断不撑开首页；失败电量源不保留旧数字估时。
- 放电约 10 小时、充电约 4 小时、97% 净充电显示“缓充中”、确认满充显示“已充满”。

截图及结果目录：`C:/Users/xiaoze/.codex/visualizations/2026/11/16/01a1e215-3be3-7e61-8caa-4d8f59cb6976`。包括 `home-320.png` 至 `home-1440.png`、`battery-details.png`、`throughput-trend.png`、零速 / 缺失 / 充电 / 缓充 / 满充截图和 `qa-results.json`。

## 构建与 APK

在最终生产源码冻结后执行：

```powershell
npm run build:h5
$env:JAVA_HOME = 'D:/config/jdk1.8.0_181'
& 'D:/config/gradle-6.9.4/bin/gradle.bat' -p android-wrapper -I 'D:/code/github/U50PRO-CON/.superpowers/sdd/2026-11-16-home-battery-estimate/package-web.gradle' assembleDebug assembleRelease assembleDebugAndroidTest
& ./.superpowers/sdd/2026-11-16-home-battery-estimate/verify-apk.ps1
```

H5 输出 `DONE Build complete`，退出码 0。Android 输出 `BUILD SUCCESSFUL`，退出码 0，84 个任务（16 executed、68 up-to-date）。使用本地 compileSdk 30 / build-tools 30.0.3；存在 namespace 映射、nonTransitive 与 deprecated API 提示，无构建错误。Android instrumentation APK 已编译，未在设备上运行。

本轮专用 Gradle init 脚本同步当前 `dist/build/h5`，未使用指向旧版本产物的其他打包脚本。APK 检查实际通过：

- 包名 `cn.mu5120.console`，版本 `1.4.3`，versionCode `75`。根目录与桌面 package / lock、manifest、Gradle 版本同步；未重新打包桌面 EXE。
- `apksigner verify --verbose --print-certs` 成功，沿用原证书。
- release 无 `application-debuggable`，生成的 `BuildConfig.DEBUG=false`；WebView 调试调用由 `BuildConfig.DEBUG` 控制。
- APK 中全部 6 个 `assets/www` 文件与本次 `dist/build/h5` 逐文件 SHA-256 一致，无多余旧资源。
- 从 release 输出复制到项目根目录，复制前确认目标不存在，复制后 SHA-256 再次相等。

交付文件：`D:/code/github/U50PRO-CON/U50PRO-Console-v1.4.3.apk`，1,111,233 字节。

```text
APK SHA-256:
bb401347e4cbe18f052ce22c11bb8334bbf8419efc534f898fe997b46a53f2e4

签名证书 SHA-256:
30f26f85ad1c970de9c00ac9ba0e042f48855f065b73b6b64f7e7840b6323ff4
```

## 用户授权后的手机安装

用户后续明确要求“安装到手机”。ADB 确认唯一在线设备为 vivo V2231A（`10ACAS1SDH000Q3`），安装前为 1.4.2 / 74。执行：

```powershell
& ./.android-sdk/platform-tools/adb.exe -s 10ACAS1SDH000Q3 install -r ./U50PRO-Console-v1.4.3.apk
& ./.android-sdk/platform-tools/adb.exe -s 10ACAS1SDH000Q3 shell dumpsys package cn.mu5120.console
& ./.android-sdk/platform-tools/adb.exe -s 10ACAS1SDH000Q3 shell am start -W -n cn.mu5120.console/.MainActivity
```

- 覆盖安装退出码 0，返回 `Success`；系统确认 1.4.3 / 75，`lastUpdateTime=2026-11-16 10:46:31`。
- `firstInstallTime=2026-10-12 21:52:15`、`ceDataInode=677189`、`deDataInode=677192`、数据目录及签名标识均与安装前一致。没有卸载或清除数据。
- 拉取安装后的 `base.apk`，SHA-256 与交付包完全相同：`bb401347e4cbe18f052ce22c11bb8334bbf8419efc534f898fe997b46a53f2e4`。
- 冷启动 `Status: ok`，实际首页正常显示并自动连接，观察到电量 92.33%、放电中及“采集中”状态，网速 / 信号 / 温度异常提醒正常。
- 设置保留路由器地址、自定义电量来源、空 IP、端口 88、悬浮监测及 LAN 启用状态；未修改这些设置。
- 安装包无 `DEBUGGABLE` 标记，启动后未发现 WebView 调试 socket。
- UIAutomator dump 未生成文件，未将其当作验证成功；使用实际屏幕截图核对首页和设置。截图为上述可视化目录中的 `phone-home-1.4.3.png`、`phone-settings-1.4.3.png`、`phone-battery-source-1.4.3.png`。

安装前后 dumpsys、安装输出及拉取 APK 保存在任务跟踪目录。当前 release 不开启 WebView 调试，本轮没有直接读取安装前后的完整私有历史并逐项比对，不能声称最旧历史时间已验证一致。

## 审查及验证边界

独立集成审查未发现剩余阻塞项。审查中发现的读数续期、SOC 兼容模型跨源、历史统计错误绑定当前读数、归档归属、详情温度来源、恢复摘要元数据问题均已修复并有相应回归。详细过程保存在 `.superpowers/sdd/2026-11-16-home-battery-estimate` 的基线、进度和各模块报告中。

本轮已执行覆盖安装、启动和配置检查；没有执行真实充放电切换、真实原厂 / 88 / 不可达端口切换、重启恢复、长期息屏采集或最旧历史时间直接比对。对应计划项保留为后续条件项，不能用 fixture、JVM 或编译成功代替真机结论。后台权限仍由用户后续配置。

估时依赖当前负载和软件容量依据，负载变化会改变结果；缓充阶段以状态代替数字，不保证实际充满或关机时刻。
