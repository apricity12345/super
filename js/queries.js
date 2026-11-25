/** 从状态派生各页面要展示的数据。所有函数都接收显式的“当前时间”。 */

import { addDays, combineDateTime, todayKey } from './dates.js';
import {
  buildOccurrence,
  compareOccurrenceOrder,
  earliestPendingOccurrence,
  occurrencesBetween,
  occurrencesUpTo,
  reminderTriggerMs,
} from './recurrence.js';
import { parseKey } from './store.js';

export function itemToOccurrence(item) {
  return {
    key: `item:${item.id}`,
    id: item.id,
    seriesId: null,
    baseDate: null,
    isRecurring: false,
    title: item.title,
    notes: item.notes,
    date: item.date,
    startTime: item.startTime,
    endTime: item.endTime,
    category: item.category,
    priority: item.priority,
    reminder: item.reminder,
    repeat: null,
    seriesStartDate: null,
    seriesEndDate: null,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    completedAt: item.completedAt,
  };
}

export function occurrenceFor(state, key) {
  const parsed = parseKey(key);
  if (!parsed) return null;
  if (parsed.type === 'item') {
    const item = state.items.find((entry) => entry.id === parsed.id);
    return item ? itemToOccurrence(item) : null;
  }
  const series = state.series.find((entry) => entry.id === parsed.id);
  if (!series) return null;
  return buildOccurrence(series, parsed.baseDate);
}

export function isOverdue(occurrence, now = new Date()) {
  if (!occurrence || occurrence.completedAt || !occurrence.date) return false;
  const today = todayKey(now);
  if (occurrence.startTime) {
    const dueTime = combineDateTime(occurrence.date, occurrence.endTime || occurrence.startTime);
    return now.getTime() >= dueTime.getTime();
  }
  // 全天事项从次日零点开始算逾期。
  return occurrence.date < today;
}

function scheduledSort(list) {
  return [...list].sort(compareOccurrenceOrder);
}

function splitScheduled(list) {
  const scheduled = [];
  const unscheduled = [];
  for (const occurrence of list) {
    if (occurrence.date) scheduled.push(occurrence);
    else unscheduled.push(occurrence);
  }
  scheduled.sort(compareOccurrenceOrder);
  unscheduled.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return { scheduled, unscheduled };
}

/** 「今天」页：逾期 + 今天，未排期和未来日期都不展示。 */
export function todayView(state, now = new Date()) {
  const today = todayKey(now);
  const overdue = [];
  const dueToday = [];

  function classify(occurrence) {
    if (!occurrence || occurrence.completedAt) return;
    if (occurrence.date !== today) {
      if (occurrence.date < today) overdue.push(occurrence);
      return;
    }
    if (isOverdue(occurrence, now)) overdue.push(occurrence);
    else dueToday.push(occurrence);
  }

  for (const item of state.items) {
    if (!item.date) continue;
    classify(itemToOccurrence(item));
  }
  for (const series of state.series) {
    for (const occurrence of occurrencesUpTo(series, today)) {
      classify(occurrence);
    }
  }

  return {
    todayKey: today,
    overdue: scheduledSort(overdue),
    today: scheduledSort(dueToday),
  };
}

