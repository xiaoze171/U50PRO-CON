# U50 Pro 路由器接口与字段清单

本文档整理当前项目实际使用的中兴 U50 Pro/MU5120 类路由器 HTTP 接口。接口返回值保持路由器原始格式，字段通常是字符串；空字符串表示固件没有返回值或当前状态不可用。

## 1. 传输与认证

### 1.1 基础地址

默认地址：`http://192.168.0.1`

- H5：请求经过 Vite 代理，基础路径为 `/router-api`。
- Android：通过 `window.AndroidRouter.request()` 原生桥接直接访问路由器。
- 请求超时：路由器请求 12 秒，原生桥总超时约 13 秒。
- 请求头：`Accept: application/json, text/javascript, */*; q=0.01`、`X-Requested-With: XMLHttpRequest`；原生请求还带 `Origin`、`Referer` 和 Cookie。

### 1.2 登录流程

| 步骤 | 请求 | 作用 | 返回/说明 |
|---|---|---|---|
| 1 | `GET /index.html` | 建立页面会话、接收 Cookie | HTML |
| 2 | `GET /goform/goform_get_cmd_process?isTest=false&multi_data=1&cmd=Language,cr_version,wa_inner_version&_=` | 读取固件版本和语言 | `Language`、`cr_version`、`wa_inner_version` |
| 3 | `GET ...cmd=LD...` | 获取登录动态令牌 | `LD` |
| 4 | `POST /goform/goform_set_cmd_process` | 登录 | `goformId=LOGIN`、`password=SHA256(SHA256(明文密码)+LD)`；当前固件使用大写十六进制 SHA-256 |
| 5 | `GET ...cmd=loginfo...` | 确认登录状态 | `loginfo=ok` 表示已登录 |

写接口除 `LOGIN`、`SET_WEB_LANGUAGE` 外需要动态权限字段 `AD`。`AD = SHA256(SHA256(wa_inner_version + cr_version) + RD)`，其中 `RD` 通过读取接口获得。

开发者会话使用相同的 `LD` 计算方式，POST `goformId=DEVELOPER_OPTION_LOGIN`，然后轮询 `developer_option_loginfo`。

### 1.3 通用读取格式

```text
GET /goform/goform_get_cmd_process
    ?isTest=false
    &multi_data=1
    &cmd=字段1,字段2,...
    &_=当前时间戳
```

项目封装：`getFields(fields, extra)`。单个命令或带参数的读取使用同一路径，例如：

```text
GET ...?isTest=false&cmd=sms_cmd_status_info&sms_cmd=1&_=...
```

项目封装：`getCommand(cmd, params)`。

### 1.4 通用写入格式

```text
POST /goform/goform_set_cmd_process
Content-Type: application/x-www-form-urlencoded; charset=UTF-8

isTest=false&goformId=命令名&参数=值&AD=动态权限值
```

写请求串行排队，返回值一般为 `{ "result": "success" }`、`0` 或 `4`。项目将这些值视为成功。

## 2. 读取接口

### 2.1 `dashboard()` 批量读取

`dashboard()` 先确保主登录，然后并行读取以下数据组，并返回：

```js
{
  timestamp,
  login,
  status,
  signal,
  temperature,
  resources,
  locks,
  stations,
  cableStations,
  neighbors,
  features,
  battery
}
```

| 数据组 | 请求 | 说明 |
|---|---|---|
| `status` | `cmd=statusFields` | SIM、联网、流量、电池、短信未读数等 |
| `signal` | `cmd=signalFields` | LTE/5G 信号、小区、CA、带宽 |
| `temperature` | `cmd=temperatureFields` | 电池、Wi-Fi、Modem、SoC 等温度候选字段 |
| `resources` | `cmd=resourceFields` | CPU、内存、负载候选字段 |
| `locks` | `cmd=lockFields` | 频段锁、小区锁、运行模式 |
| `stations` | `cmd=station_list` | 无线客户端列表 |
| `cableStations` | `cmd=lan_station_list` | 有线客户端列表 |
| `neighbors` | `cmd=network_type,lte_ngbr_cell_info_ext,sa_ngbr_cell_manual_result_ext` | 邻小区原始字符串 |
| `features` | `cmd=featureFields` | 流量套餐设置 |

