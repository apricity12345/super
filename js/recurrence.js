/**
 * 重复事项的展开逻辑。
 *
 * 每个重复系列保存一份规则（开始日期、重复方式、可选的结束日期），
 * 某一次安排被单独修改/完成/删除时，以 `overrides` 中的 baseDate 为键记录差异。
 * 这样既能无限向前展开，又不会为每次重复预生成数据。
 */

import {
  addDays,
  combineDateTime,
  compareDateKeys,
  dayOfMonth,
  daysInMonth,
  fromKey,
  monthIndex,
  weekday,
  WEEKDAY_LABELS,
} from './dates.js';

export const REPEAT_VALUES = ['daily', 'weekly', 'monthly'];
export const REMINDER_OFFSETS = {
  start: 0,
  '10m': 10 * 60 * 1000,
  '60m': 60 * 60 * 1000,
};

function hasOwn(object, key) {
  return Object.prototype.hasOwnProperty.call(object, key);
}

export function recurrenceLabel(series) {
  if (!series || !series.repeat) return '不重复';
  if (series.repeat === 'daily') return '每天';
  if (series.repeat === 'weekly') return `每${WEEKDAY_LABELS[weekday(series.startDate)]}`;
  if (series.repeat === 'monthly') return `每月${dayOfMonth(series.startDate)}日`;
  return '不重复';
}

export function recurrenceHint(series) {
  if (!series || !series.repeat) return '';
  if (series.repeat === 'weekly') {
    return `按首次日期所在的${WEEKDAY_LABELS[weekday(series.startDate)]}重复。`;
  }
  if (series.repeat === 'monthly') {
    return `按首次日期的日号（${dayOfMonth(series.startDate)}日）重复，遇到较短的月份排在该月最后一天。`;
  }
  return '每天重复。';
}

export function isOccurrenceOn(series, dateKey) {
  if (!series || !series.repeat) return false;
  if (dateKey < series.startDate) return false;
  if (series.endDate && dateKey > series.endDate) return false;
  if (series.repeat === 'daily') return true;
  if (series.repeat === 'weekly') {
    return weekday(dateKey) === weekday(series.startDate);
  }
  if (series.repeat === 'monthly') {
    const anchor = dayOfMonth(series.startDate);
    const lastDay = daysInMonth(fromKey(dateKey).getFullYear(), monthIndex(dateKey));
    return dayOfMonth(dateKey) === Math.min(anchor, lastDay);
  }
  return false;
}

function overrideFor(series, baseDate) {
  return (series.overrides && series.overrides[baseDate]) || null;
}

function fieldOr(override, field, fallback) {
  if (override && override.fields && hasOwn(override.fields, field)) {
    return override.fields[field];
  }
  return fallback;
}

/** 把系列的一次安排展开为与单次事项一致的展示对象；已删除的返回 null。 */
export function buildOccurrence(series, baseDate) {
  const override = overrideFor(series, baseDate);
  if (override && override.deleted) return null;
  return {
    key: `series:${series.id}:${baseDate}`,
    id: series.id,
    seriesId: series.id,
    baseDate,
    isRecurring: true,
    title: fieldOr(override, 'title', series.title),
    notes: fieldOr(override, 'notes', series.notes),
    date: fieldOr(override, 'date', baseDate),
    startTime: fieldOr(override, 'startTime', series.startTime),
    endTime: fieldOr(override, 'endTime', series.endTime),
    category: fieldOr(override, 'category', series.category),
    priority: fieldOr(override, 'priority', series.priority),
    reminder: fieldOr(override, 'reminder', series.reminder),
    repeat: series.repeat,
    seriesStartDate: series.startDate,
    seriesEndDate: series.endDate,
    createdAt: series.createdAt,
    updatedAt: (override && override.updatedAt) || series.updatedAt,
    completedAt: (override && override.completedAt) || null,
  };
}

/** 系列中落在 [from, to] 的原始安排日期（不含 overrides 改期）。 */
export function occurrenceDatesBetween(series, from, to) {
  if (!series || !series.repeat) return [];
  const start = from > series.startDate ? from : series.startDate;
  const end = series.endDate && series.endDate < to ? series.endDate : to;
  if (start > end) return [];
  const dates = [];
  let cursor = start;
  let guard = 0;
  while (cursor <= end && guard < 50000) {
    if (isOccurrenceOn(series, cursor)) dates.push(cursor);
    cursor = addDays(cursor, 1);
    guard += 1;
  }
  return dates;
}

