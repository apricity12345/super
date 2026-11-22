/** 表单校验与选项定义。纯函数，便于单元测试。 */

import { isDateKey, isTimeKey } from './dates.js';
import { REPEAT_VALUES } from './recurrence.js';

export const PRIORITY_VALUES = ['high', 'medium', 'low'];
export const PRIORITY_LABELS = { high: '高', medium: '中', low: '低' };
export const REMINDER_VALUES = ['start', '10m', '60m'];
export const REMINDER_LABELS = {
  start: '开始时',
  '10m': '提前 10 分钟',
  '60m': '提前 1 小时',
};

export const EMPTY_ERRORS = {
  title: '',
  date: '',
  startTime: '',
  endTime: '',
  repeat: '',
  reminder: '',
};

export function emptyDraft() {
  return {
    title: '',
    notes: '',
    date: '',
    startTime: '',
    endTime: '',
    category: '',
    priority: '',
    repeat: '',
    reminder: '',
  };
}

export function draftFromValue(value) {
  return {
    title: value.title || '',
    notes: value.notes || '',
    date: value.date || '',
    startTime: value.startTime || '',
    endTime: value.endTime || '',
    category: value.category || '',
    priority: value.priority || '',
    repeat: value.repeat || '',
    reminder: value.reminder || '',
  };
}

/**
 * 校验表单草稿。返回 `{ ok, errors, value }`，value 为规范化后的数据。
 * repeat 不属于单次事项的持久字段，由调用方决定如何保存。
 */
export function validateDraft(draft, options = {}) {
  const errors = { ...EMPTY_ERRORS };
  const title = (draft.title || '').trim();
  const date = draft.date || '';
  const startTime = draft.startTime || '';
  const endTime = draft.endTime || '';
  const repeat = draft.repeat || '';
  const reminder = draft.reminder || '';
  const priority = draft.priority || '';

  if (!title) errors.title = '请输入标题（不能只填空格）';
  if (date && !isDateKey(date)) errors.date = '日期格式不正确';
  if (startTime && !isTimeKey(startTime)) errors.startTime = '开始时间格式不正确';
  if (endTime && !isTimeKey(endTime)) errors.endTime = '结束时间格式不正确';

  if (!date && (startTime || endTime)) {
    errors.date = '设置时间前请先选择日期';
  }
  if (!startTime && endTime) {
    errors.startTime = '请先填写开始时间';
  }
  if (startTime && endTime && startTime >= endTime) {
    errors.endTime = '结束时间须晚于开始时间';
  }
  if (!date && repeat) {
    errors.repeat = '设置重复前请先选择日期';
  }
  if (!startTime && reminder) {
    errors.reminder = '设置提醒前请先填写开始时间';
  }
  if (repeat && !REPEAT_VALUES.includes(repeat)) errors.repeat = '重复方式不可用';
  if (reminder && !REMINDER_VALUES.includes(reminder)) errors.reminder = '提醒方式不可用';
  if (priority && !PRIORITY_VALUES.includes(priority)) errors.priority = '优先级不可用';

  if (options.isRecurringOccurrence && options.scope !== 'future') {
    // 仅本次修改不能改变整个系列的重复规则。
    if (repeat !== (options.currentRepeat || '')) {
      errors.repeat = '仅修改本次时不能更改重复规则，请选择「本次及以后」';
    }
  }

  const value = {
    title,
    notes: (draft.notes || '').replace(/\s+$/, ''),
    date: date || null,
    startTime: startTime || null,
    endTime: endTime || null,
    category: (draft.category || '').trim(),
    priority: priority || null,
    reminder: startTime ? reminder || null : null,
  };

  return {
    ok: !Object.values(errors).some(Boolean),
    errors,
    value: { ...value, repeat: repeat || null },
  };
}
