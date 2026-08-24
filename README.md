# U50PRO-CON 项目说明

## 1. 项目概况

U50PRO-CON 是为中兴 U50 Pro / MU5120 随身路由器制作的第三方管理界面。

项目将原厂 Web 管理后台中可用的数据和控制接口重新整理成一套适合电脑浏览器和 Android 手机使用的界面，并增加本地历史记录和续航估算能力。

- 当前 Android 验证版本：`1.3.17`（`versionCode 31`）
- Android 包名：`cn.mu5120.console`
- 开发者：晓泽
- 已验证固件：`BD_FLYMODEMMU5120V1.0.1B10`
- 路由器默认地址：`http://192.168.0.1`
- 前端技术：uni-app、Vue 3、Vite、ECharts、Tabler Icons
- Android 技术：原生 WebView、Java HTTP 网络桥、前台服务、系统悬浮窗

主工程位于 [`router-console-uniapp`](router-console-uniapp)。

## 2. 项目结构

```text
U50PRO-CON/
├─ README.md                             项目完整说明
└─ router-console-uniapp/
   ├─ src/                               uni-app 前端源码
   │  ├─ pages/index/index.vue           主界面和全部业务交互
   │  ├─ pages/index/index.css           响应式界面样式
   │  ├─ components/AppChart.vue         ECharts 图表组件（renderjs）
   │  ├─ components/MetricGrid.vue       指标卡片网格
   │  ├─ components/DataList.vue         键值明细列表
   │  ├─ services/router-client.js       路由器接口、认证和数据同步
   │  ├─ utils/format.js                 数值、字节、时长格式化
   │  ├─ utils/cells.js                  服务小区与邻小区解析
   │  └─ manifest.json                   仅供 HBuilderX 云打包使用
   ├─ android-wrapper/                   可直接使用 Gradle 构建的 Android 工程
   │  └─ app/src/main/
   │     ├─ java/cn/mu5120/console/
   │     │  ├─ MainActivity.java             WebView 宿主，加载 assets/www
   │     │  ├─ RouterBridge.java             HTTP、Cookie 和局域网请求原生桥
   │     │  ├─ BackgroundMonitorService.java 后台前台服务，独立 :monitor 进程
   │     │  ├─ MonitorOverlay.java           系统悬浮窗
   │     │  ├─ RouterSession.java            桥与后台服务共享路由器 Cookie
   │     │  ├─ MonitorTickReceiver.java      AlarmManager 唤醒接收器
   │     │  └─ BootReceiver.java             开机与覆盖安装自启
   │     └─ assets/www/                      打包进 APK 的 H5 产物
   ├─ dist/build/h5/                     H5 构建产物（未纳入版本库）
   └─ U50PRO-Console-v1.3.7/8/9.apk      历史留档安装包
```

`.android-sdk/`、`node_modules/`、`dist/`、`android-wrapper/build/` 均已在 `.gitignore` 中排除。

## 3. 已完成的主要工作

### 3.1 重做原厂管理界面

原厂页面被替换为紧凑、响应式的管理控制台，电脑和手机共用一套 Vue 页面。

界面完成了以下调整：

- 使用 Tabler Icons 替换早期图标。
- 使用 ECharts 替换旧图表实现。
- 修复手机左侧菜单不可见、菜单留白和图标错位。
- 移动端使用底部导航加“更多”抽屉，桌面端使用固定侧栏。
- 将基站、CA、邻小区、锁小区和锁频段集中在同一页面。
- 将当前网络信息、服务小区和副载波整理为同一行布局。
- 删除无值的温度、资源和 SIM 状态项目。
- 将温度信息和温度折线图移动到总览。
- 删除没有可靠数据来源的整机开机时长。
- 删除会妨碍操作的邻区扫描二次确认提示。
- 去掉右上角每秒旋转闪烁的刷新动画。
- 锁频段多选框改为可点击的频段按钮组。

### 3.2 当前页面功能

应用目前保留七个主菜单。移动端底部导航显示总览、基站、流量、电池，其余通过“更多”进入。

#### 总览

