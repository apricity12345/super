/** localStorage 持久化与所有写操作。保存失败时不会改动内存中的旧数据。 */

import { isDateKey, isTimeKey } from './dates.js';
import { REPEAT_VALUES, isOccurrenceOn, previousOccurrenceBefore } from './recurrence.js';

export const STORAGE_KEY = 'personal-todo-calendar:v1';
export const STATE_VERSION = 1;

export class StorageError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'StorageError';
  }
}

export function emptyState() {
  return { version: STATE_VERSION, items: [], series: [] };
}

function newId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function parseKey(key) {
  if (typeof key !== 'string') return null;
  if (key.startsWith('item:')) return { type: 'item', id: key.slice(5) };
  if (key.startsWith('series:')) {
    const rest = key.slice(7);
    const separator = rest.lastIndexOf(':');
    if (separator < 0) return null;
    return { type: 'series', id: rest.slice(0, separator), baseDate: rest.slice(separator + 1) };
  }
  return null;
}

function normalizeValue(input) {
  const hasDate = Boolean(input.date);
  return {
    title: (input.title || '').trim(),
    notes: input.notes || '',
    date: hasDate ? input.date : null,
    startTime: hasDate ? input.startTime || null : null,
    endTime: hasDate ? input.endTime || null : null,
    category: (input.category || '').trim(),
    priority: input.priority || null,
    reminder: hasDate && input.startTime ? input.reminder || null : null,
  };
}

function seriesFromValue(value, timestamp, options = {}) {
  return {
    id: options.id || newId(),
    title: value.title,
    notes: value.notes,
    category: value.category,
    priority: value.priority,
    startDate: value.date,
    startTime: value.startTime,
    endTime: value.endTime,
    reminder: value.reminder,
    repeat: value.repeat,
    endDate: options.endDate || null,
    createdAt: options.createdAt || timestamp,
    updatedAt: timestamp,
    overrides: options.overrides || {},
  };
}

function itemFromValue(value, timestamp, options = {}) {
  return {
    id: options.id || newId(),
    title: value.title,
    notes: value.notes,
    date: value.date,
    startTime: value.startTime,
    endTime: value.endTime,
    category: value.category,
    priority: value.priority,
    reminder: value.reminder,
    createdAt: options.createdAt || timestamp,
    updatedAt: timestamp,
    completedAt: options.completedAt || null,
  };
}

function sanitizeLoadedState(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('数据格式不正确');
  }
  if (!Array.isArray(raw.items) || !Array.isArray(raw.series)) {
    throw new Error('数据格式不正确');
  }
  const items = raw.items
    .filter((item) => item && typeof item.id === 'string' && typeof item.title === 'string')
    .map((item) => ({
      id: item.id,
      title: item.title,
      notes: typeof item.notes === 'string' ? item.notes : '',
      date: isDateKey(item.date) ? item.date : null,
      startTime: isTimeKey(item.startTime) ? item.startTime : null,
      endTime: isTimeKey(item.endTime) ? item.endTime : null,
      category: typeof item.category === 'string' ? item.category : '',
      priority: ['high', 'medium', 'low'].includes(item.priority) ? item.priority : null,
      reminder: ['start', '10m', '60m'].includes(item.reminder) ? item.reminder : null,
      createdAt: Number(item.createdAt) || 0,
      updatedAt: Number(item.updatedAt) || 0,
      completedAt: Number(item.completedAt) || null,
    }));
  const series = raw.series
    .filter(
      (entry) =>
        entry &&
        typeof entry.id === 'string' &&
        typeof entry.title === 'string' &&
        isDateKey(entry.startDate) &&
        REPEAT_VALUES.includes(entry.repeat),
    )
    .map((entry) => ({
      id: entry.id,
      title: entry.title,
      notes: typeof entry.notes === 'string' ? entry.notes : '',
      category: typeof entry.category === 'string' ? entry.category : '',
      priority: ['high', 'medium', 'low'].includes(entry.priority) ? entry.priority : null,
      startDate: entry.startDate,
      startTime: isTimeKey(entry.startTime) ? entry.startTime : null,
      endTime: isTimeKey(entry.endTime) ? entry.endTime : null,
      reminder: ['start', '10m', '60m'].includes(entry.reminder) ? entry.reminder : null,
      repeat: entry.repeat,
      endDate: isDateKey(entry.endDate) ? entry.endDate : null,
      createdAt: Number(entry.createdAt) || 0,
      updatedAt: Number(entry.updatedAt) || 0,
      overrides:
        entry.overrides && typeof entry.overrides === 'object' && !Array.isArray(entry.overrides)
          ? entry.overrides
          : {},
    }));
  return { version: STATE_VERSION, items, series };
}

