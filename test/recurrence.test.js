import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildOccurrence,
  earliestPendingOccurrence,
  isOccurrenceOn,
  occurrencesBetween,
  occurrencesUpTo,
  previousOccurrenceBefore,
  recurrenceLabel,
  reminderTriggerMs,
  nextOccurrenceAfter,
} from '../js/recurrence.js';
import { combineDateTime } from '../js/dates.js';
import { makeSeries } from './helpers.js';

test('每月重复：1 月 31 日依次落在 2 月 28 日和 3 月 31 日', () => {
  const series = makeSeries();
  const dates = occurrencesBetween(series, '2027-01-01', '2027-04-30').map((item) => item.date);
  assert.deepEqual(dates, ['2027-01-31', '2027-02-28', '2027-03-31', '2027-04-30']);
  assert.equal(recurrenceLabel(series), '每月31日');
});

test('每周重复按首次日期的星期几', () => {
  const series = makeSeries({ startDate: '2026-11-23', repeat: 'weekly' });
  const dates = occurrencesBetween(series, '2026-11-23', '2026-12-14').map((item) => item.date);
  assert.deepEqual(dates, [
    '2026-11-23',
    '2026-11-30',
    '2026-12-07',
    '2026-12-14',
  ]);
  assert.equal(recurrenceLabel(series), '每周一');
});

test('每天重复遵守结束日期', () => {
  const series = makeSeries({
    startDate: '2026-11-23',
    repeat: 'daily',
    endDate: '2026-11-25',
  });
  assert.deepEqual(
    occurrencesBetween(series, '2026-11-20', '2026-11-30').map((item) => item.date),
    ['2026-11-23', '2026-11-24', '2026-11-25'],
  );
});

test('仅删除单次安排不影响后续', () => {
  const series = makeSeries({
    overrides: { '2027-02-28': { deleted: true } },
  });
  const dates = occurrencesBetween(series, '2027-02-01', '2027-03-31').map((item) => item.date);
  assert.deepEqual(dates, ['2027-03-31']);
  assert.equal(buildOccurrence(series, '2027-02-28'), null);
});

test('单次改期按新日期出现在月历区间，原日期不再出现', () => {
  const series = makeSeries({
    overrides: {
      '2027-02-28': { fields: { date: '2027-02-15', title: '改期后的房租' } },
    },
  });
  const february = occurrencesBetween(series, '2027-02-01', '2027-02-28');
  assert.equal(february.length, 1);
  assert.equal(february[0].date, '2027-02-15');
  assert.equal(february[0].title, '改期后的房租');
});

test('单次改期到较早区间也能被展开', () => {
  const series = makeSeries({
    overrides: {
      '2027-02-28': { fields: { date: '2027-01-15' } },
    },
  });
  const january = occurrencesBetween(series, '2027-01-01', '2027-01-31');
  assert.deepEqual(january.map((item) => item.date), ['2027-01-15', '2027-01-31']);
});

test('「全部」取每个系列最早的未完成安排', () => {
  const series = makeSeries({
    overrides: {
      '2027-01-31': { completedAt: 3000 },
      '2027-02-28': { completedAt: 4000 },
    },
  });
  const next = earliestPendingOccurrence(series, '2027-12-31');
  assert.equal(next.date, '2027-03-31');
});

test('到扫描范围都完成时续接下一次安排', () => {
  const overrides = {};
  for (const date of ['2027-01-31', '2027-02-28', '2027-03-31']) {
    overrides[date] = { completedAt: 5000 };
  }
  const series = makeSeries({ overrides });
  const next = earliestPendingOccurrence(series, '2027-03-31');
  assert.equal(next.date, '2027-04-30');
});

test('前一次/后一次安排与改期无关', () => {
  const series = makeSeries();
  assert.equal(previousOccurrenceBefore(series, '2027-03-31'), '2027-02-28');
  assert.equal(previousOccurrenceBefore(series, '2027-01-31'), null);
  assert.equal(nextOccurrenceAfter(series, '2027-02-28'), '2027-03-31');
});

test('截止到今天的展开包含未来安排改期到今天', () => {
  const series = makeSeries({
    startDate: '2026-11-30',
    repeat: 'weekly',
    overrides: {
      '2026-12-07': { fields: { date: '2026-11-23' } },
    },
  });
  const dates = occurrencesUpTo(series, '2026-11-23').map((item) => item.date);
  assert.deepEqual(dates, ['2026-11-23']);
});

test('提醒触发时间按开始时/提前 10 分钟/提前 1 小时计算', () => {
  const base = combineDateTime('2027-01-31', '09:00').getTime();
  assert.equal(
    reminderTriggerMs(buildOccurrence(makeSeries({ startTime: '09:00', reminder: 'start' }), '2027-01-31')),
    base,
  );
  assert.equal(
    reminderTriggerMs(buildOccurrence(makeSeries({ startTime: '09:00', reminder: '10m' }), '2027-01-31')),
    base - 10 * 60 * 1000,
  );
  assert.equal(
    reminderTriggerMs(buildOccurrence(makeSeries({ startTime: '09:00', reminder: '60m' }), '2027-01-31')),
    base - 60 * 60 * 1000,
  );
  assert.equal(
    reminderTriggerMs(buildOccurrence(makeSeries({ startTime: null, reminder: 'start' }), '2027-01-31')),
    null,
  );
});

test('每月重复的判断规则', () => {
  const series = makeSeries();
  assert.equal(isOccurrenceOn(series, '2027-02-28'), true);
  assert.equal(isOccurrenceOn(series, '2027-02-27'), false);
  assert.equal(isOccurrenceOn(series, '2027-03-31'), true);
  assert.equal(isOccurrenceOn(series, '2027-03-30'), false);
});
