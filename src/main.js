import { createApp } from "vue";
import App from "./ProfessionalApp.vue";
import GuestScreen from "./GuestScreen.vue";
import "./professional.css";
import "./guest-screen.css";
import "./responsive.css";

const isGuestScreen = new URLSearchParams(window.location.search).get("screen") === "guest";
createApp(isGuestScreen ? GuestScreen : App).mount("#app");
