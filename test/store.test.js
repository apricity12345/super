import test from 'node:test';
import assert from 'node:assert/strict';

import { STORAGE_KEY, StorageError, createStore, parseKey } from '../js/store.js';
import { buildOccurrence, occurrencesBetween } from '../js/recurrence.js';
import { baseInput, failingStorage, makeSeries, memoryStorage } from './helpers.js';

function setup() {
  const storage = memoryStorage();
  let clock = 1000;
  const store = createStore({ storage, now: () => clock });
  return {
    storage,
    store,
    setClock(value) {
      clock = value;
    },
  };
}

test('新增单次事项、去首尾空格并持久化', () => {
  const { storage, store } = setup();
  const { key } = store.add(
    baseInput({
      title: '  写周报  ',
      notes: '整理本周进展',
      date: '2026-11-23',
      startTime: '09:00',
      endTime: '10:00',
      category: '工作',
      priority: 'high',
    }),
  );
  assert.match(key, /^item:/);
  const item = store.getState().items[0];
  assert.equal(item.title, '写周报');
  assert.equal(item.completedAt, null);

  const reloaded = createStore({ storage, now: () => 2000 });
  assert.equal(reloaded.getState().items.length, 1);
  assert.equal(reloaded.getState().items[0].title, '写周报');
});

test('未排期事项与已完成记录持久化', () => {
  const { store } = setup();
  const { key } = store.add(baseInput({ date: null }));
  assert.equal(store.getState().items[0].date, null);
  store.complete(key);
  assert.equal(store.getState().items[0].completedAt, 1000);
  store.restore(key);
  assert.equal(store.getState().items[0].completedAt, null);
});

test('新增重复事项保存为系列而不是单次事项', () => {
  const { store } = setup();
  const { key } = store.add(
    baseInput({ title: '房租', date: '2027-01-31', repeat: 'monthly' }),
  );
  assert.match(key, /^series:/);
  const series = store.getState().series[0];
  assert.equal(series.repeat, 'monthly');
  assert.equal(series.startDate, '2027-01-31');
  assert.equal(store.getState().items.length, 0);
});

test('完成和恢复单次重复安排', () => {
  const { store, setClock } = setup();
  store.add(baseInput({ title: '房租', date: '2027-01-31', repeat: 'monthly' }));
  const seriesId = store.getState().series[0].id;
  const key = `series:${seriesId}:2027-02-28`;

  setClock(2000);
  store.complete(key);
  let series = store.getState().series[0];
  assert.equal(series.overrides['2027-02-28'].completedAt, 2000);
  assert.match(buildOccurrence(series, '2027-02-28').title, /房租/);

  store.restore(key);
  series = store.getState().series[0];
  assert.equal(series.overrides['2027-02-28'], undefined);
});

test('仅本次编辑只影响一次安排', () => {
  const { store } = setup();
  store.add(baseInput({ title: '房租', date: '2027-01-31', repeat: 'monthly' }));
  const seriesId = store.getState().series[0].id;
  const key = `series:${seriesId}:2027-02-28`;

  store.update(
    key,
    baseInput({
      title: '房租（改期）',
      date: '2027-02-15',
      repeat: 'monthly',
      category: '生活',
    }),
    'one',
  );
  const series = store.getState().series[0];
  assert.equal(series.title, '房租');
  const occurrence = buildOccurrence(series, '2027-02-28');
  assert.equal(occurrence.date, '2027-02-15');
  assert.equal(occurrence.title, '房租（改期）');
  assert.equal(buildOccurrence(series, '2027-03-31').title, '房租');
});

test('本次及以后编辑会截断旧系列并创建新系列，保留之前记录', () => {
  const { store } = setup();
  store.add(baseInput({ title: '房租', date: '2027-01-31', repeat: 'monthly' }));
  const seriesId = store.getState().series[0].id;
  const januaryKey = `series:${seriesId}:2027-01-31`;
  const februaryKey = `series:${seriesId}:2027-02-28`;
  store.complete(januaryKey);

  store.update(
    februaryKey,
    baseInput({
      title: '新房租',
      date: '2027-02-15',
      repeat: 'monthly',
      category: '生活',
    }),
    'future',
  );

  const state = store.getState();
  assert.equal(state.series.length, 2);
  const oldSeries = state.series.find((entry) => entry.id === seriesId);
  const newSeries = state.series.find((entry) => entry.id !== seriesId);
  assert.equal(oldSeries.endDate, '2027-01-31');
  assert.ok(oldSeries.overrides['2027-01-31']?.completedAt);
  assert.equal(newSeries.startDate, '2027-02-15');
  assert.equal(newSeries.repeat, 'monthly');
  assert.equal(newSeries.title, '新房租');
  assert.deepEqual(
    occurrencesBetween(oldSeries, '2027-01-01', '2027-03-31').map((item) => item.date),
    ['2027-01-31'],
  );
  assert.deepEqual(
    occurrencesBetween(newSeries, '2027-02-01', '2027-03-31').map((item) => item.date),
    ['2027-02-15', '2027-03-15'],
  );
});

