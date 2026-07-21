import { createApp } from "vue";
import App from "./ProfessionalApp.vue";
import GuestScreen from "./GuestScreen.vue";
import "./professional.css";
import "./guest-screen.css";
import "./responsive.css";

const root = document.documentElement;
const userAgent = navigator.userAgent;
const isIPadLike = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
const isSafeAreaFallbackDevice =
  /Android|iPhone|iPad|iPod|HarmonyOS|OpenHarmony|Mobile/i.test(userAgent) || isIPadLike;
const isAndroid = /Android/i.test(userAgent);
const isTauriRuntime = Boolean(window.__TAURI_INTERNALS__ || window.__TAURI__);
const hasNativeSafeArea = isAndroid && isTauriRuntime;

if (isSafeAreaFallbackDevice && !hasNativeSafeArea) root.classList.add("safe-area-fallback");
if (isAndroid) root.classList.add("platform-android");
if (isTauriRuntime) root.classList.add("platform-tauri");
if (hasNativeSafeArea) root.classList.add("native-safe-area");

const isGuestScreen = new URLSearchParams(window.location.search).get("screen") === "guest";
createApp(isGuestScreen ? GuestScreen : App).mount("#app");