- 当前网络制式和运营商。
- 由 RSRP 推算的信号格数。
- RSRP、SINR 和 CA 状态。
- 实时下载、上传速度。
- 固件返回的各路温度传感器读数。
- 最近 24 小时温度曲线，支持拖动和缩放查看历史。
- CPU 与内存，仅在固件真实返回时显示。
- 设备信息：IMEI、固件版本、LAN IP。

#### 基站、CA 与锁定

- 当前网络信息：制式、运营商、MCC/MNC、联网状态、运行模式、WAN IPv4 与 IPv6。
- 服务小区 RSRP、RSRQ、SINR、RSSI、PCI、频段、ARFCN 和带宽。
- LTE/NR CA 状态和副载波信息。
- 最近 24 小时 RSRP、SINR、RSRQ 趋势图。
- 原厂接口返回的 LTE、NR 邻小区信息。
- 按 RSRP 从强到弱排序候选小区。
- 支持按制式、频段、PCI、ARFCN 和信号搜索。
- 默认选择最强候选小区并自动填入锁定参数。
- LTE 锁小区和解除锁定。
- 5G NR 锁小区和解除锁定。
- LTE、5G SA、5G NSA 独立锁频段。
- 锁小区与候选小区联动，锁频段继续保持独立操作。

#### 流量与速率

- 当前会话合计用量和本月合计用量。
- 流量套餐管理：启用开关、每月套餐 GB、提醒百分比、自动清零开关、清零日期。
- 套餐状态卡片：套餐、已用和剩余流量。
- 手动校准本月已用流量。
- 用量明细：会话下载、会话上传、会话时长、本月下载、本月上传、累计联网。

#### 电池与续航

- 电池百分比。
- 充电与电池供电状态。
- 电池温度。
- 本地充放电变化速率。
- 根据历史百分比变化估算剩余续航或充满时间。
- 电量曲线和续航记录列表。
- 续航样本仅保存在本机。

#### 短信

- 查询短信模块状态。
- 查询短信容量。
- 获取收件箱和已发送短信。
- 解码原厂 UCS-2 十六进制短信内容。
- 输入号码和内容后发送短信。
- 轮询发送结果，显示成功、失败或处理中状态。

#### 连接设备管理

- 获取无线设备列表并显示数量。
- 获取有线设备列表并显示数量。
- 展示固件实际返回的主机名、IP 和 MAC，不伪造连接数据。

#### 设置

- 修改路由器管理地址。
- 保存一个统一的登录密码，主登录和开发者登录共用。
- 验证开发者权限。
- 悬浮监测开关，含系统悬浮窗授权引导。
- 固定每秒刷新一次。
- 所有设置和历史记录仅保存在当前设备本地。
- 开启 Wi-Fi、关闭 Wi-Fi、重启和关机，危险操作带二次确认。
- 显示运行方式、软件版本和开发者信息。

#### Android 后台监测

- 启动后默认创建不可关闭的前台监测服务和常驻通知。
- 前台服务通知内容固定为“后台监测服务运行中”，不显示实时数值；实时数值由应用界面和悬浮窗承担。
- 页面在前台时由 WebView 将实时上下行、电量和温度快照同步给原生服务，用于刷新悬浮窗和记录电池。
- 页面退到后台时立即由原生服务接管轻量接口轮询，避免和前台登录会话互相挤占；15 秒的前台标记仅用于服务冷启动时恢复状态。
- 原生服务每 1 秒轮询一次路由器并刷新悬浮窗，与前台频率一致；每分钟保存一条电池记录。
- 使用 `AlarmManager.setExactAndAllowWhileIdle` 作为看门狗，Doze 模式下也能唤醒轮询。
- 后台电池样本保存在 Android 本地文件 `battery_history.json`，保留最近 24 小时，最多约 1,445 条分钟级样本；回到页面后与前端本地历史合并。
- 监听开机和应用升级广播，手机重启或覆盖安装后自动恢复。
- 使用前台服务、CPU 唤醒锁和 Wi-Fi 锁提高 vivo 等系统上的持续运行能力，并提供电池优化白名单申请接口。

#### Android 悬浮监测

