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

    // ---- 連勤ヘルパー ----
    const isWork = (id, d) => d >= 1 && d <= N && C.isWorkCode(get(id, d));
    const backRun = (id, d) => { let n = 0, k = d - 1; while (k >= 1 && isWork(id, k)) { n++; k--; } return n; };
    const fwdRun = (id, d) => { let n = 0, k = d + 1; while (k <= N && isWork(id, k)) { n++; k++; } return n; };
    // d に1日勤務を入れた場合の連勤数
    const runSingle = (id, d) => backRun(id, d) + 1 + fwdRun(id, d);
    // d と d+1 に連続勤務(2コマセット)を入れた場合の連勤数
    const runPair = (id, d) => backRun(id, d) + 2 + fwdRun(id, d + 1);
    const FORBID = C.STREAK_FORBID, PREF = C.STREAK_PREF, SOFT = C.STREAK_SOFT;

    // d に code を入れると、前日/翌日との間で「翌日の方が早い出勤」になるか
    const descentAt = (id, d, code) => {
      const prev = get(id, d - 1), next = get(id, d + 1);
      if (C.isEarlierNextDay(prev, code)) return true;   // (d-1) → d
      if (C.isEarlierNextDay(code, next)) return true;   // d → (d+1)
      return false;
    };

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
        if (!busy(id, dd + 1) && !isOff(id, dd + 1) &&
            countCat(dd + 1, 'early') < C.REQ.early &&
            runSingle(id, dd + 1) < FORBID) {   // 7連勤になる相方は付けない
          put(id, dd + 1, '75/0530');
        }
      }
    }

    const freeDay = (id, d) => !busy(id, d) && !isOff(id, d);
    const jworked = {}; genStaff.forEach(s => jworked[s.id] = 0);

    // ---- 2. アシマネ(10:00) 1/日。優先 JP4、難しければ amaneOk の社員(例: Kawakami/Duong) ----
    //   JP4 は「かたまり(ブロック)」で回し、もう一方の JP4 に連続空き日を作る
    //   （その空き日に泊まりセットを入れて公休を増やさず働けるようにするため）。
    const amaneEmps = emps.filter(s => s.amaneOk === true);
    let lastA = null;
    for (let d = 1; d <= N; d++) {
      if (countCat(d, 'amane') >= C.REQ.amane) continue;     // 固定等で充足済み
      const ok = (s) => !busy(s.id, d) && !isOff(s.id, d) &&
        runSingle(s.id, d) < FORBID && !descentAt(s.id, d, '75/1000');
      // JP4 優先。sticky: 前日と同じ JP4 を SOFT(=3)連勤までだけ継続して短い塊にする
      // （長い 5連勤の塊を作らないため）。塊の間にもう一方の JP4 が入る。
      let pool = jp4.filter(ok).sort((a, b) =>
        ((a.id === lastA && runSingle(a.id, d) <= SOFT) ? 0 : 1) -
        ((b.id === lastA && runSingle(b.id, d) <= SOFT) ? 0 : 1) ||
        (runSingle(a.id, d) > SOFT ? 1 : 0) - (runSingle(b.id, d) > SOFT ? 1 : 0) ||
        jworked[a.id] - jworked[b.id]);
      let pick = pool[0];
      if (!pick) {   // フォールバック: 10時OK の社員
        pick = amaneEmps.filter(ok).sort((a, b) =>
          (runSingle(a.id, d) > PREF ? 1 : 0) - (runSingle(b.id, d) > PREF ? 1 : 0) ||
          workCount(a.id) - workCount(b.id))[0];
      }
      if (pick) { put(pick.id, d, '75/1000'); jworked[pick.id]++; lastA = (pick.role === C.MANAGER_ROLE ? pick.id : null); }
      else lastA = null;
    }

    // ---- 3. 泊まりセット(遅番→翌早番) 2/日。優先 E職、足りなければ JP4 もOK ----
    const setRunAt = (s, d) => (d >= N ? runSingle(s.id, d) : runPair(s.id, d));
    for (let d = 1; d <= N; d++) {
      let need = C.REQ.late - countCat(d, 'late');
      if (need <= 0) continue;
      const startSet = (s) => {
        put(s.id, d, '75/1300'); need--;
        if (d < N && countCat(d + 1, 'early') < C.REQ.early &&
            !busy(s.id, d + 1) && !isOff(s.id, d + 1)) put(s.id, d + 1, '75/0530');
      };
      // 相方つき → 相方なし、各段で E職プール→JP4プール の順で充足
      for (const requirePair of [true, false]) {
        for (const pool of [emps, jp4]) {
          if (need <= 0) break;
          const cand = pool.filter(s =>
            !busy(s.id, d) && !isOff(s.id, d) &&
            (!requirePair || d >= N || (!busy(s.id, d + 1) && !isOff(s.id, d + 1))) &&
            (requirePair ? setRunAt(s, d) : runSingle(s.id, d)) < FORBID
          ).sort((a, b) => {
            const ra = requirePair ? setRunAt(a, d) : runSingle(a.id, d);
            const rb = requirePair ? setRunAt(b, d) : runSingle(b.id, d);
            return (descentAt(a.id, d, '75/1300') ? 1 : 0) - (descentAt(b.id, d, '75/1300') ? 1 : 0) ||
              (ra > SOFT ? 1 : 0) - (rb > SOFT ? 1 : 0) ||   // なるべく短い連勤
              workCount(a.id) - workCount(b.id) || ra - rb;
          });
          for (const s of cand) { if (need <= 0) break; startSet(s); }
        }
      }
    }

    // ---- 4. 公休を目標に合わせる（公休は増やさない＝勤務を targetWork まで増やす） ----
    const offTarget = clampInt(settings.offTarget, 0, N);
    const targetWork = N - offTarget;
    const surplusCode = (settings.surplusCode || C.DEFAULT_SETTINGS.surplusCode).trim() || '75/1200';

    const dayOrder = [];
    if (settings.surplusToSaturday) {
      for (let d = 1; d <= N; d++) if (C.isSaturday(year, month, d)) dayOrder.push(d);
      for (let d = 1; d <= N; d++) if (!C.isSaturday(year, month, d)) dayOrder.push(d);
    } else {
      for (let d = 1; d <= N; d++) dayOrder.push(d);
    }

    // 勤務が目標(targetWork)に満たない人を埋める。
    //  - 1コマずつ「連勤が最も短くなる空き日」を選んで置く（孤立配置を優先）ので、
    //    長い連勤の塊（5連勤の連続）にならない。逆行(翌日が早い出勤)は作らない。
    //  - まず中番(余りコマ, 人数過剰なし)。中番がうまく置けない人(JP4)は泊まりセット。
    const okMid = (id, d) =>
      freeDay(id, d) && !descentAt(id, d, surplusCode) && runSingle(id, d) < FORBID;
    const okSet = (id, d) =>
      d < N && freeDay(id, d) && freeDay(id, d + 1) && runPair(id, d) < FORBID &&
      !descentAt(id, d, '75/1300') && !C.isEarlierNextDay('75/0530', get(id, d + 2));

    genStaff.slice().sort((a, b) => workCount(a.id) - workCount(b.id)).forEach(s => {
      let guard = 0;
      while (workCount(s.id) < targetWork && guard++ < 3 * N) {
        // 連勤が最短になる中番の置き場所（同点は土曜優先＝dayOrder順）
        let bestMid = null;
        for (const d of dayOrder) {
          if (!okMid(s.id, d)) continue;
          const r = runSingle(s.id, d);
          if (bestMid === null || r < bestMid.r) bestMid = { d, r };
          if (bestMid.r === 1) break;
        }
        // 連勤が最短になる泊まりセットの置き場所
        let bestSet = null;
        for (let d = 1; d < N; d++) {
          if (!okSet(s.id, d)) continue;
          const r = runPair(s.id, d);
          if (bestSet === null || r < bestSet.r) bestSet = { d, r };
          if (bestSet.r === 2) break;
        }
        // 中番が SOFT 以内で置けるならそれを最優先（孤立配置・人数過剰なし）。
        // 無理なら、連勤の短い方（中番 or 泊まりセット）を選ぶ。
        if (bestMid && bestMid.r <= SOFT) {
          put(s.id, bestMid.d, surplusCode);
        } else if (bestSet && (!bestMid || bestSet.r <= bestMid.r)) {
          put(s.id, bestSet.d, '75/1300'); put(s.id, bestSet.d + 1, '75/0530');
        } else if (bestMid) {
          put(s.id, bestMid.d, surplusCode);
        } else break;
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