export function createStore({ storage, now = () => Date.now(), key = STORAGE_KEY } = {}) {
  let backing = storage;
  if (!backing) {
    try {
      backing = typeof globalThis !== 'undefined' ? globalThis.localStorage : undefined;
    } catch (error) {
      backing = undefined;
    }
  }
  let loadNotice = '';
  let state = emptyState();

  if (!backing) {
    loadNotice = '当前浏览器无法访问本地存储，改动可能无法在刷新后保留。';
  } else {
    try {
      const raw = backing.getItem(key);
      if (raw) state = sanitizeLoadedState(JSON.parse(raw));
    } catch (error) {
      loadNotice = '已有的本地数据无法读取，已从空清单开始。保存新事项后会覆盖旧数据。';
    }
  }

  function persist(nextState) {
    if (!backing) {
      throw new StorageError('当前浏览器无法访问本地存储，请检查隐私设置后重试。');
    }
    try {
      backing.setItem(key, JSON.stringify(nextState));
    } catch (error) {
      throw new StorageError('保存失败，数据未能写入当前浏览器。请重试。', { cause: error });
    }
    state = nextState;
  }

  function replaceItem(id, updater) {
    return state.items.map((item) => (item.id === id ? updater(item) : item));
  }

  function replaceSeries(id, updater) {
    return state.series.map((entry) => (entry.id === id ? updater(entry) : entry));
  }

  function findSeriesOccurrence(parsed) {
    const series = state.series.find((entry) => entry.id === parsed.id);
    if (!series) throw new Error('事项不存在');
    return series;
  }

  function add(rawValue) {
    const value = normalizeValue(rawValue);
    const timestamp = now();
    if (rawValue.repeat) {
      const series = seriesFromValue({ ...value, repeat: rawValue.repeat }, timestamp);
      persist({ ...state, series: [...state.series, series] });
      return { key: `series:${series.id}:${series.startDate}` };
    }
    const item = itemFromValue(value, timestamp);
    persist({ ...state, items: [...state.items, item] });
    return { key: `item:${item.id}` };
  }

  function convertItemToSeries(itemId, value, repeat) {
    const item = state.items.find((entry) => entry.id === itemId);
    if (!item) throw new Error('事项不存在');
    const timestamp = now();
    const series = seriesFromValue({ ...value, repeat }, timestamp);
    persist({
      ...state,
      items: state.items.filter((entry) => entry.id !== itemId),
      series: [...state.series, series],
    });
    return { key: `series:${series.id}:${series.startDate}` };
  }

  function update(rawKey, rawValue, scope = 'one') {
    const parsed = parseKey(rawKey);
    if (!parsed) throw new Error('事项不存在');
    const value = normalizeValue(rawValue);
    const timestamp = now();

    if (parsed.type === 'item') {
      const item = state.items.find((entry) => entry.id === parsed.id);
      if (!item) throw new Error('事项不存在');
      if (rawValue.repeat) return convertItemToSeries(parsed.id, value, rawValue.repeat);
      persist({
        ...state,
        items: replaceItem(parsed.id, (entry) => ({
          ...entry,
          ...value,
          updatedAt: timestamp,
        })),
      });
      return { key: rawKey };
    }

    const series = findSeriesOccurrence(parsed);
    if (!series.overrides[parsed.baseDate] && !isBaseDateInSeries(series, parsed.baseDate)) {
      throw new Error('事项不存在');
    }

    if (scope !== 'future') {
      const existing = series.overrides[parsed.baseDate] || {};
      const overrides = {
        ...series.overrides,
        [parsed.baseDate]: {
          ...existing,
          deleted: false,
          fields: {
            title: value.title,
            notes: value.notes,
            date: value.date,
            startTime: value.startTime,
            endTime: value.endTime,
            category: value.category,
            priority: value.priority,
            reminder: value.reminder,
          },
          updatedAt: timestamp,
        },
      };
      persist({
        ...state,
        series: replaceSeries(series.id, (entry) => ({ ...entry, overrides, updatedAt: timestamp })),
      });
      return { key: rawKey };
    }

    // 「本次及以后」：截断旧系列，保留之前的事项和完成记录，再按新值创建后续。
    const previous = previousOccurrenceBefore(series, parsed.baseDate);
    let nextSeriesList = state.series;
    if (previous) {
      const keptOverrides = {};
      for (const [baseDate, override] of Object.entries(series.overrides)) {
        if (baseDate <= previous) keptOverrides[baseDate] = override;
      }
      nextSeriesList = replaceSeries(series.id, (entry) => ({
        ...entry,
        endDate: previous,
        overrides: keptOverrides,
        updatedAt: timestamp,
      }));
    } else {
      nextSeriesList = state.series.filter((entry) => entry.id !== series.id);
    }

    if (rawValue.repeat) {
      const created = seriesFromValue({ ...value, repeat: rawValue.repeat }, timestamp);
      persist({ ...state, series: [...nextSeriesList, created] });
      return { key: `series:${created.id}:${created.startDate}` };
    }
    const createdItem = itemFromValue(value, timestamp);
    persist({ ...state, series: nextSeriesList, items: [...state.items, createdItem] });
    return { key: `item:${createdItem.id}` };
  }

  function complete(rawKey) {
    const parsed = parseKey(rawKey);
    if (!parsed) throw new Error('事项不存在');
    const timestamp = now();
    if (parsed.type === 'item') {
      if (!state.items.some((entry) => entry.id === parsed.id)) throw new Error('事项不存在');
      persist({
        ...state,
        items: replaceItem(parsed.id, (entry) => ({ ...entry, completedAt: timestamp })),
      });
      return;
    }
    const series = findSeriesOccurrence(parsed);
    const existing = series.overrides[parsed.baseDate] || {};
    persist({
      ...state,
      series: replaceSeries(series.id, (entry) => ({
        ...entry,
        overrides: {
          ...entry.overrides,
          [parsed.baseDate]: { ...existing, deleted: false, completedAt: timestamp },
        },
      })),
    });
  }

  function restore(rawKey) {
    const parsed = parseKey(rawKey);
    if (!parsed) throw new Error('事项不存在');
    if (parsed.type === 'item') {
      if (!state.items.some((entry) => entry.id === parsed.id)) throw new Error('事项不存在');
      persist({
        ...state,
        items: replaceItem(parsed.id, (entry) => ({ ...entry, completedAt: null })),
      });
      return;
    }
    const series = findSeriesOccurrence(parsed);
    const existing = series.overrides[parsed.baseDate] || {};
    if (existing.deleted) throw new Error('事项已删除');
    const nextOverride = { ...existing, completedAt: null };
    const isEmpty =
      !nextOverride.fields && !nextOverride.completedAt && !nextOverride.deleted;
    const overrides = { ...series.overrides };
    if (isEmpty) delete overrides[parsed.baseDate];
    else overrides[parsed.baseDate] = nextOverride;
    persist({
      ...state,
      series: replaceSeries(series.id, (entry) => ({ ...entry, overrides })),
    });
  }

  function remove(rawKey, scope = 'one') {
    const parsed = parseKey(rawKey);
    if (!parsed) throw new Error('事项不存在');
    if (parsed.type === 'item') {
      persist({ ...state, items: state.items.filter((entry) => entry.id !== parsed.id) });
      return;
    }
    const series = findSeriesOccurrence(parsed);
    if (scope !== 'future') {
      const existing = series.overrides[parsed.baseDate] || {};
      persist({
        ...state,
        series: replaceSeries(series.id, (entry) => ({
          ...entry,
          overrides: {
            ...entry.overrides,
            [parsed.baseDate]: {
              ...existing,
              completedAt: null,
              deleted: true,
            },
          },
        })),
      });
      return;
    }
    const previous = previousOccurrenceBefore(series, parsed.baseDate);
    if (!previous) {
      persist({ ...state, series: state.series.filter((entry) => entry.id !== series.id) });
      return;
    }
    const keptOverrides = {};
    for (const [baseDate, override] of Object.entries(series.overrides)) {
      if (baseDate <= previous) keptOverrides[baseDate] = override;
    }
    persist({
      ...state,
      series: replaceSeries(series.id, (entry) => ({
        ...entry,
        endDate: previous,
        overrides: keptOverrides,
        updatedAt: now(),
      })),
    });
  }

  return {
    getState: () => state,
    getLoadNotice: () => loadNotice,
    add,
    update,
    complete,
    restore,
    remove,
  };
}

function isBaseDateInSeries(series, baseDate) {
  return isOccurrenceOn(series, baseDate);
}