- 在设置页开启，首次开启会跳转系统“显示在其他应用上层”授权页。
- 固定约 `250dp × 32dp`，背景透明，自绘四个分栏：下载、上传、电量、电池温度。
- 上下行速度统一换算为 `MB/s`，数值变化不会改变窗口尺寸或位置。
- 可拖动调整位置，坐标自动记忆。
- 路由器不可达时显示“离线”。

## 4. 路由器认证实现

### 4.1 主登录

原厂后台不是直接提交明文密码。程序先读取动态 `LD`，再使用以下算法：

```text
password_hash = SHA256(SHA256(明文密码) + LD)
```

随后提交：

```text
POST /goform/goform_set_cmd_process
isTest=false
goformId=LOGIN
password=<password_hash>
```

应用会保存密码并自动登录，不要求用户每次重新输入。

### 4.2 开发者登录

主登录和开发者登录已统一使用同一个密码。开发者会话使用新的动态 `LD` 重新计算密码，然后提交：

```text
goformId=DEVELOPER_OPTION_LOGIN
password=<SHA256(SHA256(password) + LD)>
AD=<动态写接口令牌>
```

程序会轮询 `developer_option_loginfo`，确认开发者会话真正建立后才执行锁小区和锁频段操作。

### 4.3 写接口 AD

普通写接口会先读取固件版本作为种子，再读取动态 `RD`：

```text
AD = SHA256(SHA256(wa_inner_version + cr_version) + RD)
```

每次写操作都重新获取动态令牌，避免使用已经失效的固定参数。

## 5. 已接入的路由器接口

### 5.1 通用读取接口

```text
GET /goform/goform_get_cmd_process
```

程序通过 `cmd` 和 `multi_data=1` 批量读取以下数据组，每次刷新并发发出九个请求：

| 数据组 | 主要字段 |
| --- | --- |
| 登录状态 | `loginfo`、`developer_option_loginfo`、`LD`、`RD` |
| 网络状态 | `network_type`、`network_provider`、`ppp_status`、`wan_connect_status` |
| 设备信息 | `imei`、`imsi`、`lan_ipaddr`、`wan_ipaddr`、固件和硬件版本 |
| 信号 | `lte_rsrp`、`lte_rsrq`、`lte_snr`、`Z5g_rsrp`、`Z5g_rsrq`、`Z5g_SINR` |
| 服务小区 | `lte_pci`、`nr5g_pci`、Band、ARFCN、Cell ID、带宽 |
| CA | LTE PCell/SCell、多载波信息、NR CA 上下行状态 |
| 温度 | `battery_temp`、`wifi_chip_temp`、`pm_sensor_pa1`、`pm_sensor_mdm` 等 |
| 资源 | 固件可能返回的 CPU、内存、RAM 和负载字段 |
| 流量 | 实时上下行字节、吞吐率、月流量、联网时间 |
| 流量套餐 | `data_volume_limit_switch`、`data_volume_limit_size`、`data_volume_alert_percent`、`wan_auto_clear_flow_data_switch`、`traffic_clear_date` |
| 电池 | 百分比、充电状态、充电类型、外部供电状态 |
| Wi-Fi | 开关状态、SSID、无线接入数量 |
| 锁定状态 | LTE/NR 锁小区和锁频段字段 |

其中 Cell ID、Wi-Fi SSID 和接入数量目前只做拉取，界面尚未展示。

### 5.2 列表和查询命令

| 命令 | 用途 |
| --- | --- |
| `station_list` | 无线连接设备列表 |
| `lan_station_list` | 有线连接设备列表 |
| `lte_ngbr_cell_info_ext` | LTE 邻小区信息 |
| `sa_ngbr_cell_manual_result_ext` | 5G SA 邻小区扫描结果 |
| `sms_cmd_status_info` | 短信模块和发送状态 |
| `sms_data_total` | 短信列表 |
| `sms_capacity_info` | 短信容量 |

### 5.3 写接口

所有写接口统一使用：

```text
POST /goform/goform_set_cmd_process
Content-Type: application/x-www-form-urlencoded
```

