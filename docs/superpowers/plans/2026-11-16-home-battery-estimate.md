# 首页收紧与电池时间预估 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 首页只突出信号、实时网速、电量和状态适用的两个时间项；利用自定义电池接口净电流与可用容量改进预估。

**Architecture:** JS 读数归一与纯估算模块负责规则，前台和桌面复用。Android 后台输出相同单位的读数和分钟电流统计，前台恢复后由同一 JS 模型计算。历史和 LAN 保留身份、时刻与估算依据。

**Tech Stack:** Vue 3.4.21、uni-app、JavaScript ES modules、Android Java 8 / WebView、Node test runner、ECharts 6.1.0。

**Spec:** `docs/superpowers/specs/2026-11-16-home-battery-design.md`。执行前先读该设计和 `docs/verification-1.4.2.md`，不要只按任务标题实施。

## Global Constraints

- 当前工作目录 `D:\code\github\U50PRO-CON`，分支 `codex/daily-monitor-ui` 有大量既有未提交改动；不得 reset、clean 或覆盖其它工作。仅提交本轮明确文件，不使用 `git add .`。
- Windows 的 `exec_command` 明确 `tty: true`；后台进程隐藏窗口，Node 子进程 `windowsHide: true`，PowerShell `Start-Process -WindowStyle Hidden`。不得回退到会闪窗的 pipe 模式。
- 本轮原作者只写方案；执行者获得用户实现指令后才改应用、构建或安装。
- 电量来源设置保持原厂 / 自定义，空 IP 跟随路由器，默认 88 端口；禁止硬编码 `192.168.0.1` 或容量 8780。
- 自定义接口有效条件：`data_quality === 'ok'`、严格数值 SOC 0–100、鲜度 0–5 秒，优先 `X-Gauge-Age`；异常不回退原厂。
- 页面电量两位小数，时间用原始 SOC；两时间项独立，满充确认与低压优先；平均窗口 5 分钟，至少 60 秒覆盖/3 个时刻，净电流门槛 50 mA，超过 120 秒缺口分段。
- 首页数字 24px，时间 14px，正文 12px，标签 11px；手机内边距 12px、间距 8px、圆角 10px，点击区域至少 44px；大于 680px 两主卡并列。
- 仅移除首页图表，保留网速历史和趋势页；保留温度 −80 异常校验、短信、Cookie 隔离和用户历史。
- 不导入或执行保存的设备页面脚本；不自动将设备 CSV 合并 App 历史；不调用校准/清零等写接口。
- 修改完成后再验证与安装，不能把昨日 72 项测试通过当本次验证；安装沿用 `cn.mu5120.console` 与现有签名，使用 `adb install -r`，不得卸载或清数据。

---

## Task 1: 归一电池测量与模式

**Files:**

- Modify: `src/utils/battery-gauge.js:39`。
- Modify: `android-wrapper/app/src/main/java/cn/mu5120/console/BatteryGaugeReading.java`。
- Test: `tests/battery-gauge.test.mjs`、`tests/java/NativeBatteryGaugeTest.java`。
- Create: `tests/fixtures/battery-estimate-cases.json`，只复制测量必要字段，去掉真实 boot ID 和网络信息。

**Interfaces:** 新增 `normalizeBatteryMeasurement(status)`；原生同语义方法。无测量返回 null，禁止从无效 marker 的 raw 恢复数字。

```js
// 新契约。字段由同一源产生，measurement 作为原子对象替换。
{
  schemaVersion: 2,
  rawSoc: 50,
  mode: 'discharging', // charging/discharging/full/confirming/external/unknown
  netCurrentMa: -400,
  voltageMv: 4000,
  netPowerW: -1.6,
  usableCapacityMah: 8000,
  capacityBasis: 'fixture',
  externalPower: false,
  fullConfirmed: false,
  fullAnchorValid: true,
  fullStableSeconds: 0,
  eodImminent: false,
  eodClamp: false,
  bootId: 'fixture-boot',
  sampleMonoSeconds: 60,
  anchorIdentity: 'fixture-anchor'
}
```

