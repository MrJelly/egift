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

if (isSafeAreaFallbackDevice) root.classList.add("safe-area-fallback");
if (/Android/i.test(userAgent)) root.classList.add("platform-android");
if (window.__TAURI_INTERNALS__ || window.__TAURI__) root.classList.add("platform-tauri");

const isGuestScreen = new URLSearchParams(window.location.search).get("screen") === "guest";
createApp(isGuestScreen ? GuestScreen : App).mount("#app");