function matchesFilters(occurrence, filters) {
  if (filters.category && occurrence.category !== filters.category) return false;
  if (filters.priority === 'none') {
    if (occurrence.priority) return false;
  } else if (filters.priority && occurrence.priority !== filters.priority) {
    return false;
  }
  const query = (filters.search || '').trim().toLowerCase();
  if (query) {
    const haystack = `${occurrence.title || ''}\n${occurrence.notes || ''}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  return true;
}

function allPendingEntries(state, now) {
  const today = todayKey(now);
  const baseHorizon = addDays(today, 366 * 5);
  const entries = [];
  for (const item of state.items) {
    if (!item.completedAt) entries.push(itemToOccurrence(item));
  }
  for (const series of state.series) {
    const horizon =
      series.startDate > baseHorizon ? addDays(series.startDate, 400) : baseHorizon;
    const next = earliestPendingOccurrence(series, horizon);
    if (next) entries.push(next);
  }
  return entries;
}

/** 「全部」：未完成事项，重复系列只取最早一次。 */
export function allView(state, filters = {}, now = new Date()) {
  const entries = allPendingEntries(state, now);
  const categories = [...new Set(entries.map((entry) => entry.category).filter(Boolean))].sort(
    (a, b) => a.localeCompare(b, 'zh-Hans-CN'),
  );
  const filtered = entries.filter((occurrence) => matchesFilters(occurrence, filters));
  const { scheduled, unscheduled } = splitScheduled(filtered);
  return {
    scheduled,
    unscheduled,
    total: filtered.length,
    totalUnfiltered: entries.length,
    hasAny: entries.length > 0,
    hasFilters: Boolean(filters.search || filters.category || filters.priority),
    categories,
  };
}

/** 「已完成」：按完成时间从近到远。 */
export function completedView(state) {
  const entries = [];
  for (const item of state.items) {
    if (item.completedAt) entries.push(itemToOccurrence(item));
  }
  for (const series of state.series) {
    for (const [baseDate, override] of Object.entries(series.overrides || {})) {
      if (!override || override.deleted || !override.completedAt) continue;
      const occurrence = buildOccurrence(series, baseDate);
      if (occurrence) entries.push(occurrence);
    }
  }
  entries.sort((a, b) => (b.completedAt || 0) - (a.completedAt || 0));
  return entries;
}

/** 「月历」：整月网格数据，包含已完成事项，已删除的不包含。 */
export function calendarView(state, year, month, cells) {
  const byDate = new Map(cells.map((cell) => [cell.key, []]));
  const first = cells[0].key;
  const last = cells[cells.length - 1].key;

  for (const item of state.items) {
    if (!item.date || item.date < first || item.date > last) continue;
    const bucket = byDate.get(item.date);
    if (bucket) bucket.push(itemToOccurrence(item));
  }
  for (const series of state.series) {
    for (const occurrence of occurrencesBetween(series, first, last)) {
      const bucket = byDate.get(occurrence.date);
      if (bucket) bucket.push(occurrence);
    }
  }
  let count = 0;
  for (const [date, list] of byDate) {
    list.sort(compareOccurrenceOrder);
    byDate.set(date, list);
    if (!date.startsWith(`${year}-${String(month + 1).padStart(2, '0')}`)) continue;
    count += list.length;
  }
  return { byDate, count };
}

/** 月历右侧/下方的某一天详情。 */
export function dayView(state, dateKey) {
  const entries = [];
  for (const item of state.items) {
    if (item.date === dateKey) entries.push(itemToOccurrence(item));
  }
  for (const series of state.series) {
    entries.push(...occurrencesBetween(series, dateKey, dateKey));
  }
  entries.sort(compareOccurrenceOrder);
  return entries;
}

export function collectCategories(state) {
  const categories = new Set();
  for (const item of state.items) {
    if (item.category) categories.add(item.category);
  }
  for (const series of state.series) {
    if (series.category) categories.add(series.category);
    for (const override of Object.values(series.overrides || {})) {
      if (override && override.fields && override.fields.category) {
        categories.add(override.fields.category);
      }
    }
  }
  return [...categories].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
}

/** 提醒扫描的候选安排（已完成的不返回）。 */
export function reminderCandidates(state, from, to) {
  const candidates = [];
  for (const item of state.items) {
    if (
      item.date &&
      item.date >= from &&
      item.date <= to &&
      !item.completedAt &&
      item.reminder &&
      item.startTime
    ) {
      candidates.push(itemToOccurrence(item));
    }
  }
  for (const series of state.series) {
    for (const occurrence of occurrencesBetween(series, from, to)) {
      if (!occurrence.completedAt && occurrence.reminder && occurrence.startTime) {
        candidates.push(occurrence);
      }
    }
  }
  return candidates;
}
