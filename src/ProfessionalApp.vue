<script setup>
import { invoke, isTauri } from "@tauri-apps/api/core";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import QRCode from "qrcode";
import { computed, nextTick, onBeforeUnmount, onMounted, reactive, ref, watch } from "vue";
import {
  amountToChinese,
  downloadBlob,
  formatDateTime,
  formatEventDate,
  formatMoney,
  safeFilename,
} from "./utils/giftBookFormat.js";

const EVENTS_KEY = "vue-gift-book-events-v1";
const GUEST_EVENT_KEY = "gift-book-guest-event-id";
const PAGE_SIZE = 12;
const THEME_OPTIONS = [
  { value: "theme-festive", label: "喜庆红（喜事）" },
  { value: "theme-solemn", label: "肃穆灰（白事）" },
];
const PAYMENT_METHODS = ["现金", "微信", "支付宝", "其他"];
const REMARK_FIELDS = [
  ["gift", "礼品"],
  ["relation", "关系"],
  ["phone", "电话"],
  ["address", "住址"],
];

const events = ref(loadEvents());
const activeId = ref("");
const unlocked = ref(false);
const unlockPassword = ref("");
const page = ref(1);
const query = ref("");
const speech = ref(true);
const mobileToolsOpen = ref(false);
const showUnlockDialog = ref(false);
const showEventMenu = ref(false);
const showSetupEventOptions = ref(false);
const showThemeOptions = ref(false);
const showStats = ref(false);
const showBackup = ref(false);
const showSettings = ref(false);
const showDelete = ref(false);
const showAbolish = ref(false);
const showSearchResults = ref(false);
const showLanShare = ref(false);
const lanBusy = ref(false);
const lanSession = ref(null);
const lanQrCode = ref("");
const selectedRecordId = ref("");
const editing = ref(null);
const editMode = ref("");
const remarkFields = ref([]);
const restoreInput = ref(null);
const paymentQrInput = ref(null);
const backupExported = ref(false);
const deletePassword = ref("");
const abolishReason = ref("");
const pdfBusy = ref(false);
const toast = ref(null);
let toastTimer;
let syncChannel;
let lanSyncTimer;
let layoutResizeObserver;

const createForm = reactive({
  name: "",
  password: "",
  start: localDateTime(),
  end: localDateTime(Date.now() + 86400000),
  theme: "theme-festive",
  recorder: "",
});
const giftForm = reactive({
  name: "",
  amount: "",
  method: "现金",
  custom: "",
  gift: "",
  relation: "",
  phone: "",
  address: "",
});
const settingsForm = reactive({
  name: "",
  start: "",
  end: "",
  recorder: "",
  minSpeechAmount: 0,
  hidePrivacy: false,
  paymentQrCodes: [],
});
const viewportSize = reactive({
  width: document.documentElement.clientWidth || window.innerWidth,
  height: document.documentElement.clientHeight || window.innerHeight,
});
const orientationQuery = window.matchMedia("(orientation: landscape)");
const landscapeViewport = ref(orientationQuery.matches);
const mainStageRef = ref(null);
const mainStageBox = reactive({ width: 0, height: 0 });

const currentEvent = computed(() => events.value.find((event) => event.id === activeId.value));
const selectedEventLabel = computed(() => currentEvent.value?.name || "请选择一个事项");
const selectedThemeLabel = computed(() => THEME_OPTIONS.find((theme) => theme.value === createForm.theme)?.label || THEME_OPTIONS[0].label);
const isLandscapeLayout = computed(() => landscapeViewport.value);
const toolsCollapsible = computed(() => !isLandscapeLayout.value || viewportSize.width <= 1250);
const mainStageStyle = computed(() => {
  if (!isLandscapeLayout.value) {
    return {
      "--main-layout-width": "100%",
      "--main-layout-height": "auto",
      "--main-layout-scale": "1",
    };
  }

  const stagePadding = Math.min(28, Math.max(10, viewportSize.width * 0.02));
  const fallbackWidth = Math.max(1, viewportSize.width - stagePadding * 2);
  const fallbackHeight = Math.max(1, viewportSize.height - stagePadding * 2);
  const availableWidth = Math.max(1, mainStageBox.width || fallbackWidth);
  const availableHeight = Math.max(1, mainStageBox.height || fallbackHeight);
  const scale = Math.max(0.1, availableHeight / 700);
  const designWidth = availableWidth / scale;
  return {
    "--main-layout-width": `${designWidth}px`,
    "--main-layout-height": "700px",
    "--main-layout-scale": scale.toFixed(4),
  };
});
const guestScreenHref = computed(() => {
  if (!currentEvent.value) return "#";
  const url = new URL(window.location.href);
  url.search = "";
  url.hash = "";
  url.searchParams.set("screen", "guest");
  url.searchParams.set("event", currentEvent.value.id);
  return url.toString();
});
const guestScreenPath = computed(() => {
  const url = new URL(guestScreenHref.value);
  return `${url.pathname}${url.search}`;
});
const activeTheme = computed(() => currentEvent.value?.theme || createForm.theme);
const activeRecords = computed(() =>
  (currentEvent.value?.records || []).filter((record) => !record.abolished),
);
const filteredRecords = computed(() =>
  [...activeRecords.value].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt)),
);
const searchResults = computed(() => {
  const keyword = query.value.trim().toLowerCase();
  if (!keyword) return [];
  return filteredRecords.value
    .filter((record) => {
      const haystack = [record.name, record.method, ...Object.values(record.remarks || {})].join(" ").toLowerCase();
      return haystack.includes(keyword);
    });
});
const pageCount = computed(() => Math.max(1, Math.ceil(filteredRecords.value.length / PAGE_SIZE)));
const pageItems = computed(() => filteredRecords.value.slice((page.value - 1) * PAGE_SIZE, page.value * PAGE_SIZE));
const pageTotal = computed(() => pageItems.value.reduce((sum, record) => sum + Number(record.amount), 0));
const total = computed(() => activeRecords.value.reduce((sum, record) => sum + Number(record.amount), 0));
const selectedRecord = computed(() => currentEvent.value?.records.find((record) => record.id === selectedRecordId.value));
const methodStats = computed(() =>
  activeRecords.value.reduce((result, record) => {
    const method = record.method || "其他";
    result[method] = result[method] || { count: 0, amount: 0 };
    result[method].count += 1;
    result[method].amount += Number(record.amount);
    return result;
  }, {}),
);

watch(
  events,
  () => {
    localStorage.setItem(EVENTS_KEY, JSON.stringify(events.value));
    syncGuestScreen();
    syncLanScreen();
  },
  { deep: true },
);
watch(filteredRecords, () => {
  page.value = Math.min(page.value, pageCount.value);
});
watch(activeId, syncLanScreen);
watch([unlocked, isLandscapeLayout], () => nextTick(observeLayoutBoxes));