| `goformId` | 功能 |
| --- | --- |
| `LOGIN` | 主账号登录 |
| `DEVELOPER_OPTION_LOGIN` | 开发者登录 |
| `SCAN_NR5G_NEIGHBOR_CELL` | 5G 邻小区扫描 |
| `LTE_LOCK_CELL_SET` | LTE 锁小区和解除锁定 |
| `NR5G_LOCK_CELL_SET` | 5G 锁小区和解除锁定 |
| `BAND_SELECT` | LTE 频段掩码设置 |
| `WAN_PERFORM_NR5G_SANSA_BAND_LOCK` | 5G SA/NSA 频段设置 |
| `DATA_LIMIT_SETTING` | 流量套餐、提醒百分比和自动清零设置 |
| `FLOW_CALIBRATION_MANUAL` | 手动校准本月已用流量 |
| `SEND_SMS` | 发送短信 |
| `SET_WIFI_INFO` | 开启或关闭 Wi-Fi |
| `REBOOT_DEVICE` | 重启路由器 |
| `SHUTDOWN_DEVICE` | 关闭路由器 |
| `LOGOUT` | 清理 H5 旧登录会话 |

除 `LOGIN` 外，所有写接口都会先取一次动态 `AD` 再提交。

## 6. 图表和本地历史记录

### 6.1 保存内容

应用在本机保存以下历史数据：

- RSRP、RSRQ、SINR。
- 下载和上传速率。
- 路由器实际返回的温度传感器值。
- 电池百分比、充放电状态和电池温度。

指标历史使用 `mu5120-chart-history-v1` 保存最近 24 小时，并按分钟桶化。

电池历史前端保存在 `mu5120-battery-history`，窗口为最近 12 小时、最多 725 条分钟级样本；Android 原生文件保留 24 小时、最多 1,445 条，合并到前端时按 12 小时截断。

上下行速率历史仍在持续采集和保存，但当前界面没有对应的吞吐折线图。

### 6.2 折线图修复

已处理早期图表每秒整体移动、上下跳动和 Android WebView 闪烁的问题：

- 原始数据按稳定时间桶降采样，避免数据长度变化造成横轴重排。
- ECharts 序列使用固定 `id`，避免每次刷新被识别为新曲线。
- 图表实例持续复用，不再每秒清空后重建。
- Canvas 更新放入 `requestAnimationFrame`。
- Android WebView 关闭不稳定的脏矩形局部重绘（`useDirtyRect: false`），避免 Canvas 局部或整体白屏。
- 图表容器尺寸变化、页面重新可见和 App 从后台恢复时会执行完整重绘。
- 信号图关闭逐点动画，并固定 `-140` 到 `50` 的单轴坐标范围。
- 信号图时间窗口按 60 秒推进，页面数据仍然每秒刷新。
- 温度图使用三点滑动平均，抵消整数温度造成的阶梯感。
- 移动端补充触摸事件处理，让滑块拖动与页面纵向滚动互不干扰。

## 7. 电池数据结论

已经直接登录并检查原厂路由器后台，而不是只检查本项目代码。

固件能够返回：

- `battery_temp`
- `battery_value`
- `battery_vol_percent`
- `battery_charging`
- `battery_charg_type`
- `external_charging_flag`

已经尝试查询电压、电流、设计容量、实际容量、循环次数、FCC、SOC、SOH 和健康度等常见字段，但当前固件均返回空字符串。原厂隐藏调试页、温度页和开发者页也没有暴露这些值。

因此当前项目中的续航时间和变化速率来自电池百分比历史估算，不是路由器电量计直接返回的真实容量或电池健康度。

如需获取更底层电池数据，需要设备 Shell、`/sys/class/power_supply/`、QMI/AT、Qualcomm 诊断接口或外部电量测量设备，当前项目没有执行 Root、刷机或破坏性修改。

## 8. 本地数据保存

- 路由器地址和统一登录密码保存在 `mu5120-config`。
- 信号、温度和吞吐历史保存在 `mu5120-chart-history-v1`，保留最近 24 小时。
- 电池历史前端保存在 `mu5120-battery-history`，保留最近 12 小时。
- Android 后台电池样本保存在应用私有目录 `battery_history.json`，保留最近 24 小时。
- 悬浮窗坐标和后台服务配置保存在 `u50pro_background_monitor` SharedPreferences。
- 数据不会上传到 MySQL 或其他服务器，多台设备之间不自动共享。

