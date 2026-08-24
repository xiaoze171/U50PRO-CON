# U50 Pro 控制台 uni-app

这是现有 `router-console` 的独立 uni-app 版本，原项目没有被覆盖。它共用一套 Vue 3 页面与路由器业务逻辑：

- H5 开发预览通过 Vite 反向代理访问 `http://192.168.0.1`，避免浏览器跨域。
- Android App 运行时直接访问路由器局域网地址，不依赖电脑上的 Node 代理。
- 默认保存路由器地址 `http://192.168.0.1`、登录密码与开发者密码 `111111`，自动完成动态 `LD`、SHA-256 登录和写接口动态 `AD`。

## 已迁移功能

- 总览、网络状态、温度曲线和 ECharts 图表
- 可用的 CPU/内存字段、设备和固件信息
- 基站、服务小区、CA/辅载波、邻小区搜索与扫描
- 最近 24 小时 RSRP/SINR/RSRQ 信号趋势图
- 最强小区自动填值、LTE/NR 锁小区和解除锁定
- LTE、5G SA、5G NSA 独立锁频段
- 实时流量、每月用量、联网时间
- 流量套餐设置、提醒百分比、自动清零与已用流量校准
- 电池电量、充电状态、续航测算、电量曲线和续航记录
- 短信列表与发送
- 无线/有线接入设备管理
- 关机、重启、开启 Wi-Fi、关闭 Wi-Fi
- 信号、温度和吞吐历史在本机保存最近 24 小时，电池历史保存最近 12 小时，均按分钟桶化
- Android 前台服务常驻通知栏，后台持续轮询并记录电池数据
- Android 悬浮窗使用固定尺寸和固定绘制区域，下载/上传速度统一显示为 MB/s，避免网速变化造成位置跳动或闪烁
- 折线图在数据较少时自动放大到可读范围，支持拖动和缩放查看历史，刷新时保留用户当前视窗
- App 退到后台后自动切换为原生轻量轮询，手机重启后自动恢复监测
- 路由器功能始终使用局域网直连
- 每秒刷新并防止请求重入

`pin_status=0` 没有再作为 SIM 状态展示；无法获取的 SIM 状态已删除。

上下行速率历史仍在采集和保存，但当前界面没有吞吐折线图。Cell ID、Wi-Fi SSID 和无线接入数量也只做拉取，尚未展示。

## 浏览器预览

首次使用：

```powershell
npm install
npm run dev:h5
```

或双击 `start-h5.cmd`，然后访问：

- 本机：<http://127.0.0.1:5130>
- 同一局域网手机：<http://192.168.0.238:5130>

如果路由器管理地址不是 `192.168.0.1`，应用内设置可修改 App 地址；H5 开发代理还需要设置环境变量后重新启动：

```powershell
$env:ROUTER_ORIGIN='http://你的路由器地址'
npm run dev:h5
```

## 构建

H5：

```powershell
npm run build:h5
```

产物：`dist/build/h5`。

App 资源（仅在改用 HBuilderX 云打包时需要）：

```powershell
npm run build:app
```

产物：`dist/build/app`。

## 本地数据

路由器地址、统一登录密码和图表历史都只保存在当前浏览器或 Android App 的本地存储中，不需要配置数据库或接口服务器。路由器登录与开发者认证使用同一个密码。

- RSRP、RSRQ、SINR、温度和上下行吞吐保存最近 24 小时，并按分钟桶化以控制图表点数。
- 电池历史前端保存最近 12 小时，最多 725 条分钟级样本。
- Android 后台电池文件保留最近 24 小时、最多约 1,445 条，合并回前端时按 12 小时截断。
- 图表支持 ECharts 内置拖动/缩放；数据不足时显示稳定基线或提示，不会出现整块空白。

## 外网访问

手机未连接 U50 Pro Wi-Fi、且无法访问路由器 `192.168.0.1` 时，无法实时查看或控制路由器。

中兴智慧生活的“无需连接 Wi-Fi”依赖中兴账号、设备绑定和厂商云的私有协议，和本机 `/goform` 接口不是同一套 API。当前代码没有伪造该接口。若要复用官方云，需要提供本人账号下 App 的 HTTPS/WebSocket/MQTT 抓包（脱敏账号密码，但保留域名、路径、请求字段和返回结构），再实现独立的 ZTE Cloud 适配器。

## Android APK 打包

当前实际使用的是本目录下的原生 `android-wrapper` Gradle 工程，不走 HBuilderX 云打包。

离线构建环境：