onMounted(() => {
  if ("BroadcastChannel" in window) {
    syncChannel = new BroadcastChannel("gift-book-sync");
    syncChannel.onmessage = ({ data }) => {
      if (data?.type === "guest-ready") syncGuestScreen();
    };
  }
  updateViewportSize();
  if (typeof ResizeObserver !== "undefined") {
    layoutResizeObserver = new ResizeObserver(updateLayoutBoxes);
  }
  nextTick(observeLayoutBoxes);
  window.addEventListener("resize", updateViewportSize, { passive: true });
  window.addEventListener("orientationchange", settleViewportAfterRotation, { passive: true });
  orientationQuery.addEventListener?.("change", settleViewportAfterRotation);
  window.visualViewport?.addEventListener("resize", updateViewportSize, { passive: true });
  window.visualViewport?.addEventListener("scroll", updateViewportSize, { passive: true });
  restoreLanSession();
});

onBeforeUnmount(() => {
  syncChannel?.close();
  layoutResizeObserver?.disconnect();
  clearTimeout(toastTimer);
  clearTimeout(lanSyncTimer);
  window.removeEventListener("resize", updateViewportSize);
  window.removeEventListener("orientationchange", settleViewportAfterRotation);
  orientationQuery.removeEventListener?.("change", settleViewportAfterRotation);
  window.visualViewport?.removeEventListener("resize", updateViewportSize);
  window.visualViewport?.removeEventListener("scroll", updateViewportSize);
});

function updateViewportSize() {
  // Android WebView may keep the old visualViewport dimensions for a few
  // frames after rotation. The layout viewport updates first and is the
  // reliable source for our full-screen canvas.
  viewportSize.width = Math.round(document.documentElement.clientWidth || window.innerWidth);
  viewportSize.height = Math.round(document.documentElement.clientHeight || window.innerHeight);
  landscapeViewport.value = orientationQuery.matches;
  requestAnimationFrame(updateLayoutBoxes);
}

function settleViewportAfterRotation() {
  updateViewportSize();
  window.setTimeout(updateViewportSize, 80);
  window.setTimeout(updateViewportSize, 280);
}

function updateLayoutBoxes() {
  const mainRect = mainStageRef.value?.getBoundingClientRect();
  if (mainRect?.width && mainRect?.height) {
    mainStageBox.width = Math.round(mainRect.width);
    mainStageBox.height = Math.round(mainRect.height);
  }
}

function observeLayoutBoxes() {
  updateLayoutBoxes();
  if (!layoutResizeObserver || typeof ResizeObserver === "undefined") return;
  layoutResizeObserver.disconnect();
  if (mainStageRef.value) layoutResizeObserver.observe(mainStageRef.value);
}

function normalizeEvent(event) {
  return {
    ...event,
    id: event.id || makeId("event"),
    name: event.name || "未命名事项",
    start: event.start || event.startDateTime || event.createdAt || localDateTime(),
    end: event.end || event.endDateTime || localDateTime(Date.now() + 86400000),
    theme: event.theme || "theme-festive",
    recorder: event.recorder || "",
    minSpeechAmount: Number(event.minSpeechAmount || 0),
    hidePrivacy: Boolean(event.hidePrivacy),
    paymentQrCodes: normalizePaymentQrCodes(event.paymentQrCodes || event.paymentQrCode),
    records: (event.records || []).map((record) => ({
      ...record,
      id: record.id || makeId("record"),
      method: record.method || record.type || "现金",
      level: Number(record.level ?? record.guestLevel ?? 0),
      remarks: record.remarks || record.remarkData || { custom: record.remark || "" },
      history: Array.isArray(record.history) ? record.history : [],
      createdAt: record.createdAt || record.timestamp || new Date().toISOString(),
      updatedAt: record.updatedAt || record.timestamp || record.createdAt || new Date().toISOString(),
      abolished: Boolean(record.abolished),
    })),
  };
}

function normalizePaymentQrCodes(value) {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.filter(Boolean).slice(0, 2);
}

function loadEvents() {
  try {
    const saved = JSON.parse(localStorage.getItem(EVENTS_KEY) || "[]");
    if (Array.isArray(saved) && saved.length) return saved.map(normalizeEvent);
    const oldLedgers = JSON.parse(localStorage.getItem("gift-ledgers-list-v2") || "[]");
    return oldLedgers.map((ledger) =>
      normalizeEvent({
        ...ledger,
        passwordHash: "",
        records: JSON.parse(localStorage.getItem(`gift-ledger-records-${ledger.id}`) || "[]"),
      }),
    );
  } catch {
    return [];
  }
}

function localDateTime(value = Date.now()) {
  const date = new Date(value - new Date().getTimezoneOffset() * 60000);
  return date.toISOString().slice(0, 16);
}

function makeId(prefix = "id") {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function hash(value) {
  return globalThis.CryptoJS?.SHA256(String(value)).toString() || String(value);
}

function notify(message, type = "success") {
  toast.value = { message, type };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toast.value = null), 2800);
}

function createEvent() {
  try {
  if (new Date(createForm.start) >= new Date(createForm.end)) {
    notify("开始时间必须早于结束时间", "error");
    return;
  }
  const event = normalizeEvent({
    id: makeId("event"),
    name: createForm.name.trim(),
    passwordHash: hash(createForm.password),
    start: createForm.start,
    end: createForm.end,
    theme: createForm.theme,
    recorder: createForm.recorder.trim(),
    records: [],
    createdAt: new Date().toISOString(),
  });
  events.value.push(event);
  activeId.value = event.id;
  unlocked.value = true;
  showUnlockDialog.value = false;
  resetCreate();
  nextTick(observeLayoutBoxes);
  notify("事项已创建");
  } catch (error) {
    console.error(error);
    notify("创建失败，请重试", "error");
  }
}

function resetCreate() {
  createForm.name = "";
  createForm.password = "";
  createForm.recorder = "";
}

function selectEvent(id) {
  activeId.value = id;
  unlockPassword.value = "";
  showUnlockDialog.value = false;
}

function enterSelectedEvent() {
  if (!currentEvent.value) return notify("请先选择一个事项", "error");
  if (currentEvent.value.passwordHash) {
    unlockPassword.value = "";
    showUnlockDialog.value = true;
    return;
  }
  unlocked.value = true;
  page.value = 1;
  nextTick(observeLayoutBoxes);
}

function confirmUnlock() {
  if (!currentEvent.value) return;
  if (hash(unlockPassword.value) !== currentEvent.value.passwordHash) {
    return notify("管理密码错误", "error");
  }
  showUnlockDialog.value = false;
  unlocked.value = true;
  page.value = 1;
  nextTick(observeLayoutBoxes);
}

function switchEvent() {
  showEventMenu.value = false;
  selectedRecordId.value = "";
  unlocked.value = false;
  activeId.value = "";
  unlockPassword.value = "";
  showUnlockDialog.value = false;
}

