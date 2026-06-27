/* config.js — シフト定義・色・役職・日付ヘルパー（グローバル名前空間） */
(function (g) {
  'use strict';

  // セルに入る既知のシフトコード → 表示・色（Excel の実 ARGB に一致）・カテゴリ
  // category: late=遅番, early=早番, amane=アシマネ(JP4 10:00), off=公休, bd=誕生日休, other=その他
  const SHIFT = {
    '75/1300': { cat: 'late',  argb: 'FF33CCFF', cls: 's-late',  label: '遅番 13:00→' },
    '75/0530': { cat: 'early', argb: 'FFFF99FF', cls: 's-early', label: '早番 →5:30' },
    '75/1000': { cat: 'amane', argb: 'FFFFC000', cls: 's-amane', label: 'アシマネ 10:00' },
    '/':       { cat: 'off',   argb: 'FF00FFCC', cls: 's-off',   label: '公休' },
    'BD':      { cat: 'bd',    argb: 'FFFF0000', cls: 's-bd',    label: '誕生日休', textArgb: 'FFFFFFFF' }
  };

  // 1日あたりの必要人数（社員）
  const REQ = { late: 2, early: 2, amane: 1 };

  // 役職。GEN_ROLES = 自動生成で扱う「社員」
  const ROLES = ['JP4', 'E2', 'E1', 'PT'];
  const GEN_ROLES = ['JP4', 'E2', 'E1'];
  const EMP_ROLES = ['E2', 'E1'];   // 2コマセットを回す社員
  const MANAGER_ROLE = 'JP4';       // 10:00 ローテ

  // 公休の目標（おおよそ）
  const OFF_TARGET = 9;

  // 連勤ルール:
  //  STREAK_SOFT(=3) … 生成でできるだけこの連勤までに収める（理想）。
  //  STREAK_PREF(=5) … 5連勤は可だがなるべく避ける。
  //  STREAK_ALERT(=6)… これ以上で警告。
  //  STREAK_FORBID(=7)… 絶対に作らない（手入力は赤表示）。
  const STREAK_SOFT = 3;
  const STREAK_PREF = 5;
  const STREAK_ALERT = 6;
  const STREAK_FORBID = 7;

  // 下部集計に出すバケット（順序＝表示順）
  const SUMMARY_BUCKETS = [
    { key: 'late',  code: '75/1300', label: '遅番 75/1300', req: REQ.late },
    { key: 'early', code: '75/0530', label: '早番 75/0530', req: REQ.early },
    { key: 'amane', code: '75/1000', label: 'アシマネ 75/1000', req: REQ.amane },
    { key: 'off',   code: '/',       label: '公休 /', req: null }
  ];

  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

  // 生成のベース設定（既定値）。localStorage で上書き・永続化される。
  //  offTarget        : 1人あたりの目標公休数（月により変更可）
  //  surplusToSaturday: 余りコマを土曜優先で配置するか
  //  surplusCode      : 余りコマに入れるシフトコード（中番）
  const DEFAULT_SETTINGS = {
    offTarget: 10,
    surplusToSaturday: true,
    surplusCode: '75/1200'
  };

  function daysInMonth(year, month /*1-12*/) {
    return new Date(year, month, 0).getDate();
  }
  function isSaturday(year, month, day) {
    return weekdayIndex(year, month, day) === 6;
  }
  function weekdayIndex(year, month, day) {
    return new Date(year, month - 1, day).getDay(); // 0=Sun
  }
  function weekdayLabel(year, month, day) {
    return WEEKDAYS[weekdayIndex(year, month, day)];
  }
  function isWeekend(year, month, day) {
    const w = weekdayIndex(year, month, day);
    return w === 0 || w === 6;
  }

  // コード文字列 → カテゴリ（部分一致でなく完全一致の既知コード優先）
  function categoryOf(code) {
    if (code == null || code === '') return null;
    if (SHIFT[code]) return SHIFT[code].cat;
    return 'other';
  }
  function classOf(code) {
    if (code == null || code === '') return '';
    if (SHIFT[code]) return SHIFT[code].cls;
    return 's-other';
  }

  // 連勤判定での「勤務日」: 公休・誕生日休・空欄は休み（連勤リセット）
  function isWorkCode(code) {
    if (code == null || code === '') return false;
    const cat = categoryOf(code);
    return cat !== 'off' && cat !== 'bd';
  }

  // コード "75/HHMM" から出勤開始時刻を分で返す（時刻が読めなければ null）
  function startMinutes(code) {
    const m = /^75\/(\d{2})(\d{2})$/.exec(code || '');
    if (!m) return null;
    return (+m[1]) * 60 + (+m[2]);
  }
  // 前日 prevCode → 翌日 nextCode で「翌日の方が出勤が早い」かを判定。
  // ただし 2コマセットの明け（遅番 → 早番）は許容（false を返す）。
  function isEarlierNextDay(prevCode, nextCode) {
    const a = startMinutes(prevCode), b = startMinutes(nextCode);
    if (a == null || b == null) return false;   // 時刻が読めない側は対象外
    if (b >= a) return false;                    // 翌日が同じか遅い → OK
    if (categoryOf(prevCode) === 'late' && categoryOf(nextCode) === 'early') return false; // 明け
    return true;                                 // それ以外で翌日が早い → 避けたい
  }

  g.CFG = {
    SHIFT, REQ, ROLES, GEN_ROLES, EMP_ROLES, MANAGER_ROLE, OFF_TARGET,
    STREAK_SOFT, STREAK_PREF, STREAK_ALERT, STREAK_FORBID,
    DEFAULT_SETTINGS, SUMMARY_BUCKETS, WEEKDAYS,
    daysInMonth, weekdayIndex, weekdayLabel, isWeekend, isSaturday,
    categoryOf, classOf, isWorkCode, startMinutes, isEarlierNextDay
  };
})(window);
