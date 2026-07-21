<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref } from "vue";
import { amountToChinese, formatMoney } from "./utils/giftBookFormat.js";

const EVENTS_KEY = "vue-gift-book-events-v1";
const GUEST_EVENT_KEY = "gift-book-guest-event-id";
const PAGE_SIZE = 12;

const events = ref(readEvents());
const eventId = ref(new URLSearchParams(window.location.search).get("event") || localStorage.getItem(GUEST_EVENT_KEY) || "");
const page = ref(1);
const showPaymentQr = ref(false);
let channel;

const viewportSize = reactive({
  width: document.documentElement.clientWidth || window.innerWidth,
  height: document.documentElement.clientHeight || window.innerHeight,
});
const isIPadLikeViewport = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
const isAndroidDevice = /Android/i.test(navigator.userAgent);
const hasNativeSafeArea = document.documentElement.classList.contains("native-safe-area");
const hasMobileSafeAreaFallback =
  /Android|iPhone|iPad|iPod|HarmonyOS|OpenHarmony|Mobile/i.test(navigator.userAgent) || isIPadLikeViewport;
function fallbackSafeInsets() {
  if (hasNativeSafeArea) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (!hasMobileSafeAreaFallback) return { top: 0, right: 0, bottom: 0, left: 0 };
  const landscape = viewportSize.width >= viewportSize.height;
  if (isAndroidDevice && landscape) return { top: 22, right: 48, bottom: 22, left: 48 };
  if (isAndroidDevice) return { top: 54, right: 12, bottom: 48, left: 12 };
  if (landscape) return { top: 8, right: 24, bottom: 12, left: 24 };
  return { top: 30, right: 8, bottom: 20, left: 8 };
}

const isLandscapeLayout = computed(() => viewportSize.width >= viewportSize.height);

const guestStageStyle = computed(() => {
  const insets = fallbackSafeInsets();
  const availableWidth = Math.max(1, viewportSize.width - insets.left - insets.right);
  const availableHeight = Math.max(1, viewportSize.height - insets.top - insets.bottom);
  const designWidth = isLandscapeLayout.value ? 1080 : 420;
  const scale = Math.max(0.1, availableWidth / designWidth);
  const designHeight = availableHeight / scale;
  return {
    "--guest-layout-width": `${designWidth}px`,
    "--guest-layout-height": `${designHeight.toFixed(2)}px`,
    "--guest-layout-scale": scale.toFixed(4),
  };
});

