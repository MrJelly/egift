const CN_NUMBERS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
const CN_UNITS = ["", "拾", "佰", "仟"];
const CN_SECTIONS = ["", "万", "亿", "兆"];

function sectionToChinese(section) {
  let value = section;
  let unitIndex = 0;
  let result = "";
  let zero = true;

  while (value > 0) {
    const digit = value % 10;
    if (digit === 0) {
      if (!zero) result = CN_NUMBERS[0] + result;
      zero = true;
    } else {
      result = CN_NUMBERS[digit] + CN_UNITS[unitIndex] + result;
      zero = false;
    }
    unitIndex += 1;
    value = Math.floor(value / 10);
  }
  return result;
}

export function amountToChinese(input) {
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return "零元整";
  if (parsed === 0) return "零元整";

  const negative = parsed < 0 ? "负" : "";
  const amount = Math.min(Math.abs(parsed), 999999999999999.99);
  const integer = Math.floor(amount);
  const decimal = Math.round((amount - integer) * 100);
  const jiao = Math.floor(decimal / 10);
  const fen = decimal % 10;

  let integerText = "";
  let sectionIndex = 0;
  let section = integer;
  let needZero = false;

  while (section > 0) {
    const current = section % 10000;
    if (current === 0) {
      if (integerText) needZero = true;
    } else {
      const sectionText = sectionToChinese(current);
      if ((needZero || current < 1000) && integerText && !integerText.startsWith(CN_NUMBERS[0])) {
        integerText = CN_NUMBERS[0] + integerText;
      }
      integerText = sectionText + CN_SECTIONS[sectionIndex] + integerText;
      needZero = false;
    }
    section = Math.floor(section / 10000);
    sectionIndex += 1;
  }

  integerText = integerText.replace(/零+/g, "零").replace(/零$/g, "") || "零";
  let fractionText = "";
  if (jiao) fractionText += `${CN_NUMBERS[jiao]}角`;
  if (fen) fractionText += `${!jiao && integer ? "零" : ""}${CN_NUMBERS[fen]}分`;
  if (!fractionText) fractionText = "整";

  return `${negative}${integerText}元${fractionText}`;
}

export function formatMoney(input) {
  return `¥${Number(input || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatDateTime(input) {
  if (!input) return "-";
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function formatEventDate(input) {
  const date = new Date(input || Date.now());
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`;
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 500);
}

export function safeFilename(input, fallback = "电子礼簿") {
  return String(input || fallback).replace(/[\\/:*?"<>|]/g, "_");
}