### 2.2 设备/SIM/联网字段（`status`）

| 字段 | 含义 | 单位/取值 |
|---|---|---|
| `loginfo` | 主会话登录状态 | `ok` 表示已登录 |
| `modem_main_state` | Modem/SIM 主状态 | 固件状态字符串 |
| `simcard_roam` | 漫游状态 | `Internal`、`International` 等 |
| `sim_iccid` | SIM 卡 ICCID | 数字字符串 |
| `imei` | 设备 IMEI | 数字字符串 |
| `imsi`、`sim_imsi` | SIM IMSI | 数字字符串 |
| `msisdn`、`sim_msisdn`、`phone_number` | SIM/账户手机号 | 数字字符串，可能为空 |
| `opms_wan_mode` | WAN 运行模式 | 如 `PPP`、`AUTO_DHCP` |
| `opms_wan_auto_mode` | 自动 WAN 模式 | 固件模式字符串 |
| `ppp_status` | PPP 拨号状态 | 如 `ppp_connected` |
| `wan_connect_status` | WAN 联网状态 | 固件状态字符串 |
| `wan_ipaddr` | WAN IPv4 地址 | IPv4 |
| `ipv6_wan_ipaddr` | WAN IPv6 地址 | IPv6 |
| `lan_ipaddr` | 路由器 LAN 地址 | IPv4 |
| `wifi_mac_address` | Wi-Fi MAC | MAC 地址 |
| `wa_inner_version` | 内部固件版本 | 字符串 |
| `wa_version` | Modem/软件版本 | 字符串 |
| `hardware_version` | 硬件版本 | 字符串 |
| `web_version` | Web UI 版本 | 字符串 |

### 2.3 流量与实时吞吐字段（`status`）

| 字段 | 含义 | 单位/注意 |
|---|---|---|
| `realtime_tx_bytes` | 当前会话上传累计字节数 | bytes |
| `realtime_rx_bytes` | 当前会话下载累计字节数 | bytes |
| `realtime_tx_thrpt` | 当前上传瞬时吞吐 | 固件原始数值，项目按 bytes/s 格式化 |
| `realtime_rx_thrpt` | 当前下载瞬时吞吐 | 固件原始数值，项目按 bytes/s 格式化 |
| `realtime_time` | 当前会话时长 | 固件原始时长 |
| `monthly_rx_bytes` | 本月下载累计 | bytes |
| `monthly_tx_bytes` | 本月上传累计 | bytes |
| `monthly_time` | 本月累计联网时长 | 固件原始时长 |
| `date_month` | 统计月份 | 固件月份值 |

说明：这些字段是流量统计和瞬时吞吐，**不是 SIM 套餐签约上下行速率**。

### 2.4 Wi-Fi 客户端字段

`station_list` 和 `lan_station_list` 返回数组或对象。项目会统一转成数组。

| 字段 | 含义 |
|---|---|
| `mac_addr` / `macAddress` | 客户端 MAC |
| `hostname` / `hostName` | 客户端主机名 |
| `ip_addr` / `ipAddress` | 客户端 IP |
| `ssid_index` | 无线 SSID 索引（无线列表可能有） |

### 2.5 LTE/5G 信号与小区字段（`signal`）

