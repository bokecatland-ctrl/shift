/* app.js — UI 配線（スタッフ管理・希望休・各ボタン） */
(function (g) {
  'use strict';
  const C = g.CFG, Store = g.Store, Grid = g.Grid, Gen = g.Generator, Xlsx = g.Xlsx;

  function $(id) { return document.getElementById(id); }
  function pad(n) { return (n < 10 ? '0' : '') + n; }

  // ---- スタッフ一覧 ----
  function renderStaffList() {
    const ul = $('staffList');
    const staff = Store.getStaff();
    ul.innerHTML = staff.map(s =>
      `<li data-id="${s.id}">
        <button class="up" title="上へ">▲</button>
        <button class="down" title="下へ">▼</button>
        <span class="role ${s.role === 'PT' ? 'PT' : ''}">${esc(s.role)}</span>
        <span class="nm">${esc(s.name || '（無名）')}</span>
        <button class="del" title="削除">✕</button>
      </li>`).join('');

    ul.querySelectorAll('li').forEach(li => {
      const id = li.dataset.id;
      li.querySelector('.del').addEventListener('click', () => {
        Store.removeStaff(id); refreshAll();
      });
      li.querySelector('.up').addEventListener('click', () => { Store.moveStaff(id, -1); refreshAll(); });
      li.querySelector('.down').addEventListener('click', () => { Store.moveStaff(id, 1); refreshAll(); });
    });
  }

  // ---- 希望休セレクト ----
  function renderOffSelect() {
    const sel = $('offStaffSelect');
    const staff = Store.getStaff();
    const prev = sel.value;
    sel.innerHTML = staff.map(s =>
      `<option value="${s.id}">${esc(s.role)} / ${esc(s.name || '（無名）')}</option>`).join('');
    if (staff.some(s => s.id === prev)) sel.value = prev;
    renderOffDays();
  }

  function renderOffDays() {
    const sel = $('offStaffSelect');
    const id = sel.value;
    const wrap = $('offDays');
    if (!id) { wrap.innerHTML = '<p class="hint">スタッフを追加してください。</p>'; return; }
    const m = Store.getMonth();
    const N = C.daysInMonth(m.year, m.month);
    let html = '';
    for (let d = 1; d <= N; d++) {
      const we = C.isWeekend(m.year, m.month, d) ? 'we' : '';
      const on = Store.isOff(id, d) ? 'on' : '';
      html += `<div class="od ${we} ${on}" data-day="${d}">${d}</div>`;
    }
    wrap.innerHTML = html;
    wrap.querySelectorAll('.od').forEach(od => {
      od.addEventListener('click', () => {
        Store.toggleOff(id, +od.dataset.day);
        od.classList.toggle('on');
        Grid.renderAll();
      });
    });
  }

  // ---- 月 ----
  function syncMonthInput() {
    const m = Store.getMonth();
    $('monthInput').value = m.year + '-' + pad(m.month);
  }

  // ---- 再描画 ----
  function refreshAll() {
    renderStaffList();
    renderOffSelect();
    Grid.renderAll();
  }

  // ---- 役職テンプレ初期化（実名なし） ----
  function seedTemplate() {
    if (Store.getStaff().length &&
        !confirm('現在のスタッフを置き換えて、役職テンプレ（実名なし）で初期化しますか？')) return;
    const tpl = [
      ['JP4', ''], ['JP4', ''], ['JP4', ''],
      ['E2', ''], ['E2', ''], ['E2', ''],
      ['E1', ''], ['E1', ''], ['E1', ''],
      ['PT', ''], ['PT', '']
    ];
    const list = tpl.map(([role], i) => ({
      id: 's' + Date.now().toString(36) + i + Math.random().toString(36).slice(2, 5),
      role, name: ''
    }));
    Store.setStaff(list);
    Store.setGrid({});
    Store.state.desiredOff = {};
    try { localStorage.setItem('shift.desiredOff.v1', '{}'); } catch (e) {}
    refreshAll();
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // ---- 初期化 ----
  function init() {
    Grid.setOnChange(() => { renderOffDays(); });

    syncMonthInput();
    refreshAll();

    $('staffForm').addEventListener('submit', e => {
      e.preventDefault();
      const role = $('staffRole').value;
      const name = $('staffName').value.trim();
      Store.addStaff(role, name);
      $('staffName').value = '';
      refreshAll();
    });

    $('btnSeed').addEventListener('click', seedTemplate);

    $('offStaffSelect').addEventListener('change', renderOffDays);

    $('monthInput').addEventListener('change', e => {
      const v = e.target.value; // YYYY-MM
      const mt = /^(\d{4})-(\d{2})$/.exec(v);
      if (!mt) return;
      Store.setMonth(+mt[1], +mt[2]);
      refreshAll();
    });

    $('btnGenerate').addEventListener('click', () => {
      const m = Store.getMonth();
      const grid = Gen.generate(Store.getStaff(), Store.state.desiredOff, m.year, m.month);
      Store.setGrid(grid);
      Grid.renderAll();
      renderOffDays();
    });

    $('btnClear').addEventListener('click', () => {
      if (!confirm('グリッド（シフト）を消去しますか？スタッフと希望休は残ります。')) return;
      Store.clearGrid();
      Grid.renderAll();
    });

    $('btnExport').addEventListener('click', async () => {
      try { await Xlsx.exportXlsx(); }
      catch (err) { alert('書出に失敗: ' + err.message); }
    });

    $('btnImport').addEventListener('click', () => $('fileInput').click());
    $('fileInput').addEventListener('change', async e => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const res = await Xlsx.importXlsx(file);
        syncMonthInput();
        refreshAll();
        alert(`取込完了: ${res.count} 名 / ${res.year}年${res.month}月 (${res.days}日)`);
      } catch (err) {
        alert('取込に失敗: ' + err.message);
      }
      e.target.value = '';
    });
  }

  document.addEventListener('DOMContentLoaded', init);
})(window);