- JDK 17：`C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot`
- Android SDK：`D:\config\android-sdk`
- 旧电脑兼容环境：JDK 8 `D:\config\jdk1.8.0_181`，Gradle `D:\config\gradle-6.9.4`
- Android Gradle Plugin：4.2.2
- compileSdk/targetSdk：30，minSdk：23
- build tools：30.0.3
- 当前验证版本：`1.3.17`（`versionCode 31`）

### 同步 H5 产物

Android WebView 从 `android-wrapper/app/src/main/assets/www/` 加载页面，不引用 `dist/`。改完 `src/` 后必须：

1. `npm run build:h5`
2. 清空 `android-wrapper/app/src/main/assets/www/assets` 中旧的 hash 文件
3. 把 `dist/build/h5` 的产物和 `index.html` 复制到 `assets/www/`

### 构建与安装

```powershell
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-17.0.20.101-hotspot'
$env:Path="$env:JAVA_HOME\bin;$env:Path"
cd android-wrapper
D:\config\gradle-6.9.4\bin\gradle.bat :app:assembleRelease
adb install -r app\build\outputs\apk\release\app-release.apk
```

不要用 `cmd /c "set JAVA_HOME=... & ..."`，`%PATH%` 会提前展开导致 JAVA_HOME 校验失败。

签名配置写在 `android-wrapper/app/build.gradle`，密钥库 `android-wrapper/mu5120-release.jks`（已在 `.gitignore` 中排除）。安装到使用不同证书的旧版本前需要先卸载旧包，这会清除应用本地设置和历史数据。

Gradle 在线依赖不可用时，可使用本地 `aapt`、`javac`、`d8`、`zipalign` 和 `apksigner` 完成离线构建。

### HBuilderX 云打包（备用路径）

1. 使用 HBuilderX 导入本目录，或导入 `dist/build/app`。
2. 打开 `src/manifest.json` 检查应用名称、AppID、版本号、Android SDK 和签名。该文件当前为 `1.3.9 / 139`，与原生工程的 `1.3.17 / 31` 不同步，改用此路径前需先更新。
3. 选择“发行 → 原生 App-云打包”，平台选择 Android。
4. 正式发布时使用自己的 Android 证书；测试可使用云端测试证书。
5. 手机连接 U50 Pro Wi-Fi 后安装运行。

## 运行权限与后台

Android 已声明互联网、网络状态、Wi-Fi 状态、前台服务、唤醒锁、精确闹钟、开机自启、通知、电池优化豁免和悬浮窗权限。路由器使用 HTTP 局域网地址，清单已允许明文流量。

后台监测默认常驻且不提供关闭开关。Android 13 及以上首次启动需要允许通知；vivo 等系统还应允许应用自启动和后台高耗电，否则系统仍可能限制前台服务。常驻监测会保持 CPU 和 Wi-Fi 可用，因此会增加手机耗电。

前台服务通知内容是固定文案，不显示实时数值；实时上下行、电量和温度由应用界面和悬浮窗显示。

设置页可开启悬浮监测。首次开启会跳转到 Android“显示在其他应用上层”授权页；授权后悬浮窗显示实时下载速度、上传速度、电量和电池温度，可拖动调整位置并自动记住。关闭设置开关后悬浮窗立即移除，后台轮询和电池记录仍继续运行。

`BackgroundMonitorService` 运行在 `:monitor` 独立进程。前台状态通过 intent 驱动服务进程内的内存字段，电池历史使用文件存储，两者都不能依赖跨进程读取 SharedPreferences。

## 注意

- 路由器地址、密码和历史记录只保存在应用本机，密码为明文存储。
- 锁小区和锁频段会改变蜂窝配置，执行失败时页面会显示固件返回结果。
- 关闭 Wi-Fi 会让局域网会话立即断开；关闭设备后不能远程开机，只能使用实体电源键。
- App 首次启动前需确保手机已连接到路由器 Wi-Fi，且可访问 `192.168.0.1`。
- 手机息屏后 Wi-Fi 可能断连或换网段，后台采样会中断。这是系统层限制，已确认无法在应用层解决。

## 当前版本说明

- 指标、温度和信号历史保留最近 24 小时并按分钟桶化；数据不足时会自动放大曲线，支持拖动和缩放。
- 电池图表数据来自前端 12 小时窗口。
- Android 悬浮窗约为 `250dp × 32dp`，背景透明，下载和上传速度统一显示为 `MB/s`，固定位置刷新，不会因单位或数字长度变化而闪烁。
- 当前 Android 验证版本为 `1.3.17`。本地离线构建使用 JDK 17 和 `D:\config\android-sdk`。