| 字段 | 含义 | 单位/取值 |
|---|---|---|
| `network_type` | 当前网络制式 | LTE、SA、NSA 等 |
| `network_provider`、`Operator` | 运营商名称 | 字符串 |
| `rmcc`、`mdm_mcc` | 移动国家码 MCC | 数字字符串 |
| `rmnc`、`mdm_mnc` | 移动网络码 MNC | 数字字符串 |
| `rssi`、`lte_rssi`、`Z5g_rssi` | RSSI | dBm |
| `rscp` | 3G RSCP 候选值 | dBm |
| `lte_rsrp`、`Z5g_rsrp` | LTE/5G RSRP | dBm |
| `lte_rsrq`、`Z5g_rsrq` | LTE/5G RSRQ | dB |
| `lte_snr`、`Z5g_snr`、`Z5g_SINR` | LTE/5G 信干噪比 | dB |
| `signalbar` | 信号格数 | 通常 0-5 |
| `lte_pci`、`nr5g_pci` | LTE/NR PCI | LTE 通常 0-503，NR 通常 0-1007 |
| `cell_id`、`nr5g_cell_id`、`Z5g_CELL_ID` | 小区 ID | 固件原始值 |
| `wan_active_band` | 当前活动频段 | 如 `B3`、`n41` |
| `wan_active_channel` | 当前活动信道/ARFCN | 数字字符串 |
| `bandwidth` | 通用带宽字段 | 固件原始值，通常 MHz |
| `lte_ca_pcell_arfcn` | LTE 主载波 EARFCN | 数字字符串 |
| `lte_ca_pcell_band` | LTE 主载波 Band | 如 `B3` |
| `lte_ca_pcell_bandwidth` | LTE 主载波带宽 | 固件原始值，通常 MHz |
| `lte_ca_scell_arfcn` | LTE 辅载波 EARFCN | 数字字符串 |
| `lte_ca_scell_band` | LTE 辅载波 Band | 如 `B1` |
| `lte_ca_scell_bandwidth` | LTE 辅载波带宽 | 固件原始值，通常 MHz |
| `lte_ca_scell_info` | LTE 辅载波复合信息 | 固件原始字符串 |
| `lte_multi_ca_scell_info` | LTE 多辅载波信息 | 固件原始字符串 |
| `lte_multi_ca_scell_sig_info` | LTE 多辅载波信号信息 | 固件原始字符串 |
| `wan_lte_ca` | LTE CA 状态 | `ca_activated` / `ca_deactivated` 等 |
| `nr_ca_dl_state` | NR CA 下行状态 | 固件原始字符串 |
| `nr_ca_ul_state` | NR CA 上行状态 | 固件原始字符串 |
| `nr5g_action_band` | 当前 NR 活动 Band | 如 `n41` |
| `nr5g_action_channel`、`Z5g_dlEarfcn` | 当前 NR ARFCN | 数字字符串 |
| `nr5g_nsa_bandwidth` | NR NSA 带宽 | 固件原始值，通常 MHz |
| `nr_multi_ca_scell_info` | NR 多载波信息 | 固件原始字符串 |

邻小区原始字段：

- `lte_ngbr_cell_info_ext`：以 `;` 分隔的 LTE 邻小区，单行通常为 `ARFCN,PCI,RSRQ,RSRP,...`。
- `sa_ngbr_cell_manual_result_ext`：以 `;` 分隔的 NR 邻小区，项目按 `PCI,ARFCN,RSRP,RSRQ,Band,...` 解析。

### 2.6 温度字段（`temperature`）

原厂后台“温度状态”页面调用专用读取接口 `getTempStatus()`，实际请求为：

```text
GET /goform/goform_get_cmd_process
  ?isTest=false&multi_data=1
  &cmd=wifi_chip_temp,therm_pa_level,therm_pa_frl_level,therm_tj_level,pm_sensor_pa1,pm_sensor_mdm,pm_modem_5g,wifi_temp_level_1,wifi_temp_level_2
```

下面 9 个字段均已在该原厂接口脚本和温度页面模板中确认，属于路由器真实字段。字段是否有值取决于设备当前状态；本次未登录的直接探测返回空字符串，不能据此否定字段可用性。

| 字段 | 含义 | 单位 | 原厂字段状态 |
|---|---|---|---|
| `wifi_chip_temp` | Wi-Fi 芯片温度 | °C | 原厂 `getTempStatus()` 字段 |
| `wifi_temp_level_1`、`wifi_temp_level_2` | Wi-Fi 温度传感器温度 | °C | 原厂 `getTempStatus()` 字段 |
| `pm_sensor_pa1` | 射频 PA 温度 | °C | 原厂 `getTempStatus()` 字段 |
| `pm_sensor_mdm` | Modem 温度 | °C | 原厂 `getTempStatus()` 字段 |
| `pm_modem_5g` | 5G Modem 温度 | °C | 原厂 `getTempStatus()` 字段 |
| `therm_pa_level`、`therm_pa_frl_level`、`therm_tj_level` | 热保护等级 | 固件等级值 | 原厂 `getTempStatus()` 字段 |