## 9. H5 与 Android 数据通道

### 9.1 H5

H5 开发环境通过 Vite 将 `/router-api` 代理到路由器，解决浏览器跨域和 Cookie 问题。

```text
浏览器 -> Vite /router-api -> http://192.168.0.1/goform/...
```

### 9.2 Android

WebView 从 `https://appassets.androidplatform.net/index.html` 加载打包在 `assets/www` 中的页面，并通过注入的 `AndroidRouter` JavaScript 接口调用原生 `HttpURLConnection`：

```text
Vue 页面 -> AndroidRouter.request -> RouterBridge -> 路由器 HTTP 接口
```

原生桥保存路由器 Cookie，并限制 HTTP 请求只能访问 localhost、`.local` 和 RFC1918 局域网地址。Cookie 通过 `RouterSession` 与后台服务共享，避免前后台各自登录互相踢掉会话。Android 清单已允许局域网 HTTP 明文通信。

### 9.3 多进程注意事项

`BackgroundMonitorService` 运行在 `android:process=":monitor"` 独立进程。前台状态和电池历史都不能依赖跨进程读取 SharedPreferences：

- 前台状态由 `ACTION_FOREGROUND` intent 驱动服务进程内的内存字段。
- 电池历史使用文件存储，并采用临时文件加原子 rename 写入。

SharedPreferences 仅作为进程冷启动时的兜底恢复。

## 10. 外网访问现状

手机没有连接 U50 Pro Wi-Fi、且无法访问路由器的 `192.168.0.1` 时，当前版本不能实时读取或控制路由器。

中兴智慧生活 App 的外网能力依赖中兴账号、设备绑定和厂商云私有协议，与本地 `/goform` 接口不是同一套服务。项目已经确认这一点，但没有伪造或猜测厂商云接口。

若继续实现外网访问，需要取得本人设备在中兴智慧生活 App 中的 HTTPS、WebSocket 或 MQTT 请求记录，确认登录、绑定、设备标识、鉴权和数据推送协议后，再增加独立的 ZTE Cloud 适配层。

## 11. 构建和安装

### 11.1 H5

```powershell
cd D:\code\github\e\U50PRO-CON\router-console-uniapp
npm install
npm run dev:h5
```

开发地址：`http://127.0.0.1:5130`

生产构建：

```powershell
npm run build:h5
```

产物目录：`dist/build/h5`

### 11.2 同步 H5 产物到 Android 工程

Android WebView 从 `assets/www/` 加载页面，不引用 `dist/`。前端改动后必须同步：

1. 执行 `npm run build:h5`。
2. 清空 `android-wrapper/app/src/main/assets/www/assets` 中旧的 hash 文件。
3. 将 `dist/build/h5` 的产物和 `index.html` 复制到 `android-wrapper/app/src/main/assets/www/`。

### 11.3 Android APK

当前 Android 工程使用：

- JDK 17：`C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot`
- Android SDK：`D:\config\android-sdk`
- 旧电脑兼容环境：JDK 8 `D:\config\jdk1.8.0_181`，Gradle `D:\config\gradle-6.9.4`
- Android Gradle Plugin：4.2.2
- compileSdk / targetSdk：30
- minSdk：23
- build tools：30.0.3
- 源码与字节码兼容级别：Java 8

构建命令：

```powershell
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
cd D:\code\github\e\U50PRO-CON\router-console-uniapp\android-wrapper
D:\config\gradle-6.9.4\bin\gradle.bat :app:assembleRelease
```

旧电脑仍使用 Java 8 时，改用：

```powershell
$env:JAVA_HOME='D:\config\jdk1.8.0_181'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
D:\config\gradle-6.9.4\bin\gradle.bat :app:assembleRelease
```

不要使用 `cmd /c "set JAVA_HOME=... & ..."` 形式，`%PATH%` 会被提前展开，导致 JAVA_HOME 校验失败。

构建产物：`android-wrapper/app/build/outputs/apk/release/app-release.apk`