const currentEvent = computed(() => events.value.find((event) => event.id === eventId.value));
const currentPaymentQrCodes = computed(() => {
  const value = currentEvent.value?.paymentQrCodes || currentEvent.value?.paymentQrCode;
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.filter(Boolean).slice(0, 2);
});
const records = computed(() =>
  [...(currentEvent.value?.records || [])]
    .filter((record) => !record.abolished)
    .sort((a, b) => (b.level || 0) - (a.level || 0) || new Date(a.createdAt) - new Date(b.createdAt)),
);
const pageCount = computed(() => Math.max(1, Math.ceil(records.value.length / PAGE_SIZE)));
const pageItems = computed(() => records.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const pageTotal = computed(() => pageItems.value.reduce((sum, record) => sum + Number(record.amount), 0));
const total = computed(() => records.value.reduce((sum, record) => sum + Number(record.amount), 0));
const latestId = computed(() => records.value.at(-1)?.id);

function readEvents() {
  try {
    return JSON.parse(localStorage.getItem(EVENTS_KEY) || "[]");
  } catch {
    return [];
  }
}

function maskName(record) {
  if (!currentEvent.value?.hidePrivacy || record.id === latestId.value) return record.name;
  const chars = Array.from(record.name || "");
  if (chars.length <= 1) return "*";
  if (chars.length === 2) return `${chars[0]}*`;
  return `${chars[0]}${"*".repeat(chars.length - 2)}${chars.at(-1)}`;
}

function sync(payload) {
  if (payload?.type === "sync") events.value = readEvents();
  if (payload?.eventId) eventId.value = payload.eventId;
  page.value = pageCount.value;
}

function onStorage(event) {
  if (event.key === EVENTS_KEY || event.key === GUEST_EVENT_KEY) {
    events.value = readEvents();
    eventId.value = localStorage.getItem(GUEST_EVENT_KEY) || eventId.value;
    page.value = pageCount.value;
  }
}

function updateViewportSize() {
  viewportSize.width = Math.round(document.documentElement.clientWidth || window.innerWidth);
  viewportSize.height = Math.round(document.documentElement.clientHeight || window.innerHeight);
}

function settleViewportAfterRotation() {
  updateViewportSize();
  window.setTimeout(updateViewportSize, 80);
  window.setTimeout(updateViewportSize, 280);
}

onMounted(() => {
  window.addEventListener("storage", onStorage);
  updateViewportSize();
  window.addEventListener("resize", updateViewportSize, { passive: true });
  window.addEventListener("orientationchange", settleViewportAfterRotation, { passive: true });
  window.visualViewport?.addEventListener("resize", updateViewportSize, { passive: true });
  window.visualViewport?.addEventListener("scroll", updateViewportSize, { passive: true });
  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel("gift-book-sync");
    channel.onmessage = ({ data }) => sync(data);
    channel.postMessage({ type: "guest-ready" });
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("storage", onStorage);
  window.removeEventListener("resize", updateViewportSize);
  window.removeEventListener("orientationchange", settleViewportAfterRotation);
  window.visualViewport?.removeEventListener("resize", updateViewportSize);
  window.visualViewport?.removeEventListener("scroll", updateViewportSize);
  channel?.close();
});
</script>

<template>
  <main class="guest-app guest-scaled-layout" :class="[currentEvent?.theme || 'theme-festive', isLandscapeLayout ? 'guest-landscape' : 'guest-portrait']" :style="guestStageStyle">
    <section v-if="!currentEvent" class="guest-waiting">
      <i class="ri-broadcast-line"></i>
      <h1>副屏等待连接</h1>
      <p>请在主屏的事项菜单中重新点击“进入副屏”。</p>
    </section>

    <div v-else class="guest-container">
      <header class="guest-header">
        <div><small>电子礼簿 · 副屏</small><h1>{{ currentEvent.name }}</h1></div>
        <div class="guest-totals"><span>本页小计 <b>{{ formatMoney(pageTotal) }}</b></span><span>总金额 <b>{{ formatMoney(total) }}</b></span><span>总人数 <b>{{ records.length }}</b></span>
          <div class="guest-payment-wrap">
            <button class="guest-payment-trigger" type="button" :aria-expanded="showPaymentQr" @click="showPaymentQr = !showPaymentQr">
              <i class="ri-qr-code-line"></i><span>收款码</span><small v-if="currentPaymentQrCodes.length">{{ currentPaymentQrCodes.length }}</small>
            </button>
            <section v-if="showPaymentQr" class="guest-qr-popover" :class="{ empty: !currentPaymentQrCodes.length }">
              <button class="guest-qr-close" type="button" aria-label="关闭收款码" @click="showPaymentQr = false">×</button>
              <div v-if="currentPaymentQrCodes.length" class="guest-qr-images">
                <img v-for="(code, index) in currentPaymentQrCodes" :key="`${index}-${code.length}`" :src="code"
                  :alt="`收款码 ${index + 1}`" />
              </div>
              <p v-else>暂无收款码</p>
            </section>
          </div>
        </div>
      </header>

      <section class="guest-book">
        <div class="guest-pager"><button class="guest-pager-arrow prev" aria-label="上一页" :disabled="page <= 1" @click="page--"><span aria-hidden="true"></span></button><b>第 {{ page }} / {{ pageCount }} 页</b><button class="guest-pager-arrow next" aria-label="下一页" :disabled="page >= pageCount" @click="page++"><span aria-hidden="true"></span></button></div>
        <div class="guest-ledger-scroll">
          <div class="guest-ledger">
            <article v-for="record in pageItems" :key="record.id" class="guest-column" :class="{ latest: record.id === latestId }">
              <div class="guest-name">{{ maskName(record) }}</div>
              <div class="guest-label">{{ currentEvent.theme === 'theme-solemn' ? '礼金' : '贺礼' }}</div>
              <div class="guest-amount"><span>{{ amountToChinese(record.amount) }}</span><small>{{ formatMoney(record.amount) }}</small></div>
            </article>
            <article v-for="n in Math.max(0, PAGE_SIZE - pageItems.length)" :key="`empty-${n}`" class="guest-column empty">
              <div class="guest-name"></div><div class="guest-label">{{ currentEvent.theme === 'theme-solemn' ? '礼金' : '贺礼' }}</div><div class="guest-amount"></div>
            </article>
          </div>
        </div>
      </section>
    </div>
  </main>
</template>
