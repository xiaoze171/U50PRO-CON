# U50 Pro 控制台 uni-app

这是现有 `router-console` 的独立 uni-app 版本，原项目没有被覆盖。它共用一套 Vue 3 页面与路由器业务逻辑：

- H5 开发预览通过 Vite 反向代理访问 `http://192.168.0.1`，避免浏览器跨域。
- Android App 运行时直接访问路由器局域网地址，不依赖电脑上的 Node 代理。
- 默认保存路由器地址 `http://192.168.0.1`、登录密码与开发者密码 `111111`，自动完成动态 `LD`、SHA-256 登录和写接口动态 `AD`。

## 已迁移功能

- 总览、网络状态、信号波动和 ECharts 图表
- 温度、可用的 CPU/内存字段、设备和固件信息
- 基站、服务小区、CA/辅载波、邻小区搜索与扫描
- 最强小区自动填值、LTE/NR 锁小区和解除锁定
- LTE、5G SA、5G NSA 独立锁频段
- 实时流量、每月用量、联网时间
- 电池电量、充电状态、续航测算、温度曲线和续航记录
- 短信列表与发送
- 无线/有线接入设备管理
- 关机、重启、开启 Wi-Fi、关闭 Wi-Fi
- Android 原生 JDBC 直连 MySQL，保存路由器登录配置、电池续航样本并供多设备共享
- 路由器功能始终使用局域网直连
- 每秒刷新并防止请求重入

`pin_status=0` 没有再作为 SIM 状态展示；无法获取的 SIM 状态已删除。

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

App 资源：

```powershell
npm run build:app
```

产物：`dist/build/app`。

## MySQL 直连

Android APK 通过原生 JDBC 直接连接 MySQL，不需要 Node、PHP 或其他接口程序。浏览器 H5 受浏览器网络能力限制，不能使用 MySQL 直连功能。

1. 在 MySQL 中执行 [database/schema.sql](database/schema.sql)。
2. 确保 MySQL 允许手机所在网络连接，并给数据库用户授权。
3. 在 Android App 设置中填写数据库地址、端口、数据库名、用户名和密码。
4. 点击“测试连接”，成功后可读取或同步 `default` 配置。应用会定期上传续航样本，并从数据库合并最近 30 天记录。

数据库只保留两张实际使用的表：`router_profiles` 保存共享登录配置，`router_battery_history` 保存电量、充放电状态、温度、速率和预计续航；旧的状态快照表与操作日志表会在 App 连接时自动删除。

路由器登录与开发者认证使用同一个密码。当前直连版本按普通文本写入 `router_profiles.router_password`。

## 外网访问

MySQL 直连只负责配置共享，不能替手机访问路由器 `192.168.0.1`。手机未连接 U50 Pro Wi-Fi 时，无法实时查看或控制路由器。

中兴智慧生活的“无需连接 Wi-Fi”依赖中兴账号、设备绑定和厂商云的私有协议，和本机 `/goform` 接口不是同一套 API。当前代码没有伪造该接口。若要复用官方云，需要提供本人账号下 App 的 HTTPS/WebSocket/MQTT 抓包（脱敏账号密码，但保留域名、路径、请求字段和返回结构），再实现独立的 ZTE Cloud 适配器。

## Android APK 打包

1. 使用 HBuilderX 导入本目录，或导入 `dist/build/app`。
2. 打开 `src/manifest.json` 检查应用名称、AppID、版本号、Android SDK 和签名。
3. 选择“发行 → 原生 App-云打包”，平台选择 Android。
4. 正式发布时使用自己的 Android 证书；测试可使用云端测试证书。
5. 手机连接 U50 Pro Wi-Fi 后安装运行。

Android 已声明互联网、网络状态和 Wi-Fi 状态权限。路由器使用 HTTP 局域网地址；若目标 Android/定制 WebView 阻止明文 HTTP，需要在 HBuilderX 原生配置中允许 cleartext traffic 后重新打包。

## 注意

- 未启用 MySQL 同步时密码只保存在应用本机；启用后由 Android APK 直接写入 MySQL。
- 锁小区和锁频段会改变蜂窝配置，执行失败时页面会显示固件返回结果。
- 关闭 Wi-Fi 会让局域网会话立即断开；关闭设备后不能远程开机，只能使用实体电源键。
- App 首次启动前需确保手机已连接到路由器 Wi-Fi，且可访问 `192.168.0.1`。
