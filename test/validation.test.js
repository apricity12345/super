import test from 'node:test';
import assert from 'node:assert/strict';

import { draftFromValue, emptyDraft, validateDraft } from '../js/validation.js';

function draft(overrides = {}) {
  return { ...emptyDraft(), ...overrides };
}

test('标题必填，只输入空格也视为空', () => {
  const result = validateDraft(draft({ title: '   ' }));
  assert.equal(result.ok, false);
  assert.match(result.errors.title, /标题/);
  assert.equal(validateDraft(draft({ title: '事项' })).ok, true);
});

test('标题保存时去掉首尾空格', () => {
  const result = validateDraft(draft({ title: '  写周报  ' }));
  assert.equal(result.value.title, '写周报');
});

test('结束时间必须晚于开始时间', () => {
  let result = validateDraft(
    draft({ title: '会议', date: '2026-11-23', startTime: '10:00', endTime: '09:00' }),
  );
  assert.match(result.errors.endTime, /晚于/);
  result = validateDraft(
    draft({ title: '会议', date: '2026-11-23', startTime: '10:00', endTime: '10:00' }),
  );
  assert.match(result.errors.endTime, /晚于/);
  result = validateDraft(
    draft({ title: '会议', date: '2026-11-23', startTime: '10:00', endTime: '11:00' }),
  );
  assert.equal(result.ok, true);
});

test('设置时间、重复和提醒的前置条件', () => {
  let result = validateDraft(draft({ title: '事项', startTime: '10:00' }));
  assert.match(result.errors.date, /选择日期/);

  result = validateDraft(draft({ title: '事项', date: '2026-11-23', endTime: '10:00' }));
  assert.match(result.errors.startTime, /开始时间/);

  result = validateDraft(draft({ title: '事项', repeat: 'daily' }));
  assert.match(result.errors.repeat, /选择日期/);

  result = validateDraft(draft({ title: '事项', reminder: 'start' }));
  assert.match(result.errors.reminder, /开始时间/);
});

test('仅修改本次重复安排时不能改变重复规则', () => {
  const result = validateDraft(
    draft({ title: '房租', date: '2027-02-28', repeat: 'weekly' }),
    { isRecurringOccurrence: true, scope: 'one', currentRepeat: 'monthly' },
  );
  assert.equal(result.ok, false);
  assert.match(result.errors.repeat, /仅修改本次/);

  const future = validateDraft(
    draft({ title: '房租', date: '2027-02-28', repeat: 'weekly' }),
    { isRecurringOccurrence: true, scope: 'future', currentRepeat: 'monthly' },
  );
  assert.equal(future.ok, true);
});

test('备注保留多行，分类去首尾空格', () => {
  const result = validateDraft(
    draft({ title: '事项', notes: '第一行\n第二行', category: '  工作  ' }),
  );
  assert.equal(result.value.notes, '第一行\n第二行');
  assert.equal(result.value.category, '工作');
});

test('draftFromValue 补全可编辑字段', () => {
  const value = draftFromValue({
    title: '标题',
    notes: '备注',
    date: '2026-11-23',
    startTime: '09:00',
    endTime: '10:00',
    category: '工作',
    priority: 'high',
    repeat: 'daily',
    reminder: 'start',
  });
  assert.equal(value.repeat, 'daily');
  assert.equal(value.priority, 'high');
});
