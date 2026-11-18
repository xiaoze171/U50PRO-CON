# Device Chart History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 88版折线图读取设备自采历史，手机不再为曲线持续后台采集。

**Architecture:** 将已有设备CSV缓存扩展为全部指标历史适配器，页面使用设备历史替换本机JSON链路。原生服务按构建profile只承担可选悬浮显示，保留原厂模式原行为。

**Tech Stack:** Vue/uni-app、Node test、Android Java、现有CSV读桥。

**Spec:** `docs/superpowers/specs/2026-11-18-device-chart-history.md`

## Global Constraints

- 只改 `codex/battery-88-csv`，不合并或推送常规分支；在用户指定的现有工作区执行。
- Windows `exec_command` 均 `tty:true`，子进程隐藏窗口。
- 不修改设备服务；不执行短信发送删除、频段改写、Wi-Fi关闭、设备重启。
- 协调者统一提交与构建，子任务不改Git状态或配置。

### Task 1: Device CSV adapter

Files: `src/utils/device-history.js`, `src/utils/battery-csv.js`, `src/services/battery-csv-client.js`, `tests/device-history.test.mjs`。

Interface: `buildDeviceHistory(csv, { endpoint })` returns `{ chart: {rsrp,sinr,rsrq,down,up,temperatures,signals}, battery, sourceCounts, snapshotCount, latestTimestamp, deviceTimestamp }`. Points保留实际毫秒、值/null、`device`来源及制式身份；battery样例包含timestamp/percent/charging/temperature/source/percentSource/percentEndpoint。信号独立键为lte_rsrp/lte_rsrq/lte_snr/nr_rsrp/nr_rsrq/nr_sinr。

- [ ] 先写 `assert.equal(history.chart.down.at(-1)[1], csvRow.download_bps)` 等真实CSV适配测试，运行 `node --test tests/device-history.test.mjs` 验证缺功能失败。
- [ ] 扩展已存在CSV可选列（新增错误不得毁掉有效电池记录），保留原解析契约；实现旧列/缺口/时钟/制式/重复边界。
- [ ] `createBatteryCsvClient.get(endpoint, {force:false})` 支持手动跳过缓存及保留端点隔离，缓存结果返回同一对象便于避免每秒重新适配。
- [ ] 运行新测试及 `tests/battery-csv*.test.mjs`。

### Task 2: Optional native overlay lifecycle

Files: `BackgroundMonitorService.java`, `BootReceiver.java`, new pure policy Java and tests/instrumentation as necessary。

- [ ] 用真实service/policy测试证明gauge悬浮关闭不应启动常驻服务，开启+息屏不查询，不生成归档；factory保留原行为。
- [ ] profile门控命令发送、服务启停、alarm/locks、poll/SMS和归档。保留跨进程显式悬浮选择，开启仍显示现有实时内容。
- [ ] 验证当前JVM/Android测试，协调者串行执行共享编译目录的完整原生检查。

### Task 3: Frontend history replacement

Files: `router-client.js`, `index.vue`, `collection-source.js`, `chart-options.js`, integration tests。

- [ ] 写真实routerApi/页面函数测试：88设备历史不需登录、回前台请求CSV、旧手机缓存不混合、非设备模式维持旧行为。
- [ ] `routerApi.getDeviceHistory(force=false)` 使用Task1缓存并返回适配结果及失败状态；same-endpoint失败保留内存历史，endpoint/revision变化丢弃晚回包。
- [ ] 页面只在88配置下绕过load/persist/captureChartHistory和native backfill；启动及pageshow/手动/60秒请求设备历史，基于最后记录构建图表与电池列表；前台实时刷新不覆盖设备历史。
- [ ] 添加device来源及独立LTE/NR信号曲线，缺口与设备时间语义准确；设置/诊断显示设备保存且无须手机后台。
- [ ] 运行全部JS测试，审查Task1/2接口匹配。

### Task 4: Final verification and delivery

- [ ] 独立审查本轮diff与spec，处理实质问题。
- [ ] 运行全部JS、两模式JVM及适用Android instrumentation；构建私用88 APK，不发布常规或修改公共版本。
- [ ] 验证APK来源/签名、实际CSV历史值；手机可用时保留数据覆盖安装并实测全部曲线、悬浮开关/后台停止。
- [ ] 更新仅88版说明及验证记录，协调者提交88分支，确认常规ref与公共Release未改。
