export function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
  };
}

export function failingStorage() {
  return {
    getItem() {
      return null;
    },
    setItem() {
      throw new Error('QuotaExceededError');
    },
    removeItem() {},
  };
}

export function makeSeries(overrides = {}) {
  return {
    id: 'series-1',
    title: '示例重复事项',
    notes: '',
    category: '',
    priority: null,
    startDate: '2027-01-31',
    startTime: null,
    endTime: null,
    reminder: null,
    repeat: 'monthly',
    endDate: null,
    createdAt: 1000,
    updatedAt: 1000,
    overrides: {},
    ...overrides,
  };
}

export function baseInput(overrides = {}) {
  return {
    title: '事项',
    notes: '',
    date: '2026-11-23',
    startTime: null,
    endTime: null,
    category: '',
    priority: null,
    reminder: null,
    repeat: null,
    ...overrides,
  };
}
