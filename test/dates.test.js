import test from 'node:test';
import assert from 'node:assert/strict';

import {
  addDays,
  combineDateTime,
  formatTimeRange,
  isDateKey,
  isTimeKey,
  monthGrid,
  relativeDateLabel,
  toDateKey,
  weekday,
} from '../js/dates.js';

test('addDays 跨月与跨年', () => {
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2027-03-01', -1), '2027-02-28');
});

test('isDateKey / isTimeKey 校验', () => {
  assert.equal(isDateKey('2026-11-23'), true);
  assert.equal(isDateKey('2026-02-30'), false);
  assert.equal(isDateKey('2026-1-3'), false);
  assert.equal(isTimeKey('09:05'), true);
  assert.equal(isTimeKey('24:00'), false);
  assert.equal(isTimeKey('9:05'), false);
});

test('本地日期与时间组合', () => {
  const date = combineDateTime('2026-11-23', '09:30');
  assert.equal(date.getFullYear(), 2026);
  assert.equal(date.getMonth(), 10);
  assert.equal(date.getDate(), 23);
  assert.equal(date.getHours(), 9);
  assert.equal(date.getMinutes(), 30);
});

test('monthGrid 周一开头且补齐 42 天', () => {
  const cells = monthGrid(2026, 10); // 2026 年 11 月
  assert.equal(cells.length, 42);
  assert.equal(cells[0].key, '2026-10-26');
  assert.equal(cells[0].outside, true);
  assert.equal(cells[6].key, '2026-11-01');
  assert.equal(cells[6].outside, false);
  assert.equal(weekday('2026-11-01'), 0);
  assert.equal(toDateKey(new Date(2026, 10, 23)), '2026-11-23');
});

test('相对日期标签', () => {
  const now = new Date(2026, 10, 23, 10, 0);
  assert.equal(relativeDateLabel('2026-11-23', now), '今天');
  assert.equal(relativeDateLabel('2026-11-24', now), '明天');
  assert.equal(relativeDateLabel('2026-11-22', now), '昨天');
  assert.match(relativeDateLabel('2026-11-30', now), /^11月30日 周一$/);
});

test('时间范围展示', () => {
  assert.equal(formatTimeRange(null, null), '全天');
  assert.equal(formatTimeRange('09:00', null), '09:00');
  assert.equal(formatTimeRange('09:00', '10:30'), '09:00–10:30');
});
