<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { amountToChinese, formatMoney } from "./utils/giftBookFormat.js";

const EVENTS_KEY = "vue-gift-book-events-v1";
const GUEST_EVENT_KEY = "gift-book-guest-event-id";
const PAGE_SIZE = 12;

const events = ref(readEvents());
const eventId = ref(new URLSearchParams(window.location.search).get("event") || localStorage.getItem(GUEST_EVENT_KEY) || "");
const page = ref(1);
let channel;

const currentEvent = computed(() => events.value.find((event) => event.id === eventId.value));
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

onMounted(() => {
  window.addEventListener("storage", onStorage);
  if ("BroadcastChannel" in window) {
    channel = new BroadcastChannel("gift-book-sync");
    channel.onmessage = ({ data }) => sync(data);
    channel.postMessage({ type: "guest-ready" });
  }
});

onBeforeUnmount(() => {
  window.removeEventListener("storage", onStorage);
  channel?.close();
});
</script>

<template>
  <main class="guest-app" :class="currentEvent?.theme || 'theme-festive'">
    <section v-if="!currentEvent" class="guest-waiting">
      <i class="ri-broadcast-line"></i>
      <h1>副屏等待连接</h1>
      <p>请在主屏的事项菜单中重新点击“进入副屏”。</p>
    </section>

    <template v-else>
      <header class="guest-header">
        <div><small>电子礼簿 · 副屏</small><h1>{{ currentEvent.name }}</h1></div>
        <div class="guest-totals"><span>本页小计 <b>{{ formatMoney(pageTotal) }}</b></span><span>总金额 <b>{{ formatMoney(total) }}</b></span><span>总人数 <b>{{ records.length }}</b></span></div>
      </header>

      <section class="guest-book">
        <div class="guest-pager"><button class="guest-pager-arrow prev" aria-label="上一页" :disabled="page <= 1" @click="page--"><span aria-hidden="true"></span></button><b>第 {{ page }} / {{ pageCount }} 页</b><button class="guest-pager-arrow next" aria-label="下一页" :disabled="page >= pageCount" @click="page++"><span aria-hidden="true"></span></button></div>
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
      </section>
    </template>
  </main>
</template>
