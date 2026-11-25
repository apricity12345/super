import test from 'node:test';
import assert from 'node:assert/strict';

import { monthGrid } from '../js/dates.js';
import { createStore } from '../js/store.js';
import {
  allView,
  calendarView,
  completedView,
  dayView,
  isOverdue,
  occurrenceFor,
  reminderCandidates,
  todayView,
} from '../js/queries.js';
import { baseInput, memoryStorage } from './helpers.js';

function setup(startClock = 1000) {
  const storage = memoryStorage();
  let clock = startClock;
  const store = createStore({ storage, now: () => clock });
  const add = (overrides) => {
    clock += 1;
    return store.add(baseInput(overrides)).key;
  };
  const tick = () => {
    clock += 1;
    return clock;
  };
  return { store, add, tick, setClock: (value) => (clock = value) };
}

const NOW = new Date(2026, 10, 23, 15, 0, 0);

test('逾期判定：全天事项次日零点起算，定时事项按结束/开始时间', () => {
  assert.equal(isOverdue({ date: '2026-11-22', startTime: null, completedAt: null }, NOW), true);
  assert.equal(isOverdue({ date: '2026-11-23', startTime: null, completedAt: null }, NOW), false);
  assert.equal(
    isOverdue({ date: '2026-11-23', startTime: '14:00', endTime: '15:00', completedAt: null }, NOW),
    true,
  );
  assert.equal(
    isOverdue({ date: '2026-11-23', startTime: '14:00', endTime: '16:00', completedAt: null }, NOW),
    false,
  );
  assert.equal(
    isOverdue({ date: '2026-11-23', startTime: '15:00', endTime: null, completedAt: null }, NOW),
    true,
  );
  assert.equal(
    isOverdue({ date: '2026-11-23', startTime: '09:00', endTime: null, completedAt: 1 }, NOW),
    false,
  );
});

test('今天页分组、排序并排除未来和未排期事项', () => {
  const { store, add } = setup();
  add({ title: '昨天全天', date: '2026-11-22' });
  add({ title: '昨天定时', date: '2026-11-22', startTime: '09:00', endTime: '10:00' });
  add({ title: '今天全天', date: '2026-11-23' });
  add({ title: '今天已过', date: '2026-11-23', startTime: '13:00', endTime: '14:00' });
  add({ title: '今天进行中', date: '2026-11-23', startTime: '14:00', endTime: '16:00' });
  add({ title: '今天稍后', date: '2026-11-23', startTime: '16:00', endTime: '17:00' });
  add({ title: '明天', date: '2026-11-24' });
  add({ title: '未排期', date: null });
  const completedKey = add({ title: '今天已完成', date: '2026-11-23' });
  store.complete(completedKey);

  const view = todayView(store.getState(), NOW);
  assert.deepEqual(
    view.overdue.map((item) => item.title),
    ['昨天全天', '昨天定时', '今天已过'],
  );
  assert.deepEqual(
    view.today.map((item) => item.title),
    ['今天全天', '今天进行中', '今天稍后'],
  );
  assert.equal(view.overdue[0].date, '2026-11-22');
});

test('恢复待办后沿用原日期并按当前时间重新判断逾期', () => {
  const { store, add } = setup();
  const key = add({ title: '昨天的事', date: '2026-11-22' });
  store.complete(key);
  store.restore(key);
  const occurrence = occurrenceFor(store.getState(), key);
  assert.equal(occurrence.date, '2026-11-22');
  assert.equal(isOverdue(occurrence, NOW), true);
  assert.equal(todayView(store.getState(), NOW).overdue[0].title, '昨天的事');
});

