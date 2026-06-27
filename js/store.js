/* store.js — localStorage 永続化（スタッフ / 希望休 / グリッド / 対象月） */
(function (g) {
  'use strict';

  const K = {
    staff: 'shift.staff.v1',
    off: 'shift.desiredOff.v1',
    grid: 'shift.grid.v1',
    month: 'shift.month.v1',
    settings: 'shift.settings.v1'
  };

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch (e) { return fallback; }
  }
  function write(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {}
  }

  // ---- state ----
  const now = new Date();
  const state = {
    month: read(K.month, { year: 2026, month: 6 }),
    staff: read(K.staff, []),          // [{id, role, name}]
    desiredOff: read(K.off, {}),       // { staffId: [day,...] }
    grid: read(K.grid, {}),            // { staffId: { day: code } }
    settings: Object.assign({}, window.CFG.DEFAULT_SETTINGS, read(K.settings, {}))
  };

  function uid() {
    return 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  // ---- staff ----
  function getStaff() { return state.staff; }
  function addStaff(role, name) {
    const s = { id: uid(), role: role, name: (name || '').trim() };
    state.staff.push(s);
    write(K.staff, state.staff);
    return s;
  }
  function removeStaff(id) {
    state.staff = state.staff.filter(s => s.id !== id);
    delete state.desiredOff[id];
    delete state.grid[id];
    write(K.staff, state.staff); write(K.off, state.desiredOff); write(K.grid, state.grid);
  }
  function moveStaff(id, dir) {
    const i = state.staff.findIndex(s => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= state.staff.length) return;
    const t = state.staff[i]; state.staff[i] = state.staff[j]; state.staff[j] = t;
    write(K.staff, state.staff);
  }
  function setStaff(list) { state.staff = list; write(K.staff, state.staff); }

  // ---- desired off ----
  function getOff(id) { return state.desiredOff[id] || []; }
  function toggleOff(id, day) {
    const arr = state.desiredOff[id] || (state.desiredOff[id] = []);
    const i = arr.indexOf(day);
    if (i >= 0) arr.splice(i, 1); else arr.push(day);
    write(K.off, state.desiredOff);
  }
  function isOff(id, day) { return getOff(id).indexOf(day) >= 0; }

  // ---- grid ----
  function getGrid() { return state.grid; }
  function getCell(id, day) {
    const r = state.grid[id]; return r ? (r[day] || '') : '';
  }
  function setCell(id, day, code) {
    const r = state.grid[id] || (state.grid[id] = {});
    if (code == null || code === '') delete r[day]; else r[day] = code;
    write(K.grid, state.grid);
  }
  function setGrid(grid) { state.grid = grid || {}; write(K.grid, state.grid); }
  function clearGrid() { state.grid = {}; write(K.grid, state.grid); }

  // ---- month ----
  function getMonth() { return state.month; }
  function setMonth(year, month) {
    state.month = { year: year, month: month };
    write(K.month, state.month);
  }

  // ---- settings（生成のベースルール） ----
  function getSettings() { return state.settings; }
  function setSettings(patch) {
    state.settings = Object.assign({}, state.settings, patch);
    write(K.settings, state.settings);
    return state.settings;
  }

  g.Store = {
    state,
    getStaff, addStaff, removeStaff, moveStaff, setStaff,
    getOff, toggleOff, isOff,
    getGrid, getCell, setCell, setGrid, clearGrid,
    getMonth, setMonth,
    getSettings, setSettings
  };
})(window);
