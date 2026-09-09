/* ============================================================
 * 存钱罐 · 存储层
 * localStorage 读写(不可用时内存兜底)、JSON 导出/导入、
 * 预算月快照维护、备份提醒元数据。
 * 依赖:全局 PiggyCore(先于本文件加载)。
 * ============================================================ */
(function (global) {
  'use strict';

  var C = global.PiggyCore;
  var PREFIX = 'piggy.v1.';
  var KEY_SETTINGS = PREFIX + 'settings';
  var KEY_ENTRIES = PREFIX + 'entries';
  var KEY_GOALS = PREFIX + 'goals';
  var KEY_SNAPSHOTS = PREFIX + 'snapshots';
  var KEY_META = PREFIX + 'meta';

  var memory = {};      // localStorage 不可用时的内存兜底
  var persistent = false;
  var loadErrors = [];  // 启动时发现的损坏数据

  function canPersist() {
    try {
      var k = PREFIX + 'probe';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  }

  function rawGet(key) {
    if (persistent) return global.localStorage.getItem(key);
    return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null;
  }
  function rawSet(key, value) {
    if (persistent) { global.localStorage.setItem(key, value); return; }
    memory[key] = value;
  }
  function rawDel(key) {
    if (persistent) { global.localStorage.removeItem(key); return; }
    delete memory[key];
  }

  function loadJSON(key, fallback) {
    var raw = rawGet(key);
    if (raw === null || raw === undefined) return fallback;
    try {
      var obj = JSON.parse(raw);
      if (obj === null || typeof obj !== 'object') throw new Error('not object');
      return obj;
    } catch (e) {
      loadErrors.push(key);
      return fallback;
    }
  }

  /* ---------- 默认值 ---------- */

  function defaultSettings() {
    return {
      version: 1,
      setupDone: false,
      monthlyBudget: 1500,
      savingsTarget: 0,
      strategy: 'average',
      fixedDaily: 50,
      monthStartDay: 1,
      theme: 'auto',
      carryOver: false,
      categories: C.DEFAULT_CATEGORIES.map(function (c) {
        return { id: c.id, name: c.name, icon: c.icon, color: c.color, dailyPlan: c.dailyPlan };
      })
    };
  }

  function normalizeSettings(s) {
    var d = defaultSettings();
    if (!s || typeof s !== 'object') return d;
    var out = Object.assign({}, d, s);
    if (typeof out.monthlyBudget !== 'number' || !isFinite(out.monthlyBudget)) out.monthlyBudget = d.monthlyBudget;
    if (out.monthlyBudget < 1) out.monthlyBudget = d.monthlyBudget;
    if (out.strategy !== 'fixed') out.strategy = 'average';
    if (typeof out.fixedDaily !== 'number' || !isFinite(out.fixedDaily)) out.fixedDaily = d.fixedDaily;
    out.monthStartDay = Math.min(28, Math.max(1, Math.floor(out.monthStartDay) || 1));
    if (['auto', 'light', 'dark'].indexOf(out.theme) === -1) out.theme = 'auto';
    if (typeof out.carryOver !== 'boolean') out.carryOver = false;
    if (typeof out.savingsTarget !== 'number' || !isFinite(out.savingsTarget)) out.savingsTarget = 0;
    out.savingsTarget = Math.min(999999, Math.max(0, Math.round(out.savingsTarget * 100) / 100));
    if (!Array.isArray(out.categories) || out.categories.length === 0) out.categories = d.categories;
    return out;
  }

  function normalizeEntries(list) {
    if (!Array.isArray(list)) return [];
    return list.filter(function (e) {
      return e && typeof e === 'object' &&
        typeof e.id === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(e.date) &&
        C.isValidAmount(e.amount) &&
        (e.type === 'income' || typeof e.categoryId === 'string');
    }).map(function (e) {
      var type = e.type === 'income' ? 'income' : 'expense';
      return {
        id: e.id,
        date: e.date,
        amount: e.amount,
        categoryId: type === 'income' ? '' : e.categoryId,
        note: typeof e.note === 'string' ? e.note : '',
        createdAt: typeof e.createdAt === 'string' ? e.createdAt : '',
        type: type
      };
    });
  }

  /* ---------- 快照 ---------- */

  /**
   * 维护预算月快照(历史重算依据):
   *  - 当前预算月:按最新设置 upsert;
   *  - 所有出现过记账的月份:缺失时用当前设置合成(尽力近似,README 有说明)。
   */
  function syncSnapshots(settings, entries, snapshots) {
    var out = {};
    Object.keys(snapshots || {}).forEach(function (k) { out[k] = snapshots[k]; });
    entries.forEach(function (e) {
      var bm = C.getBudgetMonth(e.date, settings.monthStartDay);
      if (!out[bm.key]) {
        out[bm.key] = {
          budget: settings.monthlyBudget, strategy: settings.strategy,
          fixedDaily: settings.fixedDaily, days: bm.days,
          start: bm.start, end: bm.end
        };
      }
    });
    var cur = C.getBudgetMonth(C.todayStr(), settings.monthStartDay);
    out[cur.key] = {
      budget: settings.monthlyBudget, strategy: settings.strategy,
      fixedDaily: settings.fixedDaily, days: cur.days,
      start: cur.start, end: cur.end
    };
    return applyCarryIns(out, settings, entries);
  }

  /**
   * 为每个预算月快照计算 carryIn(上月结余滚入本月):
   * carryIn(月) = carryOver 开启时 max(0, 上月有效预算 - 上月净支出),否则 0。
   * 按月份升序迭代,首个有记录的月份 carryIn = 0。
   */
  function applyCarryIns(out, settings, entries) {
    var keys = Object.keys(out).sort();
    var prevEff = 0, prevNet = 0;
    for (var i = 0; i < keys.length; i++) {
      var snap = out[keys[i]];
      var carry = settings.carryOver ? Math.max(0, C.round2(prevEff - prevNet)) : 0;
      snap.carryIn = carry;
      prevEff = snap.budget + carry;
      prevNet = C.netOf(C.entriesInMonth(entries, snap));
    }
    return out;
  }

  /* ---------- 对外 API ---------- */

  function init() {
    persistent = canPersist();
  }

  function loadSettings() { return normalizeSettings(loadJSON(KEY_SETTINGS, defaultSettings())); }
  function loadEntries() { return normalizeEntries(loadJSON(KEY_ENTRIES, [])); }
  function loadGoals() {
    var g = loadJSON(KEY_GOALS, []);
    if (!Array.isArray(g)) return [];
    return g.filter(function (x) {
      return x && typeof x === 'object' && typeof x.id === 'string' &&
        typeof x.name === 'string' && C.isValidAmount(x.target);
    });
  }
  function loadSnapshots() {
    var s = loadJSON(KEY_SNAPSHOTS, {});
    return (s && typeof s === 'object' && !Array.isArray(s)) ? s : {};
  }
  function loadMeta() {
    var m = loadJSON(KEY_META, {});
    return (m && typeof m === 'object' && !Array.isArray(m)) ? m : {};
  }

  function saveSettings(s) { rawSet(KEY_SETTINGS, JSON.stringify(s)); }
  function saveEntries(list) { rawSet(KEY_ENTRIES, JSON.stringify(list)); }
  function saveGoals(list) { rawSet(KEY_GOALS, JSON.stringify(list)); }
  function saveSnapshots(s) { rawSet(KEY_SNAPSHOTS, JSON.stringify(s)); }
  function saveMeta(m) { rawSet(KEY_META, JSON.stringify(m)); }

  function uid() {
    if (global.crypto && typeof global.crypto.randomUUID === 'function') {
      return global.crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /* ---------- 导出 / 导入 ---------- */

  function exportData(settings, entries, goals, snapshots) {
    return {
      app: 'piggy-savings',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: settings,
      entries: entries,
      goals: goals,
      snapshots: snapshots
    };
  }

  function downloadBackup(settings, entries, goals, snapshots) {
    var data = exportData(settings, entries, goals, snapshots);
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    var d = C.todayStr();
    a.href = url;
    a.download = 'piggy-backup-' + d.replace(/-/g, '') + '.json';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 4000);
    saveMeta(Object.assign({}, loadMeta(), {
      lastExportAt: new Date().toISOString(),
      entriesAtExport: entries.length
    }));
    return data;
  }

  /**
   * 校验并导入备份。成功返回 {ok:true, data};失败返回 {ok:false, error}。
   * 只校验结构,不修改现有数据(由调用方决定是否覆盖)。
   */
  function validateImport(raw) {
    var obj;
    try { obj = JSON.parse(raw); } catch (e) { return { ok: false, error: '文件不是有效的 JSON' }; }
    if (!obj || typeof obj !== 'object' || obj.app !== 'piggy-savings') {
      return { ok: false, error: '这不是「存钱罐」导出的备份文件' };
    }
    if (!Array.isArray(obj.entries)) return { ok: false, error: '备份缺少记账数据(entries)' };
    var entries = normalizeEntries(obj.entries);
    if (entries.length !== obj.entries.length) {
      return { ok: false, error: '备份中有不合法的记账记录,已拒绝导入' };
    }
    if (obj.settings && typeof obj.settings !== 'object') {
      return { ok: false, error: '备份中设置数据格式不正确' };
    }
    var settings = normalizeSettings(obj.settings);
    var goals = Array.isArray(obj.goals) ? obj.goals : [];
    var snapshots = (obj.snapshots && typeof obj.snapshots === 'object' && !Array.isArray(obj.snapshots))
      ? obj.snapshots : {};
    return { ok: true, data: { settings: settings, entries: entries, goals: goals, snapshots: snapshots } };
  }

  function applyImport(data) {
    saveSettings(data.settings);
    saveEntries(data.entries);
    saveGoals(data.goals);
    saveSnapshots(syncSnapshots(data.settings, data.entries, data.snapshots));
    saveMeta(Object.assign({}, loadMeta(), { lastExportAt: new Date().toISOString(), entriesAtExport: data.entries.length }));
  }

  function clearAll() {
    rawDel(KEY_SETTINGS); rawDel(KEY_ENTRIES); rawDel(KEY_GOALS);
    rawDel(KEY_SNAPSHOTS); rawDel(KEY_META);
  }

  init();

  global.PiggyStorage = {
    persistent: persistent,
    loadErrors: loadErrors,
    loadSettings: loadSettings,
    loadEntries: loadEntries,
    loadGoals: loadGoals,
    loadSnapshots: loadSnapshots,
    loadMeta: loadMeta,
    saveSettings: saveSettings,
    saveEntries: saveEntries,
    saveGoals: saveGoals,
    saveSnapshots: saveSnapshots,
    saveMeta: saveMeta,
    syncSnapshots: syncSnapshots,
    uid: uid,
    exportData: exportData,
    downloadBackup: downloadBackup,
    validateImport: validateImport,
    applyImport: applyImport,
    clearAll: clearAll,
    defaultSettings: defaultSettings,
    normalizeSettings: normalizeSettings
  };
})(typeof window !== 'undefined' ? window : this);
