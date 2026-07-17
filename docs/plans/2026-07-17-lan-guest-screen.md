# LAN Guest Screen and Native Export Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let a phone scan a QR code and view the tablet's gift ledger in real time on the same LAN, while making desktop PDF/Excel export open a real save dialog.

**Architecture:** The Tauri Rust process hosts a temporary read-only HTTP/WebSocket server bound to the local network. Vue sends only the active event snapshot to Rust, and a tokenized single-page viewer receives initial and incremental snapshots. Tauri uses native dialog/file APIs on every desktop/mobile platform; normal Chromium browsers use the File System Access API with a download fallback.

**Tech Stack:** Vue 3, Tauri 2 commands/state, Rust, Axum 0.8 WebSocket, Tokio, qrcode 1.5, Tauri dialog/fs plugins.

---

### Task 1: Native LAN server

**Files:**
- Create: `src-tauri/src/lan_server.rs`
- Create: `src-tauri/src/lan_viewer.html`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`

1. Add Axum/Tokio/UUID/local-IP dependencies.
2. Add start, update, status and stop Tauri commands.
3. Bind to an ephemeral `0.0.0.0` port and return a tokenized LAN URL.
4. Serve a read-only HTML viewer and authenticated WebSocket endpoint.
5. Verify later with `cargo check` in CI because this machine intentionally has no Rust toolchain.

### Task 2: QR sharing UI and live data flow

**Files:**
- Modify: `src/ProfessionalApp.vue`
- Modify: `src/professional.css`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

1. Add QR generation dependency.
2. Add a “局域网副屏” action and pairing modal.
3. Send the current event immediately and after every record mutation.
4. Add copy URL, retry and stop-sharing states.
5. Verify Vue production compilation with `pnpm build`.

### Task 3: Desktop PDF and Excel delivery

**Files:**
- Modify: `src/ProfessionalApp.vue`

1. Use Tauri save/write APIs on Windows and Android.
2. Use `showSaveFilePicker` in supporting desktop browsers.
3. Preserve Android PDF share-to-print and anchor-download fallback.
4. Verify PDF/Excel code paths compile and cancellation does not show an error.

### Task 4: Static verification

1. Run `pnpm build` and expect success.
2. Run `git diff --check` and expect no whitespace errors.
3. Do not launch a browser or trigger GitHub Actions in this phase.
