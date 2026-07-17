# 电子礼簿系统

基于 Vite 与 Vue 3 的本地电子礼金登记系统，数据保存在当前浏览器的 `localStorage` 中。

## 功能

- 创建、切换和设置礼金事项
- 登记、修改、作废及检索礼金记录
- 礼簿分页展示与独立副屏
- 数据统计、JSON 备份恢复与 Excel 导出
- 生成包含封面、礼簿正文和封底的 PDF

## 运行

```bash
pnpm install
pnpm dev
```

打开 `http://127.0.0.1:5173/`。

## 构建

```bash
pnpm build
```

构建产物位于 `dist/`。

## Tauri 桌面与 Android 打包

项目已经接入 Tauri 2，Vue 页面由同一套源码生成 Windows 和 Android 应用。

### 环境要求

- Windows：Rust（通过 rustup 安装）、Visual Studio 2022 Build Tools 的“使用 C++ 的桌面开发”、WebView2。
- Android：Android Studio、Android SDK、NDK、Build Tools，并配置 `JAVA_HOME`、`ANDROID_HOME` 和 `NDK_HOME`。

### Windows EXE

```bash
pnpm tauri:build:win
```

安装包输出到 `src-tauri/target/release/bundle/nsis/`。

### Android APK

首次初始化 Android 工程：

```bash
pnpm tauri:android:init
```

生成 APK：

```bash
pnpm tauri:build:apk
```

Android 构建产物位于 `src-tauri/gen/android/app/build/outputs/`。

## GitHub 云端自动构建

仓库中的 `.github/workflows/build-tauri.yml` 会在以下情况自动运行：

- 推送到 `main` 分支。
- 推送以 `v` 开头的版本标签，例如 `v0.1.0`。
- 在 GitHub 仓库的 Actions 页面手动点击 `Run workflow`。

每次构建完成后，可以在该次 Actions 运行页面的 `Artifacts` 区域下载：

- `egift-windows-x64-nsis`：Windows 安装程序。
- `egift-android-aarch64-apk-debug`：适用于主流 ARM64 手机、可直接安装的小体积 Android Debug APK。

版本标签构建还会自动创建 GitHub Release，并把 EXE 和 APK 添加到 Release 下载列表。

```bash
git tag v0.1.0
git push 电子礼金 v0.1.0
```

Debug APK 适合自行安装和测试。发布到应用商店前，需要根据 Tauri Android 签名文档配置正式签名证书；证书和密码只能放在 GitHub Secrets 中，不能提交到仓库。