function candidateBaseDates(series, from, to) {
  const candidates = new Set(occurrenceDatesBetween(series, from, to));
  const overrides = series.overrides || {};
  for (const baseDate of Object.keys(overrides)) {
    const override = overrides[baseDate];
    if (!override || override.deleted) continue;
    const effectiveDate = (override.fields && override.fields.date) || baseDate;
    if (effectiveDate >= from && effectiveDate <= to && isOccurrenceOn(series, baseDate)) {
      candidates.add(baseDate);
    }
  }
  return [...candidates];
}

/** 某月/某区间内的所有安排（含已完成，不含已删除，含被改期进区间的安排）。 */
export function occurrencesBetween(series, from, to) {
  if (!series) return [];
  const result = [];
  for (const baseDate of candidateBaseDates(series, from, to)) {
    const occurrence = buildOccurrence(series, baseDate);
    if (!occurrence) continue;
    if (occurrence.date < from || occurrence.date > to) continue;
    result.push(occurrence);
  }
  result.sort(compareOccurrenceOrder);
  return result;
}

/** 截止到某天（含）的全部安排，用于“今天”里的逾期/今日分组。 */
export function occurrencesUpTo(series, to) {
  if (!series) return [];
  const baseDates = occurrenceDatesBetween(series, series.startDate, to);
  const set = new Set(baseDates);
  for (const [baseDate, override] of Object.entries(series.overrides || {})) {
    if (!override || override.deleted) continue;
    const effectiveDate = (override.fields && override.fields.date) || baseDate;
    if (effectiveDate <= to && isOccurrenceOn(series, baseDate)) set.add(baseDate);
  }
  const result = [];
  for (const baseDate of set) {
    const occurrence = buildOccurrence(series, baseDate);
    if (occurrence && occurrence.date <= to) result.push(occurrence);
  }
  return result;
}

/** 严格早于 dateKey 的最近一次原始安排日期。 */
export function previousOccurrenceBefore(series, dateKey) {
  if (!series || !series.repeat) return null;
  let cursor = addDays(dateKey, -1);
  for (let i = 0; i < 400; i += 1) {
    if (cursor < series.startDate) return null;
    if (isOccurrenceOn(series, cursor)) return cursor;
    cursor = addDays(cursor, -1);
  }
  return null;
}

/** 严格晚于 dateKey 的最近一次原始安排日期。 */
export function nextOccurrenceAfter(series, dateKey) {
  if (!series || !series.repeat) return null;
  let cursor = addDays(dateKey, 1);
  for (let i = 0; i < 400; i += 1) {
    if (series.endDate && cursor > series.endDate) return null;
    if (isOccurrenceOn(series, cursor)) return cursor;
    cursor = addDays(cursor, 1);
  }
  return null;
}

export function compareOccurrenceOrder(a, b) {
  if (a.date !== b.date) return compareDateKeys(a.date, b.date);
  const aAllDay = !a.startTime;
  const bAllDay = !b.startTime;
  if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;
  if (a.startTime !== b.startTime) return a.startTime < b.startTime ? -1 : 1;
  return (a.createdAt || 0) - (b.createdAt || 0);
}

/**
 * 「全部」页每个系列只显示最早的未完成安排。
 * 先扫描从系列开始到 horizon 的所有安排，再考虑被改期进该范围、或改期到更晚的安排。
 */
export function earliestPendingOccurrence(series, horizon) {
  if (!series || !series.repeat) return null;
  const candidates = new Set(occurrenceDatesBetween(series, series.startDate, horizon));
  for (const baseDate of Object.keys(series.overrides || {})) {
    if (isOccurrenceOn(series, baseDate)) candidates.add(baseDate);
  }
  let best = null;
  for (const baseDate of candidates) {
    const occurrence = buildOccurrence(series, baseDate);
    if (!occurrence || occurrence.completedAt) continue;
    if (!best || compareOccurrenceOrder(occurrence, best) < 0) best = occurrence;
  }
  // horizon 之后可能还有比「改期到更远未来」更早的一次安排。
  const nextBase = nextOccurrenceAfter(series, horizon);
  if (nextBase) {
    const nextOccurrence = buildOccurrence(series, nextBase);
    if (
      nextOccurrence &&
      !nextOccurrence.completedAt &&
      (!best || compareOccurrenceOrder(nextOccurrence, best) < 0)
    ) {
      best = nextOccurrence;
    }
  }
  return best;
}

export function reminderTriggerMs(occurrence) {
  if (!occurrence || !occurrence.date || !occurrence.startTime || !occurrence.reminder) {
    return null;
  }
  const offset = REMINDER_OFFSETS[occurrence.reminder];
  if (offset === undefined) return null;
  return combineDateTime(occurrence.date, occurrence.startTime).getTime() - offset;
}