test('全部页搜索标题与备注，并叠加分类/优先级筛选', () => {
  const { store, add } = setup();
  add({ title: '提交报告', notes: '周报正文', category: '工作', priority: 'high', date: '2026-11-24' });
  add({ title: '买菜', notes: '顺便打印报告', category: '生活', priority: 'low', date: null });
  add({ title: '整理桌面', date: null });

  let view = allView(store.getState(), { search: '报告', category: '', priority: '' }, NOW);
  assert.deepEqual(view.scheduled.map((item) => item.title), ['提交报告']);
  assert.deepEqual(view.unscheduled.map((item) => item.title), ['买菜']);

  view = allView(store.getState(), { search: '报告', category: '工作', priority: 'high' }, NOW);
  assert.deepEqual(view.scheduled.map((item) => item.title), ['提交报告']);
  assert.equal(view.unscheduled.length, 0);

  view = allView(store.getState(), { search: '', category: '', priority: 'none' }, NOW);
  assert.deepEqual(view.unscheduled.map((item) => item.title), ['整理桌面']);
  assert.equal(view.scheduled.length, 0);

  view = allView(store.getState(), { search: '不存在', category: '', priority: '' }, NOW);
  assert.equal(view.total, 0);
  assert.equal(view.hasAny, true);
});

test('全部页未排期事项按创建时间从近到远', () => {
  const { store, add } = setup();
  add({ title: '较早', date: null });
  add({ title: '较晚', date: null });
  add({ title: '最新', date: null });
  const view = allView(store.getState(), {}, NOW);
  assert.deepEqual(view.unscheduled.map((item) => item.title), ['最新', '较晚', '较早']);
});

test('全部页重复事项只显示每组最早的一次', () => {
  const { store, add } = setup();
  add({ title: '房租', date: '2027-01-31', repeat: 'monthly' });
  const seriesId = store.getState().series[0].id;
  store.complete(`series:${seriesId}:2027-01-31`);

  const view = allView(store.getState(), {}, NOW);
  assert.equal(view.scheduled.length, 1);
  assert.equal(view.scheduled[0].title, '房租');
  assert.equal(view.scheduled[0].date, '2027-02-28');
});

test('已排期事项同一天先显示全天事项', () => {
  const { store, add } = setup();
  add({ title: '上午', date: '2026-11-24', startTime: '09:00' });
  add({ title: '全天', date: '2026-11-24' });
  add({ title: '更早一天', date: '2026-11-23', startTime: '18:00' });
  const view = allView(store.getState(), {}, NOW);
  assert.deepEqual(view.scheduled.map((item) => item.title), ['更早一天', '全天', '上午']);
});

test('已完成页按完成时间从近到远', () => {
  const { store, add, setClock } = setup();
  const first = add({ title: '先完成', date: '2026-11-22' });
  const second = add({ title: '后完成', date: '2026-11-23' });
  setClock(2000);
  store.complete(first);
  setClock(3000);
  store.complete(second);
  const entries = completedView(store.getState());
  assert.deepEqual(entries.map((item) => item.title), ['后完成', '先完成']);
});

test('月历包含已完成事项，排除已删除的单次安排', () => {
  const { store, add } = setup();
  const doneKey = add({ title: '已完成事项', date: '2026-11-20' });
  store.complete(doneKey);
  add({ title: '普通事项', date: '2026-11-23', startTime: '10:00' });
  add({ title: '每天打卡', date: '2026-11-23', repeat: 'daily' });
  const seriesId = store.getState().series[0].id;
  store.remove(`series:${seriesId}:2026-11-24`, 'one');

  const cells = monthGrid(2026, 10);
  const view = calendarView(store.getState(), 2026, 10, cells);
  const day20 = view.byDate.get('2026-11-20');
  assert.equal(day20[0].completedAt > 0, true);
  const day23 = view.byDate.get('2026-11-23').map((item) => item.title);
  assert.deepEqual(day23, ['每天打卡', '普通事项']);
  const day24 = view.byDate.get('2026-11-24').map((item) => item.title);
  assert.equal(day24.includes('每天打卡'), false);

  const day = dayView(store.getState(), '2026-11-23');
  assert.deepEqual(day.map((item) => item.title), ['每天打卡', '普通事项']);
});

test('提醒候选只包含未完成且有提醒的安排', () => {
  const { store, add } = setup();
  add({ title: '有提醒', date: '2026-11-23', startTime: '18:00', reminder: '10m' });
  add({ title: '无提醒', date: '2026-11-23', startTime: '18:00' });
  const completed = add({ title: '已完成', date: '2026-11-23', startTime: '18:00', reminder: 'start' });
  store.complete(completed);

  const candidates = reminderCandidates(store.getState(), '2026-11-22', '2026-11-24');
  assert.deepEqual(candidates.map((item) => item.title), ['有提醒']);
});