`battery_temp` 属于另一组设备/电池状态字段，不在上述专用“端口温度”接口中。

以下名称仍未在该设备原厂温度接口中确认，仅是项目尝试过的候选字段：`OOM_TEMP_PRO`、`cpu_temp`、`cpu_temperature`、`soc_temp`、`board_temp`、`modem_temp`。

### 2.7 资源字段（`resources`）

| 字段 | 含义 | 单位/注意 |
|---|---|---|
| `cpu_usage`、`cpu_percent` | CPU 使用率 | 通常 % |
| `cpu_load`、`loadavg` | CPU 负载 | 固件原始值 |
| `mem_usage`、`memory_usage`、`memory_percent` | 内存使用率 | 通常 % |
| `mem_total`、`MemTotal`、`ram_total` | 总内存 | 固件原始单位 |
| `mem_free`、`MemFree`、`ram_free` | 可用内存 | 固件原始单位 |

当前页面只展示有值的温度；资源字段已请求但没有固定展示承诺，具体取决于固件是否返回。

### 2.8 频段/小区锁状态字段（`locks`）

| 字段 | 含义 | 格式 |
|---|---|---|
| `nr5g_cell_lock` | NR 小区锁配置 | `PCI,ARFCN,Band,SCS` 或解锁值 |
| `lte_pci_lock` | LTE PCI 锁配置 | 数字字符串 |
| `lte_earfcn_lock` | LTE EARFCN 锁配置 | 数字字符串 |
| `lte_freq_lock` | LTE 频点锁状态 | 固件原始值 |
| `lte_band_lock` | LTE 频段锁掩码 | 十六进制字符串 |
| `nr5g_band_lock` | 通用 NR 锁状态 | 固件原始值 |
| `nr5g_sa_band_lock` | NR SA 锁频段列表 | 逗号分隔 Band，如 `41,77` |
| `nr5g_nsa_band_lock` | NR NSA 锁频段列表 | 逗号分隔 Band，如 `41,78` |
| `operate_mode` | 当前运行模式 | 固件模式字符串 |

项目支持的 LTE Band：`1,3,5,7,8,20,28,34,38,39,40,41`。

项目支持的 NR Band：`1,3,5,8,28,41,77,78`。

### 2.9 流量套餐字段（`features`）

| 字段 | 含义 | 格式 |
|---|---|---|
| `data_volume_limit_switch` | 是否启用套餐限制 | `1` 启用，`0` 关闭 |
| `data_volume_limit_unit` | 套餐单位 | 当前写入 `data` |
| `data_volume_limit_size` | 套餐容量 | 路由器格式 `数值_1024`，项目换算为 GB |
| `data_volume_alert_percent` | 流量提醒百分比 | 0-100 |
| `wan_auto_clear_flow_data_switch` | 是否自动清零流量 | `on` / `off` |
| `traffic_clear_date` | 每月清零日期 | 1-31 |

### 2.10 电池字段与本地计算

下列字段在路由器原厂 Web UI 的状态轮询字段中有明确出现，属于路由器原始字段。字段值仍取决于硬件、电池状态和固件实现，可能为空字符串。

| 字段 | 含义 | 当前核对结果 |
|---|---|---|
| `battery_temp` | 电池温度 | 原厂轮询字段；本次查询为空 |
| `battery_value` | 电量百分比候选值 | 原厂轮询字段；本次查询为空 |
| `battery_charging` | 充电状态，通常 `1` 表示充电 | 原厂轮询字段；本次查询为空 |
| `battery_charg_type` | 充电类型 | 原厂轮询字段；本次查询为空 |
| `external_charging_flag` | 外部电源标记 | 原厂轮询字段；本次查询为空 |
| `battery_pers` | 电池百分比候选字段 | 原厂轮询字段；本次查询为空 |
| `battery_customer_mode` | 电池客户模式 | 原厂轮询字段；本次查询为空 |
| `battery_vol_percent` | 电量百分比 | 原厂轮询字段；本次查询为空 |