- [x] 先新增 JS/JVM fixture 回归：原厂 charging=true 而自定义 Discharging / −400 mA 时读数仍属于自定义；USB=1 不得强行变充电；容量 used/nominal 不混用；null、字符串电流不可算数。
- [x] 运行 `node --test tests/battery-gauge.test.mjs`，确认新增用例先失败。
- [x] 实现归一，保留当前 batteryGaugeReading/batteryPercent 等既有 API。mode 决策遵循设计 4.1；电流方向矛盾用 unknown/待确认，不扩大未知状态枚举的含义。
- [x] 原生归一用同份 fixture 校验单位/状态；不复制未经确认的原厂电流单位规则。
- [x] JS 回归通过后检查限定文件 diff；如果执行者提交，仅 stage 上述文件并提交 `feat: normalize software battery measurements`。实施、回归和限定 diff 审查已完成；条件性分步提交未执行。

## Task 2: 实现纯电流统计与时间模型

**Files:**

- Create: `src/utils/battery-estimate.js`。
- Create: `src/utils/battery-current-window.js`。
- Create: `tests/battery-estimate.test.mjs`、`tests/battery-current-window.test.mjs`。

**Interfaces:**

```js
// ingest 的时间使用本机接收时间；同 boot 的 mono 用来校验采样间隔。
createBatteryCurrentWindow({ windowMs: 300000, maxGapMs: 120000 });
// 实例提供 ingest({ receivedAt, endpoint, measurement }), reset(), snapshot(),
// restore(currentStatsList, { receivedAt, identity })。
// restore 只导入最近5分钟内、同身份且不重叠的有效统计；缺失/冲突块不相加。
// snapshot 输出 { meanCurrentMa, observedDurationMs, sampleCount,
//                 windowStart, windowEnd, identity }，没覆盖时 meanCurrentMa=null。

estimateBatteryTimes({ measurement, currentWindow, samples, calculatedAt,
                      runtimeTargetPercent: 0 });
// runtimeTargetPercent 是内部口径参数，首页固定0，不新增用户设置；20用于口径回归。
// 返回两个独立结果，不携带完整 samples：
{
  timeToFull: { minutes: null, state: 'not-applicable', method: null,
               reason: '未充电', targetPercent: 100 },
  runtime: { minutes: 600, state: 'estimated', method: 'net-current',
             reason: '', targetPercent: 0 },
  calculatedAt: 1800000060000,
  windowSeconds: 60
}
```

- [x] 先写恒定电流解析用例，避免只镜像内部公式。例如 50%/8000 mAh/−400 mA/60 秒覆盖输出 runtime.minutes=600，充电 50%/+1000 mA 输出 timeToFull.minutes=240，另一项 minutes 为 null。
- [x] 统计模块写变步长验证：t=0/10/70 秒，电流 −200/−200/−600 mA；梯形积分平均绝对电流为 `(200×10 + 400×60)/70`，不能用三个读数的算术平均。重复 mono 和逆序样本不增加覆盖。
- [x] 运行 `node --test tests/battery-estimate.test.mjs tests/battery-current-window.test.mjs`，先确认新增断言失败。
- [x] 实现 5 分钟时间加权窗口，实际间隔积分；来源/端点、模式、boot、容量/锚点身份变化 reset，超过 120 秒 gap reset。只保存小型窗口，过期样本移除；不往断线区间补电量。
- [x] restore 导入完整落在窗口内的分钟统计和最近 live 的非重叠当前分钟统计，检查 startAt/endAt、覆盖不大于时段、identity 与最新测量一致。先按 blockId 去重，同块取较高 revision；同一分钟不同 segmentId 的不重叠块全部保留。不同块有重叠时取较新且完整的一块，不能凭整块积分推算被裁剪的半块，也不把前台和后台对同一时段的积分相加。
- [x] 实现设计 4.2–4.4。低电流不以 Infinity 表示；缺少容量/电流才允许 SOC 兼容模型。兼容斜率先按当前来源筛选，再分连续段；中位点对速率最少跨度 5 分钟，总窗口 10–30 分钟。
- [x] 添加净充电且 95% 缓充、97% 放电仍给续航、Full 未确认/已确认、eod、未知方向、0%/0 分钟、到 20% 与到 0% 区别、粗粒度原厂跳变、容量改变的数值/状态回归；计时格式化留给展示层。
- [x] 运行上述测试通过，限定文件 diff 后可提交 `feat: estimate battery time from net current`。实施、回归和限定 diff 审查已完成；条件性分步提交未执行。

