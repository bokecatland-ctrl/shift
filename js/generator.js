/* generator.js — 下書き自動生成
 *
 * ルール:
 *   - JP4: 毎日 1 人が 75/1000（アシマネ）をローテーション。希望休は尊重。
 *   - 社員(E2/E1): 「2コマセット」= 同一人物が N日 13:00(遅番) → 翌日 5:30(早番)。
 *       毎日 2 人がセットを開始するので、どの日も 遅番×2・早番×2 になる。
 *   - 希望休を尊重し、勤務でない日は公休(/) で埋める。
 *   - 公休は設定の目標値(offTarget)を目安にし、勤務が目標に満たない人には
 *     「余りコマ」(中番)を空き日（土曜優先）に追加して公休数を揃える。
 *
 * ★ 手入力で固定(ロック)したセルは lockedGrid で渡され、上書きしない。
 *   固定セルは所与の条件として日別の必要数に数え、不足分だけを自動で埋める。
 *
 * 出力: grid = { staffId: { day: code } }
 */
(function (g) {
  'use strict';
  const C = g.CFG;

  function generate(staff, desiredOffMap, year, month, settings, lockedGrid) {
    settings = Object.assign({}, C.DEFAULT_SETTINGS, settings || {});
    lockedGrid = lockedGrid || {};
    const N = C.daysInMonth(year, month);
    const grid = {};
    const off = (id) => desiredOffMap[id] || [];
    const isOff = (id, d) => off(id).indexOf(d) >= 0;
    const put = (id, d, code) => { (grid[id] || (grid[id] = {}))[d] = code; };
    const get = (id, d) => (grid[id] && grid[id][d]) || '';
    const busy = (id, d) => !!get(id, d);                 // 何か入っている＝その日は確定済み

    const jp4 = staff.filter(s => s.role === C.MANAGER_ROLE);
    const emps = staff.filter(s => C.EMP_ROLES.indexOf(s.role) >= 0);
    const genStaff = staff.filter(s => C.GEN_ROLES.indexOf(s.role) >= 0);
    const genIds = new Set(genStaff.map(s => s.id));

    // ---- 0. 固定セルを先に配置（これらは絶対に動かさない） ----
    for (const id in lockedGrid) {
      for (const d in lockedGrid[id]) {
        const code = lockedGrid[id][d];
        if (code) put(id, +d, code);
      }
    }

    // 社員のみで、その日のカテゴリ件数を数える（固定＋自動の両方を含む）
    function countCat(d, cat) {
      let n = 0;
      for (const s of genStaff) if (C.categoryOf(get(s.id, d)) === cat) n++;
      return n;
    }
    // 勤務日数（公休カテゴリは除く＝固定の公休は勤務に数えない）
    function workCount(id) {
      const r = grid[id]; if (!r) return 0;
      let n = 0;
      for (let d = 1; d <= N; d++) {
        const c = r[d]; if (!c) continue;
        if (C.categoryOf(c) !== 'off') n++;
      }
      return n;
    }

    // ---- 1. 固定された遅番の相方（翌5:30）を補完（2コマセットの維持） ----
    for (const id in lockedGrid) {
      if (!genIds.has(id)) continue;
      for (const d in lockedGrid[id]) {
        const dd = +d;
        if (C.categoryOf(lockedGrid[id][d]) !== 'late') continue;
        if (dd >= N) continue;
        if (!busy(id, dd + 1) && !isOff(id, dd + 1) && countCat(dd + 1, 'early') < C.REQ.early) {
          put(id, dd + 1, '75/0530');
        }
      }
    }

    // ---- 2. JP4: 10:00 ローテーション（その日に未充足のときだけ） ----
    if (jp4.length) {
      let ptr = 0;
      const jworked = {}; jp4.forEach(s => jworked[s.id] = 0);
      for (let d = 1; d <= N; d++) {
        if (countCat(d, 'amane') >= C.REQ.amane) continue;   // 固定等で既に充足
        const ordered = jp4.slice().sort((a, b) => jworked[a.id] - jworked[b.id]);
        let pick = null;
        for (const cand of ordered) {
          if (!busy(cand.id, d) && !isOff(cand.id, d)) { pick = cand; break; }
        }
        if (pick) { put(pick.id, d, '75/1000'); jworked[pick.id]++; ptr++; }
      }
    }

    // ---- 3. 社員: 2コマセットで遅番/早番の不足を埋める ----
    for (let d = 1; d <= N; d++) {
      let need = C.REQ.late - countCat(d, 'late');
      if (need <= 0) continue;

      // 相方(翌5:30)まで確保できる候補を優先
      const pairable = emps.filter(s =>
        !busy(s.id, d) && !isOff(s.id, d) &&
        (d >= N || (!busy(s.id, d + 1) && !isOff(s.id, d + 1)))
      ).sort((a, b) => workCount(a.id) - workCount(b.id));

      for (const s of pairable) {
        if (need <= 0) break;
        put(s.id, d, '75/1300');
        need--;
        if (d < N && countCat(d + 1, 'early') < C.REQ.early &&
            !busy(s.id, d + 1) && !isOff(s.id, d + 1)) {
          put(s.id, d + 1, '75/0530');  // 翌日 早番（相方）
        }
      }

      // それでも遅番が不足するなら、相方を組めなくても遅番だけ入れる（過少回避）
      if (need > 0) {
        const solo = emps.filter(s => !busy(s.id, d) && !isOff(s.id, d))
          .sort((a, b) => workCount(a.id) - workCount(b.id));
        for (const s of solo) {
          if (need <= 0) break;
          put(s.id, d, '75/1300'); need--;
        }
      }
    }

    // ---- 4. 余りコマ（公休を目標値に近づける／土曜優先） ----
    const offTarget = clampInt(settings.offTarget, 0, N);
    const targetWork = N - offTarget;
    const surplusCode = (settings.surplusCode || C.DEFAULT_SETTINGS.surplusCode).trim() || '75/1200';
    const freeDay = (id, d) => !busy(id, d) && !isOff(id, d);

    const dayOrder = [];
    if (settings.surplusToSaturday) {
      for (let d = 1; d <= N; d++) if (C.isSaturday(year, month, d)) dayOrder.push(d);
      for (let d = 1; d <= N; d++) if (!C.isSaturday(year, month, d)) dayOrder.push(d);
    } else {
      for (let d = 1; d <= N; d++) dayOrder.push(d);
    }

    genStaff.slice().sort((a, b) => workCount(a.id) - workCount(b.id)).forEach(s => {
      let need = targetWork - workCount(s.id);
      if (need <= 0) return;
      for (const d of dayOrder) {
        if (need <= 0) break;
        if (freeDay(s.id, d)) { put(s.id, d, surplusCode); need--; }
      }
    });

    // ---- 5. 残りを公休(/) で埋める ----
    for (const s of genStaff) {
      for (let d = 1; d <= N; d++) {
        if (!busy(s.id, d)) put(s.id, d, '/');
      }
    }

    return grid;
  }

  function clampInt(v, lo, hi) {
    v = parseInt(v, 10); if (isNaN(v)) v = lo;
    return Math.max(lo, Math.min(hi, v));
  }

  g.Generator = { generate };
})(window);
