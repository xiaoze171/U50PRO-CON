# U50PRO-CON 功能说明

中兴 U50 Pro / MU5120 路由器的第三方管理控制台。项目使用 Vue 3、uni-app、ECharts 和 Tabler Icons 实现界面，Android 端通过原生 WebView、HTTP 桥接、前台服务和系统悬浮窗运行。

- 当前版本：`1.3.21`
- Android versionCode：`35`
- Android 包名：`cn.mu5120.console`
- 开发者：晓泽
- 默认路由器地址：`http://192.168.0.1`
- 默认登录密码：`111111`
- H5 开发端口：`5120`

## 一、登录与路由器通信

### 1. 统一登录

登录密码和开发者密码使用同一个配置，设置页只需要保存一次，不需要每次重复输入。

登录流程：

1. 读取路由器动态 `LD`。
2. 使用 `SHA256(SHA256(明文密码) + LD)` 计算登录密码。
3. 调用 `LOGIN` 建立路由器会话。
4. 读取登录状态并缓存 Cookie。
5. 开发者功能需要时，重新读取动态 `LD`，调用 `DEVELOPER_OPTION_LOGIN`。

写接口会在提交前重新读取动态 `RD`，按固件版本计算动态 `AD`，避免使用过期令牌。Android 原生桥和后台服务共享路由器 Cookie，前后台不会因为重复登录互相挤掉会话。

### 2. 数据通道

- H5：浏览器请求 `/router-api`，Vite 代理转发到路由器。
- Android：Vue 页面通过 `AndroidRouter` 调用原生 `HttpURLConnection`，直接访问局域网路由器。
- 默认轮询间隔：`1000ms`。
- 请求有超时和请求重入保护。

H5 开发：

```powershell
cd D:\code\github\e\U50PRO-CON
npm install
npm run dev:h5
```

浏览器访问：`http://127.0.0.1:5120`

路由器地址不是默认地址时：

```powershell
$env:ROUTER_ORIGIN='http://你的路由器地址'
npm run dev:h5
```

## 二、页面和业务功能

### 1. 总览

- 当前蜂窝网络制式、运营商和信号格数。
- RSRP、SINR、CA 状态。
- 实时下载速度和实时上传速度。
- 电池、Wi-Fi 芯片、射频 PA、Modem、5G Modem、CPU、SoC、主板等温度字段；固件没有返回的温度不会显示。
- 最近 24 小时温度趋势折线图。
- CPU 和内存信息，仅展示固件实际返回的字段。
- 设备信息：IMEI、固件版本、LAN IP。

### 2. 基站、CA 与锁定

当前网络信息：

- 网络制式、运营商、MCC/MNC。
- 联网状态、运行模式、WAN IPv4、WAN IPv6。

服务小区：

- RSRP、RSRQ、SINR、RSSI。
- PCI、频段、信道/ARFCN、带宽。
- Cell ID 已从页面移除。

CA 和辅载波：

- LTE PCell/SCell。
- LTE 辅载波频段、带宽、ARFCN、多载波信息和辅载波信号。
- NR 多载波信息、NR CA 下行和上行状态。

邻小区和锁小区：

- LTE 邻小区读取。
- 5G NR 邻小区扫描。
- 按 RSRP 从强到弱排序。
- 搜索 PCI、ARFCN、Band 和信号值。
- 默认使用最强候选小区。
- 点击候选小区自动填写制式、PCI、ARFCN、Band 和 NR SCS。
- LTE/5G NR 锁小区和解除锁定。
- 邻区扫描不再弹出二次确认。

频段锁定独立操作：

- LTE：B1、B3、B5、B7、B8、B20、B28、B34、B38、B39、B40、B41。
- 5G SA：n1、n3、n5、n8、n28、n41、n77、n78。
- 5G NSA：n1、n3、n5、n8、n28、n41、n77、n78。
- 多选按钮固定宽度，选中后不会造成布局变宽。

无线质量趋势图保存最近 24 小时的 RSRP、SINR 和 RSRQ，按分钟采样。

### 3. 流量与速率

- 当前会话总流量、本月总流量。
- 会话下载、会话上传、会话时长。
- 本月下载、本月上传、累计联网时间。
- 启用/停用套餐。
- 每月套餐大小、提醒百分比、自动清零、清零日期。
- 套餐、已用和剩余流量。
- 手动校准本月已用流量。

### 4. 电池与续航

- 电池百分比、充电/电池供电状态、电池温度。
- 电量变化速率。
- 根据历史变化估算剩余续航或充满时间。
- 最近 12 小时电量趋势图。
- 续航记录：时间、电量、充放电状态、温度。
- 页面不显示充电类型和外部供电；接口原始字段仍保留以兼容不同固件。