## Task 3: 前台与原生后台记录同源统计

**Files:**

- Modify: `src/services/router-client.js:169`、`:537`、`:617`。
- Modify: `src/utils/history.js:74`。
- Modify: `android-wrapper/app/src/main/java/cn/mu5120/console/BackgroundMonitorService.java:478`。
- Modify: `android-wrapper/app/src/main/java/cn/mu5120/console/MonitorHistoryStore.java:39`、`:137`、`:184`。
- Create: `android-wrapper/app/src/main/java/cn/mu5120/console/BatteryCurrentWindow.java`。
- Test: `tests/background-history.test.mjs`、`tests/collection-source.test.mjs`、`tests/java/NativeBatteryHistoryTest.java`、`tests/java/NativeMonitorGaugeHistoryTest.java`。

**Interfaces:**

- `batterySummary` 输出 measurement、mode 和 Task 2 的 `timeToFull/runtime`，原 `remainingHours/ratePerHour` 仅为迁移兼容项，不能继续做首页真值源。
- 历史样本新增 `measurement` 与 `currentStats`。currentStats 为一个采集段内的分钟电流统计块：`{ segmentId, blockId, revision, startAt, endAt, integralMaMs, observedDurationMs, sampleCount, identity }`。累计积分除以覆盖得到均值；缺失区间不填补。同一分钟可以保留多个不重叠采集块，不把分钟时间戳当作唯一键。
- identity 包含百分比来源、标准化端点、模式、boot、容量与锚点身份。新统计不与缺失 identity 的旧统计混合。
- segmentId 在每次采集权交接或窗口 reset 时生成，须在前台和原生采集实例之间唯一；blockId 可由 segmentId 与分钟起点构成，块延长时保持不变，revision 递增。逻辑测量 identity 不包含 segmentId，因此恢复时可合并同源不同采集段的有效非重叠覆盖；存储/合并键必须包含 blockId。

- [x] 先新增回归：同一分钟从充电→Full→直供保留状态边界；同一分钟前台→后台→前台、同 identity 的三个非重叠块全部保留；重复 live+归档回填只计算一次，同块高 revision 替换低 revision；重启、地址或容量基准改变不跨段；旧端覆盖新记录时 measurement/currentStats 清 null，不继承 previous 的净电流。
- [x] 运行 `node --test tests/background-history.test.mjs tests/collection-source.test.mjs tests/battery-config-race.test.mjs`，确认新断言先失败。
- [x] 前台每次有效读数更新窗口，电量历史继续保持原分钟点/采集来源；额外聚合每分钟电流统计。在分钟结束或既有归档节奏持久化，禁止每秒重写完整 24 小时数组。当前分钟的统计放在小型 live 摘要。
- [x] 使用 Task 1 的测量模式替代 chargingState 原厂优先逻辑，软件历史 temperature/current/voltage/capacity 同源；保留旧 history 结构可读。
- [x] mergeBatterySamples 对 measurement/currentStats 原子替换并校验；桶身份纳入 blockId，旧记录 identity 明确为 legacy。同一统计块按 revision 替换，不相加积分；同一分钟不同采集块分别保留。图表展示仍可按分钟归并百分比点，不能以图表降采样结果覆盖电流统计块。
- [x] 原生 BatteryCurrentWindow 输出相同统计单位。前台传入自己的统计时只接收/保存，不在后台二次积分同一采样；原生独立采集时才自己 ingest。
- [x] 调整剥离 battery 的桥接/存档代码，允许小型测量/统计摘要、禁止 samples；后台归档恢复上述字段。
- [x] 给 JVM 加与 Task 2 相同的恒流和变步长统计 fixture，用真实 org.json JVM 库验证。仓库没有统一 JVM 运行脚本，执行者需将可重复的 javac/java 命令记录进本轮 verification 文档，不能使用 Android SDK stub 作为运行时 org.json。
- [x] 相关 JS/JVM 用例通过后审查源隔离、写入频率和数据体积；限定文件可提交 `feat: retain battery current statistics across monitoring modes`。实施、回归和限定 diff 审查已完成；条件性分步提交未执行。

## Task 4: 历史恢复、LAN 与电池详情消费新结果

**Files:**