function addGift() {
  const amount = Number(giftForm.amount);
  const name = giftForm.name.trim();
  if (!name || amount <= 0) return notify("请填写正确的姓名和金额", "error");
  const duplicate = activeRecords.value.find((record) => record.name === name && Number(record.amount) === amount);
  if (duplicate && !confirm(`已有“${name} ${formatMoney(amount)}”的记录，仍要继续录入吗？`)) return;

  const now = new Date().toISOString();
  currentEvent.value.records.push({
    id: makeId("record"),
    name,
    amount,
    method: giftForm.method,
    level: 0,
    remarks: {
      custom: giftForm.custom.trim(),
      gift: giftForm.gift.trim(),
      relation: giftForm.relation.trim(),
      phone: giftForm.phone.trim(),
      address: giftForm.address.trim(),
    },
    createdAt: now,
    updatedAt: now,
    history: [{ type: "created", at: now, text: "创建记录" }],
    abolished: false,
  });

  const threshold = Number(currentEvent.value.minSpeechAmount || 0);
  if (speech.value && amount >= threshold && "speechSynthesis" in window) {
    speechSynthesis.cancel();
    const prefix = currentEvent.value.theme === "theme-solemn" ? "" : "贺礼";
    speechSynthesis.speak(new SpeechSynthesisUtterance(`${name} ${prefix} ${amountToChinese(amount)}`));
  }

  Object.assign(giftForm, {
    name: "",
    amount: "",
    method: "现金",
    custom: "",
    gift: "",
    relation: "",
    phone: "",
    address: "",
  });
  remarkFields.value = [];
  page.value = pageCount.value;
  notify("礼金已录入");
}

function toggleRemarkField(field) {
  const index = remarkFields.value.indexOf(field);
  if (index >= 0) remarkFields.value.splice(index, 1);
  else remarkFields.value.push(field);
}

function openRecord(record) {
  selectedRecordId.value = record.id;
  editing.value = null;
}

function openSearchResults() {
  if (!query.value.trim()) return notify("请输入要查找的姓名或备注", "error");
  showSearchResults.value = true;
}

function openSearchRecord(record) {
  showSearchResults.value = false;
  openRecord(record);
}

function startEdit(mode) {
  if (!selectedRecord.value) return;
  editMode.value = mode;
  editing.value = JSON.parse(JSON.stringify(selectedRecord.value));
}

function saveEdit() {
  const target = selectedRecord.value;
  if (!target || !editing.value) return;
  const before = JSON.parse(JSON.stringify(target));
  let text = "";

  if (editMode.value === "name") {
    const value = editing.value.name.trim();
    if (!value) return notify("姓名不能为空", "error");
    target.name = value;
    text = `姓名由“${before.name}”更正为“${value}”`;
  } else if (editMode.value === "amount") {
    const value = Number(editing.value.amount);
    if (value <= 0) return notify("金额必须大于 0", "error");
    target.amount = value;
    target.method = editing.value.method;
    text = `金额/类型由 ${formatMoney(before.amount)} ${before.method} 修改为 ${formatMoney(value)} ${target.method}`;
  } else if (editMode.value === "remarks") {
    target.remarks = { ...editing.value.remarks };
    text = "更新备注信息";
  }

  target.updatedAt = new Date().toISOString();
  target.history.push({ type: editMode.value === "remarks" ? "remark" : "correction", at: target.updatedAt, text });
  editing.value = null;
  notify("记录已更新");
}

function requestAbolish() {
  abolishReason.value = "";
  showAbolish.value = true;
}

function confirmAbolish() {
  const target = selectedRecord.value;
  const reason = abolishReason.value.trim();
  if (!target || !reason) return notify("请填写作废原因", "error");
  const now = new Date().toISOString();
  target.abolished = true;
  target.abolishReason = reason;
  target.updatedAt = now;
  target.history.push({ type: "abolished", at: now, text: `作废：${reason}` });
  showAbolish.value = false;
  selectedRecordId.value = "";
  notify("记录已作废");
}

function remarkText(record) {
  const labels = Object.fromEntries(REMARK_FIELDS);
  const parts = [];
  if (record?.remarks?.custom) parts.push(record.remarks.custom);
  for (const [key, value] of Object.entries(record?.remarks || {})) {
    if (key !== "custom" && value) parts.push(`${labels[key] || key}：${value}`);
  }
  return parts.join("；");
}