### 5. 短信

- 短信模块状态和容量。
- 短信列表。
- 自动识别短信中的验证码，支持一键复制。
- UCS-2 十六进制内容解码。
- 发送短信，内容上限 670 个字符。
- 发送后轮询状态并显示结果。

### 6. 连接设备管理

- 无线设备数量和列表。
- 有线设备数量和列表。
- 设备名称/主机名、IP 地址、MAC 地址。
- 只显示路由器实际返回的数据。

### 7. 设置与设备控制

- 修改路由器管理地址。
- 保存统一登录/开发者密码。
- 验证开发者权限。
- 开启/关闭悬浮窗。
- 开启/关闭 Wi-Fi。
- 重启设备、关闭设备。

## 三、接口业务目录

读取接口：`GET /goform/goform_get_cmd_process`。写接口：`POST /goform/goform_set_cmd_process`，写操作自动附加动态 `AD`。

读取内容包括登录状态、网络和运营商、WAN/LAN、IMEI、固件、信号、服务小区、CA、温度、CPU/内存、流量、电池、Wi-Fi 和锁定状态。

列表命令：

| 命令 | 业务 |
| --- | --- |
| `station_list` | 无线连接设备 |
| `lan_station_list` | 有线连接设备 |
| `lte_ngbr_cell_info_ext` | LTE 邻小区 |
| `sa_ngbr_cell_manual_result_ext` | 5G SA 邻小区扫描结果 |
| `sms_cmd_status_info` | 短信状态 |
| `sms_data_total` | 短信列表 |
| `sms_capacity_info` | 短信容量 |

写接口：

| goformId | 业务 |
| --- | --- |
| `LOGIN` | 登录 |
| `DEVELOPER_OPTION_LOGIN` | 开发者登录 |
| `SCAN_NR5G_NEIGHBOR_CELL` | 5G 邻小区扫描 |
| `LTE_LOCK_CELL_SET` | LTE 锁小区/解除锁定 |
| `NR5G_LOCK_CELL_SET` | 5G 锁小区/解除锁定 |
| `BAND_SELECT` | LTE 频段锁定 |
| `WAN_PERFORM_NR5G_SANSA_BAND_LOCK` | 5G SA/NSA 频段锁定 |
| `DATA_LIMIT_SETTING` | 流量套餐设置 |
| `FLOW_CALIBRATION_MANUAL` | 流量校准 |
| `SEND_SMS` | 发送短信 |
| `SET_WIFI_INFO` | Wi-Fi 开关 |
| `REBOOT_DEVICE` | 重启设备 |
| `SHUTDOWN_DEVICE` | 关闭设备 |

## 四、本地历史和图表

- 指标键：`mu5120-chart-history-v1`。
- 电池键：`mu5120-battery-history`。
- Android 后台文件：`battery_history.json`。
- 温度、信号和吞吐保存最近 24 小时，按 1 分钟桶化。
- 电池前端保存最近 12 小时。
- ECharts 实例复用，不每秒销毁重建。
- 信号图关闭逐点动画并固定坐标范围。
- 温度曲线使用滑动平均。
- 刷新时保留用户拖动的时间窗口，避免曲线闪烁和向前移动。

## 五、Android 后台和悬浮窗

`BackgroundMonitorService` 在独立 `:monitor` 进程中运行：

- 前台服务常驻通知栏。
- 后台每秒轮询路由器。
- 每分钟保存一条电池样本。
- 保存电量、充电状态、电池温度及接口返回的电压、电流、容量、健康度原始字段。
- 使用 `AlarmManager` 作为轮询看门狗。
- 通过 `BootReceiver` 在开机和覆盖更新后恢复服务。
- 使用唤醒锁和 Wi-Fi 锁尽量维持后台采样。
- 前台页面和后台服务同步路由器地址、密码和实时快照。

悬浮窗：

- 固定约 `250dp × 32dp`。
- 单行显示下载、上传、电量、电池温度。
- 下载和上传统一显示 MB/s。
- 可拖动，位置本地保存。
- 路由器不可访问时显示离线状态。

## 六、已确认限制

- 当前只支持访问路由器局域网地址，未接入中兴智慧生活云端协议。
- 路由器不返回的 CPU 温度、内存、电压、电流、容量和健康度不会虚构。
- 电池续航根据电量历史变化估算，不等同于真实容量或 SOH。
- `pin_status=0` 不作为有效 SIM 状态显示。
- 关闭 Wi-Fi 会立即断开连接；设备关机后不能通过本应用远程开机。
- 配置和历史只保存在本机，卸载或清除应用数据会删除这些内容。