- Modify: `src/pages/index/index.vue:949`、`:1173`、`:1749`、`:2348`。
- Modify: `src/services/sync.js:152`、`:305`。
- Test: `tests/background-history.test.mjs`、`tests/sync-performance.test.mjs`、`tests/sync-temperature.test.mjs`。
- Test: `android-wrapper/app/src/androidTest/java/cn/mu5120/console/SyncPublicationTest.java`，只验证数据传输，不扩大后台 LAN 功能。

**Interfaces:** 首页使用 `batteryTimeToFullText` / `batteryRuntimeText` 两个 computed，分别消费 timeToFull/runtime。旧 `remainingHours` 只经兼容适配，不能同时灌入两项。

- [x] 写后台恢复/旧 payload 回归：保存 marker valid 但采集时间陈旧不显示实时估时；足够新同源统计在下次有效读数时恢复；LAN 不带 samples 的两个结果透传且保持 calculatedAt。
- [x] `backfillBackgroundHistory` 合并 samples 和统计后重算当前 summary；不要只替换 `battery.samples`。当前读数不存在/陈旧时保留历史并显示待刷新。
- [x] compact live 保留两个结果和小型依据对象，完整历史仍单独发送；旧 payload 无新字段时安全归一。查看端不能用自己不同端点的窗口重算采集器值。
- [x] 两个时间 formatter 实现设计状态表、5 分钟取整、少于 5 分钟、超过 72 小时与真实零值；不展示“接口读取失败”的长技术字符串撑开首页。
- [x] 电池详情增加净电流 mA、净功率 W、电压 V、可用容量 mAh、USB 输入与质量、系统轨、累计充放 mAh、满充观察和采样缺口。页面标注总续航到 0% 的口径和软件容量依据。
- [x] 运行 `node --test tests/background-history.test.mjs tests/sync-performance.test.mjs tests/sync-temperature.test.mjs` 与原生传输回归；限定文件可提交 `feat: expose independent battery time estimates`。实施、回归和限定 diff 审查已完成；条件性分步提交未执行。

## Task 5: 收紧首页，移除首页折线图

**Files:**

- Modify: `src/components/DashboardHome.vue:12`、`:22`、`:52`、`:79`、`:84`。
- Modify: `src/pages/index/index.vue:70`、`:936`、`:1204`。
- Modify: `src/pages/index/index.css`，仅确实参与首页布局的选择器。
- Test: `tests/dashboard-navigation.test.mjs`、`tests/chart-performance.test.mjs`、`tests/temperature.test.mjs`。

- [x] 删除首页实时速率标题、AppChart 元素、首页独有 import/prop 和 `homeSpeedChartOption`；保留 `throughputOption`、throughputChartOption、histories 与趋势页 AppChart。
- [x] 删除 `.home-speed { grid-row: span 2 }` 与图表高度变量，避免留空。按设计第 3 节排列网络卡、电池卡和四个小入口，清理首页完整套餐/温度列表。
- [x] runtime prop 拆两个时间展示字段，绑定真实状态文字。温度入口保留小型异常提示，移除首页 selectHomeTemperatures 时同步调整直接测试此函数的旧用例。
- [x] 用既有 resolveNavigation ID 实现卡片/入口点击，不新增路由，不触发设备扫描或发送短信。
- [x] 运行 `node --test tests/dashboard-navigation.test.mjs tests/chart-performance.test.mjs tests/temperature.test.mjs`。
- [x] 用浏览器/测试包查看 320、360、390、411、768、1440px，截图核对核心数字、两时间项、0速/缺失、长状态文本、无图表空白和横向溢出。此低风险样式改动以页面检查为主，不新增逐条匹配 CSS 字符串的测试。
- [x] 验证自动轮询不旋转、手动刷新结束后停止；趋势网速图和四入口正常。限定文件可提交 `ui: focus home on network and battery status`。实施、回归、浏览器检查和限定 diff 审查已完成；条件性分步提交未执行。

## Task 6: 最终验证与交付

**Files:**

- Modify: `README.md` 的当前功能/版本说明。
- Create: `docs/verification-home-battery-2026-11-16.md`。
- 实际交付时更新版本：`package.json`、`package-lock.json`、`src/manifest.json`、`android-wrapper/app/build.gradle`，桌面包版本按本项目一贯方式同步，不自动重新打包桌面 EXE。