async function exportExcel() {
  if (!globalThis.XLSX) return notify("Excel 组件未加载", "error");
  const rows = (currentEvent.value.records || []).map((record, index) => ({
    序号: index + 1,
    姓名: record.name,
    金额: record.amount,
    金额大写: amountToChinese(record.amount),
    收款类型: record.method,
    备注: remarkText(record),
    状态: record.abolished ? "已作废" : "正常",
    作废原因: record.abolishReason || "",
    录入时间: formatDateTime(record.createdAt),
    修改时间: formatDateTime(record.updatedAt),
    修改记录: (record.history || []).map((item) => `${formatDateTime(item.at)} ${item.text}`).join(" | "),
  }));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(rows), "礼金明细");
  const bytes = XLSX.write(workbook, { bookType: "xlsx", type: "array" });
  await deliverExport(
    new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${safeFilename(currentEvent.value.name)}_礼金记录.xlsx`,
    "Excel",
  );
}

async function exportBackup() {
  const payload = {
    app: "vue-gift-book",
    version: 2,
    exportedAt: new Date().toISOString(),
    events: events.value,
  };
  const delivered = await deliverExport(
    new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8" }),
    `电子礼簿备份_${new Date().toISOString().slice(0, 10)}.json`,
    "数据备份",
  );
  if (!delivered) return;
  backupExported.value = true;
}

async function deliverExport(blob, filename, label, { preferShare = false } = {}) {
  const android = /Android/i.test(navigator.userAgent);
  const extension = filename.split(".").pop() || "bin";
  const mimeType = blob.type.split(";")[0] || "application/octet-stream";

  if (android && preferShare) {
    const file = new File([blob], filename, { type: blob.type });
    const canShareFiles = typeof navigator.share === "function"
      && (typeof navigator.canShare !== "function" || navigator.canShare({ files: [file] }));

    if (canShareFiles) {
      try {
        await navigator.share({ title: filename, files: [file] });
        notify(`${label} 已交给安卓系统处理`);
        return true;
      } catch (error) {
        if (error?.name === "AbortError") return false;
        console.warn("安卓分享不可用，改用系统保存窗口", error);
      }
    }
  }

  if (isTauri()) {
    try {
      const filePath = await save({
        defaultPath: filename,
        filters: [{ name: label, extensions: [extension] }],
      });
      if (!filePath) return false;
      await writeFile(filePath, new Uint8Array(await blob.arrayBuffer()));
      notify(`${label} 已保存到：${filePath}`);
      return true;
    } catch (error) {
      console.error("系统保存失败", error);
      notify(`${label} 保存失败：${error.message || error}`, "error");
      return false;
    }
  }

  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [{ description: label, accept: { [mimeType]: [`.${extension}`] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      notify(`${label} 已保存`);
      return true;
    } catch (error) {
      if (error?.name === "AbortError") return false;
      console.warn("文件保存窗口不可用，改用浏览器下载", error);
    }
  }

  downloadBlob(blob, filename);
  notify(`${label} 已下载，请到浏览器下载列表中查看`);
  return true;
}

async function restoreBackup(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text());
    if (!Array.isArray(payload.events)) throw new Error("备份结构无效");
    if (!confirm(`备份中包含 ${payload.events.length} 个事项，确定恢复并合并到当前数据吗？`)) return;
    const merged = new Map(events.value.map((item) => [item.id, item]));
    payload.events.map(normalizeEvent).forEach((item) => merged.set(item.id, item));
    events.value = [...merged.values()];
    notify("数据恢复完成");
  } catch (error) {
    notify(`恢复失败：${error.message}`, "error");
  }
}

function openSettings() {
  Object.assign(settingsForm, {
    name: currentEvent.value.name,
    start: currentEvent.value.start,
    end: currentEvent.value.end,
    recorder: currentEvent.value.recorder || "",
    minSpeechAmount: Number(currentEvent.value.minSpeechAmount || 0),
    hidePrivacy: Boolean(currentEvent.value.hidePrivacy),
    paymentQrCodes: normalizePaymentQrCodes(currentEvent.value.paymentQrCodes || currentEvent.value.paymentQrCode),
  });
  showSettings.value = true;
  showEventMenu.value = false;
}

function saveSettings() {
  if (!settingsForm.name.trim()) return notify("事项名称不能为空", "error");
  if (new Date(settingsForm.start) >= new Date(settingsForm.end)) return notify("开始时间必须早于结束时间", "error");
  Object.assign(currentEvent.value, {
    name: settingsForm.name.trim(),
    start: settingsForm.start,
    end: settingsForm.end,
    recorder: settingsForm.recorder.trim(),
    minSpeechAmount: Number(settingsForm.minSpeechAmount || 0),
    hidePrivacy: settingsForm.hidePrivacy,
    paymentQrCodes: normalizePaymentQrCodes(settingsForm.paymentQrCodes),
  });
  showSettings.value = false;
  notify("事项设置已保存");
}

async function readPaymentQrFiles(event, limit = 2) {
  const files = Array.from(event.target.files || []).slice(0, Math.max(0, limit));
  event.target.value = "";
  if (!files.length) return [];
  if (files.some((file) => !file.type.startsWith("image/"))) {
    notify("请选择图片格式的收款码", "error");
    return [];
  }
  if (files.some((file) => file.size > 3 * 1024 * 1024)) {
    notify("单张收款码图片不能超过 3MB", "error");
    return [];
  }
  return Promise.all(
    files.map(
      (file) =>
        new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result || ""));
          reader.onerror = () => reject(reader.error || new Error("读取图片失败"));
          reader.readAsDataURL(file);
        }),
    ),
  ).catch((error) => {
    notify(error.message || "读取收款码失败", "error");
    return [];
  });
}

async function uploadPaymentQrCode(event) {
  const existingCodes = normalizePaymentQrCodes(settingsForm.paymentQrCodes);
  const codes = await readPaymentQrFiles(event, 2 - existingCodes.length);
  settingsForm.paymentQrCodes = normalizePaymentQrCodes([...existingCodes, ...codes]);
  if (codes.length) notify(`已添加 ${codes.length} 张收款码，保存设置后同步到副屏`);
}

function removePaymentQrCode(index) {
  settingsForm.paymentQrCodes.splice(index, 1);
}

function syncGuestScreen() {
  if (!currentEvent.value) return;
  localStorage.setItem(GUEST_EVENT_KEY, currentEvent.value.id);
  try {
    syncChannel?.postMessage({
      type: "sync",
      eventId: currentEvent.value.id,
      revision: Date.now(),
    });
  } catch (error) {
    console.warn("副屏广播失败，副屏仍可通过本地存储同步。", error);
  }
}

function buildLanSnapshot() {
  if (!currentEvent.value) return null;
  return {
    version: 1,
    updatedAt: new Date().toISOString(),
    event: {
      id: currentEvent.value.id,
      name: currentEvent.value.name,
      theme: currentEvent.value.theme,
      hidePrivacy: Boolean(currentEvent.value.hidePrivacy),
      paymentQrCodes: normalizePaymentQrCodes(currentEvent.value.paymentQrCodes || currentEvent.value.paymentQrCode),
      records: (currentEvent.value.records || []).map((record) => ({
        id: record.id,
        name: record.name,
        amount: Number(record.amount),
        amountText: amountToChinese(record.amount),
        method: record.method,
        level: Number(record.level || 0),
        createdAt: record.createdAt,
        abolished: Boolean(record.abolished),
      })),
    },
  };
}

async function createLanQrCode(session) {
  lanQrCode.value = await QRCode.toDataURL(session.url, {
    width: 280,
    margin: 1,
    errorCorrectionLevel: "M",
    color: { dark: "#18181b", light: "#ffffffff" },
  });
}

async function openLanShare() {
  showEventMenu.value = false;
  if (!isTauri()) return notify("局域网副屏需要在 Windows 或安卓应用中开启", "error");
  const snapshot = buildLanSnapshot();
  if (!snapshot) return;
  lanBusy.value = true;
  try {
    const session = await invoke("start_lan_server", { snapshot });
    lanSession.value = session;
    await createLanQrCode(session);
    showLanShare.value = true;
    notify("局域网副屏已开启");
  } catch (error) {
    console.error("开启局域网副屏失败", error);
    notify(`局域网副屏开启失败：${error}`, "error");
  } finally {
    lanBusy.value = false;
  }
}

function syncLanScreen() {
  if (!isTauri() || !lanSession.value || !currentEvent.value) return;
  clearTimeout(lanSyncTimer);
  lanSyncTimer = setTimeout(async () => {
    try {
      await invoke("update_lan_snapshot", { snapshot: buildLanSnapshot() });
    } catch (error) {
      console.warn("局域网副屏同步失败", error);
    }
  }, 80);
}

async function restoreLanSession() {
  if (!isTauri()) return;
  try {
    const session = await invoke("lan_server_status");
    if (!session) return;
    lanSession.value = session;
    await createLanQrCode(session);
    syncLanScreen();
  } catch (error) {
    console.warn("读取局域网副屏状态失败", error);
  }
}

async function copyLanUrl() {
  if (!lanSession.value?.url) return;
  try {
    await navigator.clipboard.writeText(lanSession.value.url);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = lanSession.value.url;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  }
  notify("副屏地址已复制");
}

async function stopLanShare() {
  if (!isTauri()) return;
  lanBusy.value = true;
  try {
    await invoke("stop_lan_server");
    lanSession.value = null;
    lanQrCode.value = "";
    showLanShare.value = false;
    notify("局域网副屏已停止");
  } catch (error) {
    notify(`停止局域网副屏失败：${error}`, "error");
  } finally {
    lanBusy.value = false;
  }
}

function prepareGuestScreen() {
  showEventMenu.value = false;
  syncGuestScreen();
  setTimeout(syncGuestScreen, 300);
}

async function openGuestScreen() {
  prepareGuestScreen();

  if (!isTauri()) {
    const guestWindow = window.open(guestScreenHref.value, "_blank");
    if (guestWindow) guestWindow.opener = null;
    else notify("副屏被浏览器拦截，请允许弹出窗口", "error");
    return;
  }

  // Android 手机通常无法同时并排显示两个 Activity，使用当前窗口进入展示模式，
  // 系统返回键可以回到主屏。桌面端则创建真正的独立副屏窗口。
  if (/Android/i.test(navigator.userAgent)) {
    window.location.assign(guestScreenHref.value);
    return;
  }

  try {
    const existing = await WebviewWindow.getByLabel("guest");
    if (existing) {
      await existing.show();
      await existing.setFocus();
      syncGuestScreen();
      return;
    }

    const guestWindow = new WebviewWindow("guest", {
      url: guestScreenPath.value,
      title: `${currentEvent.value.name} · 副屏`,
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 640,
      center: true,
      resizable: true,
    });
    guestWindow.once("tauri://created", () => {
      syncGuestScreen();
      notify("副屏已打开");
    });
    guestWindow.once("tauri://error", ({ payload }) => {
      console.error("创建副屏窗口失败", payload);
      notify("副屏打开失败，请重新尝试", "error");
    });
  } catch (error) {
    console.error("打开副屏失败", error);
    notify("副屏打开失败，请重新尝试", "error");
  }
}

function openDeleteDialog() {
  showEventMenu.value = false;
  showDelete.value = true;
  backupExported.value = currentEvent.value.records.length === 0;
  deletePassword.value = "";
}

function deleteEvent() {
  if (!backupExported.value) return notify("请先导出数据备份", "error");
  if (currentEvent.value.passwordHash && hash(deletePassword.value) !== currentEvent.value.passwordHash) {
    return notify("管理密码错误", "error");
  }
  const name = currentEvent.value.name;
  events.value = events.value.filter((event) => event.id !== activeId.value);
  showDelete.value = false;
  switchEvent();
  notify(`事项“${name}”已删除`);
}

async function grayscaleImage(url) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      const context = canvas.getContext("2d");
      context.filter = "grayscale(1) contrast(1.08) brightness(.72)";
      context.drawImage(image, 0, 0);
      resolve(canvas.toDataURL("image/jpeg", 0.9));
    };
    image.onerror = reject;
    image.src = url;
  });
}

function loadExternalScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-runtime-src="${src}"]`);
    if (existing) {
      if (existing.dataset.loaded === "true") return resolve();
      existing.addEventListener("load", resolve, { once: true });
      existing.addEventListener("error", reject, { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = `${src}?v=3`;
    script.dataset.runtimeSrc = src;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => {
      script.remove();
      reject(new Error(`无法加载 ${src}`));
    };
    document.head.appendChild(script);
  });
}