test('本次及以后改成不重复会结束系列并生成单次事项', () => {
  const { store } = setup();
  store.add(baseInput({ title: '健身', date: '2026-11-23', repeat: 'daily' }));
  const seriesId = store.getState().series[0].id;
  store.update(
    `series:${seriesId}:2026-11-24`,
    baseInput({ title: '最后一次健身', date: '2026-11-24', repeat: null }),
    'future',
  );
  const state = store.getState();
  assert.equal(state.series[0].endDate, '2026-11-23');
  assert.equal(state.items.length, 1);
  assert.equal(state.items[0].title, '最后一次健身');
});

test('仅删除一次安排不影响后续', () => {
  const { store } = setup();
  store.add(baseInput({ title: '打卡', date: '2026-11-23', repeat: 'daily' }));
  const seriesId = store.getState().series[0].id;
  store.remove(`series:${seriesId}:2026-11-24`, 'one');
  const series = store.getState().series[0];
  assert.deepEqual(
    occurrencesBetween(series, '2026-11-23', '2026-11-25').map((item) => item.date),
    ['2026-11-23', '2026-11-25'],
  );
});

test('本次及以后删除会截断系列并保留完成记录', () => {
  const { store } = setup();
  store.add(baseInput({ title: '打卡', date: '2026-11-23', repeat: 'daily' }));
  const seriesId = store.getState().series[0].id;
  store.complete(`series:${seriesId}:2026-11-23`);
  store.remove(`series:${seriesId}:2026-11-24`, 'future');
  const series = store.getState().series[0];
  assert.equal(series.endDate, '2026-11-23');
  assert.ok(series.overrides['2026-11-23']?.completedAt);
  assert.deepEqual(
    occurrencesBetween(series, '2026-11-20', '2026-11-30').map((item) => item.date),
    ['2026-11-23'],
  );
});

test('删除第一次的「本次及以后」会移除整个系列', () => {
  const { store } = setup();
  store.add(baseInput({ title: '打卡', date: '2026-11-23', repeat: 'daily' }));
  const seriesId = store.getState().series[0].id;
  store.remove(`series:${seriesId}:2026-11-23`, 'future');
  assert.equal(store.getState().series.length, 0);
});

test('给单次事项设置重复会转换为系列', () => {
  const { store } = setup();
  const { key } = store.add(baseInput({ title: '喝水', date: '2026-11-23' }));
  store.update(key, baseInput({ title: '喝水', date: '2026-11-23', repeat: 'daily' }), 'one');
  const state = store.getState();
  assert.equal(state.items.length, 0);
  assert.equal(state.series.length, 1);
  assert.equal(state.series[0].repeat, 'daily');
});

test('保存失败时抛出 StorageError 且不改动内存状态', () => {
  const store = createStore({ storage: failingStorage(), now: () => 1000 });
  assert.throws(() => store.add(baseInput({})), StorageError);
  assert.equal(store.getState().items.length, 0);
});

test('更新保存失败时保留原数据，稍后可重试', () => {
  const storage = memoryStorage();
  let shouldFail = false;
  const originalSetItem = storage.setItem;
  storage.setItem = (key, value) => {
    if (shouldFail) throw new Error('quota');
    originalSetItem(key, value);
  };
  const store = createStore({ storage, now: () => 1000 });
  const { key } = store.add(baseInput({ title: '原标题' }));

  shouldFail = true;
  assert.throws(
    () => store.update(key, baseInput({ title: '新标题' }), 'one'),
    StorageError,
  );
  assert.equal(store.getState().items[0].title, '原标题');

  shouldFail = false;
  store.update(key, baseInput({ title: '新标题' }), 'one');
  assert.equal(store.getState().items[0].title, '新标题');
});

test('损坏的本地数据会提示并从空状态开始', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: '{not-json' });
  const store = createStore({ storage, now: () => 1000 });
  assert.match(store.getLoadNotice(), /无法读取/);
  assert.equal(store.getState().items.length, 0);
});

test('解析事项 key', () => {
  assert.deepEqual(parseKey('item:abc'), { type: 'item', id: 'abc' });
  assert.deepEqual(parseKey('series:abc:2027-01-31'), {
    type: 'series',
    id: 'abc',
    baseDate: '2027-01-31',
  });
  assert.equal(parseKey('nope'), null);
});