以下名称是项目为兼容不同固件而尝试读取的候选字段，目前没有在该设备原厂 Web UI 的状态轮询清单中确认，不能视为已确认的路由器字段：

`battery_time`、`battery_remain_time`、`battery_remaining_time`、`battery_capacity`、`battery_health`、`battery_voltage`、`battery_current`。

项目自定义字段（不是路由器返回字段）：

- `battery.percent`、`battery.charging`、`battery.samples`：项目根据原始字段整理出的对象属性。
- `battery.ratePerHour`、`battery.remainingHours`、`remainingMinutes`：项目根据本地电池历史计算的变化速率和预计剩余时间。
- `temperature`、`chargeType`、`externalPower`、`voltage`、`current`、`capacity`、`health`：项目保存到本地历史样本中的字段名，其中部分值来自上面的原始字段，不能反向证明路由器一定提供对应字段。

### 2.11 短信读取接口

| 请求 | 参数 | 返回/说明 |
|---|---|---|
| `cmd=sms_cmd_status_info` | `sms_cmd=1` | 查询短信模块是否就绪；`sms_cmd_status_result=3` 表示可读 |
| `cmd=sms_data_total` | `page=0&data_per_page=500&mem_store=1&tags=10&order_by=order by id desc` | 短信列表，`messages` |
| `cmd=sms_capacity_info` | 无 | 短信容量统计 |
| `cmd=sms_cmd_status_info` | `sms_cmd=4` | 发送短信后的异步状态 |
| `cmd=sms_cmd_status_info` | `sms_cmd=6` | 删除短信后的异步状态 |

短信列表常见字段：`id`、`number`、`content`、`date`、`tag`、`received_all_concat_sms`、`draft_group_id`。项目对十六进制 Unicode 内容做解码。

## 3. 写入接口

### 3.1 主登录/开发者登录

| `goformId` | 参数 | 权限 | 作用 |
|---|---|---|---|
| `LOGIN` | `password` | 无 | 主登录 |
| `LOGOUT` | 无 | 主会话 | H5 强制登录前注销旧会话 |
| `DEVELOPER_OPTION_LOGIN` | `password` | 主登录 | 建立开发者会话 |

### 3.2 流量设置

| `goformId` | 参数 | 说明 |
|---|---|---|
| `DATA_LIMIT_SETTING` | `data_volume_limit_switch`、`data_volume_limit_unit`、`data_volume_limit_size`、`data_volume_alert_percent`、`wan_auto_clear_flow_data_switch`、`traffic_clear_date` | 保存流量套餐设置；容量写成 `GB_1024` |
| `FLOW_CALIBRATION_MANUAL` | `calibration_way=data`、`data=字节数`、`time=0` | 手动校准已用流量 |

### 3.3 短信

| `goformId` | 参数 | 说明 |
|---|---|---|
| `SEND_SMS` | `Number`、`sms_time`、`MessageBody`、`ID=-1`、`encode_type=UNICODE` | 发送短信；正文为四位十六进制 Unicode |
| `DELETE_SMS` | `msg_id=ID1;ID2;...;` | 删除短信，之后轮询 `sms_cmd=6` |

### 3.4 小区扫描与锁定

| `goformId` | 参数 | 权限 | 说明 |
|---|---|---|---|
| `SCAN_NR5G_NEIGHBOR_CELL` | 无 | 主登录 | 触发 5G 邻小区扫描 |
| `LTE_LOCK_CELL_SET` | `lte_pci_lock`、`lte_earfcn_lock` | 开发者 | 设置/解除 LTE PCI+EARFCN 锁 |
| `NR5G_LOCK_CELL_SET` | `nr5g_cell_lock=PCI,ARFCN,Band,SCS` | 开发者 | 设置/解除 NR 小区锁；项目解锁值为 `1,1,1,1` |
| `BAND_SELECT` | `is_gw_band=0`、`gw_band_mask=0`、`is_lte_band=1`、`lte_band_mask=0x...` | 开发者 | 保存 LTE 频段掩码 |
| `WAN_PERFORM_NR5G_SANSA_BAND_LOCK` | `nr5g_band_mask=逗号分隔Band`、`type=0/1` | 开发者 | 保存 NR SA/NSA 频段；`type=0` SA，`type=1` NSA；空列表写 `0` |