async function ensurePdfGenerator() {
  if (!globalThis.PDFLib) await loadExternalScript("/vendor/pdf-lib.min.js");
  if (!globalThis.fontkit) await loadExternalScript("/vendor/fontkit.umd.min.js");
  if (!globalThis.GiftRegistryPDF) await loadExternalScript("/vendor/gift-list-pdf.js");
  if (!globalThis.GiftRegistryPDF) throw new Error("PDF 组件加载失败，请刷新页面后重试");
}

async function generatePdf() {
  if (!activeRecords.value.length) return notify("当前没有可打印的礼金记录", "error");
  pdfBusy.value = true;
  try {
    await ensurePdfGenerator();
    const solemn = currentEvent.value.theme === "theme-solemn";
    const cover = solemn ? await grayscaleImage("/assets/gift-cover-front.jpg") : "/assets/gift-cover-front.jpg";
    const background = solemn ? await grayscaleImage("/assets/gift-page-bg.jpg") : "/assets/gift-page-bg.jpg";
    const backCover = solemn ? await grayscaleImage("/assets/gift-cover-back.jpg") : "/assets/gift-cover-back.jpg";
    const themeColor = solemn ? "#4b5563" : "#ec403c";
    const generator = new globalThis.GiftRegistryPDF({
      title: currentEvent.value.name,
      subtitle: formatEventDate(currentEvent.value.start),
      recorder: currentEvent.value.recorder || null,
      giftLabel: solemn ? "礼金" : "贺礼",
      itemsPerPage: PAGE_SIZE,
      printCover: true,
      showCoverTitle: true,
      printAppendix: true,
      printSummary: true,
      printEndPage: true,
      coverImage: cover,
      backgroundImage: background,
      backCoverImage: backCover,
      mainFontUrl: "/assets/MaShanZheng-Regular.ttf",
      giftLabelFontUrl: "/assets/SourceHanSerifCN-Heavy.ttf",
      formalFontUrl: "/assets/NotoSansSCMedium-mini.ttf",
      amountFontUrl: "/assets/NotoSansSCMedium-mini.ttf",
      coverFontUrl: "/assets/NotoSansSCMedium-mini.ttf",
      giftBookStyles: {
        name: { fontSize: 20, color: solemn ? "#262626" : "#333333" },
        label: { fontSize: 20, color: themeColor },
        amount: { fontSize: 18, color: solemn ? "#262626" : "#333333" },
        coverText: { fontSize: 28, color: solemn ? "#f3f4f6" : "#f5d4ab" },
        pageInfo: { fontSize: 12, themeColor, baseColor: solemn ? "#1f2937" : "#1f2937" },
      },
    });
    const data = activeRecords.value.map((record) => ({
      name: record.name,
      amount: Number(record.amount),
      type: record.method,
      remark: remarkText(record) || null,
      abolished: false,
      amountText: amountToChinese(record.amount),
    }));
    const bytes = await generator.generate(data);
    await deliverExport(
      new Blob([bytes], { type: "application/pdf" }),
      `${safeFilename(currentEvent.value.name)}_电子礼簿_${new Date().toISOString().slice(0, 10)}.pdf`,
      "PDF",
      { preferShare: true },
    );
  } catch (error) {
    console.error(error);
    notify(`PDF 生成失败：${error.message}`, "error");
  } finally {
    pdfBusy.value = false;
  }
}
</script>