```text
versionCode: 31
versionName: 1.3.17
签名：android-wrapper/mu5120-release.jks，alias mu5120
```

覆盖安装：

```powershell
adb install -r android-wrapper\app\build\outputs\apk\release\app-release.apk
```

`android-wrapper/build/` 和 `android-wrapper/app/build/` 已在 `.gitignore` 中排除，仓库内不保留构建产物。仓库根目录下的 `U50PRO-Console-v1.3.7/8/9.apk` 是历史留档，不是当前版本。

### 11.4 版本号位置

| 位置 | 当前值 | 作用 |
| --- | --- | --- |
| `package.json` | `1.3.17` | npm 包版本 |
| `src/pages/index/index.vue` 的 `APP_VERSION` | `1.3.17` | 设置页显示的版本 |
| `android-wrapper/app/build.gradle` | `1.3.17` / `31` | 实际打包的 APK 版本 |
| `src/manifest.json` | `1.3.9` / `139` | 仅 HBuilderX 云打包路径使用，当前未同步 |

发版时前三处必须一致。`manifest.json` 只在改用 HBuilderX 云打包时才需要更新。

## 12. 当前限制和注意事项

- 路由器实时功能依赖手机或电脑能够访问路由器局域网地址。
- 手机息屏后 Wi-Fi 可能断连或切换网段，导致后台采样中断。这属于系统层限制，`WifiLock` 在现代 Android 上约束力有限，应用无法阻止；该场景下的数据断档已确认无法解决。
- Android 13 及以上首次启动需要允许通知；vivo 等系统还应允许自启动和后台高耗电。
- 常驻监测会保持 CPU 和 Wi-Fi 可用，因此会增加手机耗电。
- 不同固件可能使用不同字段或拒绝部分写接口。
- 锁小区、锁频段、关闭 Wi-Fi、重启和关机都会修改设备状态。
- 关闭 Wi-Fi 后当前连接会立即断开。
- 路由器关机后不能通过当前应用远程重新开机。
- CPU 温度、CPU 占用和内存占用只在固件真实返回时显示，空字段不会伪造。
- SIM 状态字段不可靠时不显示，`pin_status=0` 不再被误认为有效 SIM 状态。
- 电池续航是根据历史百分比变化估算，不能代表真实电池容量和健康度。
- 本地数据不会跨手机同步，卸载应用或清除应用数据会删除历史记录和保存的设置。
- 路由器登录密码以明文保存在本地存储中。

## 13. 后续可继续开发的方向

- 补回流量与速率页的吞吐折线图，数据已在采集但界面未使用。
- 展示已经拉取但未使用的 Cell ID、Wi-Fi SSID 和无线接入数量字段。
- 统一前端与原生的电池历史窗口，目前为 12 小时与 24 小时。
- 在设置页接入已就绪的电池优化白名单引导接口 `isIgnoringBatteryOptimizations` 与 `requestIgnoreBatteryOptimizations`。
- 对中兴智慧生活 App 进行合规的本人设备网络抓包，研究厂商云外网访问。
- 在获得底层设备访问能力后读取真实电池电压、电流、FCC、循环次数和 SOH。
- 增加连接设备备注、限速、拉黑等功能，但必须先确认固件对应写接口。
- 增加数据导出和更长周期的信号、温度、流量统计。
- 清理 Android WebView 旧 API 警告并升级 Android Gradle 工具链。
- 为路由器接口解析、登录算法和电池估算补充自动化测试。

## 14. 当前实现说明

本轮实现已更新到 Android 验证版本 `1.3.17`：

- 指标、温度和信号图表保留最近 24 小时数据，并按分钟桶化。
- 电池图表数据来自前端 12 小时窗口。
- 折线图在数据较少时自动放大显示，支持拖动和缩放查看历史；刷新数据不会强制跳回当前时间。
- 前台服务通知内容固定，实时数值由界面和悬浮窗显示。
- Android 悬浮窗固定为约 `250dp × 32dp`，背景透明，下载和上传速度统一显示为 `MB/s`，数值变化不会改变窗口位置。
- Android 离线构建使用 JDK 17（`C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot`）和 SDK（`D:\config\android-sdk`）。
