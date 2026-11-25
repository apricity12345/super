/**
 * 本地日期工具。日期统一用 `YYYY-MM-DD` 字符串表示，时间用 `HH:mm`。
 * 所有换算都按浏览器当前时区进行。
 */

export const WEEKDAY_LABELS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
/** 月历表头顺序：周一至周日。 */
export const WEEKDAY_INITIALS = ['一', '二', '三', '四', '五', '六', '日'];

export function pad2(value) {
  return String(value).padStart(2, '0');
}

export function toDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

export function fromKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day);
}

export function isDateKey(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = fromKey(value);
  return !Number.isNaN(date.getTime()) && toDateKey(date) === value;
}

export function isTimeKey(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function todayKey(now = new Date()) {
  return toDateKey(now);
}

export function addDays(key, amount) {
  const date = fromKey(key);
  date.setDate(date.getDate() + amount);
  return toDateKey(date);
}

export function daysInMonth(year, monthIndex) {
  return new Date(year, monthIndex + 1, 0).getDate();
}

export function dayOfMonth(key) {
  return Number(key.slice(8, 10));
}

export function monthIndex(key) {
  return Number(key.slice(5, 7)) - 1;
}

export function yearOf(key) {
  return Number(key.slice(0, 4));
}

export function weekday(key) {
  return fromKey(key).getDay();
}

export function compareDateKeys(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function combineDateTime(dateKey, time) {
  const [year, month, day] = dateKey.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  return new Date(year, month - 1, day, hour, minute, 0, 0);
}

export function formatTimeLabel(time) {
  return time || '全天';
}

export function formatTimeRange(startTime, endTime) {
  if (!startTime) return '全天';
  return endTime ? `${startTime}–${endTime}` : startTime;
}

export function formatDateLabel(key) {
  if (!key) return '未排期';
  const date = fromKey(key);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${WEEKDAY_LABELS[date.getDay()]}`;
}

export function formatDateShort(key) {
  const date = fromKey(key);
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export function relativeDateLabel(key, now = new Date()) {
  if (!key) return '未排期';
  const today = todayKey(now);
  if (key === today) return '今天';
  if (key === addDays(today, 1)) return '明天';
  if (key === addDays(today, -1)) return '昨天';
  const thisYear = today.slice(0, 4) === key.slice(0, 4);
  return thisYear ? `${formatDateShort(key)} ${WEEKDAY_LABELS[weekday(key)]}` : formatDateLabel(key);
}

export function formatMonthTitle(year, index) {
  return `${year}年${index + 1}月`;
}

/** 周一为一周第一天的 6×7 月历网格，包含相邻月份补齐的日期。 */
export function monthGrid(year, index) {
  const firstDay = new Date(year, index, 1);
  const mondayOffset = (firstDay.getDay() + 6) % 7;
  const cells = [];
  for (let i = 0; i < 42; i += 1) {
    const date = new Date(year, index, 1 - mondayOffset + i);
    cells.push({
      key: toDateKey(date),
      day: date.getDate(),
      outside: date.getMonth() !== index || date.getFullYear() !== year,
    });
  }
  return cells;
}

export function formatTimestamp(timestamp) {
  const date = new Date(timestamp);
  return `${date.getMonth() + 1}月${date.getDate()}日 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function formatFullTimestamp(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/** 返回从 from 到 to 的日期键（含两端），调用方需保证 from ≤ to。 */
export function dateKeysBetween(fromKeyValue, toKeyValue, limit = 60000) {
  const keys = [];
  let cursor = fromKeyValue;
  while (cursor <= toKeyValue && keys.length < limit) {
    keys.push(cursor);
    cursor = addDays(cursor, 1);
  }
  return keys;
}
