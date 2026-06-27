/* grid.js — スケジュール表の描画 / セル編集 / 過不足警告 / 下部集計 */
(function (g) {
  'use strict';
  const C = g.CFG, Store = g.Store;

  let onChange = function () {};

  function setOnChange(fn) { onChange = fn || function () {}; }

  function monthDays() {
    const m = Store.getMonth();
    return C.daysInMonth(m.year, m.month);
  }

  // ---- 1日の社員カテゴリ別カウント（過不足判定に使用） ----
  function dayCounts(day) {
    const m = Store.getMonth();
    const counts = { late: 0, early: 0, amane: 0, off: 0, other: 0, bd: 0 };
    Store.getStaff().forEach(s => {
      if (C.GEN_ROLES.indexOf(s.role) < 0) return; // 社員のみ
      const cat = C.categoryOf(Store.getCell(s.id, day));
      if (cat && counts[cat] != null) counts[cat]++;
    });
    return counts;
  }

  function dayHasShortage(day) {
    const c = dayCounts(day);
    return c.late !== C.REQ.late || c.early !== C.REQ.early || c.amane !== C.REQ.amane;
  }

  // ---- 連勤の検出 ----
  // 全スタッフについて、勤務が STREAK_ALERT(6) 日以上続く区間を列挙し、
  // 各セルの連勤レベル(6 or 7+)も返す（セル着色用）。
  function computeStreaks() {
    const N = monthDays();
    const runs = [];
    const cellSev = {}; // "id|day" -> 6(注意) / 7(禁止)
    Store.getStaff().forEach(s => {
      let len = 0, start = 0;
      for (let d = 1; d <= N + 1; d++) {
        const work = d <= N && C.isWorkCode(Store.getCell(s.id, d));
        if (work) { if (len === 0) start = d; len++; }
        else {
          if (len >= C.STREAK_ALERT) {
            const end = d - 1;
            const sev = len >= C.STREAK_FORBID ? 7 : 6;
            runs.push({ id: s.id, role: s.role, name: s.name, start, end, len, sev });
            for (let k = start; k <= end; k++) cellSev[s.id + '|' + k] = sev;
          }
          len = 0;
        }
      }
    });
    return { runs, cellSev };
  }

  // ---- メイングリッド描画 ----
  function renderGrid() {
    const m = Store.getMonth();
    const N = monthDays();
    const table = document.getElementById('grid');
    const staff = Store.getStaff();

    // header
    let thead = '<thead><tr>' +
      '<th class="colRole">役職</th>' +
      '<th class="colName">氏名</th>';
    for (let d = 1; d <= N; d++) {
      const wd = C.weekdayLabel(m.year, m.month, d);
      const we = C.isWeekend(m.year, m.month, d);
      const sun = C.weekdayIndex(m.year, m.month, d) === 0;
      const short = dayHasShortage(d);
      const cls = ['day', we ? 'wknd' : '', sun ? 'sun' : '', short ? 'bad' : ''].join(' ');
      thead += `<th class="${cls}" data-day="${d}"><div>${d}</div><div style="font-size:10px;opacity:.7">${wd}</div></th>`;
    }
    thead += '<th class="colOff">公休</th></tr></thead>';

    // body
    const cellSev = computeStreaks().cellSev;
    let tbody = '<tbody>';
    staff.forEach(s => {
      tbody += '<tr data-id="' + s.id + '">';
      tbody += '<td class="colRole ' + (s.role === 'PT' ? 'PT' : '') + '">' + esc(s.role) + '</td>';
      tbody += '<td class="colName">' + esc(s.name || '—') + '</td>';
      let offCount = 0;
      for (let d = 1; d <= N; d++) {
        const code = Store.getCell(s.id, d);
        const cls = C.classOf(code);
        const we = C.isWeekend(m.year, m.month, d) && !cls ? 'wknd' : '';
        if (C.categoryOf(code) === 'off') offCount++;
        const locked = Store.isLocked(s.id, d);
        const sev = cellSev[s.id + '|' + d];
        const runCls = sev === 7 ? 'run7' : (sev === 6 ? 'run6' : '');
        const wish = Store.isOff(s.id, d) ? ' title="希望休"'
          : (sev ? ` title="${sev}連勤"` : (locked ? ' title="手入力で固定"' : ''));
        const wishMark = Store.isOff(s.id, d) && !code ? '·' : '';
        tbody += `<td class="cell ${cls} ${we} ${locked ? 'locked' : ''} ${runCls}" data-id="${s.id}" data-day="${d}"${wish}>${esc(code) || wishMark}</td>`;
      }
      tbody += '<td class="colOff">' + offCount + '</td>';
      tbody += '</tr>';
    });
    tbody += '</tbody>';

    table.innerHTML = thead + tbody;

    // セルクリック編集
    table.querySelectorAll('td.cell').forEach(td => {
      td.addEventListener('click', ev => openEditor(td, td.dataset.id, +td.dataset.day));
    });
  }

  // ---- 下部集計描画 ----
  function renderSummary() {
    const N = monthDays();
    const table = document.getElementById('summary');

    // 各日カウントを先に算出
    const per = [];
    for (let d = 1; d <= N; d++) per[d] = dayCounts(d);

    let html = '<thead><tr><th class="rowlabel">区分 / 必要</th>';
    for (let d = 1; d <= N; d++) html += `<th>${d}</th>`;
    html += '<th>計</th></tr></thead><tbody>';

    C.SUMMARY_BUCKETS.forEach(b => {
      html += `<tr><td class="rowlabel">${esc(b.label)}${b.req != null ? '（必要' + b.req + '）' : ''}</td>`;
      let total = 0;
      for (let d = 1; d <= N; d++) {
        const v = per[d][b.key] || 0;
        total += v;
        let cls = '';
        if (b.req != null) cls = (v === b.req) ? 'ok' : 'bad';
        html += `<td class="${cls}">${v}</td>`;
      }
      html += `<td>${total}</td></tr>`;
    });

    // 社員出勤計（公休以外）
    html += '<tr><td class="rowlabel">社員 出勤計</td>';
    let gtotal = 0;
    for (let d = 1; d <= N; d++) {
      const c = per[d];
      const work = c.late + c.early + c.amane + c.other + c.bd;
      gtotal += work;
      html += `<td>${work}</td>`;
    }
    html += `<td>${gtotal}</td></tr>`;
    html += '</tbody>';

    table.innerHTML = html;
  }

  // ---- 警告バナー ----
  function renderWarnings() {
    const N = monthDays();
    const el = document.getElementById('warnBanner');
    const lines = [];

    const bad = [];
    for (let d = 1; d <= N; d++) if (dayHasShortage(d)) bad.push(d);
    if (bad.length) {
      lines.push('<div>⚠ 人数過不足の日: ' + bad.join(', ') +
        '（必要: 遅番' + C.REQ.late + '・早番' + C.REQ.early + '・アシマネ' + C.REQ.amane + '）</div>');
    }

    // 連勤アラート
    const runs = computeStreaks().runs;
    const who = (r) => (r.role + ' ' + (r.name || '無名')) + '（' + r.start + '〜' + r.end + '日=' + r.len + '連勤）';
    const forbid = runs.filter(r => r.sev === 7);
    const alert6 = runs.filter(r => r.sev === 6);
    if (forbid.length) {
      lines.push('<div class="wl-err">🚫 7連勤（絶対NG）: ' + forbid.map(who).join(' / ') + ' — 手直ししてください</div>');
    }
    if (alert6.length) {
      lines.push('<div class="wl-warn">⚠ 6連勤（注意・なるべく5まで）: ' + alert6.map(who).join(' / ') + '</div>');
    }

    if (!lines.length) { el.hidden = true; el.classList.remove('has-err'); return; }
    el.hidden = false;
    el.classList.toggle('has-err', forbid.length > 0);
    el.innerHTML = lines.join('');
  }

  function renderAll() {
    renderGrid();
    renderSummary();
    renderWarnings();
  }

  // ---- セル編集ポップオーバー ----
  function openEditor(td, id, day) {
    const pop = document.getElementById('popover');
    const cur = Store.getCell(id, day);
    const opts = Object.keys(C.SHIFT).map(code => {
      const def = C.SHIFT[code];
      const bg = '#' + def.argb.slice(2);
      const fg = def.textArgb ? '#' + def.textArgb.slice(2) : '#1d2733';
      const sel = (cur === code) ? 'style="outline:2px solid #1d9bf0"' : '';
      return `<button class="opt" data-code="${code}" ${sel}>
        <span class="sw" style="background:${bg}"></span>
        <span><b style="color:${fg};background:${bg};padding:0 4px;border-radius:3px">${esc(code)}</b> ${esc(def.label)}</span>
      </button>`;
    }).join('');

    const locked = Store.isLocked(id, day);
    pop.innerHTML =
      `<h3>${day}日 のシフト${locked ? ' <span class="lk">🔒固定中</span>' : ''}</h3>
       <p class="pop-hint">選ぶと<b>手入力として固定</b>され、自動生成で上書きされません。</p>
       <div class="opts">
         ${opts}
         <button class="opt" data-code=""><span class="sw" style="background:#fff;border:1px dashed #99a"></span><span>空欄にする（固定解除）</span></button>
       </div>
       <div class="free">
         <input type="text" id="freeCode" placeholder="自由入力 (例 75/0800)" value="${esc(cur)}">
         <button id="freeSet">固定</button>
       </div>
       ${locked ? '<button id="unlock" class="unlock">固定を解除（自動生成の対象に戻す）</button>' : ''}`;

    // 位置
    const r = td.getBoundingClientRect();
    pop.hidden = false;
    const pw = 210, ph = pop.offsetHeight || 260;
    let left = r.left + window.scrollX;
    let top = r.bottom + window.scrollY + 4;
    if (left + pw > window.scrollX + document.documentElement.clientWidth)
      left = window.scrollX + document.documentElement.clientWidth - pw - 8;
    if (r.bottom + ph > document.documentElement.clientHeight)
      top = r.top + window.scrollY - ph - 4;
    pop.style.left = left + 'px';
    pop.style.top = Math.max(window.scrollY + 4, top) + 'px';

    // manual=true で手入力固定（空欄なら固定解除）
    const apply = (code) => { Store.setCell(id, day, code, true); closeEditor(); renderAll(); onChange(); };
    pop.querySelectorAll('.opt').forEach(b =>
      b.addEventListener('click', () => apply(b.dataset.code)));
    pop.querySelector('#freeSet').addEventListener('click', () =>
      apply(pop.querySelector('#freeCode').value.trim()));
    pop.querySelector('#freeCode').addEventListener('keydown', e => {
      if (e.key === 'Enter') apply(e.target.value.trim());
    });
    const unlockBtn = pop.querySelector('#unlock');
    if (unlockBtn) unlockBtn.addEventListener('click', () => {
      Store.setLock(id, day, false); closeEditor(); renderAll(); onChange();
    });
  }

  function closeEditor() {
    const pop = document.getElementById('popover');
    pop.hidden = true; pop.innerHTML = '';
  }

  // 外側クリックで閉じる
  document.addEventListener('click', e => {
    const pop = document.getElementById('popover');
    if (pop.hidden) return;
    if (!pop.contains(e.target) && !e.target.classList.contains('cell')) closeEditor();
  });

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  g.Grid = { renderAll, renderGrid, renderSummary, renderWarnings, setOnChange, dayCounts };
})(window);
