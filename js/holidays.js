/* holidays.js — 日本の祝日をオフラインで算出（外部APIなし）
 * 現行法（2020年以降）に準拠。ハッピーマンデー・春分/秋分・振替休日・国民の休日に対応。
 * getHolidays(year) → { "M-D": "名称", ... }
 */
(function (g) {
  'use strict';

  function nthMonday(year, month, n) {            // month: 1-12
    const first = new Date(year, month - 1, 1).getDay(); // 0=Sun..1=Mon
    const day = 1 + ((1 - first + 7) % 7);        // その月の最初の月曜
    return day + (n - 1) * 7;
  }
  function vernalEquinox(year) {                  // 春分の日（1900-2099 近似）
    return Math.floor(20.8431 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }
  function autumnalEquinox(year) {                // 秋分の日
    return Math.floor(23.2488 + 0.242194 * (year - 1980) - Math.floor((year - 1980) / 4));
  }

  const cache = {};

  function getHolidays(year) {
    if (cache[year]) return cache[year];
    const map = {};
    const set = (m, d, name) => { map[m + '-' + d] = name; };

    // 固定日・計算日（現行法）
    set(1, 1, '元日');
    set(1, nthMonday(year, 1, 2), '成人の日');
    set(2, 11, '建国記念の日');
    if (year >= 2020) set(2, 23, '天皇誕生日');
    set(3, vernalEquinox(year), '春分の日');
    set(4, 29, '昭和の日');
    set(5, 3, '憲法記念日');
    set(5, 4, 'みどりの日');
    set(5, 5, 'こどもの日');
    set(7, nthMonday(year, 7, 3), '海の日');
    set(8, 11, '山の日');
    set(9, nthMonday(year, 9, 3), '敬老の日');
    set(9, autumnalEquinox(year), '秋分の日');
    set(10, nthMonday(year, 10, 2), 'スポーツの日');
    set(11, 3, '文化の日');
    set(11, 23, '勤労感謝の日');

    const key = (dt) => (dt.getMonth() + 1) + '-' + dt.getDate();
    const isHol = (dt) => !!map[key(dt)];

    // 国民の休日: 祝日に挟まれた平日（日曜・祝日でない日）
    const base = Object.assign({}, map);
    for (let m = 1; m <= 12; m++) {
      const dim = new Date(year, m, 0).getDate();
      for (let d = 1; d <= dim; d++) {
        const dt = new Date(year, m - 1, d);
        if (base[m + '-' + d]) continue;
        if (dt.getDay() === 0) continue;
        const prev = new Date(year, m - 1, d - 1);
        const next = new Date(year, m - 1, d + 1);
        if (base[key(prev)] && base[key(next)]) set(m, d, '国民の休日');
      }
    }

    // 振替休日: 日曜に当たる祝日の後、最初の平日（祝日でない日）
    for (let m = 1; m <= 12; m++) {
      const dim = new Date(year, m, 0).getDate();
      for (let d = 1; d <= dim; d++) {
        if (!base[m + '-' + d]) continue;
        const dt = new Date(year, m - 1, d);
        if (dt.getDay() !== 0) continue;          // 日曜の祝日のみ
        let nx = new Date(year, m - 1, d + 1);
        while (isHol(nx)) nx = new Date(nx.getFullYear(), nx.getMonth(), nx.getDate() + 1);
        if (nx.getFullYear() === year) set(nx.getMonth() + 1, nx.getDate(), '振替休日');
      }
    }

    cache[year] = map;
    return map;
  }

  function holidayName(year, month, day) {
    return getHolidays(year)[month + '-' + day] || null;
  }

  g.Holidays = { getHolidays, holidayName };
})(window);
