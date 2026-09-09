/* ============================================================
 * 存钱罐 · 核心计算模块
 * 纯函数、无 DOM 依赖:浏览器挂载为全局 PiggyCore,
 * Node(测试)通过 module.exports 加载。
 * 约定:日期一律使用本地 'YYYY-MM-DD' 字符串手工处理,
 * 禁止 new Date('YYYY-MM-DD')(UTC 陷阱)。
 * ============================================================ */
(function (global) {
  'use strict';

  var MS_DAY = 86400000;

  /* ---------- 日期工具 ---------- */

  function pad2(n) { return String(n).padStart(2, '0'); }
  function round2(x) { return Math.round(x * 100) / 100; }

  function parseDateStr(s) {
    var p = String(s).split('-').map(Number);
    return { y: p[0], m: p[1], d: p[2] };
  }
  function toDateStr(y, m, d) { return y + '-' + pad2(m) + '-' + pad2(d); }
  function todayStr(now) {
    var n = now || new Date();
    return toDateStr(n.getFullYear(), n.getMonth() + 1, n.getDate());
  }
  /** m 为 1-12,返回该月天数 */
  function daysInMonth(y, m) { return new Date(y, m, 0).getDate(); }
  function utcOf(s) { var p = parseDateStr(s); return Date.UTC(p.y, p.m - 1, p.d); }
  /** 日期字符串偏移 n 天(可为负) */
  function shiftDate(s, nDays) {
    var t = new Date(utcOf(s) + nDays * MS_DAY);
    return toDateStr(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  function daysBetween(a, b) { return Math.round((utcOf(b) - utcOf(a)) / MS_DAY); }
  /** 0=周日 ... 6=周六 */
  function weekdayOf(s) { return new Date(utcOf(s)).getUTCDay(); }

  /* ---------- 预算月(到账日划分) ---------- */

  /**
   * 预算月:每月 startDay(1-28,越界自动夹取)开始,次月 startDay-1 结束。
   * @returns {{key:'YYYY-MM', start:'YYYY-MM-DD', end:'YYYY-MM-DD', days:number, startDay:number}}
   */
  function getBudgetMonth(dateStr, startDay) {
    var sd = Math.min(28, Math.max(1, Math.floor(startDay) || 1));
    var p = parseDateStr(dateStr);
    var y = p.y, m = p.m;
    if (p.d < sd) { m -= 1; if (m === 0) { m = 12; y -= 1; } }
    var start = toDateStr(y, m, sd);
    var end;
    if (sd === 1) {
      end = toDateStr(y, m, daysInMonth(y, m));
    } else {
      var ey = y, em = m + 1;
      if (em === 13) { em = 1; ey += 1; }
      end = toDateStr(ey, em, sd - 1);
    }
    return {
      key: y + '-' + pad2(m),
      start: start,
      end: end,
      days: daysInMonth(y, m),
      startDay: sd
    };
  }
  /** dateStr 在预算月内的第几天(1 起,与月内天数一致) */
  function dayIndexInMonth(dateStr, bm) { return daysBetween(bm.start, dateStr) + 1; }
  /** 从 dateStr(含当天)到预算月结束还剩几天 */
  function daysLeft(bm, dateStr) { return bm.days - dayIndexInMonth(dateStr, bm) + 1; }
  function monthKeyFromDate(dateStr, startDay) { return getBudgetMonth(dateStr, startDay).key; }
  function monthLabel(key) {
    var p = parseDateStr(key + '-01');
    return p.y + '年' + p.m + '月';
  }

  /* ---------- 记账统计 ---------- */

  function entriesInMonth(entries, bm) {
    return entries.filter(function (e) { return e.date >= bm.start && e.date <= bm.end; });
  }
  var ALLOWANCE_CAT = 'allowance'; // 生活费收入分类 id
  /** 普通收入(不含生活费):生活费是收入分类之一,但预算抵扣时需排除 */
  function isIncome(e) { return !!(e && e.type === 'income' && e.categoryId !== ALLOWANCE_CAT); }
  /** 生活费到账条目:计入总收支,但不参与预算抵扣(预算本身即生活费)。
   *  兼容旧数据:type='allowance' 或 type='income' + 分类='allowance'。 */
  function isAllowance(e) {
    return !!(e && (e.type === 'allowance' || (e.type === 'income' && e.categoryId === ALLOWANCE_CAT)));
  }
  /** 支出合计(不含收入与生活费) */
  function sumExpenses(list) {
    return round2(list.reduce(function (a, e) { return a + (isIncome(e) || isAllowance(e) ? 0 : e.amount); }, 0));
  }
  /** 收入合计(普通收入,不含生活费) */
  function sumIncomes(list) {
    return round2(list.reduce(function (a, e) { return a + (isIncome(e) ? e.amount : 0); }, 0));
  }
  /** 生活费合计 */
  function sumAllowances(list) {
    return round2(list.reduce(function (a, e) { return a + (isAllowance(e) ? e.amount : 0); }, 0));
  }
  /** 总入账合计 = 普通收入 + 生活费(用于总收支展示) */
  function sumIncomesAll(list) { return round2(sumIncomes(list) + sumAllowances(list)); }
  /** 净支出 = 支出 - 收入(可为负;不含生活费抵扣) */
  function netOf(list) { return round2(sumExpenses(list) - sumIncomes(list)); }
  /** 全部金额合计(不分类型,供历史兼容/测试) */
  function sumAmounts(list) {
    return round2(list.reduce(function (a, e) { return a + e.amount; }, 0));
  }
  function expenseOnDay(entries, dateStr) {
    return sumExpenses(entries.filter(function (e) { return e.date === dateStr; }));
  }
  function incomeOnDay(entries, dateStr) {
    return sumIncomes(entries.filter(function (e) { return e.date === dateStr; }));
  }
  function allowanceOnDay(entries, dateStr) {
    return sumAllowances(entries.filter(function (e) { return e.date === dateStr; }));
  }
  function incomeAllOnDay(entries, dateStr) {
    return round2(incomeOnDay(entries, dateStr) + allowanceOnDay(entries, dateStr));
  }
  /** 某日净支出(支出 - 普通收入;生活费不计入)。
   *  预算口径统一用支出:普通收入不冲抵预算。 */
  function spentOnDay(entries, dateStr) {
    return sumExpenses(entries.filter(function (e) { return e.date === dateStr; }));
  }
  /** 某预算月内各分类支出 {categoryId: amount}(仅支出,不含收入与生活费) */
  function spentByCategory(entries, bm) {
    var map = {};
    entriesInMonth(entries, bm).forEach(function (e) {
      if (isIncome(e) || isAllowance(e)) return;
      map[e.categoryId] = round2((map[e.categoryId] || 0) + e.amount);
    });
    return map;
  }
  function spentInCategoryOnDay(entries, dateStr, categoryId) {
    return sumExpenses(entries.filter(function (e) {
      return e.date === dateStr && e.categoryId === categoryId;
    }));
  }

  /* ---------- 预算与可存(核心公式) ---------- */

  /**
   * 当日全景统计。
   * 净支出 = 支出 - 收入;可花总额 = 有效预算(含结转) - 本月存钱目标;
   * 剩余 = 可花总额 - 净支出;
   * 动态平均法:今日预算 = max(0, 剩余 ÷ 剩余天数);
   * 固定额度法:今日预算 = fixedDaily(月目标仅作进度参考);
   * 今日可存 = 今日预算 - 今日净支出(负值即超支);
   * 预计月末可存 = 剩余 - 今日净支出 - 今日预算 × (剩余天数 - 1)。
   * @param {object} [snapshots] 月度快照(含 carryIn 结转);缺省时结转视为 0。
   * @param {number} [settings.savingsTarget] 本月存钱目标(0 = 未设,负数按 0)。
   */
  function todayStats(settings, entries, today, snapshots) {
    var bm = getBudgetMonth(today, settings.monthStartDay);
    var snap = snapshotForMonth(snapshots, settings, bm);
    var carryIn = snap.carryIn || 0;
    var target = settings.savingsTarget ? Math.max(0, round2(settings.savingsTarget)) : 0;
    var monthEntries = entriesInMonth(entries, bm);
    var monthExpense = sumExpenses(monthEntries);
    var monthIncome = sumIncomes(monthEntries);
    var monthAllowance = sumAllowances(monthEntries);
    var monthSpent = round2(monthExpense - monthIncome);
    var left = daysLeft(bm, today);

    /* 纯记账模式(budgetMode 关闭):不算预算,只报收支与结余 */
    if (settings.budgetMode === false) {
      var todayExpenseL = expenseOnDay(entries, today);
      var todayIncomeL = incomeOnDay(entries, today);
      var todayAllowanceL = allowanceOnDay(entries, today);
      return {
        bm: bm,
        ledgerMode: true,
        budget: 0,
        carryIn: 0,
        savingsTarget: 0,
        spendable: 0,
        monthExpense: monthExpense,
        monthIncome: monthIncome,
        monthAllowance: monthAllowance,
        monthIncomeAll: round2(monthIncome + monthAllowance),
        monthSpent: monthSpent,
        remaining: 0,
        daysLeft: left,
        dailyBudget: 0,
        todayExpense: todayExpenseL,
        todayIncome: todayIncomeL,
        todayAllowance: todayAllowanceL,
        todayIncomeAll: round2(todayIncomeL + todayAllowanceL),
        todaySpent: round2(todayExpenseL - todayIncomeL),
        todaySavings: round2(todayIncomeL + todayAllowanceL - todayExpenseL),
        projectedSaved: 0
      };
    }

    /* 预算基数 = 本月实际到账的生活费 + 上月结转(不使用设置金额);
     * 预算只按支出计算:普通收入不冲抵、不抬高预算。 */
    var budget = round2(monthAllowance + carryIn);
    var spendable = round2(budget - target);
    var remaining = round2(spendable - monthExpense);
    var daily;
    if (settings.strategy === 'fixed') {
      daily = round2(settings.fixedDaily);
    } else {
      daily = remaining > 0 ? round2(remaining / left) : 0;
    }
    var todayExpense = expenseOnDay(entries, today);
    var todayIncome = incomeOnDay(entries, today);
    var todayAllowance = allowanceOnDay(entries, today);
    var todaySpent = todayExpense;                       // 预算口径:今日支出
    var todaySavings = round2(daily - todayExpense);     // 今日可存 = 预算 - 支出
    var projected = round2(remaining - todayExpense - round2(daily * (left - 1)));
    return {
      bm: bm,
      budget: budget,
      carryIn: carryIn,
      savingsTarget: target,
      spendable: spendable,
      monthExpense: monthExpense,
      monthIncome: monthIncome,
      monthAllowance: monthAllowance,
      monthIncomeAll: round2(monthIncome + monthAllowance),
      monthSpent: round2(monthExpense - monthIncome),
      remaining: remaining,
      daysLeft: left,
      dailyBudget: daily,
      todayExpense: todayExpense,
      todayIncome: todayIncome,
      todayAllowance: todayAllowance,
      todayIncomeAll: round2(todayIncome + todayAllowance),
      todaySpent: todaySpent,
      todaySavings: todaySavings,
      projectedSaved: projected
    };
  }

  /**
   * 预算基数 = 当月实际到账生活费(allowance) + 结转。
   * 不传 allowance 时回退到 snap.budget(历史兼容/工具函数使用)。
   */
  function effBudget(snap, allowance) {
    var a = allowance == null ? (snap.budget || 0) : allowance;
    return round2(a + (snap.carryIn || 0));
  }
  /** 历史月快照 → 该月每日预算(须传入该月实际到账生活费 allowance) */
  function dayBudgetFor(snap, allowance) {
    if (snap.strategy === 'fixed') return round2(snap.fixedDaily);
    return round2(effBudget(snap, allowance) / snap.days);
  }
  /** 取某预算月快照;缺失时用当前设置合成(尽力近似) */
  function snapshotForMonth(snapshots, settings, bm) {
    var snap = snapshots && snapshots[bm.key];
    if (snap) return snap;
    return {
      budget: settings.monthlyBudget,
      strategy: settings.strategy,
      fixedDaily: settings.fixedDaily,
      days: bm.days,
      start: bm.start,
      end: bm.end,
      carryIn: 0
    };
  }
  /** 预算月内截至 upToDate(含)每天正向可存之和(超支日计 0 不扣罐)。
   *  每日预算基于该月实际到账生活费 + 结转。 */
  function monthSavings(entries, snap, upToDate) {
    var allowance = sumAllowances(entriesInMonth(entries, snap));
    var dayBudget = dayBudgetFor(snap, allowance);
    var total = 0;
    var idx = dayIndexInMonth(upToDate, snap);
    for (var i = 1; i <= idx; i++) {
      var date = shiftDate(snap.start, i - 1);
      total += Math.max(0, round2(dayBudget - spentOnDay(entries, date)));
    }
    return round2(total);
  }
  /**
   * 存钱罐(累计存款):
   *   Σ 已关闭预算月 max(0, 实际到账生活费 + 结转 - 月净支出)
   * + Σ 本月已过天数(含今天) max(0, 当日预算 - 当日已花)
   */
  function cumulativeSavings(entries, snapshots, settings, today) {
    var bm = getBudgetMonth(today, settings.monthStartDay);
    var total = 0;
    Object.keys(snapshots || {}).forEach(function (key) {
      if (key < bm.key) {
        var snap = snapshots[key];
        var monthEntries = entriesInMonth(entries, snap);
        var base = round2(sumAllowances(monthEntries) + (snap.carryIn || 0));
        total += Math.max(0, round2(base - sumExpenses(monthEntries)));
      }
    });
    var cur = snapshotForMonth(snapshots, settings, bm);
    total += monthSavings(entries, cur, today);
    return round2(total);
  }

  /* ---------- 校验与格式化 ---------- */

  function isValidAmount(v) {
    return typeof v === 'number' && isFinite(v) && v > 0 && v <= 999999 &&
      Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
  }
  function isValidNonNeg(v) {
    return typeof v === 'number' && isFinite(v) && v >= 0 && v <= 999999 &&
      Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
  }
  function fmtMoney(x) {
    var n = round2(x);
    return (n < 0 ? '-¥' : '¥') + Math.abs(n).toFixed(2);
  }
  function fmtNum(x) { return round2(x).toFixed(2); }

  /** 最近 n 天日期串(含 today,升序) */
  function lastNDays(n, today) {
    var out = [];
    for (var i = n - 1; i >= 0; i--) out.push(shiftDate(today, -i));
    return out;
  }

  var DEFAULT_CATEGORIES = [
    { id: 'food',  name: '饮食', icon: 'bowl', color: '#f59e0b', dailyPlan: 35 },
    { id: 'trans', name: '交通', icon: 'bus',  color: '#3b82f6', dailyPlan: 6 },
    { id: 'study', name: '学习', icon: 'book', color: '#8b5cf6', dailyPlan: 5 },
    { id: 'fun',   name: '娱乐', icon: 'game', color: '#ec4899', dailyPlan: 10 },
    { id: 'daily', name: '日用', icon: 'cart', color: '#14b8a6', dailyPlan: 8 },
    { id: 'other', name: '其他', icon: 'dots', color: '#64748b', dailyPlan: 5 }
  ];

  var PiggyCore = {
    pad2: pad2, round2: round2,
    parseDateStr: parseDateStr, toDateStr: toDateStr, todayStr: todayStr,
    daysInMonth: daysInMonth, shiftDate: shiftDate, daysBetween: daysBetween,
    weekdayOf: weekdayOf,
    getBudgetMonth: getBudgetMonth, dayIndexInMonth: dayIndexInMonth,
    daysLeft: daysLeft, monthKeyFromDate: monthKeyFromDate, monthLabel: monthLabel,
    entriesInMonth: entriesInMonth, sumAmounts: sumAmounts, spentOnDay: spentOnDay,
    spentByCategory: spentByCategory, spentInCategoryOnDay: spentInCategoryOnDay,
    isIncome: isIncome, isAllowance: isAllowance, ALLOWANCE_CAT: ALLOWANCE_CAT,
    sumExpenses: sumExpenses, sumIncomes: sumIncomes, sumAllowances: sumAllowances,
    sumIncomesAll: sumIncomesAll, netOf: netOf,
    expenseOnDay: expenseOnDay, incomeOnDay: incomeOnDay,
    allowanceOnDay: allowanceOnDay, incomeAllOnDay: incomeAllOnDay, effBudget: effBudget,
    todayStats: todayStats, dayBudgetFor: dayBudgetFor, snapshotForMonth: snapshotForMonth,
    monthSavings: monthSavings, cumulativeSavings: cumulativeSavings,
    isValidAmount: isValidAmount, isValidNonNeg: isValidNonNeg,
    fmtMoney: fmtMoney, fmtNum: fmtNum, lastNDays: lastNDays,
    DEFAULT_CATEGORIES: DEFAULT_CATEGORIES
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PiggyCore;
  else global.PiggyCore = PiggyCore;
})(typeof window !== 'undefined' ? window : this);
