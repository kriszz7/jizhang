/* ============================================================
 * 存钱罐 · 应用逻辑
 * 依赖:js/core.js(PiggyCore)、js/storage.js(PiggyStorage)
 * ============================================================ */
(function () {
  'use strict';

  var C = window.PiggyCore;
  var S = window.PiggyStorage;

  /* ================= 状态 ================= */

  var settings = S.loadSettings();
  var entries = S.loadEntries();
  var goals = S.loadGoals();
  var snapshots = S.syncSnapshots(settings, entries, S.loadSnapshots());
  var meta = S.loadMeta();
  S.saveSnapshots(snapshots);

  var today = C.todayStr();
  var WD = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];

  var state = {
    view: 'today',
    calMonth: C.monthKeyFromDate(today, settings.monthStartDay),
    statsMonth: C.monthKeyFromDate(today, settings.monthStartDay),
    selDay: today,
    sheet: null,
    confirmCb: null,
    form: null,
    onboard: null,
    toastTimer: null,
    search: { q: '', type: '', cat: '', min: '', max: '' }
  };

  var prevSavings = 0; // 今日可存上次渲染值(数字滚动起点)

  /* ================= 图标 ================= */

  var ICONS = {
    bowl: '<path d="M4 11h16a8 8 0 0 1-16 0z"/><path d="M8 3.5v6M16 3.5v6"/>',
    bus: '<rect x="4" y="4" width="16" height="12" rx="2.6"/><path d="M4 10h16M9 16v2.6M15 16v2.6M9 3.2v2.4M15 3.2v2.4"/><circle cx="8.4" cy="16" r="1.2"/><circle cx="15.6" cy="16" r="1.2"/>',
    book: '<path d="M12 6.2C10.5 5 8.4 4.4 6 4.4v13.4c2.4 0 4.5.6 6 1.8 1.5-1.2 3.6-1.8 6-1.8V4.4c-2.4 0-4.5.6-6 1.8z"/><path d="M12 6.2v13.4"/>',
    game: '<rect x="7" y="8.2" width="10" height="7.6" rx="3.8"/><path d="M9 11v1.6M8.2 11.8h1.6M14.8 11.2h.01M16.7 12.8h.01M14.8 14.4h.01"/>',
    cart: '<path d="M3 4h2l2.2 9.6h9.3L20 7H6"/><circle cx="9.5" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>',
    heart: '<path d="M12 20s-7.2-4.5-9.2-9.2C1.6 7.6 3.8 4.5 7 4.5c2 0 3.4 1 4.9 2.7 1.5-1.7 2.9-2.7 4.9-2.7 3.2 0 5.4 3.1 4.2 6.3C19.2 15.5 12 20 12 20z"/>',
    drink: '<path d="M7 3.5h10l-1.1 6.2a4 4 0 0 1-7.8 0L7 3.5z"/><path d="M9.2 13.7L8.4 19M14.8 13.7l.8 5.3M7 6.5h10"/>',
    dots: '<circle cx="7" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="17" cy="12" r="1.5" fill="currentColor" stroke="none"/>'
  };
  var ICON_LABELS = {
    bowl: '碗', bus: '公交', book: '书', game: '游戏',
    cart: '购物', heart: '爱心', drink: '饮品', dots: '圆点'
  };
  var PALETTE = ['#f59e0b', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#64748b',
    '#ef4444', '#10b981', '#f97316', '#06b6d4', '#84cc16', '#a855f7'];

  function iconSVG(name, extra) {
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"' + (extra || '') + '>' +
      (ICONS[name] || ICONS.dots) + '</svg>';
  }

  /* ================= 小工具 ================= */

  function $(sel) { return document.querySelector(sel); }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function catById(id) {
    for (var i = 0; i < settings.categories.length; i++) {
      if (settings.categories[i].id === id) return settings.categories[i];
    }
    return null;
  }
  function badgeHTML(cat) {
    if (!cat) cat = { name: '未知', icon: 'dots', color: '#64748b' };
    return '<span class="cat-badge" style="background:linear-gradient(135deg,' + cat.color + 'e6,' + cat.color + '99)">' +
      iconSVG(cat.icon) + '</span>';
  }
  function incomeBadgeHTML() {
    return '<span class="cat-badge" style="background:linear-gradient(135deg,#34d399,#0d9488)">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg></span>';
  }
  function entryRowHTML(e) {
    if (e.type === 'income') {
      return '<div class="entry-row" data-act="edit-entry" data-id="' + e.id + '">' + incomeBadgeHTML() +
        '<div class="mid"><div class="name">收入</div>' +
        (e.note ? '<div class="note">' + esc(e.note) + '</div>' : '') + '</div>' +
        '<span class="amount in">+' + C.fmtMoney(e.amount) + '</span></div>';
    }
    var cat = catById(e.categoryId);
    return '<div class="entry-row" data-act="edit-entry" data-id="' + e.id + '">' + badgeHTML(cat) +
      '<div class="mid"><div class="name">' + esc(cat ? cat.name : '未知分类') + '</div>' +
      (e.note ? '<div class="note">' + esc(e.note) + '</div>' : '') + '</div>' +
      '<span class="amount out">-' + C.fmtMoney(e.amount) + '</span></div>';
  }
  function fmtDateCN(dateStr) {
    var p = C.parseDateStr(dateStr);
    return p.m + '月' + p.d + '日 ' + WD[C.weekdayOf(dateStr)];
  }
  function shiftMonthKey(key, delta) {
    var p = C.parseDateStr(key + '-01');
    var m = p.m + delta, y = p.y;
    while (m < 1) { m += 12; y -= 1; }
    while (m > 12) { m -= 12; y += 1; }
    return y + '-' + C.pad2(m);
  }
  function bmFromKey(key) {
    return C.getBudgetMonth(key + '-' + C.pad2(settings.monthStartDay), settings.monthStartDay);
  }
  function saveAll() {
    S.saveSettings(settings);
    S.saveEntries(entries);
    S.saveGoals(goals);
    snapshots = S.syncSnapshots(settings, entries, snapshots);
    S.saveSnapshots(snapshots);
  }
  function saveSettingsOnly() {
    S.saveSettings(settings);
    snapshots = S.syncSnapshots(settings, entries, snapshots);
    S.saveSnapshots(snapshots);
  }

  function showToast(msg, ms) {
    var t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(state.toastTimer);
    state.toastTimer = setTimeout(function () { t.classList.remove('show'); }, ms || 1800);
  }

  function animateNumber(node, from, to, formatter) {
    var start = null, dur = 520;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min(1, (ts - start) / dur);
      var e = 1 - Math.pow(1 - p, 3);
      node.textContent = formatter(from + (to - from) * e);
      if (p < 1) window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }

  /* ================= 主题 ================= */

  var mqlDark = window.matchMedia('(prefers-color-scheme: dark)');
  function resolveTheme() {
    if (settings.theme === 'auto') return mqlDark.matches ? 'dark' : 'light';
    return settings.theme;
  }
  function applyTheme() {
    document.documentElement.setAttribute('data-theme', resolveTheme());
  }

  /* ================= 渲染入口 ================= */

  function render() {
    applyTheme();
    var titles = { today: '今日', calendar: '明细', stats: '统计', settings: '设置' };
    $('#topbar-title').textContent = titles[state.view];
    $('#topbar-sub').textContent = fmtDateCN(today) + ' · ' + C.monthLabel(C.monthKeyFromDate(today, settings.monthStartDay));
    if (state.view === 'today') renderToday();
    else if (state.view === 'calendar') renderCalendar();
    else if (state.view === 'stats') renderStats();
    else renderSettings();
    bindDynamic();
  }

  function switchView(v) {
    state.view = v;
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].classList.toggle('active', tabs[i].getAttribute('data-view') === v);
    }
    var views = document.querySelectorAll('.view');
    for (var j = 0; j < views.length; j++) {
      views[j].classList.toggle('active', views[j].id === 'view-' + v);
    }
    render();
  }

  /* ================= 今日页 ================= */

  function needsBackupReminder() {
    if (!entries.length) return false;
    var sinceExport = meta.lastExportAt
      ? Math.floor((Date.now() - new Date(meta.lastExportAt).getTime()) / 86400000)
      : Infinity;
    var sinceRemind = meta.lastRemindedAt
      ? Math.floor((Date.now() - new Date(meta.lastRemindedAt).getTime()) / 86400000)
      : Infinity;
    var overCount = entries.length - (meta.entriesAtExport || 0) >= 50;
    var overDays = sinceExport >= 7;
    return (overCount || overDays) && sinceRemind >= 1;
  }

  function renderToday() {
    var stats = C.todayStats(settings, entries, today, snapshots);
    var tds = entries.filter(function (e) { return e.date === today; })
      .sort(function (a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); });

    var html = '';

    /* 持久化警告 / 备份提醒 */
    if (!S.persistent) {
      html += '<div class="banner"><span class="msg">⚠️ 当前环境无法持久保存数据(如无痕模式),退出后记录会丢失,请及时导出备份。</span>' +
        '<button class="btn primary small" data-act="export">导出</button></div>';
    } else if (needsBackupReminder()) {
      html += '<div class="banner"><span class="msg">💾 有一阵子没备份了,建议现在导出一份,防止数据丢失。</span>' +
        '<button class="btn primary small" data-act="export">立即备份</button>' +
        '<button class="btn ghost small" data-act="dismiss-backup">稍后</button></div>';
    }

    /* 英雄卡 */
    var pct = stats.dailyBudget > 0 ? stats.todaySpent / stats.dailyBudget : (stats.todaySpent > 0 ? 2 : 0);
    var ringState = stats.todaySavings < 0 ? 'ringOver' : (pct >= 0.8 ? 'ringWarn' : 'ringGrad');
    var statusPill = stats.todaySavings < 0
      ? '<span class="pill over">今日超支</span>'
      : (pct >= 0.8 ? '<span class="pill warn">接近预算</span>' : '<span class="pill ok">今日正常</span>');
    var monthKey = stats.bm.key;
    var valClass = stats.todaySavings >= 0 ? 'pos' : 'neg';
    var carryPill = (settings.carryOver && stats.carryIn > 0)
      ? '<span class="pill ok">含结转 ' + C.fmtMoney(stats.carryIn) + '</span>' : '';
    var subTxt = '预算 ' + C.fmtMoney(stats.dailyBudget) + ' · 花 ' + C.fmtMoney(stats.todayExpense);
    if (stats.todayIncome > 0) subTxt += ' · 收 ' + C.fmtMoney(stats.todayIncome);

    html += '<div class="card hero">' +
      '<div class="hero-top"><span class="pill">' + C.monthLabel(monthKey) + '</span>' +
      '<span class="pill">剩 ' + stats.daysLeft + ' 天</span>' + statusPill + carryPill + '</div>' +
      '<div class="ring-wrap">' + heroRingHTML() +
      '<div class="ring-center"><span class="label">今日可存</span>' +
      '<span class="value ' + valClass + '" id="hero-value" data-prev="' + prevSavings + '"></span>' +
      '<span class="sub">' + subTxt + '</span></div>' +
      '</div>' +
      '<div class="hero-stats">' +
      '<div class="stat"><div class="k">今日预算</div><div class="v">' + C.fmtMoney(stats.dailyBudget) + '</div></div>' +
      '<div class="stat"><div class="k">今日支出</div><div class="v">' + C.fmtMoney(stats.todayExpense) + '</div></div>' +
      '<div class="stat"><div class="k">本月剩余</div><div class="v ' + (stats.remaining < 0 ? 'neg' : '') + '">' + C.fmtMoney(stats.remaining) + '</div></div>' +
      '</div>' +
      (stats.todayIncome > 0
        ? '<div class="proj-row" style="padding-top:6px"><span style="color:var(--brand-3);font-weight:700">今日收入</span><b class="pos">+' + C.fmtMoney(stats.todayIncome) + '</b></div>'
        : '') +
      '<div class="proj-row"><span>预计月末可存 <span style="color:var(--text-3);font-size:11.5px">(按当前节奏)</span></span>' +
      '<b class="' + (stats.projectedSaved >= 0 ? 'pos' : 'neg') + '">' + C.fmtMoney(stats.projectedSaved) + '</b></div>' +
      '</div>';

    /* 超支 / 接近预算横幅 */
    if (stats.todaySavings < 0) {
      html += '<div class="banner alert-over"><span class="msg">⚠️ 今天已超支 ' + C.fmtMoney(Math.abs(stats.todaySavings)) + ',后面几天会自动收紧。</span></div>';
    } else if (pct >= 0.8) {
      html += '<div class="banner alert-warn"><span class="msg">⚠️ 今日预算已用 ' + Math.round(pct * 100) + '%,还能花 ' + C.fmtMoney(stats.todaySavings) + '。</span></div>';
    }

    /* 分类计划 */
    var chips = settings.categories.slice().sort(function (a, b) {
      var ra = a.dailyPlan - C.spentInCategoryOnDay(entries, today, a.id);
      var rb = b.dailyPlan - C.spentInCategoryOnDay(entries, today, b.id);
      return ra - rb;
    });
    html += '<div class="section-title"><span>今日分类计划</span></div>' +
      '<div class="cat-grid">';
    for (var i = 0; i < chips.length; i++) {
      var c = chips[i];
      var spent = C.spentInCategoryOnDay(entries, today, c.id);
      var rest = C.round2(c.dailyPlan - spent);
      html += '<div class="cat-chip">' + badgeHTML(c) +
        '<div class="info"><div class="name">' + esc(c.name) + '</div>' +
        '<div class="rest">剩 ' + C.fmtMoney(rest) + ' / 计划 ' + C.fmtMoney(c.dailyPlan) + '</div></div>' +
        '<span class="amount ' + (rest < 0 ? 'neg' : 'pos') + '">' + C.fmtMoney(rest) + '</span></div>';
    }
    html += '</div>';

    /* 今日账单 */
    html += '<div class="section-title"><span>今日账单' + (tds.length ? ' · ' + tds.length + ' 笔' : '') + '</span></div>' +
      '<div class="card">';
    if (!tds.length) {
      html += emptyStateHTML('今天还没有记账', '记录第一笔消费,开始攒钱吧');
    } else {
      for (var k = 0; k < tds.length; k++) {
        html += entryRowHTML(tds[k]);
      }
    }
    html += '</div>';

    $('#today-body').innerHTML = html;

    /* 环形进度动画 */
    var ring = document.querySelector('#today-body .ring-value');
    if (ring) {
      var shown = Math.min(1, pct);
      ring.setAttribute('stroke', 'url(#' + ringState + ')');
      window.requestAnimationFrame(function () {
        ring.style.strokeDashoffset = String(2 * Math.PI * 84 * (1 - shown));
      });
    }
    /* 数字滚动 */
    var hv = $('#hero-value');
    if (hv) {
      var prev = parseFloat(hv.getAttribute('data-prev')) || 0;
      animateNumber(hv, prev, stats.todaySavings, function (v) { return C.fmtMoney(v); });
      prevSavings = stats.todaySavings;
    }
  }

  function heroRingHTML() {
    var R = 84, circ = 2 * Math.PI * R;
    return '<svg viewBox="0 0 200 200">' +
      '<defs>' +
      '<linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#0d9488"/></linearGradient>' +
      '<linearGradient id="ringWarn" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fbbf24"/><stop offset="1" stop-color="#f97316"/></linearGradient>' +
      '<linearGradient id="ringOver" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f87171"/><stop offset="1" stop-color="#dc2626"/></linearGradient>' +
      '</defs>' +
      '<circle class="ring-track" cx="100" cy="100" r="' + R + '"/>' +
      '<circle class="ring-value" cx="100" cy="100" r="' + R + '" stroke="url(#ringGrad)" stroke-dasharray="' + circ + '" stroke-dashoffset="' + circ + '"/>' +
      '</svg>';
  }

  function emptyStateHTML(title, desc) {
    return '<div class="empty">' +
      '<svg viewBox="0 0 120 96" fill="none">' +
      '<defs><linearGradient id="empGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#34d399" stop-opacity="0.9"/><stop offset="1" stop-color="#0d9488" stop-opacity="0.9"/></linearGradient></defs>' +
      '<ellipse cx="60" cy="52" rx="33" ry="26" fill="url(#empGrad)" opacity="0.28"/>' +
      '<ellipse cx="60" cy="52" rx="33" ry="26" stroke="url(#empGrad)" stroke-width="3"/>' +
      '<path d="M51 30l-5-9 11-2z" fill="url(#empGrad)" opacity="0.55"/>' +
      '<ellipse cx="91" cy="55" rx="6.5" ry="8.5" stroke="url(#empGrad)" stroke-width="3"/>' +
      '<circle cx="68" cy="44" r="3.2" fill="url(#empGrad)"/>' +
      '<rect x="56" y="36" width="9" height="5.5" rx="2.5" fill="url(#empGrad)" opacity="0.75"/>' +
      '<rect x="41" y="74" width="8" height="12" rx="3.5" fill="url(#empGrad)" opacity="0.5"/>' +
      '<rect x="71" y="74" width="8" height="12" rx="3.5" fill="url(#empGrad)" opacity="0.5"/>' +
      '</svg>' +
      '<p>' + title + '<br>' + desc + '</p>' +
      '<button class="btn primary" data-act="open-add">记一笔</button></div>';
  }

  /* ================= 明细/日历 ================= */

  function isSearchActive() {
    var s = state.search;
    return !!(String(s.q).trim() || s.type || s.cat || s.min || s.max);
  }

  function searchBarHTML() {
    var catOpts = '<option value="">全部分类</option>';
    for (var i = 0; i < settings.categories.length; i++) {
      catOpts += '<option value="' + settings.categories[i].id + '"' +
        (state.search.cat === settings.categories[i].id ? ' selected' : '') + '>' + esc(settings.categories[i].name) + '</option>';
    }
    return '<div class="search-bar">' +
      '<div class="search-row">' +
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.5-4.5"/></svg>' +
      '<input id="search-q" type="search" placeholder="搜索备注、分类、金额…" value="' + esc(state.search.q) + '" autocomplete="off">' +
      '<button class="btn ghost small" data-act="search-clear">清除</button>' +
      '</div>' +
      '<div class="search-filters">' +
      '<span class="seg seg-mini" id="seg-search-type">' +
      '<button data-stype="" class="' + (state.search.type === '' ? 'on' : '') + '">全部</button>' +
      '<button data-stype="expense" class="' + (state.search.type === 'expense' ? 'on' : '') + '">支出</button>' +
      '<button data-stype="income" class="' + (state.search.type === 'income' ? 'on' : '') + '">收入</button>' +
      '</span>' +
      '<select id="search-cat" class="select-input">' + catOpts + '</select>' +
      '<span class="amt-range"><input id="search-min" type="number" inputmode="decimal" placeholder="最低" value="' + esc(state.search.min) + '"><i>—</i>' +
      '<input id="search-max" type="number" inputmode="decimal" placeholder="最高" value="' + esc(state.search.max) + '"></span>' +
      '</div></div>';
  }

  function bindSearchBar() {
    var q = $('#search-q');
    if (q && !q._bound) {
      q._bound = true;
      q.addEventListener('input', function () { state.search.q = this.value; updateSearchView(); });
    }
    var mn = $('#search-min');
    if (mn && !mn._bound) {
      mn._bound = true;
      mn.addEventListener('input', function () { state.search.min = this.value; updateSearchView(); });
    }
    var mx = $('#search-max');
    if (mx && !mx._bound) {
      mx._bound = true;
      mx.addEventListener('input', function () { state.search.max = this.value; updateSearchView(); });
    }
    var cat = $('#search-cat');
    if (cat && !cat._bound) {
      cat._bound = true;
      cat.addEventListener('change', function () { state.search.cat = this.value; updateSearchView(); });
    }
    var btns = document.querySelectorAll('#seg-search-type button');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i]._bound) continue;
      btns[i]._bound = true;
      btns[i].addEventListener('click', function () {
        state.search.type = this.getAttribute('data-stype');
        var all = document.querySelectorAll('#seg-search-type button');
        for (var j = 0; j < all.length; j++) {
          all[j].classList.toggle('on', all[j].getAttribute('data-stype') === state.search.type);
        }
        updateSearchView();
      });
    }
  }

  function matchesSearch(e) {
    var s = state.search;
    if (s.type && e.type !== s.type) return false;
    if (s.cat && e.categoryId !== s.cat) return false;
    if (s.min && e.amount < parseFloat(s.min)) return false;
    if (s.max && e.amount > parseFloat(s.max)) return false;
    var q = String(s.q).trim().toLowerCase();
    if (q) {
      var cat = catById(e.categoryId);
      var name = cat ? cat.name : (e.type === 'income' ? '收入' : '未知分类');
      var hay = ((e.note || '') + ' ' + name + ' ' + String(e.amount)).toLowerCase();
      if (hay.indexOf(q) === -1) return false;
    }
    return true;
  }

  function searchResultsHTML() {
    var list = entries.filter(matchesSearch)
      .sort(function (a, b) { return b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || ''); });
    var exp = 0, inc = 0;
    for (var i = 0; i < list.length; i++) {
      if (list[i].type === 'income') inc += list[i].amount; else exp += list[i].amount;
    }
    var html = '<div class="search-summary">共 ' + list.length + ' 笔 · 支出 ' + C.fmtMoney(C.round2(exp)) + ' · 收入 ' + C.fmtMoney(C.round2(inc)) + '</div>';
    if (!list.length) {
      html += '<div class="card"><div class="empty" style="padding:30px 10px"><p style="margin:0">没有符合条件的账单</p></div></div>';
    } else {
      var cur = '';
      for (var k = 0; k < list.length; k++) {
        var e = list[k];
        if (e.date !== cur) {
          if (cur) html += '</div>';
          html += '<div class="result-group"><div class="result-date">' + fmtDateCN(e.date) + '</div>';
          cur = e.date;
        }
        html += entryRowHTML(e);
      }
      html += '</div>';
    }
    return html;
  }

  function updateSearchView() {
    var box = $('#cal-body-main');
    if (!box) return;
    box.innerHTML = isSearchActive() ? searchResultsHTML() : calendarGridHTML();
    bindDynamic();
  }

  function renderCalendar() {
    $('#cal-body').innerHTML = searchBarHTML() + '<div id="cal-body-main"></div>';
    bindSearchBar();
    updateSearchView();
  }

  function calendarGridHTML() {
    var bm = bmFromKey(state.calMonth);
    var snap = C.snapshotForMonth(snapshots, settings, bm);
    var dayBudget = C.dayBudgetFor(snap);
    var offset = (C.weekdayOf(bm.start) + 6) % 7; // 周一开头

    var html = '<div class="cal-nav">' +
      '<button class="icon-btn" data-act="cal-prev" aria-label="上一月"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5l-7 7 7 7"/></svg></button>' +
      '<span class="month">' + C.monthLabel(bm.key) + '</span>' +
      '<button class="icon-btn" data-act="cal-next" aria-label="下一月"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 5l7 7-7 7"/></svg></button>' +
      '</div>';

    if (state.calMonth !== C.monthKeyFromDate(today, settings.monthStartDay)) {
      html += '<div style="text-align:center;margin:-4px 0 10px"><button class="btn ghost small" data-act="cal-today">回到本月</button></div>';
    }

    html += '<div class="card">' +
      '<div class="cal-week"><span>一</span><span>二</span><span>三</span><span>四</span><span>五</span><span>六</span><span>日</span></div>' +
      '<div class="cal-grid">';
    for (var i = 0; i < offset; i++) html += '<span></span>';
    for (var d = 1; d <= bm.days; d++) {
      var date = C.shiftDate(bm.start, d - 1);
      var spent = C.spentOnDay(entries, date);
      var isFuture = date > today;
      var ratio = dayBudget > 0 ? spent / dayBudget : (spent > 0 ? 2 : 0);
      var cls = 'cal-cell';
      if (!isFuture) {
        if (spent <= 0) cls += ' l4';
        else if (ratio <= 0.5) cls += ' l3';
        else if (ratio <= 0.75) cls += ' l2';
        else if (ratio <= 1) cls += ' l1';
        else if (ratio <= 1.5) cls += ' over';
        else cls += ' over2';
      } else cls += ' future';
      if (date === today) cls += ' today';
      if (date === state.selDay && !isFuture) cls += ' sel';
      var act = isFuture ? '' : ' data-act="cal-cell" data-date="' + date + '"';
      html += '<div class="' + cls + '"' + act + '>' + d + (spent > 0 ? '<span class="dot"></span>' : '') + '</div>';
    }
    html += '</div>' +
      '<div class="cal-legend">' +
      '<i class="l4" style="background:var(--grad)"></i>没花' +
      '<span class="sep">·</span><i style="background:rgba(16,185,129,.42)"></i>花得少' +
      '<span class="sep">·</span><i style="background:rgba(16,185,129,.14)"></i>接近预算' +
      '<span class="sep">·</span><i style="background:rgba(239,68,68,.16)"></i>超支' +
      '</div></div>';

    /* 选中日详情 */
    var sd = state.selDay;
    var sSpent = C.spentOnDay(entries, sd);
    var sBudget = dayBudget;
    var sSaved = C.round2(sBudget - sSpent);
    var dayEntries = entries.filter(function (e) { return e.date === sd; })
      .sort(function (a, b) { return (a.createdAt || '').localeCompare(b.createdAt || ''); });

    html += '<div class="section-title"><span>' + fmtDateCN(sd) + ' 明细</span></div>' +
      '<div class="card day-summary">' +
      '<div class="hero-stats">' +
      '<div class="stat"><div class="k">当日预算</div><div class="v">' + C.fmtMoney(sBudget) + '</div></div>' +
      '<div class="stat"><div class="k">当日净花</div><div class="v">' + C.fmtMoney(sSpent) + '</div></div>' +
      '<div class="stat"><div class="k">当日可存</div><div class="v ' + (sSaved < 0 ? 'neg' : '') + '">' + C.fmtMoney(sSaved) + '</div></div>' +
      '</div>';
    if (!dayEntries.length) {
      html += '<div class="empty" style="padding:22px 10px 10px"><p style="margin:0">这天没有记账</p></div>';
    } else {
      for (var k = 0; k < dayEntries.length; k++) {
        html += entryRowHTML(dayEntries[k]);
      }
    }
    html += '</div>';

    return html;
  }

  /* ================= 统计 ================= */

  function renderStats() {
    var bm = bmFromKey(state.statsMonth);
    var monthEntries = C.entriesInMonth(entries, bm);
    var monthExpense = C.sumExpenses(monthEntries);
    var monthIncome = C.sumIncomes(monthEntries);
    var netSpent = C.netOf(monthEntries);
    var total = monthExpense; // 环形图只统计支出
    var byCat = C.spentByCategory(entries, bm);
    var snap = C.snapshotForMonth(snapshots, settings, bm);
    var effBudget = C.effBudget(snap);
    var isCurrent = bm.key === C.monthKeyFromDate(today, settings.monthStartDay);
    var cum = C.cumulativeSavings(entries, snapshots, settings, today);
    var savedThisMonth = isCurrent
      ? C.monthSavings(entries, snap, today)
      : Math.max(0, C.round2(effBudget - netSpent));
    var usePct = effBudget > 0 ? Math.round(netSpent / effBudget * 100) : 0;

    /* 环形图数据 */
    var segs = [];
    for (var id in byCat) {
      if (!byCat.hasOwnProperty(id)) continue;
      var cat = catById(id);
      segs.push({ color: cat ? cat.color : '#64748b', name: cat ? cat.name : '未知分类', value: byCat[id] });
    }
    segs.sort(function (a, b) { return b.value - a.value; });
    var legend = '';
    for (var i = 0; i < segs.length; i++) {
      var s = segs[i];
      legend += '<div class="legend-row"><span class="dot" style="background:' + s.color + '"></span>' +
        '<span class="nm">' + esc(s.name) + '</span>' +
        '<span class="pct">' + (total > 0 ? Math.round(s.value / total * 100) : 0) + '%</span>' +
        '<span class="amt">' + C.fmtMoney(s.value) + '</span></div>';
    }

    var html = '<div class="cal-nav">' +
      '<button class="icon-btn" data-act="stats-prev" aria-label="上一月"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.5 5l-7 7 7 7"/></svg></button>' +
      '<span class="month">' + C.monthLabel(bm.key) + '</span>' +
      '<button class="icon-btn" data-act="stats-next" aria-label="下一月"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 5l7 7-7 7"/></svg></button>' +
      '</div>';

    if (state.statsMonth !== C.monthKeyFromDate(today, settings.monthStartDay)) {
      html += '<div style="text-align:center;margin:-4px 0 10px"><button class="btn ghost small" data-act="stats-today">回到本月</button></div>';
    }

    /* 汇总卡 */
    html += '<div class="card">' +
      '<div class="sum-grid">' +
      '<div class="sum-cell"><div class="k">本月支出</div><div class="v">' + C.fmtMoney(monthExpense) + '</div></div>' +
      '<div class="sum-cell"><div class="k">本月收入</div><div class="v pos">' + C.fmtMoney(monthIncome) + '</div></div>' +
      '<div class="sum-cell"><div class="k">本月已存</div><div class="v pos">' + C.fmtMoney(savedThisMonth) + '</div></div>' +
      '<div class="sum-cell"><div class="k">累计存款</div><div class="v pos">' + C.fmtMoney(cum) + '</div></div>' +
      '</div>' +
      '<div class="proj-row"><span>本月预算' + (snap.carryIn > 0 ? ' <span style="color:var(--text-3);font-size:11.5px">(含结转 ' + C.fmtMoney(snap.carryIn) + ')</span>' : '') + '</span><b>' + C.fmtMoney(effBudget) + '</b></div>' +
      '<div class="proj-row" style="padding-top:0"><span style="color:var(--text-3);font-size:11.5px">净支出 ' + C.fmtMoney(netSpent) + ' · 使用率 ' + usePct + '%</span></div>' +
      '<div class="bar' + (usePct > 100 ? ' over' : (usePct >= 80 ? ' warn' : '')) + '" style="margin-top:6px"><i style="width:' + Math.min(100, Math.max(0, usePct)) + '%"></i></div>' +
      '</div>';

    /* 分类环形图 */
    html += '<div class="card chart-card" style="margin-top:14px"><h3>分类占比</h3>' +
      (total > 0
        ? '<div class="donut-wrap">' + donutSVG(segs, total) +
          '<div class="donut-center"><div><div class="v">' + C.fmtMoney(total) + '</div><div class="k">本月总支出</div></div></div></div>' +
          '<div class="legend">' + legend + '</div>'
        : '<div class="empty" style="padding:30px 10px"><p style="margin:0">本月还没有支出记录</p></div>') +
      '</div>';

    /* 近 30 天柱状图 */
    var dates = C.lastNDays(30, today);
    var vals = dates.map(function (d) { return C.expenseOnDay(entries, d); });
    html += '<div class="card chart-card" style="margin-top:14px"><h3>近 30 天消费</h3>' +
      '<div class="bars-wrap">' + barsSVG(dates, vals) + '</div></div>';

    /* 存钱目标 */
    html += '<div class="section-title"><span>存钱目标</span>' +
      '<button class="btn ghost small" data-act="add-goal">+ 添加目标</button></div>' +
      '<div class="card">';
    if (!goals.length) {
      html += '<div class="empty" style="padding:26px 10px"><p style="margin:0">设一个目标,比如「攒 2000 买平板」<br>攒下的每一块钱都会累积到这里</p></div>';
    } else {
      for (var g = 0; g < goals.length; g++) {
        var goal = goals[g];
        var pctg = Math.min(100, Math.round(cum / goal.target * 100));
        html += '<div class="goal"><div class="top">' +
          '<span class="nm">' + esc(goal.name) + '</span>' +
          '<span class="amt"><b>' + C.fmtMoney(Math.min(cum, goal.target)) + '</b> / ' + C.fmtMoney(goal.target) + '</span>' +
          '</div>' +
          '<div class="bar"><i style="width:' + pctg + '%"></i></div>' +
          '<div class="proj-row" style="padding:6px 2px 0"><span style="color:var(--text-3);font-size:11.5px">' + pctg + '% 达成</span>' +
          '<button class="btn ghost small" data-act="del-goal" data-id="' + goal.id + '">删除</button></div></div>';
      }
    }
    html += '</div>';

    $('#stats-body').innerHTML = html;
  }

  function donutSVG(segs, total) {
    var R = 62, circ = 2 * Math.PI * R;
    var html = '<svg viewBox="0 0 160 160">';
    var offset = 0;
    for (var i = 0; i < segs.length; i++) {
      var len = segs[i].value / total * circ;
      html += '<circle class="donut-seg" cx="80" cy="80" r="' + R + '" fill="none" stroke="' + segs[i].color +
        '" stroke-width="17" stroke-dasharray="' + len + ' ' + (circ - len) + '" stroke-dashoffset="' + (-offset) + '"/>';
      offset += len;
    }
    return html + '</svg>';
  }

  function barsSVG(dates, vals) {
    var W = 320, H = 92, pad = 6, labelH = 16;
    var max = 1;
    for (var i = 0; i < vals.length; i++) max = Math.max(max, vals[i]);
    var bw = (W - pad * 2) / dates.length;
    var html = '<svg viewBox="0 0 ' + W + ' ' + (H + labelH) + '">' +
      '<defs><linearGradient id="barsGrad" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0" stop-color="#34d399"/><stop offset="1" stop-color="#0d9488"/></linearGradient></defs>';
    for (var j = 0; j < dates.length; j++) {
      var h = Math.max(3, Math.round(vals[j] / max * (H - 12)));
      var x = pad + j * bw + bw * 0.18;
      var w = bw * 0.64;
      var y = H - h;
      html += '<rect x="' + x.toFixed(1) + '" y="' + y + '" width="' + w.toFixed(1) + '" height="' + h + '" rx="' + Math.min(4, w / 2).toFixed(1) + '" fill="url(#barsGrad)" opacity="' + (vals[j] > 0 ? 1 : 0.16) + '"><title>' + dates[j] + ' ' + C.fmtMoney(vals[j]) + '</title></rect>';
    }
    html += '<text x="' + pad + '" y="' + (H + 12) + '" font-size="9" fill="var(--text-3)">' + dates[0].slice(5) + '</text>';
    html += '<text x="' + (W / 2 - 16) + '" y="' + (H + 12) + '" font-size="9" fill="var(--text-3)">' + dates[14].slice(5) + '</text>';
    html += '<text x="' + (W - pad - 26) + '" y="' + (H + 12) + '" font-size="9" fill="var(--text-3)">' + dates[29].slice(5) + '</text>';
    return html + '</svg>';
  }

  /* ================= 设置 ================= */

  function renderSettings() {
    var isIOS = detectIOS();
    var standalone = isStandalone();

    var cats = '';
    for (var i = 0; i < settings.categories.length; i++) {
      var c = settings.categories[i];
      cats += '<div class="cat-edit-row">' + badgeHTML(c) +
        '<div class="mid"><div class="nm">' + esc(c.name) + '</div>' +
        '<div class="dp">每日计划 ' + C.fmtMoney(c.dailyPlan) + '</div></div>' +
        '<button class="btn ghost small" data-act="edit-cat" data-id="' + c.id + '">编辑</button></div>';
    }

    var html = '';

    /* 预算 */
    html += '<div class="set-section"><h3>预算</h3><div class="card">' +
      '<div class="set-row"><span class="k">每月生活费<span class="hint">到账后可用于整月开销的总额</span></span>' +
      '<input class="num-input" id="in-budget" type="number" inputmode="decimal" min="1" step="0.01" value="' + settings.monthlyBudget + '"></div>' +
      '<div class="set-row"><span class="k">生活费到账日<span class="hint">每月几号到账(1–28 号)</span></span>' +
      '<select class="select-input" id="in-startday">' +
      (function () {
        var o = '';
        for (var d = 1; d <= 28; d++) {
          o += '<option value="' + d + '"' + (settings.monthStartDay === d ? ' selected' : '') + '>' + d + ' 号</option>';
        }
        return o;
      })() + '</select></div>' +
      '<div class="set-row"><span class="k">存钱策略<span class="hint">「今日可存」的计算方式</span></span></div>' +
      '<div class="opt-cards">' +
      '<div class="opt-card' + (settings.strategy === 'average' ? ' on' : '') + '" data-act="strategy" data-val="average">' +
      '<div class="t">动态平均法</div><div class="d">今日预算 = 剩余生活费 ÷ 剩余天数,花超了后面自动收紧</div></div>' +
      '<div class="opt-card' + (settings.strategy === 'fixed' ? ' on' : '') + '" data-act="strategy" data-val="fixed">' +
      '<div class="t">固定每日额度</div><div class="d">自己设定每天最多花多少,简单直观</div></div>' +
      '</div>' +
      '<div class="set-row" id="row-fixed" style="' + (settings.strategy === 'fixed' ? '' : 'opacity:.45') + '"><span class="k">每日额度</span>' +
      '<input class="num-input" id="in-fixed" type="number" inputmode="decimal" min="0" step="0.01" value="' + settings.fixedDaily + '"></div>' +
      '<div class="set-row"><span class="k">月末结余自动结转<span class="hint">上月没花完的钱自动滚入本月预算</span></span>' +
      '<button class="switch' + (settings.carryOver ? ' on' : '') + '" data-act="carryover" role="switch" aria-checked="' + settings.carryOver + '"><i></i></button></div>' +
      '</div></div>';

    /* 外观 */
    html += '<div class="set-section"><h3>外观</h3><div class="card">' +
      '<div class="set-row"><span class="k">主题</span><span class="seg" id="seg-theme">' +
      '<button data-act="theme" data-val="auto" class="' + (settings.theme === 'auto' ? 'on' : '') + '">自动</button>' +
      '<button data-act="theme" data-val="light" class="' + (settings.theme === 'light' ? 'on' : '') + '">浅色</button>' +
      '<button data-act="theme" data-val="dark" class="' + (settings.theme === 'dark' ? 'on' : '') + '">深色</button>' +
      '</span></div></div></div>';

    /* 分类 */
    html += '<div class="set-section"><h3>消费分类</h3><div class="card">' + cats +
      '<div style="padding:10px 4px 2px"><button class="btn ghost small" data-act="add-cat">+ 新增分类</button></div>' +
      '</div></div>';

    /* 数据 */
    html += '<div class="set-section"><h3>数据</h3><div class="card">' +
      '<div class="set-row"><span class="k">导出备份<span class="hint">保存为 JSON 文件,可发到电脑/另一台手机导入</span></span>' +
      '<button class="btn ghost small" data-act="export">导出</button></div>' +
      '<div class="set-row"><span class="k">导入备份<span class="hint">将覆盖当前全部数据</span></span>' +
      '<button class="btn ghost small" data-act="import">导入</button></div>' +
      '<div class="set-row"><span class="k">清空数据<span class="hint">删除所有记录,无法恢复</span></span>' +
      '<button class="btn danger small" data-act="clear">清空</button></div>' +
      '</div></div>';

    /* 关于 */
    html += '<div class="set-section"><h3>关于</h3><div class="card">' +
      '<div class="set-row"><span class="k">版本</span><span style="color:var(--text-3);font-size:13px">存钱罐 v1.0.0</span></div>' +
      '<div class="set-row"><span class="k">数据位置<span class="hint">仅保存在本机浏览器,不会上传</span></span></div>' +
      (isIOS && !standalone
        ? '<div class="set-row"><span class="k">添加到主屏幕<span class="hint">像 App 一样全屏使用、离线可用</span></span>' +
          '<button class="btn primary small" data-act="install-help">查看方法</button></div>'
        : '') +
      '<div class="meta-line">攒下的每一块钱,都是给未来的自己<br>· 存钱罐 ·</div>' +
      '</div></div>';

    $('#set-body').innerHTML = html;
  }

  /* ================= 记账弹层 ================= */

  function openSheet(mode, entry) {
    state.sheet = {
      mode: mode,
      id: entry ? entry.id : null,
      type: entry ? (entry.type || 'expense') : 'expense',
      amount: entry ? String(entry.amount) : '',
      catId: entry ? (entry.categoryId || '') : (settings.categories.length ? settings.categories[0].id : ''),
      date: entry ? entry.date : today,
      note: entry ? (entry.note || '') : '',
      createdAt: entry ? entry.createdAt : null
    };
    $('#sheet-title').textContent = mode === 'edit' ? '编辑账单' : '记一笔';
    $('#sheet-date').value = state.sheet.date;
    $('#sheet-note').value = state.sheet.note;
    $('#sheet-delete').hidden = mode !== 'edit';
    renderSheetType();
    renderSheetCats();
    renderSheetAmount();
    renderKeypad();
    $('#sheet-mask').classList.add('open');
    $('#sheet').classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeSheet() {
    $('#sheet-mask').classList.remove('open');
    $('#sheet').classList.remove('open');
    document.body.style.overflow = '';
    state.sheet = null;
  }

  function renderSheetType() {
    var t = state.sheet.type;
    $('#sheet-type').innerHTML =
      '<span class="seg" id="seg-sheet-type">' +
      '<button data-stype="expense" class="' + (t === 'expense' ? 'on' : '') + '">支出</button>' +
      '<button data-stype="income" class="' + (t === 'income' ? 'on' : '') + '">收入</button>' +
      '</span>';
    var btns = document.querySelectorAll('#seg-sheet-type button');
    for (var i = 0; i < btns.length; i++) {
      btns[i].addEventListener('click', function () {
        if (!state.sheet) return;
        state.sheet.type = this.getAttribute('data-stype');
        renderSheetType();
        renderSheetCats();
      });
    }
    $('#sheet-cats').style.display = t === 'income' ? 'none' : '';
  }

  function renderSheetCats() {
    var html = '';
    if (state.sheet.type !== 'income') {
      for (var i = 0; i < settings.categories.length; i++) {
        var c = settings.categories[i];
        html += '<div class="cat-pick' + (state.sheet.catId === c.id ? ' on' : '') + '" data-id="' + c.id + '">' +
          badgeHTML(c) + '<span>' + esc(c.name) + '</span></div>';
      }
    }
    $('#sheet-cats').innerHTML = html;
    var picks = document.querySelectorAll('#sheet-cats .cat-pick');
    for (var k = 0; k < picks.length; k++) {
      picks[k].addEventListener('click', function () {
        if (!state.sheet) return;
        state.sheet.catId = this.getAttribute('data-id');
        renderSheetCats();
      });
    }
  }

  function renderSheetAmount() {
    var el = $('#sheet-amount');
    var txt = state.sheet.amount || '0';
    el.textContent = txt;
    el.classList.toggle('zero', !state.sheet.amount);
  }

  function renderKeypad() {
    var rows = [['1', '2', '3'], ['4', '5', '6'], ['7', '8', '9'], ['.', '0', '⌫']];
    var html = '';
    for (var r = 0; r < rows.length; r++) {
      for (var c = 0; c < rows[r].length; c++) {
        var k = rows[r][c];
        html += '<button class="key' + (k === '.' || k === '⌫' ? ' fn' : '') + '" data-key="' + k + '">' + k + '</button>';
      }
    }
    $('#keypad').innerHTML = html;
  }

  function keypadInput(key) {
    var amt = state.sheet.amount;
    if (key === '⌫') { state.sheet.amount = amt.slice(0, -1); }
    else if (key === '.') {
      if (!amt) state.sheet.amount = '0.';
      else if (amt.indexOf('.') === -1) state.sheet.amount = amt + '.';
    } else {
      if (amt.indexOf('.') !== -1 && amt.split('.')[1].length >= 2) return;
      if (amt === '0') amt = '';
      if (amt.length >= 9) return;
      state.sheet.amount = amt + key;
    }
    renderSheetAmount();
    if (navigator.vibrate) { try { navigator.vibrate(8); } catch (e) { /* iOS 不支持,忽略 */ } }
  }

  function sheetSave() {
    var num = parseFloat(state.sheet.amount);
    if (!C.isValidAmount(num)) {
      showToast('请输入正确的金额');
      return;
    }
    var date = $('#sheet-date').value || today;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      showToast('日期不正确');
      return;
    }
    var note = $('#sheet-note').value.trim().slice(0, 100);
    var isEdit = state.sheet.mode === 'edit';
    var isIncome = state.sheet.type === 'income';
    var entry = {
      id: isEdit ? state.sheet.id : S.uid(),
      date: date,
      amount: C.round2(num),
      categoryId: isIncome ? '' : state.sheet.catId,
      note: note,
      createdAt: isEdit ? state.sheet.createdAt : new Date().toISOString(),
      type: isIncome ? 'income' : 'expense'
    };
    var catForAlert = isIncome ? null : catById(entry.categoryId);
    if (isEdit) {
      for (var i = 0; i < entries.length; i++) {
        if (entries[i].id === entry.id) { entries[i] = entry; break; }
      }
    } else {
      entries.push(entry);
    }
    saveAll();
    closeSheet();

    /* 超支即时提示 */
    var msg = isEdit ? '已保存' : '已记一笔 🎉';
    if (!isEdit) {
      if (isIncome) {
        msg = '已记一笔收入 +' + C.fmtMoney(C.round2(num));
      } else {
        var st = C.todayStats(settings, entries, today, snapshots);
        var catRest = catForAlert ? C.round2(catForAlert.dailyPlan - C.spentInCategoryOnDay(entries, today, catForAlert.id)) : null;
        if (st.todaySavings < 0) {
          msg = '⚠️ 今日已超支 ' + C.fmtMoney(Math.abs(st.todaySavings)) + ',后面省一点哦';
        } else if (st.dailyBudget > 0 && st.todaySpent / st.dailyBudget >= 0.8) {
          msg = '今日预算已用 ' + Math.round(st.todaySpent / st.dailyBudget * 100) + '%,还剩 ' + C.fmtMoney(st.todaySavings);
        } else if (catRest !== null && catRest < 0) {
          msg = '「' + catForAlert.name + '」今日已超计划 ' + C.fmtMoney(Math.abs(catRest));
        }
      }
    }
    showToast(msg);
    render();
  }

  function sheetDelete() {
    showConfirm('删除账单', '确定删除这笔 ' + C.fmtMoney(parseFloat(state.sheet.amount) || 0) + ' 的记录吗?', function () {
      entries = entries.filter(function (e) { return e.id !== state.sheet.id; });
      saveAll();
      closeSheet();
      showToast('已删除');
      render();
    });
  }

  /* ================= 引导页 ================= */

  function showOnboarding() {
    state.onboard = { step: 1, budget: '1500', startDay: 1 };
    renderOnboard();
    $('#onboarding').classList.add('open');
  }
  function closeOnboarding() {
    $('#onboarding').classList.remove('open');
    state.onboard = null;
  }

  function renderOnboard() {
    var o = state.onboard;
    var dots = '<div class="dots"><i class="on"></i><i class="' + (o.step >= 2 ? 'on' : '') + '"></i><i class="' + (o.step >= 3 ? 'on' : '') + '"></i></div>';
    var html = '';
    if (o.step === 1) {
      html += '<div class="onboard-hero"><svg viewBox="0 0 40 40" fill="none">' +
        '<circle cx="20" cy="20" r="16" fill="rgba(255,255,255,.92)"/>' +
        '<g stroke="#0d9488" stroke-width="3" stroke-linecap="round">' +
        '<path d="M20 13v14"/><path d="M14.5 13l5.5 7M25.5 13L20 20"/><path d="M15.5 21h9M15 26h10"/></g></svg></div>' +
        '<h3>欢迎使用存钱罐 👋</h3>' +
        '<p class="desc">记录每一笔开销,实时算出今天还能存下多少钱。<br>先告诉我,你每个月有多少生活费?</p>' +
        '<div><input class="onboard-big-input" id="ob-budget" type="number" inputmode="decimal" min="1" step="0.01" value="' + esc(o.budget) + '"></div>' +
        '<div class="onboard-unit">元 / 月</div>' +
        '<button class="btn primary block" data-act="onboard-next">下一步</button>' + dots;
    } else if (o.step === 2) {
      html += '<div class="onboard-hero" style="background:linear-gradient(135deg,#fbbf24,#f97316)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><rect x="3.5" y="5" width="17" height="16" rx="3.5"/><path d="M3.5 10h17M8 2.8v4.4M16 2.8v4.4"/></svg></div>' +
        '<h3>生活费几号到账?</h3>' +
        '<p class="desc">预算月从到账日算起。<br>比如 15 号到账,预算月就是 15 号到下月 14 号。</p>' +
        '<div class="day-grid">';
      for (var d = 1; d <= 28; d++) {
        html += '<button data-act="onboard-day" data-day="' + d + '" class="' + (o.startDay === d ? 'on' : '') + '">' + d + '</button>';
      }
      html += '</div>' +
        '<button class="btn primary block" data-act="onboard-next">下一步</button>' + dots;
    } else {
      html += '<div class="onboard-hero" style="background:linear-gradient(135deg,#a78bfa,#8b5cf6)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/></svg></div>' +
        '<h3>分类计划已就绪</h3>' +
        '<p class="desc">预置了大学生常用分类和每日建议额度,<br>之后可以在「设置」里自由调整。</p>' +
        '<div class="onboard-cats">';
      for (var i = 0; i < settings.categories.length; i++) {
        var c = settings.categories[i];
        html += '<div class="cat-chip" style="padding:9px 10px">' + badgeHTML(c) +
          '<div class="info"><div class="name">' + esc(c.name) + '</div>' +
          '<div class="rest">' + C.fmtMoney(c.dailyPlan) + '/天</div></div></div>';
      }
      html += '</div>' +
        '<button class="btn primary block" data-act="onboard-finish">开始存钱 🎉</button>' + dots;
    }
    $('#onboard-body').innerHTML = html;
    bindDynamic();
  }

  function onboardFinish() {
    var budget = parseFloat(state.onboard.budget);
    if (!C.isValidAmount(budget)) {
      showToast('请输入有效的生活费金额');
      return;
    }
    settings.monthlyBudget = C.round2(budget);
    settings.monthStartDay = state.onboard.startDay;
    settings.setupDone = true;
    saveSettingsOnly();
    closeOnboarding();
    showToast('设置完成,开始存钱吧 🎉', 2400);
    render();
    maybeShowInstall();
  }

  /* ================= 通用弹窗 ================= */

  function showConfirm(title, text, cb, dangerText) {
    $('#confirm-title').textContent = title;
    $('#confirm-text').textContent = text;
    $('#confirm-ok').textContent = dangerText || '确定';
    $('#confirm-ok').className = 'btn ' + (dangerText === '删除' || text.indexOf('清空') !== -1 || text.indexOf('覆盖') !== -1 ? 'danger' : 'primary');
    state.confirmCb = cb;
    $('#confirm-modal').classList.add('open');
  }
  function closeConfirm() {
    $('#confirm-modal').classList.remove('open');
    state.confirmCb = null;
  }

  function showForm(opts) {
    state.form = opts;
    $('#form-title').textContent = opts.title;
    $('#form-ok').textContent = opts.okText || '保存';
    var html = '<div class="form-body">';
    if (opts.fields) {
      for (var i = 0; i < opts.fields.length; i++) {
        var f = opts.fields[i];
        html += '<label>' + esc(f.label) + '<input id="f-' + i + '" type="' + (f.type || 'text') + '" placeholder="' + esc(f.placeholder || '') + '" value="' + esc(f.value != null ? f.value : '') + '"' + (f.inputmode ? ' inputmode="' + f.inputmode + '"' : '') + '></label>';
      }
    }
    if (opts.palette) {
      html += '<div class="palette" id="f-palette">';
      for (var p = 0; p < PALETTE.length; p++) {
        html += '<button type="button" data-color="' + PALETTE[p] + '" style="background:' + PALETTE[p] + '" class="' + (state.form.color === PALETTE[p] ? 'on' : '') + '" aria-label="颜色"></button>';
      }
      html += '</div>';
    }
    if (opts.icons) {
      html += '<label>图标<select id="f-icon" class="select-input" style="font-size:15px">';
      for (var n in ICONS) {
        if (!ICONS.hasOwnProperty(n)) continue;
        html += '<option value="' + n + '"' + (state.form.icon === n ? ' selected' : '') + '>' + (ICON_LABELS[n] || n) + '</option>';
      }
      html += '</select></label>';
    }
    if (opts.deletable) {
      html += '<button type="button" class="btn danger" id="f-delete" style="margin-top:6px">删除该分类</button>';
    }
    html += '</div>';
    $('#form-body').innerHTML = html;
    var palBtns = document.querySelectorAll('#f-palette button');
    for (var q = 0; q < palBtns.length; q++) {
      palBtns[q].addEventListener('click', function () {
        if (!state.form) return;
        state.form.color = this.getAttribute('data-color');
        var all = document.querySelectorAll('#f-palette button');
        for (var w = 0; w < all.length; w++) {
          all[w].classList.toggle('on', all[w].getAttribute('data-color') === state.form.color);
        }
      });
    }
    $('#form-modal').classList.add('open');
  }
  function closeForm() {
    $('#form-modal').classList.remove('open');
    state.form = null;
  }

  function formOk() {
    var f = state.form;
    if (!f) return;
    var vals = [];
    if (f.fields) {
      for (var i = 0; i < f.fields.length; i++) {
        vals.push($('#f-' + i).value);
      }
    }
    f.onOk(vals);
  }

  /* ================= 安装引导 ================= */

  function detectIOS() {
    return /iphone|ipad|ipod/i.test(navigator.userAgent) ||
      (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  function isStandalone() {
    return window.navigator.standalone === true ||
      window.matchMedia('(display-mode: standalone)').matches;
  }
  function maybeShowInstall() {
    if (!settings.setupDone || meta.installDismissed) return;
    if (!/^https?:$/.test(location.protocol)) return;
    if (!detectIOS() || isStandalone()) return;
    setTimeout(function () {
      $('#install-modal').classList.add('open');
    }, 700);
  }

  /* ================= 数据操作 ================= */

  function doExport() {
    S.downloadBackup(settings, entries, goals, snapshots);
    meta = S.loadMeta();
    showToast('备份已导出 ✓');
  }

  function doImport() {
    $('#import-input').click();
  }

  function doClear() {
    showConfirm('清空数据', '将删除所有账单、目标和设置,且无法恢复。确定继续吗?', function () {
      S.clearAll();
      settings = S.loadSettings();
      entries = [];
      goals = [];
      snapshots = {};
      meta = {};
      today = C.todayStr();
      showOnboarding();
      showToast('数据已清空');
    }, '清空');
  }

  /* ================= 事件绑定 ================= */

  function bindDynamic() {
    var acts = document.querySelectorAll('[data-act]');
    for (var i = 0; i < acts.length; i++) {
      (function (node) {
        var act = node.getAttribute('data-act');
        if (node._bound) return;
        node._bound = true;
        node.addEventListener('click', function (ev) {
          ev.stopPropagation();
          handleAct(act, node);
        });
      })(acts[i]);
    }
    /* 输入框(change 保存,避免重渲染打断输入) */
    var budget = $('#in-budget');
    if (budget && !budget._bound) {
      budget._bound = true;
      budget.addEventListener('change', function () {
        var v = parseFloat(budget.value);
        if (!C.isValidAmount(v)) { showToast('请输入有效金额'); budget.value = settings.monthlyBudget; return; }
        settings.monthlyBudget = C.round2(v);
        saveSettingsOnly();
        showToast('已保存');
        render();
      });
    }
    var startday = $('#in-startday');
    if (startday && !startday._bound) {
      startday._bound = true;
      startday.addEventListener('change', function () {
        settings.monthStartDay = parseInt(startday.value, 10) || 1;
        saveSettingsOnly();
        state.calMonth = C.monthKeyFromDate(today, settings.monthStartDay);
        state.statsMonth = state.calMonth;
        showToast('已保存');
        render();
      });
    }
    var fixed = $('#in-fixed');
    if (fixed && !fixed._bound) {
      fixed._bound = true;
      fixed.addEventListener('change', function () {
        var v = parseFloat(fixed.value);
        if (!C.isValidNonNeg(v)) { showToast('请输入有效金额'); fixed.value = settings.fixedDaily; return; }
        settings.fixedDaily = C.round2(v);
        saveSettingsOnly();
        showToast('已保存');
        render();
      });
    }
  }

  function handleAct(act, node) {
    var id, date;
    switch (act) {
      case 'open-add': openSheet('add'); break;
      case 'empty-add': openSheet('add'); break;
      case 'edit-entry':
        id = node.getAttribute('data-id');
        for (var i = 0; i < entries.length; i++) {
          if (entries[i].id === id) { openSheet('edit', entries[i]); break; }
        }
        break;
      case 'cal-cell':
        date = node.getAttribute('data-date');
        if (date && date <= today) { state.selDay = date; renderCalendar(); }
        break;
      case 'cal-prev':
        state.calMonth = shiftMonthKey(state.calMonth, -1);
        setSelDayForCalMonth();
        renderCalendar();
        break;
      case 'cal-next':
        state.calMonth = shiftMonthKey(state.calMonth, 1);
        setSelDayForCalMonth();
        renderCalendar();
        break;
      case 'cal-today':
        state.calMonth = C.monthKeyFromDate(today, settings.monthStartDay);
        state.selDay = today;
        renderCalendar();
        break;
      case 'stats-prev': state.statsMonth = shiftMonthKey(state.statsMonth, -1); renderStats(); break;
      case 'stats-next': state.statsMonth = shiftMonthKey(state.statsMonth, 1); renderStats(); break;
      case 'stats-today':
        state.statsMonth = C.monthKeyFromDate(today, settings.monthStartDay);
        renderStats();
        break;
      case 'strategy':
        settings.strategy = node.getAttribute('data-val');
        saveSettingsOnly();
        render();
        showToast(settings.strategy === 'fixed' ? '已切换为固定每日额度' : '已切换为动态平均法');
        break;
      case 'theme':
        settings.theme = node.getAttribute('data-val');
        S.saveSettings(settings);
        applyTheme();
        render();
        break;
      case 'edit-cat': openCatForm(node.getAttribute('data-id')); break;
      case 'add-cat': openCatForm(null); break;
      case 'add-goal': openGoalForm(); break;
      case 'del-goal':
        id = node.getAttribute('data-id');
        showConfirm('删除目标', '确定删除这个存钱目标吗?', function () {
          goals = goals.filter(function (g) { return g.id !== id; });
          saveAll();
          showToast('已删除');
          render();
        }, '删除');
        break;
      case 'export': doExport(); break;
      case 'import': doImport(); break;
      case 'clear': doClear(); break;
      case 'dismiss-backup':
        meta.lastRemindedAt = new Date().toISOString();
        S.saveMeta(meta);
        renderToday();
        break;
      case 'install-help':
        $('#install-modal').classList.add('open');
        break;
      case 'onboard-next': onboardNext(); break;
      case 'onboard-day': onboardPickDay(node.getAttribute('data-day')); break;
      case 'onboard-finish': onboardFinish(); break;
      case 'carryover':
        settings.carryOver = !settings.carryOver;
        saveSettingsOnly();
        render();
        showToast(settings.carryOver ? '已开启月末结转' : '已关闭月末结转');
        break;
      case 'search-clear':
        state.search = { q: '', type: '', cat: '', min: '', max: '' };
        renderCalendar();
        break;
    }
  }

  function setSelDayForCalMonth() {
    var cur = C.monthKeyFromDate(today, settings.monthStartDay);
    state.selDay = state.calMonth === cur ? today : bmFromKey(state.calMonth).start;
  }

  function onboardNext() {
    var o = state.onboard;
    if (o.step === 1) {
      var v = parseFloat($('#ob-budget') ? $('#ob-budget').value : o.budget);
      if (!C.isValidAmount(v)) { showToast('请输入有效的生活费金额'); return; }
      o.budget = String(v);
    }
    if (o.step < 3) { o.step += 1; renderOnboard(); }
  }
  function onboardPickDay(d) {
    state.onboard.startDay = parseInt(d, 10);
    renderOnboard();
  }

  /* ---------- 分类表单 ---------- */

  function openCatForm(id) {
    var cat = id ? catById(id) : null;
    if (cat) {
      state.form = {
        mode: 'cat', id: id, color: cat.color, icon: cat.icon, onOk: saveCat
      };
      showForm({
        title: '编辑分类',
        fields: [
          { label: '名称', value: cat.name, placeholder: '如:奶茶' },
          { label: '每日计划(元)', value: cat.dailyPlan, type: 'number', inputmode: 'decimal' }
        ],
        icons: true,
        palette: true,
        deletable: settings.categories.length > 1,
        okText: '保存'
      });
    } else {
      state.form = {
        mode: 'cat', id: null,
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
        icon: 'dots', onOk: saveCat
      };
      showForm({
        title: '新增分类',
        fields: [
          { label: '名称', placeholder: '如:奶茶' },
          { label: '每日计划(元)', value: 10, type: 'number', inputmode: 'decimal' }
        ],
        icons: true,
        palette: true,
        okText: '添加'
      });
    }
  }

  function saveCat(vals) {
    var name = String(vals[0] || '').trim().slice(0, 8);
    var plan = parseFloat(vals[1]);
    if (!name) { showToast('请输入分类名称'); return; }
    if (!C.isValidNonNeg(plan)) { showToast('每日计划请输入 0 或正数'); return; }
    var icon = $('#f-icon') ? $('#f-icon').value : state.form.icon;
    var color = state.form.color;
    if (state.form.id) {
      var cat = catById(state.form.id);
      cat.name = name; cat.dailyPlan = C.round2(plan); cat.icon = icon; cat.color = color;
    } else {
      settings.categories.push({
        id: 'c-' + S.uid().slice(0, 8),
        name: name, icon: icon, color: color, dailyPlan: C.round2(plan)
      });
    }
    saveSettingsOnly();
    closeForm();
    showToast('已保存');
    render();
  }

  function formDeleteCat() {
    if (settings.categories.length <= 1) { showToast('至少保留一个分类'); return; }
    var id = state.form.id;
    showConfirm('删除分类', '删除后,已记账的该分类记录会显示为「未知分类」。确定删除?', function () {
      settings.categories = settings.categories.filter(function (c) { return c.id !== id; });
      saveSettingsOnly();
      closeForm();
      showToast('已删除');
      render();
    }, '删除');
  }

  /* ---------- 目标表单 ---------- */

  function openGoalForm() {
    state.form = { mode: 'goal', onOk: saveGoal };
    showForm({
      title: '添加存钱目标',
      fields: [
        { label: '目标名称', placeholder: '如:买平板 / 旅行基金' },
        { label: '目标金额(元)', value: 1000, type: 'number', inputmode: 'decimal' }
      ],
      okText: '添加'
    });
  }

  function saveGoal(vals) {
    var name = String(vals[0] || '').trim().slice(0, 20);
    var target = parseFloat(vals[1]);
    if (!name) { showToast('请输入目标名称'); return; }
    if (!C.isValidAmount(target)) { showToast('请输入正确的目标金额'); return; }
    goals.push({ id: S.uid(), name: name, target: C.round2(target), createdAt: new Date().toISOString() });
    saveAll();
    closeForm();
    showToast('目标已添加 🎯');
    render();
  }

  /* ================= 全局事件 ================= */

  function bindGlobal() {
    /* 底部导航 */
    var tabs = document.querySelectorAll('.tab');
    for (var i = 0; i < tabs.length; i++) {
      tabs[i].addEventListener('click', function () {
        switchView(this.getAttribute('data-view'));
      });
    }
    $('#fab').addEventListener('click', function () { openSheet('add'); });
    $('#btn-export').addEventListener('click', doExport);

    /* 弹层 */
    $('#sheet-mask').addEventListener('click', closeSheet);
    $('#keypad').addEventListener('click', function (ev) {
      var btn = ev.target.closest('.key');
      if (btn) keypadInput(btn.getAttribute('data-key'));
    });
    $('#sheet-date').addEventListener('change', function () {
      if (state.sheet) state.sheet.date = this.value;
    });
    $('#sheet-note').addEventListener('input', function () {
      if (state.sheet) state.sheet.note = this.value;
    });
    $('#sheet-save').addEventListener('click', sheetSave);
    $('#sheet-delete').addEventListener('click', sheetDelete);

    /* 弹窗 */
    $('#install-ok').addEventListener('click', function () {
      $('#install-modal').classList.remove('open');
      meta.installDismissed = true;
      S.saveMeta(meta);
    });
    $('#confirm-cancel').addEventListener('click', closeConfirm);
    $('#confirm-ok').addEventListener('click', function () {
      var cb = state.confirmCb;
      closeConfirm();
      if (cb) cb();
    });
    $('#form-cancel').addEventListener('click', closeForm);
    $('#form-ok').addEventListener('click', formOk);
    document.addEventListener('click', function (ev) {
      if (ev.target.id === 'f-delete') formDeleteCat();
    });

    /* 导入 */
    $('#import-input').addEventListener('change', function () {
      var file = this.files && this.files[0];
      this.value = '';
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        var res = S.validateImport(reader.result);
        if (!res.ok) {
          showToast(res.error, 3200);
          return;
        }
        showConfirm('导入备份', '将用备份覆盖当前数据(共 ' + res.data.entries.length + ' 笔记录)。确定继续?', function () {
          S.applyImport(res.data);
          settings = S.loadSettings();
          entries = S.loadEntries();
          goals = S.loadGoals();
          snapshots = S.loadSnapshots();
          meta = S.loadMeta();
          today = C.todayStr();
          state.calMonth = C.monthKeyFromDate(today, settings.monthStartDay);
          state.statsMonth = state.calMonth;
          state.selDay = today;
          applyTheme();
          render();
          showToast('导入成功 ✓');
        });
      };
      reader.onerror = function () { showToast('读取文件失败', 3000); };
      reader.readAsText(file);
    });

    /* 主题跟随系统 */
    if (mqlDark.addEventListener) {
      mqlDark.addEventListener('change', function () { if (settings.theme === 'auto') applyTheme(); });
    }
  }

  /* ================= 跨天刷新 ================= */

  function checkRollover() {
    var t = C.todayStr();
    if (t !== today) {
      today = t;
      state.selDay = today;
      state.calMonth = C.monthKeyFromDate(today, settings.monthStartDay);
      state.statsMonth = state.calMonth;
      render();
    }
  }

  /* ================= 启动 ================= */

  function init() {
    applyTheme();
    bindGlobal();

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('./sw.js').catch(function () {});
      });
    }

    setInterval(checkRollover, 60000);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) checkRollover();
    });

    if (settings.setupDone) {
      switchView('today');
      maybeShowInstall();
    } else {
      $('#topbar-sub').textContent = '欢迎使用存钱罐';
      showOnboarding();
    }
  }

  init();
})();