- [x] 全套 JS、桌面历史/互通测试与 diff 检查：JS 当前 151 项通过；桌面历史、选举、同步分别 16 / 14 / 29 项通过。

```powershell
node --test tests/*.test.mjs
node desktop/history-selftest.mjs
node desktop/election-selftest.mjs
node desktop/sync-selftest.js
git diff --check
```

- [x] 运行新统计和原生历史相关 JVM fixture，记录真实执行命令、退出码和通过项；7 类 JVM 回归通过，命令和证据由本轮 verification 文档记录。未完成的平台检查仍列为后续条件项。
- [x] 最终冻结源文件的 H5 / Android 重打包与输出核验。`npm run build:h5` 退出码 0；Android debug / release / androidTest 构建成功，84 个任务（16 executed、68 up-to-date）。最终 release 内全部 6 个网页文件与当前 `dist/build/h5` 逐文件哈希相等，无旧资源；详细命令记录在 verification 文档。
- [x] 版本已同步为 1.4.3 / 75；`package.json`、`package-lock.json`、`src/manifest.json`、`android-wrapper/app/build.gradle` 按项目方式保持一致。版本更新不代表已安装。
- [x] 最终 APK 的正式签名与 release 配置核验：`apksigner verify` 成功，证书与原基线一致；release 无 debuggable 标记，`BuildConfig.DEBUG=false`，WebView 调试受该标记控制。交付 `U50PRO-Console-v1.4.3.apk`，复制后哈希与已核验 release 相同。
- [ ] 后续条件项：获用户真机测试 / 安装授权后，用测试包覆盖充电/放电显示、背景回补、重启恢复设置、原厂/88/不可达端口切换。本轮未做真机验证；设备写接口不作为测试。缓充/低压等无法现场制造的状态用 fixture，不宣称真机全部状态验证。
- [x] 用户后续明确要求“安装到手机”，已执行下列覆盖安装与版本核验，返回 `Success`，手机确认为 1.4.3 / 75：

```powershell
.\.android-sdk\platform-tools\adb.exe -s 10ACAS1SDH000Q3 install -r .\U50PRO-Console-v1.4.3.apk
.\.android-sdk\platform-tools\adb.exe -s 10ACAS1SDH000Q3 shell dumpsys package cn.mu5120.console
```

- [ ] 安装后核验：版本、签名、安装 `Success`、配置、数据目录 inode 和首次安装时间已核对；拉取的已安装 APK 与交付包哈希一致。最旧历史时间未直接比对，因此此组合项不勾全。原基线签名 SHA256：`30f26f85ad1c970de9c00ac9ba0e042f48855f065b73b6b64f7e7840b6323ff4`。未卸载、未清数据。
- [x] 最终文档收尾：README 功能 / 版本说明与 `docs/verification-home-battery-2026-11-16.md` 已更新，记录回归、六宽度浏览器检查、最终构建、签名和产物哈希。缓充阶段使用状态代替数字；后台权限由用户稍后配置，不宣称长期息屏运行通过。

## 执行状态（2026-11-16）

Tasks 1–5 的实施和验证已完成。分步提交均未执行；上述包含可选提交的已勾选步骤仅表示实施、测试与限定 diff 审查完成。浏览器 320 / 360 / 390 / 411 / 768 / 1440px 六宽度均通过：无横向溢出，点击目标至少 44px，六项导航、趋势图、同源详情、自动轮询静止 / 手动刷新结束停止、零值 / 缺失值、充电 / 缓充 / 满充状态通过。

Task 6 本轮交付工作完成：JS 151 项、桌面 16 / 14 / 29 项、原生 7 类 JVM 回归通过，版本为 1.4.3 / 75。最终 H5 / Android 构建、APK 签名、release 设置和网页资源逐文件核验通过；安装包及验证文档已交付。用户后续授权后已覆盖安装到 vivo V2231A，启动与配置检查通过。完整真机状态切换、后台 / 重启 / 长期息屏及最旧历史时间直接比对仍未执行。

## 给 6a 的开工说明

先读本计划、设计文档及离线 88 接口证据；按 Task 1→2→3→4→5→6 推进。归一与算法、原生统计和首页布局可以分别交给代理，但先锁定 measurement/currentStats/timeToFull/runtime 契约，避免共享文件并发改动。用户已选择让 6a 执行，本方案作者不启动实现。