<template>
  <main class="pro-app" :class="[activeTheme, unlocked ? 'is-main' : 'is-setup']">
    <transition name="toast">
      <div v-if="toast" class="toast-message" :class="toast.type"><i
          :class="toast.type === 'error' ? 'ri-error-warning-line' : 'ri-checkbox-circle-line'"></i>{{ toast.message }}
      </div>
    </transition>

    <section v-if="!unlocked" class="setup-stage"
      :class="isLandscapeLayout ? 'stage-landscape' : 'stage-portrait'">
      <div class="setup-screen scaled-setup" @click="showSetupEventOptions = false; showThemeOptions = false"
        :class="isLandscapeLayout ? 'setup-landscape' : 'setup-portrait'">
      <div class="setup-brand">
        <img src="/assets/gift-cover-front.jpg" alt="礼簿封面" />
        <div><span>GIFT BOOK</span>
          <h1>{{ activeTheme === 'theme-solemn' ? '奠仪礼簿' : '嘉宾礼簿' }}</h1>
          <p>{{ activeTheme === 'theme-solemn' ? '慎终追远 · 礼敬故人' : '传统礼序 · 数字新章' }}</p>
        </div>
      </div>
      <div class="setup-card">
        <h1 class="setup-title">电子礼簿系统</h1>
        <section v-if="events.length" class="event-select">
          <h2>选择事项</h2>
          <div class="event-entry-row">
            <div class="pretty-select" @click.stop>
              <button class="pretty-select-trigger" type="button" :aria-expanded="showSetupEventOptions"
                @click="showSetupEventOptions = !showSetupEventOptions; showThemeOptions = false">
                <span>{{ selectedEventLabel }}</span><i class="ri-arrow-down-s-line"></i>
              </button>
              <div v-if="showSetupEventOptions" class="pretty-select-menu">
                <button v-for="event in events" :key="event.id" type="button"
                  :class="{ active: event.id === activeId }"
                  @click="selectEvent(event.id); showSetupEventOptions = false">{{ event.name }}</button>
              </div>
            </div>
            <select :value="activeId" @change="selectEvent($event.target.value)">
              <option value="">请选择一个事项</option>
              <option v-for="event in events" :key="event.id" :value="event.id">{{ event.name }}</option>
            </select>
            <button type="button" @click="enterSelectedEvent">进入</button>
          </div>
        </section>

        <form class="create-event" @submit.prevent="createEvent">
          <h2>{{ events.length ? '或创建新事项' : '创建新事项' }}</h2>
          <input v-model="createForm.name" required placeholder="事项名称（例如：张三李四新婚之喜）" />
          <div class="two"><label>开始时间<input v-model="createForm.start" type="datetime-local"
                required /></label><label>结束时间<input v-model="createForm.end" type="datetime-local" required /></label>
          </div>
          <input v-model="createForm.password" type="password" minlength="4" required placeholder="设置管理密码（请牢记）" />
          <details>
            <summary>更多设置</summary><div class="pretty-select theme-select" @click.stop>
              <button class="pretty-select-trigger" type="button" :aria-expanded="showThemeOptions"
                @click="showThemeOptions = !showThemeOptions; showSetupEventOptions = false">
                <span>{{ selectedThemeLabel }}</span><i class="ri-arrow-down-s-line"></i>
              </button>
              <div v-if="showThemeOptions" class="pretty-select-menu">
                <button v-for="theme in THEME_OPTIONS" :key="theme.value" type="button"
                  :class="{ active: theme.value === createForm.theme }"
                  @click="createForm.theme = theme.value; showThemeOptions = false">{{ theme.label }}</button>
              </div>
            </div><select v-model="createForm.theme">
              <option value="theme-festive">喜庆红（喜事）</option>
              <option value="theme-solemn">肃穆灰（白事）</option>
            </select><input v-model="createForm.recorder" placeholder="记账人（选填）" />
          </details>
          <button class="primary" type="submit">创建并进入</button>
        </form>
      </div>
      </div>
    </section>

    <section v-else ref="mainStageRef" class="main-stage scaled-layout" :class="isLandscapeLayout ? 'scaled-landscape' : 'scaled-portrait'"
      :style="mainStageStyle">
      <div class="main-screen" @click="showEventMenu = false">
        <header>
          <div class="event-menu-wrap" @click.stop>
            <button class="event-title" type="button" :aria-expanded="showEventMenu"
              @click="showEventMenu = !showEventMenu">{{ currentEvent.name }}<span class="menu-chevron"
                :class="{ open: showEventMenu }" aria-hidden="true"></span></button>
            <transition name="menu-pop">
              <nav v-if="showEventMenu" class="event-dropdown">
                <button type="button" @click="switchEvent">切换/创建事项</button>
                <button type="button" @click="showBackup = true; showEventMenu = false">备份/恢复数据</button>
                <button type="button" @click="openGuestScreen">本机打开副屏</button>
                <button type="button" :disabled="lanBusy" @click="openLanShare">{{ lanSession ? '查看局域网副屏二维码' :
                  '开启局域网副屏（扫码）' }}</button>
                <button type="button" @click="openSettings">设置此事项</button>
                <button class="danger" type="button" @click="openDeleteDialog">删除此事项</button>
              </nav>
            </transition>
          </div>
        </header>

        <div class="workspace-grid">
          <aside class="entry-panel">
            <h2>礼金录入</h2>
            <form @submit.prevent="addGift">
              <input v-model="giftForm.name" required placeholder="姓名" />
              <input v-model="giftForm.amount" required type="number" min="0.01" step="0.01" placeholder="金额（元）" />
              <div class="methods"><span>收款类型：</span><label v-for="method in PAYMENT_METHODS" :key="method"><input
                    v-model="giftForm.method" type="radio" :value="method" />{{ method }}</label></div>
              <textarea v-model="giftForm.custom" rows="2" placeholder="备注内容（选填）"></textarea>
              <div class="remark-buttons"><span>更多备注：</span><button v-for="([field, label]) in REMARK_FIELDS"
                  :key="field" type="button" :class="{ active: remarkFields.includes(field) }"
                  @click="toggleRemarkField(field)">{{ label }}</button></div>
              <input v-if="remarkFields.includes('gift')" v-model="giftForm.gift" placeholder="礼品" />
              <input v-if="remarkFields.includes('relation')" v-model="giftForm.relation" placeholder="关系" />
              <input v-if="remarkFields.includes('phone')" v-model="giftForm.phone" placeholder="电话" />
              <input v-if="remarkFields.includes('address')" v-model="giftForm.address" placeholder="住址" />
              <button class="primary entry-submit">确认录入</button>
            </form>

            <button v-if="toolsCollapsible && !mobileToolsOpen" class="tools-toggle tools-toggle-open" type="button"
              :aria-expanded="mobileToolsOpen" aria-label="展开功能区" @click="mobileToolsOpen = true"><span>展开</span><i
                class="ri-arrow-down-s-line"></i></button>
            <div class="tools" :class="{ open: mobileToolsOpen, collapsible: toolsCollapsible }">
              <h3>功能区</h3>
              <div class="search"><input v-model="query" placeholder="按姓名或备注查找…"
                  @keydown.enter.prevent="openSearchResults" /><button type="button" aria-label="搜索礼金记录"
                  @click="openSearchResults"><i class="ri-search-line"></i></button></div><button :disabled="pdfBusy"
                @click="generatePdf"><i :class="pdfBusy ? 'ri-loader-4-line spin' : 'ri-printer-line'"></i>{{ pdfBusy ?
                  '正在生成 PDF…' :
                  '打印/另存为PDF' }}</button><button @click="exportExcel"><i class="ri-file-excel-2-line"></i>导出为
                Excel</button><button @click="showStats = true"><i
                  class="ri-pie-chart-line"></i>查看统计</button><label
                class="voice"><span class="voice-label"><i class="ri-volume-up-line"></i>语音播报</span><input
                  v-model="speech" type="checkbox" role="switch" :aria-checked="speech" /><span class="switch-track"
                  aria-hidden="true"></span></label><button v-if="toolsCollapsible" class="tools-toggle tools-toggle-close" type="button"
                aria-label="收起功能区" @click="mobileToolsOpen = false"><span>收起</span><i
                  class="ri-arrow-up-s-line"></i></button>
            </div>
          </aside>

          <section class="book-frame">
            <div class="book-toolbar">
              <div><b>本页小计：</b><strong>{{ formatMoney(pageTotal) }}</strong><b>总金额：</b><strong>{{ formatMoney(total)
              }}</strong><b>总人数：</b><strong>{{ activeRecords.length }}</strong></div>
              <div class="pager"><button class="pager-arrow prev" aria-label="上一页" :disabled="page <= 1"
                  @click="page--"><span aria-hidden="true"></span></button><b>第 <input v-model.number="page"
                    class="page-number" type="number" min="1" :max="pageCount" /> / {{ pageCount }} 页</b><button
                  class="pager-arrow next" aria-label="下一页" :disabled="page >= pageCount" @click="page++"><span
                    aria-hidden="true"></span></button></div>
            </div>
            <div class="ledger-scroll">
              <div class="ledger-sheet">
                <div v-for="(record, index) in pageItems" :key="record.id" class="gift-column" role="button" tabindex="0"
                  @click="openRecord(record)" @keydown.enter="openRecord(record)" @keydown.space.prevent="openRecord(record)"><span class="name-cell"><small>{{ (page - 1) * PAGE_SIZE + index + 1
                  }}</small><b>{{ record.name.length === 2 ? `${record.name[0]}　${record.name[1]}` : record.name
                      }}</b><em v-if="remarkText(record)">已备注</em></span><span class="type-cell">{{ currentEvent.theme
                        === 'theme-solemn' ? '礼金' : '贺礼' }}</span><span class="amount-cell"><b>{{
                      amountToChinese(record.amount) }}</b><small>{{ formatMoney(record.amount)
                       }}</small></span></div>
                <div v-for="n in Math.max(0, PAGE_SIZE - pageItems.length)" :key="`empty-${n}`"
                  class="gift-column empty"><span class="name-cell"></span><span class="type-cell">{{ currentEvent.theme
                    === 'theme-solemn' ? '礼金' : '贺礼' }}</span><span class="amount-cell"></span></div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </section>

    <div v-if="showSearchResults" class="modal-backdrop" @click.self="showSearchResults = false">
      <section class="modal-card search-results-card"><button class="modal-close" type="button" aria-label="关闭搜索结果"
          @click="showSearchResults = false"><span aria-hidden="true">×</span></button>
        <h2>“{{ query.trim() }}”的搜索结果</h2>
        <div v-if="searchResults.length" class="search-result-list">
          <article v-for="record in searchResults" :key="record.id" class="search-result-item">
            <div><b>姓名：<span>{{ record.name }}</span></b>
              <p>金额：{{ formatMoney(record.amount) }}（{{ record.method }}）</p><small v-if="remarkText(record)">备注：{{
                remarkText(record) }}</small>
            </div><button class="primary" type="button" @click="openSearchRecord(record)">查看详情</button>
          </article>
        </div>
        <div v-else class="search-empty"><i class="ri-search-eye-line"></i>
          <p>没有找到匹配的礼金记录</p><small>可以尝试输入完整姓名、收款类型或备注关键词</small>
        </div>
        <footer><button class="secondary" type="button" @click="showSearchResults = false">关闭</button></footer>
      </section>
    </div>

    <div v-if="showUnlockDialog && currentEvent" class="modal-backdrop" @click.self="showUnlockDialog = false">
      <form class="modal-card unlock-card" @submit.prevent="confirmUnlock"><button class="modal-close" type="button"
          aria-label="关闭密码输入" @click="showUnlockDialog = false"><span aria-hidden="true">×</span></button>
        <h2>进入“{{ currentEvent.name }}”</h2><label>管理密码<input v-model="unlockPassword" type="password"
            autocomplete="current-password" autofocus placeholder="请输入管理密码" /></label>
        <footer><button type="button" class="secondary" @click="showUnlockDialog = false">取消</button><button
            class="primary" type="submit">进入</button></footer>
      </form>
    </div>

    <div v-if="showLanShare && lanSession" class="modal-backdrop" @click.self="showLanShare = false">
      <section class="modal-card lan-share-card"><button class="modal-close" type="button" aria-label="关闭二维码"
          @click="showLanShare = false"><span aria-hidden="true">×</span></button>
        <h2>局域网副屏</h2>
        <p class="lan-share-status"><span></span>正在共享“{{ currentEvent.name }}”的只读数据</p>
        <div class="lan-share-grid">
          <div class="lan-qr"><img v-if="lanQrCode" :src="lanQrCode" alt="手机副屏二维码" /><i v-else
              class="ri-loader-4-line spin"></i></div>
          <div class="lan-share-info">
            <h3>手机扫码即可查看</h3>
            <ol>
              <li>手机和平板连接同一个 Wi-Fi 或热点</li>
              <li>使用微信或系统相机扫描二维码</li>
              <li>在浏览器中打开，录入后会自动同步</li>
              <li>若 Windows 首次弹出防火墙提示，请选择“允许访问”</li>
            </ol><label>访问地址<div class="lan-url"><code>{{ lanSession.url }}</code><button type="button"
                  @click="copyLanUrl">复制</button></div></label>
            <p class="lan-warning"><i class="ri-shield-check-line"></i>副屏只能查看，不能修改礼金；停止共享后此链接立即失效。</p>
          </div>
        </div>
        <footer><button class="danger-outline" type="button" :disabled="lanBusy"
            @click="stopLanShare">停止共享</button><button class="secondary" type="button"
            @click="showLanShare = false">暂时关闭二维码</button></footer>
      </section>
    </div>

    <div v-if="selectedRecord" class="modal-backdrop" @click.self="selectedRecordId = ''">
      <section class="modal-card record-detail"><button class="modal-close" @click="selectedRecordId = ''"><span
            aria-hidden="true">×</span></button>
        <h2>{{ selectedRecord.name }} 的礼金详情</h2>
        <h3>当前记录信息</h3>
        <div class="detail-row">
          <div><b>姓名：</b><span>{{ selectedRecord.name }}</span></div><button @click="startEdit('name')">纠错</button>
        </div>
        <div class="detail-row">
          <div><b>金额：</b><strong>{{ formatMoney(selectedRecord.amount) }}</strong><small>类型：{{ selectedRecord.method
          }}</small></div><button @click="startEdit('amount')">修改</button>
        </div>
        <div class="detail-row">
          <div><b>备注：</b>
            <p>{{ remarkText(selectedRecord) || '（无备注）' }}</p>
          </div><button @click="startEdit('remarks')">修改</button>
        </div>
        <div class="detail-time">录入时间：{{ formatDateTime(selectedRecord.createdAt) }}<br
            v-if="selectedRecord.updatedAt !== selectedRecord.createdAt" /> <span
            v-if="selectedRecord.updatedAt !== selectedRecord.createdAt">最后修改：{{
              formatDateTime(selectedRecord.updatedAt) }}</span></div>
        <details v-if="selectedRecord.history?.length" class="history">
          <summary>查看修改记录（{{ selectedRecord.history.length }}）</summary>
          <ol>
            <li v-for="(item, index) in selectedRecord.history" :key="index"><time>{{ formatDateTime(item.at)
            }}</time><span>{{ item.text }}</span></li>
          </ol>
        </details>
        <footer><button class="danger-outline" :disabled="selectedRecord.abolished" @click="requestAbolish"><i
              class="ri-delete-bin-6-line"></i>{{ selectedRecord.abolished ? '此记录已作废' : '作废此记录' }}</button><button
            class="secondary" @click="selectedRecordId = ''">关闭</button></footer>
      </section>
    </div>

    <div v-if="editing" class="modal-backdrop modal-nested" @click.self="editing = null">
      <form class="modal-card edit-card" @submit.prevent="saveEdit"><button class="modal-close" type="button"
          @click="editing = null"><i class="ri-close-line"></i></button>
        <h2>{{ editMode === 'name' ? '纠错姓名' : editMode === 'amount' ? '修改金额与类型' : '修改备注信息' }}</h2><template
          v-if="editMode === 'name'"><label>姓名<input v-model="editing.name" required /></label>
          <p class="form-tip">姓名纠错将写入修改记录，方便日后核对。</p>
        </template><template v-else-if="editMode === 'amount'"><label>金额<input v-model="editing.amount" type="number"
              min="0.01" step="0.01" required /></label><label>收款类型<select v-model="editing.method">
              <option v-for="method in PAYMENT_METHODS" :key="method">{{ method }}</option>
            </select></label></template><template v-else><label>备注<textarea
              v-model="editing.remarks.custom"></textarea></label><label>礼品<input
              v-model="editing.remarks.gift" /></label><label>关系<input
              v-model="editing.remarks.relation" /></label><label>电话<input
              v-model="editing.remarks.phone" /></label><label>住址<input
              v-model="editing.remarks.address" /></label></template>
        <footer><button type="button" class="secondary" @click="editing = null">取消</button><button
            class="primary">保存修改</button>
        </footer>
      </form>
    </div>

    <div v-if="showAbolish" class="modal-backdrop modal-nested" @click.self="showAbolish = false">
      <section class="modal-card small-modal">
        <h2>作废礼金记录</h2>
        <p>作废后记录会保留，但不计入统计和 PDF 正文。</p><textarea v-model="abolishReason" rows="4"
          placeholder="请输入作废原因，例如：重复录入"></textarea>
        <footer><button class="secondary" @click="showAbolish = false">取消</button><button class="danger-button"
            @click="confirmAbolish">确认作废</button></footer>
      </section>
    </div>

    <div v-if="showStats" class="modal-backdrop" @click.self="showStats = false">
      <section class="modal-card stats-card"><button class="modal-close" @click="showStats = false"><i
            class="ri-close-line"></i></button>
        <h2>礼金统计</h2>
        <div class="stat-grid">
          <article><span>有效记录</span><b>{{ activeRecords.length }}</b><small>人</small></article>
          <article><span>礼金总额</span><b>{{ formatMoney(total) }}</b></article>
          <article><span>平均礼金</span><b>{{ formatMoney(total / Math.max(1, activeRecords.length)) }}</b></article>
          <article v-for="(data, method) in methodStats" :key="method"><span>{{ method }}</span><b>{{
            formatMoney(data.amount) }}</b><small>{{ data.count }} 人</small></article>
        </div>
        <footer><button class="secondary" @click="showStats = false">关闭</button></footer>
      </section>
    </div>

    <div v-if="showBackup" class="modal-backdrop" @click.self="showBackup = false">
      <section class="modal-card backup-card"><button class="modal-close" @click="showBackup = false"><i
            class="ri-close-line"></i></button>
        <h2>备份/恢复数据</h2>
        <p>数据备份包含所有事项、礼金记录和修改历史。建议活动结束后同时保留 JSON、Excel 和 PDF。</p>
        <div class="backup-actions"><button class="primary" @click="exportBackup"><i
              class="ri-download-cloud-2-line"></i><span>导出完整数据备份<small>生成可跨设备恢复的 JSON 文件</small></span></button><button
            class="secondary" @click="restoreInput.click()"><i
              class="ri-upload-cloud-2-line"></i><span>从备份文件恢复<small>相同事项将以备份内容覆盖</small></span></button><input
            ref="restoreInput" hidden type="file" accept="application/json,.json" @change="restoreBackup" /></div>
      </section>
    </div>

    <div v-if="showSettings" class="modal-backdrop" @click.self="showSettings = false">
      <form class="modal-card settings-card" @submit.prevent="saveSettings"><button class="modal-close" type="button"
          @click="showSettings = false"><i class="ri-close-line"></i></button>
        <h2>设置事项</h2>
        <div class="settings-grid"><label>事项名称<input v-model="settingsForm.name" required /></label><label>记账人<input
              v-model="settingsForm.recorder" /></label><label>开始时间<input v-model="settingsForm.start"
              type="datetime-local" required /></label><label>结束时间<input v-model="settingsForm.end"
              type="datetime-local" required /></label><label>语音播报起报金额<input v-model="settingsForm.minSpeechAmount"
              type="number" min="0" /></label><label class="privacy-setting"><input v-model="settingsForm.hidePrivacy"
              type="checkbox" /><span>副屏信息脱敏显示<small>仅最新一条记录显示完整姓名</small></span></label>
          <div class="payment-qr-setting"><span>副屏收款码（最多 2 张）</span><input ref="paymentQrInput" hidden type="file"
              accept="image/*" multiple @change="uploadPaymentQrCode" />
            <div class="payment-qr-preview-list">
              <figure v-for="(code, index) in settingsForm.paymentQrCodes" :key="`${index}-${code.length}`">
                <img :src="code" :alt="`收款码预览 ${index + 1}`" />
                <figcaption><span>第 {{ index + 1 }} 张</span><button type="button" class="danger-outline"
                    @click="removePaymentQrCode(index)">删除</button></figcaption>
              </figure>
              <button v-if="settingsForm.paymentQrCodes.length < 2" type="button" class="payment-qr-add"
                @click="paymentQrInput?.click()"><i class="ri-add-line"></i><span>{{ settingsForm.paymentQrCodes.length ?
                  '继续上传' : '上传收款码' }}</span><small>还可上传 {{ 2 - settingsForm.paymentQrCodes.length }} 张</small></button>
            </div>
            <small>保存后，副屏“总人数”右侧会显示收款码按钮，点击即可查看。</small>
          </div>
        </div>
        <footer><button type="button" class="secondary" @click="showSettings = false">取消</button><button
            class="primary">保存设置</button></footer>
      </form>
    </div>

    <div v-if="showDelete" class="modal-backdrop" @click.self="showDelete = false">
      <section class="modal-card delete-card"><button class="modal-close" @click="showDelete = false"><i
            class="ri-close-line"></i></button>
        <h2>删除事项</h2>
        <div class="warning-box"><i class="ri-error-warning-line"></i>
          <p>此操作将永久删除“<b>{{ currentEvent.name }}</b>”及全部礼金记录，无法恢复。</p>
        </div><template v-if="currentEvent.records.length">
          <p>为确保数据安全，请先导出完整备份：</p><button class="secondary wide" @click="exportBackup"><i
              class="ri-download-2-line"></i>{{ backupExported ? '备份已导出，可继续删除' : '导出数据备份' }}</button>
        </template><label>输入管理密码确认<input v-model="deletePassword" type="password"
            @keydown.enter="deleteEvent" /></label>
        <footer><button class="secondary" @click="showDelete = false">取消</button><button class="danger-button"
            :disabled="!backupExported" @click="deleteEvent">永久删除</button></footer>
      </section>
    </div>
  </main>
</template>
