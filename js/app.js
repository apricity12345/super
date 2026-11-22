import {
  addDays,
  formatDateLabel,
  formatDateShort,
  formatFullTimestamp,
  formatMonthTitle,
  formatTimeRange,
  formatTimestamp,
  isDateKey,
  monthGrid,
  pad2,
  relativeDateLabel,
  todayKey,
  WEEKDAY_INITIALS,
} from './dates.js';
import { recurrenceHint, recurrenceLabel, reminderTriggerMs } from './recurrence.js';
import { createStore } from './store.js';
import {
  allView,
  calendarView,
  collectCategories,
  completedView,
  dayView,
  isOverdue,
  occurrenceFor,
  reminderCandidates,
  todayView,
} from './queries.js';
import {
  draftFromValue,
  emptyDraft,
  PRIORITY_LABELS,
  REMINDER_LABELS,
  validateDraft,
} from './validation.js';

const store = createStore({ storage: window.localStorage });
const ui = {
  filters: { search: '', category: '', priority: '' },
};
const modal = {
  current: null,
  ctx: null,
  lastFocused: null,
};
const firedReminders = new Set();
const loadedAt = Date.now();
const app = document.getElementById('app');
const modalRoot = document.getElementById('modal-root');

init();

function init() {
  const notice = store.getLoadNotice();
  if (notice) {
    const banner = document.getElementById('storage-warning');
    banner.textContent = notice;
    banner.hidden = false;
  }

  window.addEventListener('hashchange', () => {
    if (modal.current) closeModal();
    render();
  });
  document.addEventListener('click', onClick);
  document.addEventListener('input', onInput);
  document.addEventListener('change', onChange);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('keydown', onKeydown);

  render();
  window.setInterval(checkReminders, 10000);
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

function getRoute() {
  const raw = (window.location.hash || '').replace(/^#\/?/, '');
  const parts = raw.split('/').filter(Boolean);
  const page = ['today', 'all', 'calendar', 'completed'].includes(parts[0]) ? parts[0] : 'today';
  if (page !== 'calendar') return { page };

  const now = new Date();
  let year = now.getFullYear();
  let month = now.getMonth();
  let explicitMonth = false;
  if (/^\d{4}-\d{2}$/.test(parts[1] || '')) {
    const [candidateYear, candidateMonth] = parts[1].split('-').map(Number);
    if (candidateYear >= 1970 && candidateYear <= 2100 && candidateMonth >= 1 && candidateMonth <= 12) {
      year = candidateYear;
      month = candidateMonth - 1;
      explicitMonth = true;
    }
  }
  let selected = null;
  const candidateDate = parts[2] || '';
  if (
    isDateKey(candidateDate) &&
    candidateDate.startsWith(`${year}-${pad2(month + 1)}`)
  ) {
    selected = candidateDate;
  }
  if (!explicitMonth && !selected) selected = todayKey();
  return { page, year, month, selected, explicitMonth };
}

function navigate(path) {
  const hash = `#${path}`;
  if (window.location.hash === hash) render();
  else window.location.hash = hash;
}

function render() {
  const route = getRoute();
  document.querySelectorAll('[data-nav]').forEach((link) => {
    const active = link.dataset.nav === route.page;
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  if (route.page === 'today') app.innerHTML = todayPage();
  else if (route.page === 'all') app.innerHTML = allPage();
  else if (route.page === 'calendar') app.innerHTML = calendarPage(route);
  else app.innerHTML = completedPage();

  const titles = { today: '今天', all: '全部', calendar: '月历', completed: '已完成' };
  document.title = `${titles[route.page]} · 我的待办`;
}

/* ------------------------------------------------------------------ */
/* 页面：今天                                                          */
/* ------------------------------------------------------------------ */

function todayPage() {
  const data = todayView(store.getState(), new Date());
  const total = data.overdue.length + data.today.length;
  let body = '';
  if (total === 0) {
    body = emptyState({
      icon: '☀',
      title: '今天没有待办',
      text: '记下一件事，今天从容一点。也可以去「全部」看看后面的安排。',
      actionLabel: '新增事项',
      actionAttrs: 'data-action="add" data-source="today"',
    });
  } else {
    if (data.overdue.length) body += sectionHtml('逾期', data.overdue, { overdue: true });
    if (data.today.length) body += sectionHtml('今天', data.today);
  }

  return `
    <div class="page-head">
      <div>
        <h1>今天</h1>
        <p class="page-sub">${escapeHtml(formatDateLabel(data.todayKey))}${
          total ? ` · 还有 ${total} 项待处理` : ' · 一切就绪'
        }</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" type="button" data-action="add" data-source="today">＋ 新增事项</button>
      </div>
    </div>
    ${body}
  `;
}

/* ------------------------------------------------------------------ */
/* 页面：全部                                                          */
/* ------------------------------------------------------------------ */

function allPage() {
  const data = allView(store.getState(), ui.filters, new Date());
  const categoryOptions = ['', ...data.categories];
  if (ui.filters.category && !categoryOptions.includes(ui.filters.category)) {
    categoryOptions.push(ui.filters.category);
  }
  return `
    <div class="page-head">
      <div>
        <h1>全部</h1>
        <p class="page-sub">所有未完成事项。重复事项显示每组中最早的一次。</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" type="button" data-action="add" data-source="all">＋ 新增事项</button>
      </div>
    </div>

    <div class="filter-bar" role="search">
      <div class="search-field">
        <span class="search-icon" aria-hidden="true">⌕</span>
        <label class="sr-only" for="search-input">搜索标题或备注</label>
        <input id="search-input" type="search" data-filter="search" placeholder="搜索标题或备注" value="${escapeAttr(
          ui.filters.search,
        )}" autocomplete="off" />
      </div>
      <label class="sr-only" for="filter-category">按分类筛选</label>
      <select id="filter-category" data-filter="category">
        <option value="">全部分类</option>
        ${categoryOptions
          .filter(Boolean)
          .map(
            (category) =>
              `<option value="${escapeAttr(category)}"${
                category === ui.filters.category ? ' selected' : ''
              }>${escapeHtml(category)}</option>`,
          )
          .join('')}
      </select>
      <label class="sr-only" for="filter-priority">按优先级筛选</label>
      <select id="filter-priority" data-filter="priority">
        <option value="">全部优先级</option>
        <option value="high"${ui.filters.priority === 'high' ? ' selected' : ''}>高优先级</option>
        <option value="medium"${ui.filters.priority === 'medium' ? ' selected' : ''}>中优先级</option>
        <option value="low"${ui.filters.priority === 'low' ? ' selected' : ''}>低优先级</option>
        <option value="none"${ui.filters.priority === 'none' ? ' selected' : ''}>无优先级</option>
      </select>
      <button class="btn btn-ghost" type="button" data-action="clear-filters" ${
        hasFilters() ? '' : 'disabled'
      }>清除筛选</button>
    </div>

    <div id="all-results">${allResultsHtml()}</div>
  `;
}

function hasFilters() {
  return Boolean(ui.filters.search || ui.filters.category || ui.filters.priority);
}

function allResultsHtml() {
  const data = allView(store.getState(), ui.filters, new Date());
  if (!data.hasAny) {
    return emptyState({
      icon: '≡',
      title: '还没有待办事项',
      text: '先记下一件事，之后可以随时补充日期、时间和备注。',
      actionLabel: '新增事项',
      actionAttrs: 'data-action="add" data-source="all"',
    });
  }
  if (data.total === 0) {
    return emptyState({
      icon: '⌕',
      title: '没有匹配的事项',
      text: '试试其他关键词或筛选条件。',
      actionLabel: '清除筛选',
      actionAttrs: 'data-action="clear-filters"',
    });
  }
  let html = `<p class="result-count">${data.total} 项未完成${
    data.hasFilters ? ` · 筛选自 ${data.totalUnfiltered} 项` : ''
  }</p>`;
  if (data.scheduled.length) html += sectionHtml('已排期', data.scheduled);
  if (data.unscheduled.length) html += sectionHtml('未排期', data.unscheduled);
  return html;
}

/* ------------------------------------------------------------------ */
/* 页面：月历                                                          */
/* ------------------------------------------------------------------ */

function calendarPage(route) {
  const cells = monthGrid(route.year, route.month);
  const view = calendarView(store.getState(), route.year, route.month, cells);
  const selected = route.selected;
  const dayItems = selected ? dayView(store.getState(), selected) : [];
  const monthKey = `${route.year}-${pad2(route.month + 1)}`;
  return `
    <div class="page-head">
      <div>
        <h1>月历</h1>
        <p class="page-sub">查看每一天的安排，点击日期查看当天事项。已完成事项也会保留。</p>
      </div>
      <div class="head-actions">
        <button class="btn btn-primary" type="button" data-action="add" data-source="calendar"${
          selected ? ` data-date="${selected}"` : ''
        }>＋ 新增事项</button>
      </div>
    </div>

    <div class="calendar-layout">
      <section class="card calendar-card" aria-label="月历">
        <div class="calendar-toolbar">
          <div>
            <h2>${formatMonthTitle(route.year, route.month)}</h2>
            <p>本月 ${view.count} 项安排</p>
          </div>
          <div class="calendar-nav">
            <button class="btn btn-ghost btn-sm" type="button" data-action="calendar-prev" aria-label="上个月">‹ 上月</button>
            <button class="btn btn-ghost btn-sm" type="button" data-action="calendar-today">今天</button>
            <button class="btn btn-ghost btn-sm" type="button" data-action="calendar-next" aria-label="下个月">下月 ›</button>
          </div>
        </div>
        <div class="weekdays" aria-hidden="true">
          ${WEEKDAY_INITIALS.map((label) => `<span>${label}</span>`).join('')}
        </div>
        <div class="calendar-grid" role="group" aria-label="${escapeAttr(
          `${formatMonthTitle(route.year, route.month)}的安排`,
        )}">
          ${cells.map((cell) => calendarCell(cell, view.byDate.get(cell.key) || [], route, selected)).join('')}
        </div>
      </section>
      ${selected ? dayPanel(selected, dayItems) : emptyDayPanel(monthKey)}
    </div>
  `;
}

function calendarCell(cell, items, route, selected) {
  const today = todayKey();
  const isToday = cell.key === today;
  const isSelected = cell.key === selected;
  const shown = items.slice(0, 2);
  const more = items.length - shown.length;
  const classNames = ['day-cell'];
  if (cell.outside) classNames.push('outside');
  if (isToday) classNames.push('is-today');
  if (isSelected) classNames.push('is-selected');
  if (items.length) classNames.push('has-items');
  const label = `${formatDateShort(cell.key)}，${items.length} 项安排`;
  return `
    <div class="${classNames.join(' ')}" data-action="select-date" data-date="${cell.key}">
      <button class="day-number" type="button" data-action="select-date" data-date="${cell.key}" aria-label="${escapeAttr(
        label,
      )}"${isToday ? ' aria-current="date"' : ''}>
        <span class="day-num">${cell.day}</span>
        ${isToday ? '<span class="today-label">今天</span>' : ''}
      </button>
      ${
        shown.length
          ? `<ul class="mini-list">${shown
              .map((occurrence) => miniItemHtml(occurrence))
              .join('')}</ul>`
          : ''
      }
      ${
        more > 0
          ? `<button class="more-items" type="button" data-action="select-date" data-date="${cell.key}">+${more} 项</button>`
          : ''
      }
    </div>
  `;
}

function miniItemHtml(occurrence) {
  const done = Boolean(occurrence.completedAt);
  const overdue = !done && isOverdue(occurrence, new Date());
  const classes = ['mini-item'];
  if (done) classes.push('is-done');
  else if (overdue) classes.push('is-overdue');
  const time = occurrence.startTime
    ? `<span class="mini-time">${occurrence.startTime}</span> `
    : '';
  const label = `${done ? '已完成：' : overdue ? '已逾期：' : ''}${occurrence.title}${
    occurrence.startTime ? `，${occurrence.startTime}` : ''
  }`;
  return `<li><button class="${classes.join(
    ' ',
  )}" type="button" data-action="open" data-key="${escapeAttr(occurrence.key)}" title="${escapeAttr(
    occurrence.title,
  )}" aria-label="${escapeAttr(label)}">${done ? '✓ ' : ''}${time}${escapeHtml(
    occurrence.title,
  )}</button></li>`;
}

function dayPanel(dateKey, items) {
  const isToday = dateKey === todayKey();
  return `
    <aside class="card day-panel" aria-label="当天事项">
      <div class="day-panel-head">
        <div>
          <p class="modal-kicker">${isToday ? '今天' : '当天安排'}</p>
          <h2>${escapeHtml(formatDateLabel(dateKey))}</h2>
        </div>
        <button class="btn btn-primary btn-sm" type="button" data-action="add" data-source="calendar" data-date="${dateKey}">＋ 添加</button>
      </div>
      ${
        items.length
          ? `<ul class="item-list">${items
              .map((occurrence) => itemHtml(occurrence, { context: 'calendar' }))
              .join('')}</ul>`
          : `<div class="calendar-empty">这一天还没有安排。<br /><button class="btn btn-ghost btn-sm" type="button" data-action="add" data-source="calendar" data-date="${dateKey}">新增事项</button></div>`
      }
    </aside>
  `;
}

function emptyDayPanel(monthKey) {
  return `
    <aside class="card day-panel" aria-label="当天事项">
      <div class="calendar-empty">
        点击左侧日期查看当天安排。<br />
        <button class="btn btn-ghost btn-sm" type="button" data-action="add" data-source="calendar" data-date="${monthKey}-01">新增事项</button>
      </div>
    </aside>
  `;
}

/* ------------------------------------------------------------------ */
/* 页面：已完成                                                        */
/* ------------------------------------------------------------------ */

function completedPage() {
  const entries = completedView(store.getState());
  return `
    <div class="page-head">
      <div>
        <h1>已完成</h1>
        <p class="page-sub">按完成时间从近到远排列${
          entries.length ? ` · 共 ${entries.length} 项` : ''
        }</p>
      </div>
      <div class="head-actions">
        <a class="btn btn-ghost" href="#/today">回到今天</a>
      </div>
    </div>
    ${
      entries.length
        ? `<ul class="item-list">${entries
            .map((occurrence) => itemHtml(occurrence, { context: 'completed', showDelete: true }))
            .join('')}</ul>`
        : emptyState({
            icon: '✓',
            title: '还没有完成的事项',
            text: '完成待办后，会按完成时间记录在这里，也可以随时恢复为待办。',
            actionLabel: '回到今天',
            actionHref: '#/today',
          })
    }
  `;
}

/* ------------------------------------------------------------------ */
/* 事项行                                                              */
/* ------------------------------------------------------------------ */

function sectionHtml(title, list, options = {}) {
  return `
    <section class="section${options.overdue ? ' section-overdue' : ''}">
      <div class="section-head">
        <h2>${escapeHtml(title)}</h2>
        <span class="count">${list.length}</span>
      </div>
      ${itemsList(list, options)}
    </section>
  `;
}

function itemsList(list, options = {}) {
  return `<ul class="item-list">${list
    .map((occurrence) => itemHtml(occurrence, options))
    .join('')}</ul>`;
}

function itemHtml(occurrence, options = {}) {
  const done = Boolean(occurrence.completedAt);
  const overdue = !done && isOverdue(occurrence, new Date());
  const context = options.context || 'all';
  const metaParts = [];

  if (done) {
    metaParts.push('<span class="status-label done">✓ 已完成</span>');
  } else if (overdue) {
    metaParts.push('<span class="status-label overdue">已逾期</span>');
  }

  if (options.context === 'completed' && done) {
    metaParts.push(`<span>完成于 ${escapeHtml(formatTimestamp(occurrence.completedAt))}</span>`);
  }

  if (occurrence.date) {
    metaParts.push(`<span>${escapeHtml(relativeDateLabel(occurrence.date))}</span>`);
    metaParts.push(`<span>${escapeHtml(formatTimeRange(occurrence.startTime, occurrence.endTime))}</span>`);
  } else {
    metaParts.push('<span>未排期</span>');
  }

  if (occurrence.priority) {
    metaParts.push(
      `<span class="badge priority-${occurrence.priority}">${PRIORITY_LABELS[occurrence.priority]}优先级</span>`,
    );
  }
  if (occurrence.category) {
    metaParts.push(`<span class="badge">${escapeHtml(occurrence.category)}</span>`);
  }
  if (occurrence.isRecurring) {
    metaParts.push(
      `<span class="badge repeat">↻ ${escapeHtml(
        recurrenceLabel({ repeat: occurrence.repeat, startDate: occurrence.seriesStartDate }),
      )}</span>`,
    );
  }
  if (occurrence.reminder) {
    metaParts.push(
      `<span class="badge reminder">提醒 · ${REMINDER_LABELS[occurrence.reminder]}</span>`,
    );
  }

  const metaHtml = metaParts.reduce(
    (html, part, index) =>
      `${html}${index ? '<span class="meta-sep" aria-hidden="true">·</span>' : ''}${part}`,
    '',
  );

  const notesPreview = occurrence.notes
    ? `<span class="item-notes">${escapeHtml(occurrence.notes.replace(/\s+/g, ' ').slice(0, 90))}</span>`
    : '';

  const side = options.showDelete && done
    ? `<span class="item-side"><span class="item-actions"><button class="btn btn-sm btn-soft-danger" type="button" data-action="delete" data-key="${escapeAttr(
        occurrence.key,
      )}" aria-label="删除事项：${escapeAttr(occurrence.title)}">删除</button></span></span>`
    : '<span class="item-side"></span>';

  return `
    <li class="item${done ? ' is-done' : ''}${overdue ? ' is-overdue' : ''}" data-context="${context}">
      <button class="item-check" type="button" data-action="toggle" data-key="${escapeAttr(
        occurrence.key,
      )}" aria-pressed="${done}" aria-label="${
        done ? '恢复为待办' : '标记完成'
      }：${escapeAttr(occurrence.title)}">
        <span aria-hidden="true">${done ? '✓' : ''}</span>
      </button>
      <button class="item-main" type="button" data-action="open" data-key="${escapeAttr(
        occurrence.key,
      )}">
        <span class="item-title-row"><span class="item-title">${escapeHtml(
          occurrence.title,
        )}</span></span>
        <span class="item-meta">${metaHtml}</span>
        ${notesPreview}
      </button>
      ${side}
    </li>
  `;
}

/* ------------------------------------------------------------------ */
/* 空状态                                                              */
/* ------------------------------------------------------------------ */

function emptyState({ icon = '✓', title, text, actionLabel, actionAttrs = '', actionHref = '' }) {
  const action = actionHref
    ? `<a class="btn btn-primary" href="${escapeAttr(actionHref)}">${escapeHtml(actionLabel)}</a>`
    : actionLabel
      ? `<button class="btn btn-primary" type="button" ${actionAttrs}>${escapeHtml(actionLabel)}</button>`
      : '';
  return `
    <div class="empty-state">
      <div class="empty-icon" aria-hidden="true">${icon}</div>
      <h2>${escapeHtml(title)}</h2>
      <p>${escapeHtml(text)}</p>
      ${action}
    </div>
  `;
}

/* ------------------------------------------------------------------ */
/* 事件分发                                                            */
/* ------------------------------------------------------------------ */

function onClick(event) {
  const actionEl = event.target.closest('[data-action]');
  if (!actionEl) return;
  const action = actionEl.dataset.action;

  if (action === 'backdrop-close') {
    if (event.target === actionEl) closeModal();
    return;
  }

  switch (action) {
    case 'add':
      event.preventDefault();
      handleAdd(actionEl);
      break;
    case 'close-modal':
      event.preventDefault();
      closeModal();
      break;
    case 'open':
      event.preventDefault();
      openDetail(actionEl.dataset.key);
      break;
    case 'toggle':
      event.preventDefault();
      toggleOccurrence(actionEl.dataset.key);
      break;
    case 'edit':
      event.preventDefault();
      openEditModal(actionEl.dataset.key);
      break;
    case 'delete':
      event.preventDefault();
      openDeleteConfirm(actionEl.dataset.key, modal.current === 'detail' ? 'detail' : 'page');
      break;
    case 'confirm-delete':
      event.preventDefault();
      performDelete();
      break;
    case 'cancel-delete': {
      event.preventDefault();
      const { from, key } = modal.ctx || {};
      if (from === 'detail' && key) openDetail(key);
      else closeModal();
      break;
    }
    case 'retry-save':
      event.preventDefault();
      document.getElementById('item-form')?.requestSubmit();
      break;
    case 'calendar-prev':
      shiftMonth(-1);
      break;
    case 'calendar-next':
      shiftMonth(1);
      break;
    case 'calendar-today': {
      const key = todayKey();
      navigate(`/calendar/${key.slice(0, 7)}/${key}`);
      break;
    }
    case 'select-date': {
      const dateKey = actionEl.dataset.date;
      if (isDateKey(dateKey)) navigate(`/calendar/${dateKey.slice(0, 7)}/${dateKey}`);
      break;
    }
    case 'clear-filters':
      event.preventDefault();
      resetFilters();
      break;
    case 'dismiss-reminder':
      actionEl.closest('.reminder-card')?.remove();
      break;
    case 'open-reminder': {
      const key = actionEl.dataset.key;
      actionEl.closest('.reminder-card')?.remove();
      if (key) openDetail(key);
      break;
    }
    case 'dismiss-banner':
      document.getElementById('storage-warning').hidden = true;
      break;
    default:
      break;
  }
}

function onInput(event) {
  const target = event.target;
  if (target.matches('[data-filter="search"]')) {
    ui.filters.search = target.value;
    updateAllResults();
  }
  if (target.closest('#item-form') && target.id?.startsWith('f-')) {
    clearFieldError(target.id.slice(2));
  }
}

function onChange(event) {
  const target = event.target;
  if (target.matches('[data-filter="category"]')) {
    ui.filters.category = target.value;
    updateAllResults();
    return;
  }
  if (target.matches('[data-filter="priority"]')) {
    ui.filters.priority = target.value;
    updateAllResults();
    return;
  }
  if (target.closest('#item-form')) {
    if (target.id?.startsWith('f-')) clearFieldError(target.id.slice(2));
    if (
      target.matches(
        '[name="date"], [name="startTime"], [name="endTime"], [name="repeat"], [name="reminder"], [name="scope"]',
      )
    ) {
      syncFormAvailability();
    }
  }
}

function onSubmit(event) {
  if (event.target.id !== 'item-form') return;
  event.preventDefault();
  const ctx = modal.ctx;
  if (!ctx) return;
  const draft = readForm();
  const scope = document.querySelector('input[name="scope"]:checked')?.value || 'one';
  const result = validateDraft(draft, {
    isRecurringOccurrence: Boolean(ctx.occurrence?.isRecurring),
    scope,
    currentRepeat: ctx.currentRepeat || '',
  });

  if (!result.ok) {
    clearFormError();
    showFieldErrors(result.errors);
    return;
  }
  clearFieldErrors();
  clearFormError();

  try {
    if (ctx.mode === 'create') store.add(result.value);
    else store.update(ctx.key, result.value, scope);
  } catch (error) {
    showFormError(error.message || '保存失败，请重试。');
    return;
  }

  if (ctx.mode === 'edit') removeReminderCards(ctx.key);
  closeModal();
  render();
  focusMain();
  toast(ctx.mode === 'create' ? '已保存事项' : '已保存修改');
}

function onKeydown(event) {
  if (!modal.current) return;
  if (event.key === 'Escape') {
    event.preventDefault();
    closeModal();
    return;
  }
  if (event.key === 'Tab') trapFocus(event);
}

/* ------------------------------------------------------------------ */
/* 筛选                                                                */
/* ------------------------------------------------------------------ */

function updateAllResults() {
  const container = document.getElementById('all-results');
  if (!container) return;
  container.innerHTML = allResultsHtml();
  const clear = document.querySelector('[data-action="clear-filters"]');
  if (clear) clear.disabled = !hasFilters();
}

function resetFilters() {
  ui.filters = { search: '', category: '', priority: '' };
  const search = document.querySelector('[data-filter="search"]');
  const category = document.querySelector('[data-filter="category"]');
  const priority = document.querySelector('[data-filter="priority"]');
  if (search) search.value = '';
  if (category) category.value = '';
  if (priority) priority.value = '';
  updateAllResults();
  const clear = document.querySelector('[data-action="clear-filters"]');
  if (clear) clear.disabled = true;
}

/* ------------------------------------------------------------------ */
/* 新增 / 编辑                                                         */
/* ------------------------------------------------------------------ */

function handleAdd(actionEl) {
  const route = getRoute();
  let source = actionEl.dataset.source;
  let date = actionEl.dataset.date;
  if (!source) {
    source = route.page === 'all' ? 'all' : route.page === 'calendar' ? 'calendar' : 'today';
  }
  if (source === 'calendar') {
    date = date || (route.page === 'calendar' ? route.selected : '') || todayKey();
  }
  openAddModal({ source, date });
}

function openAddModal({ source = 'today', date = '' } = {}) {
  const presetDate = source === 'all' ? '' : source === 'calendar' ? date || todayKey() : todayKey();
  const draft = { ...emptyDraft(), date: presetDate };
  openForm(draft, {
    mode: 'create',
    title: '新增事项',
    source,
  });
}

function openEditModal(key) {
  const occurrence = occurrenceFor(store.getState(), key);
  if (!occurrence) {
    toast('事项不存在或已删除', 'error');
    return;
  }
  const draft = draftFromValue({ ...occurrence, repeat: occurrence.repeat || '' });
  const ctx = {
    mode: 'edit',
    title: '编辑事项',
    key,
    occurrence,
    currentRepeat: occurrence.repeat || '',
  };
  openForm(draft, ctx);
}

function openForm(draft, ctx) {
  if (!modal.current) {
    modal.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  modal.current = 'form';
  modal.ctx = ctx;
  modalRoot.innerHTML = formHtml(draft, ctx);
  syncFormAvailability();
  document.getElementById('f-title')?.focus();
}

function formHtml(draft, ctx) {
  const isRecurringOccurrence = Boolean(ctx.occurrence?.isRecurring);
  const categories = [...new Set(['工作', '生活', ...collectCategories(store.getState())])].filter(Boolean);
  return `
    <div class="modal-backdrop" data-action="backdrop-close">
      <form class="modal" id="item-form" novalidate>
        <div class="modal-head">
          <div>
            <p class="modal-kicker">${ctx.mode === 'create' ? '新安排' : '修改安排'}</p>
            <h2>${escapeHtml(ctx.title)}</h2>
          </div>
          <button class="icon-btn" type="button" data-action="close-modal" aria-label="关闭">×</button>
        </div>
        <div class="modal-body">
          <div class="form-error" id="form-error" role="alert" hidden></div>

          <div class="field">
            <label for="f-title">标题<span class="required">必填</span></label>
            <input id="f-title" name="title" type="text" maxlength="200" autocomplete="off"
              value="${escapeAttr(draft.title)}" aria-required="true" aria-describedby="err-title" />
            <p class="field-error" id="err-title" aria-live="polite" hidden></p>
          </div>

          <div class="field">
            <label for="f-notes">备注</label>
            <textarea id="f-notes" name="notes" rows="3" placeholder="补充细节，可多行">${escapeHtml(
              draft.notes,
            )}</textarea>
          </div>

          <div class="field">
            <span class="field-label" id="date-label">日期和时间</span>
            <div class="field-row three">
              <div class="field-sub">
                <label for="f-date">日期</label>
                <input id="f-date" name="date" type="date" value="${escapeAttr(
                  draft.date,
                )}" aria-describedby="err-date" />
                <p class="field-hint">仅填日期时为全天事项。</p>
                <p class="field-error" id="err-date" aria-live="polite" hidden></p>
              </div>
              <div class="field-sub">
                <label for="f-startTime">开始</label>
                <input id="f-startTime" name="startTime" type="time" value="${escapeAttr(
                  draft.startTime,
                )}" aria-describedby="err-startTime" />
                <p class="field-hint">选填</p>
                <p class="field-error" id="err-startTime" aria-live="polite" hidden></p>
              </div>
              <div class="field-sub">
                <label for="f-endTime">结束</label>
                <input id="f-endTime" name="endTime" type="time" value="${escapeAttr(
                  draft.endTime,
                )}" aria-describedby="err-endTime" />
                <p class="field-hint">选填，需晚于开始时间</p>
                <p class="field-error" id="err-endTime" aria-live="polite" hidden></p>
              </div>
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="f-category">分类</label>
              <input id="f-category" name="category" type="text" list="category-options" maxlength="40"
                value="${escapeAttr(draft.category)}" placeholder="例如：工作、生活" />
              <datalist id="category-options">
                ${categories.map((category) => `<option value="${escapeAttr(category)}"></option>`).join('')}
              </datalist>
            </div>
            <div class="field">
              <label for="f-priority">优先级</label>
              <select id="f-priority" name="priority">
                <option value=""${draft.priority === '' ? ' selected' : ''}>无优先级</option>
                <option value="high"${draft.priority === 'high' ? ' selected' : ''}>高</option>
                <option value="medium"${draft.priority === 'medium' ? ' selected' : ''}>中</option>
                <option value="low"${draft.priority === 'low' ? ' selected' : ''}>低</option>
              </select>
            </div>
          </div>

          <div class="field-row">
            <div class="field">
              <label for="f-repeat">重复</label>
              <select id="f-repeat" name="repeat" aria-describedby="repeat-hint err-repeat">
                <option value=""${draft.repeat === '' ? ' selected' : ''}>不重复</option>
                <option value="daily"${draft.repeat === 'daily' ? ' selected' : ''}>每天</option>
                <option value="weekly"${draft.repeat === 'weekly' ? ' selected' : ''}>每周</option>
                <option value="monthly"${draft.repeat === 'monthly' ? ' selected' : ''}>每月</option>
              </select>
              <p class="field-hint" id="repeat-hint"></p>
              <p class="field-error" id="err-repeat" aria-live="polite" hidden></p>
            </div>
            <div class="field">
              <label for="f-reminder">提醒</label>
              <select id="f-reminder" name="reminder" aria-describedby="reminder-hint err-reminder">
                <option value=""${draft.reminder === '' ? ' selected' : ''}>不提醒</option>
                <option value="start"${draft.reminder === 'start' ? ' selected' : ''}>开始时</option>
                <option value="10m"${draft.reminder === '10m' ? ' selected' : ''}>提前 10 分钟</option>
                <option value="60m"${draft.reminder === '60m' ? ' selected' : ''}>提前 1 小时</option>
              </select>
              <p class="field-hint" id="reminder-hint"></p>
              <p class="field-error" id="err-reminder" aria-live="polite" hidden></p>
            </div>
          </div>

          ${
            isRecurringOccurrence
              ? `<fieldset class="scope">
                  <legend>修改范围</legend>
                  <div class="radio-row">
                    <label><input type="radio" name="scope" value="one" checked /> 仅本次</label>
                    <label><input type="radio" name="scope" value="future" /> 本次及以后</label>
                  </div>
                  <p class="field-hint">选择「本次及以后」会保留之前的事项和完成记录。</p>
                </fieldset>`
              : ''
          }
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" type="button" data-action="close-modal">取消</button>
          <button class="btn btn-primary" type="submit">保存</button>
        </div>
      </form>
    </div>
  `;
}

function syncFormAvailability() {
  const form = document.getElementById('item-form');
  if (!form) return;
  const dateEl = form.elements.date;
  const startEl = form.elements.startTime;
  const endEl = form.elements.endTime;
  const repeatEl = form.elements.repeat;
  const reminderEl = form.elements.reminder;
  if (!dateEl || !startEl || !endEl || !repeatEl || !reminderEl) return;

  if (!dateEl.value) {
    startEl.value = '';
    endEl.value = '';
  }
  startEl.disabled = !dateEl.value;
  if (!startEl.value) {
    endEl.value = '';
    reminderEl.value = '';
  }
  endEl.disabled = !startEl.value;
  reminderEl.disabled = !startEl.value;

  const scope = form.querySelector('input[name="scope"]:checked')?.value || 'one';
  const occurrence = modal.ctx?.occurrence;
  const onlyThis = Boolean(occurrence?.isRecurring) && scope !== 'future';
  if (onlyThis && modal.ctx?.currentRepeat !== undefined) {
    repeatEl.value = modal.ctx.currentRepeat;
  }
  if (!dateEl.value) repeatEl.value = '';
  repeatEl.disabled = !dateEl.value || onlyThis;

  const repeatHint = document.getElementById('repeat-hint');
  if (repeatHint) {
    if (onlyThis) {
      repeatHint.textContent = '仅修改本次时不能更改重复规则；如需调整请选择「本次及以后」。';
    } else if (!dateEl.value) {
      repeatHint.textContent = '设置重复须先选择日期。';
    } else if (repeatEl.value) {
      repeatHint.textContent = `${recurrenceHint({
        startDate: dateEl.value,
        repeat: repeatEl.value,
      })} 编辑时可选择「仅本次」或「本次及以后」。`;
    } else {
      repeatHint.textContent = '选择每天、每周或每月后，按首次日期计算后续安排。';
    }
  }

  const reminderHint = document.getElementById('reminder-hint');
  if (reminderHint) {
    reminderHint.textContent = startEl.value
      ? '网页保持打开时，到点会显示提醒；关闭网页后不会提醒，重新打开只安排之后的提醒。'
      : '设置提醒须先填写开始时间。';
  }
}

function readForm() {
  const form = document.getElementById('item-form');
  if (!form) return emptyDraft();
  return {
    title: form.elements.title.value,
    notes: form.elements.notes.value,
    date: form.elements.date.value,
    startTime: form.elements.startTime.value,
    endTime: form.elements.endTime.value,
    category: form.elements.category.value,
    priority: form.elements.priority.value,
    repeat: form.elements.repeat.value,
    reminder: form.elements.reminder.value,
  };
}

const FIELD_ORDER = ['title', 'date', 'startTime', 'endTime', 'repeat', 'reminder', 'priority'];

function showFieldErrors(errors) {
  clearFieldErrors();
  let first = null;
  for (const field of FIELD_ORDER) {
    if (!errors[field]) continue;
    const errorEl = document.getElementById(`err-${field}`);
    const input = document.getElementById(`f-${field}`);
    if (errorEl) {
      errorEl.textContent = errors[field];
      errorEl.hidden = false;
    }
    if (input) {
      input.setAttribute('aria-invalid', 'true');
      if (!first) first = input;
    }
  }
  first?.focus();
}

function clearFieldError(field) {
  const errorEl = document.getElementById(`err-${field}`);
  if (errorEl) {
    errorEl.textContent = '';
    errorEl.hidden = true;
  }
  document.getElementById(`f-${field}`)?.removeAttribute('aria-invalid');
}

function clearFieldErrors() {
  for (const field of FIELD_ORDER) {
    const errorEl = document.getElementById(`err-${field}`);
    if (errorEl) {
      errorEl.textContent = '';
      errorEl.hidden = true;
    }
    document.getElementById(`f-${field}`)?.removeAttribute('aria-invalid');
  }
}

function showFormError(message) {
  const errorEl = document.getElementById('form-error');
  if (!errorEl) return;
  errorEl.hidden = false;
  errorEl.innerHTML = `<span>${escapeHtml(message)}</span><button class="btn btn-sm btn-ghost" type="button" data-action="retry-save">重试保存</button>`;
  errorEl.scrollIntoView({ block: 'nearest' });
}

function clearFormError() {
  const errorEl = document.getElementById('form-error');
  if (!errorEl) return;
  errorEl.hidden = true;
  errorEl.innerHTML = '';
}

/* ------------------------------------------------------------------ */
/* 详情 / 删除                                                         */
/* ------------------------------------------------------------------ */

function openDetail(key) {
  const occurrence = occurrenceFor(store.getState(), key);
  if (!occurrence) {
    toast('事项不存在或已删除', 'error');
    return;
  }
  if (!modal.current) {
    modal.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  modal.current = 'detail';
  modal.ctx = { key };
  modalRoot.innerHTML = detailHtml(occurrence);
  document.querySelector('.modal')?.focus();
}

function detailHtml(occurrence) {
  const done = Boolean(occurrence.completedAt);
  const overdue = !done && isOverdue(occurrence, new Date());
  const status = [];
  if (done) status.push('<span class="status-label done">✓ 已完成</span>');
  else if (overdue) status.push('<span class="status-label overdue">已逾期</span>');
  if (occurrence.isRecurring) status.push('<span class="badge repeat">↻ 重复事项</span>');
  if (occurrence.reminder) {
    status.push(`<span class="badge reminder">提醒 · ${REMINDER_LABELS[occurrence.reminder]}</span>`);
  }

  const repeatText = occurrence.isRecurring
    ? `${recurrenceLabel({
        repeat: occurrence.repeat,
        startDate: occurrence.seriesStartDate,
      })}${occurrence.baseDate !== occurrence.date ? `（原安排 ${formatDateShort(occurrence.baseDate)}）` : ''}`
    : '不重复';

  const footer = done
    ? `<button class="btn btn-primary" type="button" data-action="toggle" data-key="${escapeAttr(
        occurrence.key,
      )}">恢复为待办</button>
       <button class="btn btn-soft-danger" type="button" data-action="delete" data-key="${escapeAttr(
         occurrence.key,
       )}">删除</button>
       <button class="btn btn-ghost" type="button" data-action="close-modal">关闭</button>`
    : `<button class="btn btn-primary" type="button" data-action="toggle" data-key="${escapeAttr(
        occurrence.key,
      )}">标记完成</button>
       <button class="btn btn-ghost" type="button" data-action="edit" data-key="${escapeAttr(
         occurrence.key,
       )}">编辑</button>
       <button class="btn btn-soft-danger" type="button" data-action="delete" data-key="${escapeAttr(
         occurrence.key,
       )}">删除</button>
       <button class="btn btn-ghost" type="button" data-action="close-modal">关闭</button>`;

  return `
    <div class="modal-backdrop" data-action="backdrop-close">
      <div class="modal modal-detail" role="dialog" aria-modal="true" aria-labelledby="detail-title" tabindex="-1">
        <div class="modal-head">
          <div>
            <p class="modal-kicker">${done ? '完成记录' : '事项详情'}</p>
            <h2 id="detail-title">${escapeHtml(occurrence.title)}</h2>
          </div>
          <button class="icon-btn" type="button" data-action="close-modal" aria-label="关闭">×</button>
        </div>
        <div class="modal-body">
          <div class="detail-status">${status.join('')}</div>
          <dl class="detail-list">
            <div class="detail-row"><dt>日期</dt><dd>${
              occurrence.date ? escapeHtml(formatDateLabel(occurrence.date)) : '未排期'
            }</dd></div>
            <div class="detail-row"><dt>时间</dt><dd>${escapeHtml(
              formatTimeRange(occurrence.startTime, occurrence.endTime),
            )}</dd></div>
            <div class="detail-row"><dt>分类</dt><dd>${
              occurrence.category ? escapeHtml(occurrence.category) : '未分类'
            }</dd></div>
            <div class="detail-row"><dt>优先级</dt><dd>${
              occurrence.priority ? PRIORITY_LABELS[occurrence.priority] : '无优先级'
            }</dd></div>
            <div class="detail-row"><dt>重复</dt><dd>${escapeHtml(repeatText)}</dd></div>
            <div class="detail-row"><dt>提醒</dt><dd>${
              occurrence.reminder
                ? `${REMINDER_LABELS[occurrence.reminder]}提醒`
                : '不提醒'
            }</dd></div>
            <div class="detail-row"><dt>创建于</dt><dd>${escapeHtml(
              formatFullTimestamp(occurrence.createdAt),
            )}</dd></div>
            ${
              done
                ? `<div class="detail-row"><dt>完成于</dt><dd>${escapeHtml(
                    formatFullTimestamp(occurrence.completedAt),
                  )}</dd></div>`
                : ''
            }
          </dl>
          ${
            occurrence.notes
              ? `<div class="detail-notes"><h3>备注</h3><p>${escapeHtml(
                  occurrence.notes,
                )}</p></div>`
              : ''
          }
          ${
            occurrence.isRecurring
              ? '<p class="detail-hint">这是重复事项的一次安排，可单独完成、改期或删除；编辑和删除时可选择「仅本次」或「本次及以后」。</p>'
              : ''
          }
        </div>
        <div class="modal-foot">${footer}</div>
      </div>
    </div>
  `;
}

function openDeleteConfirm(key, from = 'page') {
  const occurrence = occurrenceFor(store.getState(), key);
  if (!occurrence) {
    toast('事项不存在或已删除', 'error');
    return;
  }
  if (!modal.current) {
    modal.lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
  modal.current = 'confirm';
  modal.ctx = { key, from, occurrence };
  modalRoot.innerHTML = confirmHtml(occurrence);
  document.querySelector('[data-action="cancel-delete"]')?.focus();
}

function confirmHtml(occurrence) {
  return `
    <div class="modal-backdrop" data-action="backdrop-close">
      <div class="modal modal-sm" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title" tabindex="-1">
        <div class="modal-head">
          <div>
            <p class="modal-kicker">删除事项</p>
            <h2 id="confirm-title">确定删除？</h2>
          </div>
        </div>
        <div class="modal-body">
          <p>将删除「<strong>${escapeHtml(occurrence.title)}</strong>」，此操作无法撤销。</p>
          ${
            occurrence.isRecurring
              ? `<fieldset class="scope">
                  <legend>删除范围</legend>
                  <div class="radio-row">
                    <label><input type="radio" name="delete-scope" value="one" checked /> 仅本次</label>
                    <label><input type="radio" name="delete-scope" value="future" /> 本次及以后</label>
                  </div>
                  <p class="field-hint">选择「本次及以后」会删除从本次开始的所有安排，之前的事项和完成记录保留。</p>
                </fieldset>`
              : `<p class="detail-hint">取消后会保留这项事项。</p>`
          }
        </div>
        <div class="modal-foot">
          <button class="btn btn-ghost" type="button" data-action="cancel-delete">取消</button>
          <button class="btn btn-danger" type="button" data-action="confirm-delete">删除</button>
        </div>
      </div>
    </div>
  `;
}

function performDelete() {
  const ctx = modal.ctx;
  if (!ctx?.key) return;
  const scope =
    document.querySelector('input[name="delete-scope"]:checked')?.value || 'one';
  try {
    store.remove(ctx.key, scope);
  } catch (error) {
    toast(error.message || '删除失败，请重试', 'error');
    return;
  }
  removeReminderCards(ctx.key);
  closeModal();
  render();
  focusMain();
  toast('已删除事项');
}

function toggleOccurrence(key) {
  const occurrence = occurrenceFor(store.getState(), key);
  if (!occurrence) {
    toast('事项不存在或已删除', 'error');
    return;
  }
  const wasCompleted = Boolean(occurrence.completedAt);
  try {
    if (wasCompleted) store.restore(key);
    else {
      store.complete(key);
      removeReminderCards(key);
    }
  } catch (error) {
    toast(error.message || '操作失败，请重试', 'error');
    return;
  }
  render();
  toast(wasCompleted ? '已恢复为待办' : '已完成，移入「已完成」');
  if (modal.current === 'detail') {
    const fresh = occurrenceFor(store.getState(), key);
    if (fresh) {
      modal.ctx = { key };
      modalRoot.innerHTML = detailHtml(fresh);
      document.querySelector('.modal')?.focus();
    } else {
      closeModal();
    }
  } else {
    focusMain();
  }
}

/* ------------------------------------------------------------------ */
/* 月历导航                                                            */
/* ------------------------------------------------------------------ */

function shiftMonth(delta) {
  const route = getRoute();
  if (route.page !== 'calendar') return;
  const target = new Date(route.year, route.month + delta, 1);
  navigate(`/calendar/${target.getFullYear()}-${pad2(target.getMonth() + 1)}`);
}

/* ------------------------------------------------------------------ */
/* 提醒                                                                */
/* ------------------------------------------------------------------ */

function removeReminderCards(key) {
  for (const card of document.querySelectorAll('.reminder-card')) {
    if (card.dataset.key === key) card.remove();
  }
}

function checkReminders() {
  const now = new Date();
  const today = todayKey(now);
  const from = addDays(today, -1);
  const to = addDays(today, 2);
  const candidates = reminderCandidates(store.getState(), from, to);
  for (const occurrence of candidates) {
    const trigger = reminderTriggerMs(occurrence);
    if (trigger === null) continue;
    if (trigger < loadedAt || trigger > now.getTime()) continue;
    const fireKey = `${occurrence.key}@${trigger}`;
    if (firedReminders.has(fireKey)) continue;
    firedReminders.add(fireKey);
    showReminder(occurrence);
  }
}

function showReminder(occurrence) {
  const region = document.getElementById('reminder-region');
  if (!region) return;
  const card = document.createElement('div');
  card.className = 'reminder-card';
  card.dataset.key = occurrence.key;
  card.innerHTML = `
    <div class="reminder-icon" aria-hidden="true">⏰</div>
    <div>
      <p class="reminder-label">待办提醒</p>
      <p class="reminder-title">${escapeHtml(occurrence.title)}</p>
      <p class="reminder-meta">${escapeHtml(relativeDateLabel(occurrence.date))} ${escapeHtml(
        occurrence.startTime || '',
      )} 开始</p>
      <div class="reminder-actions">
        <button class="btn btn-primary btn-sm" type="button" data-action="open-reminder" data-key="${escapeAttr(
          occurrence.key,
        )}">查看详情</button>
        <button class="btn btn-ghost btn-sm" type="button" data-action="dismiss-reminder">知道了</button>
      </div>
    </div>
  `;
  region.append(card);
}

/* ------------------------------------------------------------------ */
/* 弹窗焦点                                                            */
/* ------------------------------------------------------------------ */

function closeModal() {
  if (!modal.current) return;
  modalRoot.innerHTML = '';
  modal.current = null;
  modal.ctx = null;
  const target = modal.lastFocused;
  modal.lastFocused = null;
  if (target && document.contains(target)) target.focus();
}

function trapFocus(event) {
  const focusables = [
    ...modalRoot.querySelectorAll(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ].filter((element) => element.getClientRects().length > 0);
  if (!focusables.length) return;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/* ------------------------------------------------------------------ */
/* 通用工具                                                            */
/* ------------------------------------------------------------------ */

function focusMain() {
  const target =
    document.querySelector('.page-head [data-action="add"]') ||
    document.querySelector('.add-button') ||
    app;
  if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
}

function toast(message, type = 'success') {
  const region = document.getElementById('toast-region');
  if (!region) return;
  const element = document.createElement('div');
  element.className = `toast${type === 'error' ? ' is-error' : ''}`;
  element.textContent = message;
  region.append(element);
  while (region.children.length > 3) region.firstElementChild.remove();
  window.setTimeout(() => element.remove(), 3200);
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    const map = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return map[character];
  });
}

function escapeAttr(value) {
  return escapeHtml(value);
}
