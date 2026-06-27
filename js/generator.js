/* generator.js — 下書き自動生成
 *
 * ルール:
 *   - JP4: 毎日 1 人が 75/1000（アシマネ）をローテーション。希望休は尊重。
 *   - 社員(E2/E1): 「2コマセット」= 同一人物が N日 13:00(遅番) → 翌日 5:30(早番)。
 *       毎日 2 人がセットを開始するので、どの日も 遅番×2・早番×2 になる。
 *   - 希望休を尊重し、勤務でない日は公休(/) で埋める（公休 ≈ 9 を目安に公平化）。
 *
 *   - 公休は設定の目標値(offTarget)を目安にする。2コマ需要だけでは勤務が
 *     目標に満たない人（＝コマが余る人）には、空き日に「余りコマ」(中番)を
 *     追加して目標公休数に近づける。追加先は設定で土曜優先にできる。
 *
 * 出力: grid = { staffId: { day: code } }
 */
(function (g) {
  'use strict';
  const C = g.CFG;

  function generate(staff, desiredOffMap, year, month, settings) {
    settings = Object.assign({}, C.DEFAULT_SETTINGS, settings || {});
    const N = C.daysInMonth(year, month);
    const grid = {};
    const off = (id) => desiredOffMap[id] || [];
    const isOff = (id, d) => off(id).indexOf(d) >= 0;
    const put = (id, d, code) => {
      (grid[id] || (grid[id] = {}))[d] = code;
    };

    const jp4 = staff.filter(s => s.role === C.MANAGER_ROLE);
    const emps = staff.filter(s => C.EMP_ROLES.indexOf(s.role) >= 0);

    // ---- JP4: 10:00 ローテーション（1日1人） ----
    if (jp4.length) {
      let ptr = 0;
      const jworked = {}; jp4.forEach(s => jworked[s.id] = 0);
      for (let d = 1; d <= N; d++) {
        // 希望休でない JP4 を、勤務数が少ない順 → ローテ順 で選ぶ
        let pick = null, tries = 0;
        const ordered = jp4.slice().sort((a, b) => jworked[a.id] - jworked[b.id]);
        for (const cand of ordered) {
          if (!isOff(cand.id, d)) { pick = cand; break; }
        }
        if (!pick) { // 全員希望休 → ローテだけで
          for (let k = 0; k < jp4.length; k++) {
            const cand = jp4[(ptr + k) % jp4.length];
            if (!isOff(cand.id, d)) { pick = cand; break; }
          }
        }
        if (pick) { put(pick.id, d, '75/1000'); jworked[pick.id]++; ptr++; }
      }
    }

    // ---- 社員: 2コマセット ----
    // worked[id] = 勤務コマ数（公平化の基準）
    const worked = {}; emps.forEach(s => worked[s.id] = 0);
    // early[d] = その日 5:30(早番) を担当する人の集合（前日にセット開始した人）
    const earlyOn = {}; for (let d = 1; d <= N + 1; d++) earlyOn[d] = new Set();

    for (let d = 1; d <= N; d++) {
      // 今日 5:30 をやる人を確定
      earlyOn[d].forEach(id => { put(id, d, '75/0530'); worked[id]++; });

      // 今日セットを開始する候補:
      //  - 希望休でない (d)
      //  - 今日 5:30 を担当していない（早番終わり13:00開始は不可）
      //  - 翌日 d+1 が存在し希望休でない（翌5:30が必要）。d===N は翌月にこぼれるので開始しない
      const needStart = (d < N);
      let started = 0;
      if (needStart) {
        const cands = emps.filter(s =>
          !isOff(s.id, d) &&
          !earlyOn[d].has(s.id) &&
          !isOff(s.id, d + 1) &&
          !earlyOn[d + 1].has(s.id)
        );
        cands.sort((a, b) => worked[a.id] - worked[b.id]); // 勤務が少ない順
        for (const s of cands) {
          if (started >= C.REQ.late) break;
          put(s.id, d, '75/1300');      // 今日 遅番
          worked[s.id]++;
          earlyOn[d + 1].add(s.id);     // 翌日 早番を予約
          started++;
        }
      }
      // started が 2 未満なら過少（後で集計が警告する）
    }

    // ---- 余りコマの配置（公休を目標値に近づける） ----
    // 各生成スタッフ(JP4/E2/E1)の現在の勤務日数を数え、目標勤務日数
    // (N - offTarget) に満たない人の空き日に「余りコマ」を追加する。
    const genStaff = staff.filter(s => C.GEN_ROLES.indexOf(s.role) >= 0);
    const offTarget = clampInt(settings.offTarget, 0, N);
    const targetWork = N - offTarget;
    const surplusCode = (settings.surplusCode || C.DEFAULT_SETTINGS.surplusCode).trim() || '75/1200';

    const workCount = (id) => {
      const r = grid[id]; if (!r) return 0;
      let n = 0;
      for (let d = 1; d <= N; d++) if (r[d]) n++;  // 既に入っている=勤務（公休はまだ未配置）
      return n;
    };
    const freeDay = (id, d) => !(grid[id] && grid[id][d]) && !isOff(id, d);

    // 配置日の優先順: 設定で土曜優先なら 土曜→他の日、そうでなければ日付順
    const dayOrder = [];
    if (settings.surplusToSaturday) {
      for (let d = 1; d <= N; d++) if (C.isSaturday(year, month, d)) dayOrder.push(d);
      for (let d = 1; d <= N; d++) if (!C.isSaturday(year, month, d)) dayOrder.push(d);
    } else {
      for (let d = 1; d <= N; d++) dayOrder.push(d);
    }

    // 公休が多い人（勤務が少ない人）から埋めて公平化
    genStaff.sort((a, b) => workCount(a.id) - workCount(b.id));
    for (const s of genStaff) {
      let need = targetWork - workCount(s.id);
      if (need <= 0) continue;
      for (const d of dayOrder) {
        if (need <= 0) break;
        if (freeDay(s.id, d)) { put(s.id, d, surplusCode); need--; }
      }
    }

    // ---- 残りを公休(/) で埋める（社員 + JP4） ----
    for (const s of genStaff) {
      for (let d = 1; d <= N; d++) {
        const cur = grid[s.id] && grid[s.id][d];
        if (!cur) put(s.id, d, '/');
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
