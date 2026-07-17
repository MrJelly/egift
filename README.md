# 电子礼簿

一个基于 Vue 3 + Vite + Tauri 的本地电子礼金登记工具，适合婚宴、寿宴、白事等现场快速录入礼金，并支持手机/平板副屏实时查看。

## 功能特点

- 事项管理：创建、切换、设置、删除不同礼金事项。
- 礼金录入：姓名、金额、收款方式、备注、礼品、关系、电话、住址。
- 礼簿展示：12 格一页，仿传统礼簿竖排布局。
- 搜索与详情：按姓名或备注查找记录，查看、修改、纠错、作废。
- 统计功能：查看总金额、人数、收款方式等统计信息。
- 语音播报：录入后可播报礼金信息。
- 数据备份：支持 JSON 备份与恢复。
- 导出能力：支持打印/另存为 PDF，支持导出 Excel。
- 副屏展示：本机副屏或局域网手机扫码查看，只读实时同步。
- 多端适配：桌面、平板横竖屏、手机副屏做了响应式适配。
- Tauri 打包：支持 Windows EXE 和 Android APK。

## 本地运行

```bash
pnpm install
pnpm dev
```

浏览器打开：

```text
http://127.0.0.1:5173/
```

如果要让局域网内手机访问开发服务，确保电脑和平板/手机在同一个 Wi-Fi，并使用终端输出的局域网地址访问。

## 常用操作

### 创建事项

首页填写事项名称、起止时间、管理密码，选择主题后点击“创建并进入”。

### 进入已有事项

在首页选择已有事项，点击“进入”，再输入管理密码。

### 手机扫码查看副屏

进入事项后，在左上角事项菜单中选择“开启局域网副屏（扫码）”，手机和主设备连接同一 Wi-Fi 后扫码即可查看。

副屏是只读页面，只展示礼簿和统计信息，不允许修改数据。

### 打印 / 另存为 PDF

点击“打印/另存为 PDF”会生成适合打印的礼簿 PDF。桌面端可以直接保存，浏览器端会触发下载或打印流程。

### 导出 Excel

点击“导出为 Excel”会导出当前事项的礼金明细。

## 构建前端

```bash
pnpm build
```

构建产物位于：

```text
dist/
```

## Tauri 桌面端和 Android

项目已接入 Tauri 2，同一套 Vue 前端可以打包为 Windows 桌面应用和 Android 应用。

### Windows EXE

```bash
pnpm tauri:build:win
```

输出目录通常为：

```text
src-tauri/target/release/bundle/nsis/
```

### Android APK

首次初始化 Android 工程：

```bash
pnpm tauri:android:init
```

构建 APK：

```bash
pnpm tauri:build:apk
```

构建 ARM64 debug APK：

```bash
pnpm tauri:build:apk:debug
```

Android 产物通常位于：

```text
src-tauri/gen/android/app/build/outputs/
```

## GitHub 自动构建

仓库内 `.github/workflows/build-tauri.yml` 会在以下情况自动运行：

- 推送到 `main` 分支。
- 推送 `v*` 版本标签，例如 `v0.1.0`。
- 在 GitHub Actions 页面手动点击 `Run workflow`。

构建完成后，在对应 Actions 运行页面的 `Artifacts` 区域下载：

- `egift-windows-x64-nsis`：Windows 安装包。
- `egift-android-arm64-apk-debug`：Android ARM64 debug APK。

如果是版本标签触发构建，还会自动创建 GitHub Release，并把 EXE 和 APK 上传到 Release 下载列表。

示例：

```bash
git tag v0.1.0
git push origin v0.1.0
```

## 数据说明

默认数据保存在当前浏览器或 Tauri WebView 的 `localStorage` 中。换设备、清理浏览器数据或卸载应用前，请先使用“备份/恢复数据”导出 JSON 备份。

## 开发说明

- 前端框架：Vue 3
- 构建工具：Vite
- 桌面/移动壳：Tauri 2
- 二维码：qrcode
- 样式适配：桌面横屏使用整体缩放，移动竖屏使用上下布局，副屏使用按屏幕宽度铺满的缩放画布。

## 注意事项

- 局域网副屏要求主设备和观看手机处于同一网络。
- 如果 Windows 防火墙弹出提示，需要允许局域网访问。
- Android debug APK 适合自测安装；正式发布前应配置正式签名证书。