### 3.5 设备控制

| `goformId` | 参数 | 说明 |
|---|---|---|
| `REBOOT_DEVICE` | 无 | 重启设备 |
| `SHUTDOWN_DEVICE` | 无 | 关闭设备 |
| `SET_WIFI_INFO` | `wifiEnabled=1/0` | 开启/关闭 Wi-Fi；关闭会立即断开当前连接 |

## 4. App 对外封装方法

源码导出的 `routerApi` 方法如下：

| 方法 | 参数 | 底层接口 |
|---|---|---|
| `getConfig()` | 无 | 本地配置，不访问路由器 |
| `updateConfig({ routerUrl, password })` | 地址、密码 | 清除会话并保存本地配置 |
| `getOverlayState()` | 无 | Android 原生悬浮窗状态 |
| `setOverlayEnabled(enabled)` | 布尔值 | Android 原生悬浮窗 |
| `requestOverlayPermission()` | 无 | Android 原生权限请求 |
| `login(force)` | 布尔值 | `LOGIN` 登录流程 |
| `developerLogin()` | 无 | `DEVELOPER_OPTION_LOGIN` |
| `dashboard()` | 无 | 批量读取，见第 2.1 节 |
| `setTrafficPlan(values)` | `enabled,sizeGb,alertPercent,autoClear,clearDate` | `DATA_LIMIT_SETTING` |
| `calibrateTraffic({ gigabytes })` | GB 数字 | `FLOW_CALIBRATION_MANUAL` |
| `listSms()` | 无 | 短信状态、列表、容量 |
| `sendSms(number, message)` | 手机号、正文 | `SEND_SMS` |
| `deleteSms(ids)` | ID 或 ID 数组 | `DELETE_SMS` |
| `scanNeighbors()` | 无 | `SCAN_NR5G_NEIGHBOR_CELL` |
| `linkedCellLock(candidate)` | LTE/NR 候选小区对象 | 对应 LTE/NR 小区锁接口 |
| `setNrCellLock(values)` | `unlock` 或 `pci,arfcn,band,scs` | `NR5G_LOCK_CELL_SET` |
| `setLteCellLock(values)` | `unlock` 或 `pci,arfcn` | `LTE_LOCK_CELL_SET` |
| `setLteBands(bands)` | Band 数组 | `BAND_SELECT` |
| `setNrBands(type,bands)` | `type=sa/nsa`、Band 数组 | `WAN_PERFORM_NR5G_SANSA_BAND_LOCK` |
| `controlDevice(action)` | `wifi-on`、`wifi-off`、`reboot`、`shutdown` | 设备控制接口 |

## 5. 当前未发现的字段/能力

下列名称已做过接口探测，但当前固件 Web API 未返回有效值，项目也没有对应正式接口：

| 目标 | 常见候选字段/命令 | 当前结论 |
|---|---|---|
| LTE QCI | `qci`、`QCI`、`qos`、`qos_info` | Web API 未暴露 |
| 5G 5QI/QoS Flow | `5qi`、`5QI`、NR QoS 字段 | Web API 未暴露 |
| 签约下行速率 | `dl_rate`、`downlink_rate`、`ambr_dl` | 未发现 |
| 签约上行速率 | `ul_rate`、`uplink_rate`、`ambr_ul` | 未发现 |

这些值与 SIM 本身不是同一个层级：QCI/5QI 和 APN-AMBR 通常由核心网为承载或 QoS Flow 下发。若要继续验证，需要 Modem AT/诊断通道；LTE 设备可尝试标准 `AT+CGEQOSRDP`，5G SA 通常需要厂商专用命令。当前 App 只有 HTTP 路由器接口，没有 AT 透传实现。

## 6. 源码位置

- 请求、认证、字段集合和所有写接口：[src/services/router-client.js](/D:/code/U50PRO-CON/src/services/router-client.js)
- 页面字段展示和单位换算：[src/pages/index/index.vue](/D:/code/U50PRO-CON/src/pages/index/index.vue)
- LTE/NR 邻小区解析：[src/utils/cells.js](/D:/code/U50PRO-CON/src/utils/cells.js)
