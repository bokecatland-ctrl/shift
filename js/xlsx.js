/* xlsx.js — 既存 .xlsx 取込 & 同じ見た目で .xlsx 書出（ExcelJS / MIT, vendor/）*/
(function (g) {
  'use strict';
  const C = g.CFG, Store = g.Store;

  const ROLE_COL = 3;   // C = 役職
  const NAME_COL = 4;   // D = 氏名
  const DAY0 = 4;       // 日 d は列 (DAY0 + d) → 1日=E(5)
  const TITLE_ROW = 1, DAY_ROW = 2, WD_ROW = 3, STAFF_ROW0 = 4;

  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function dayCol(d) { return DAY0 + d; }

  function fillFor(code) {
    const def = C.SHIFT[code];
    if (!def) return null;
    return { type: 'pattern', pattern: 'solid', fgColor: { argb: def.argb } };
  }
  function fontFor(code) {
    const def = C.SHIFT[code];
    if (def && def.textArgb) return { color: { argb: def.textArgb }, bold: true };
    return null;
  }

  const THIN = { style: 'thin', color: { argb: 'FFBFC8D0' } };
  const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN };

  // ============ 書出 ============
  async function exportXlsx() {
    const m = Store.getMonth();
    const N = C.daysInMonth(m.year, m.month);
    const sheetName = '' + m.year + pad(m.month);

    const wb = new ExcelJS.Workbook();
    wb.creator = 'shift-auto';
    const ws = wb.addWorksheet(sheetName, {
      views: [{ state: 'frozen', xSplit: NAME_COL, ySplit: WD_ROW }]
    });

    const offCol = dayCol(N) + 1;
    const lastCol = offCol;

    // 列幅
    ws.getColumn(ROLE_COL).width = 14;
    ws.getColumn(NAME_COL).width = 24;
    for (let d = 1; d <= N; d++) ws.getColumn(dayCol(d)).width = 6;
    ws.getColumn(offCol).width = 7;

    // タイトル
    ws.getCell(TITLE_ROW, ROLE_COL).value = 'EXECUTIVE LOUNGE  ' + m.year + '/' + pad(m.month);
    ws.mergeCells(TITLE_ROW, ROLE_COL, TITLE_ROW, Math.min(dayCol(10), lastCol));
    ws.getCell(TITLE_ROW, ROLE_COL).font = { bold: true, size: 13 };

    // ヘッダ行（役職/氏名/日付/公休）
    ws.getCell(DAY_ROW, ROLE_COL).value = '役職';
    ws.getCell(DAY_ROW, NAME_COL).value = '氏名';
    const holName = (d) => window.Holidays ? window.Holidays.holidayName(m.year, m.month, d) : null;
    for (let d = 1; d <= N; d++) {
      const c = ws.getCell(DAY_ROW, dayCol(d));
      c.value = d;
      c.alignment = { horizontal: 'center' };
      c.font = { bold: true };
      if (holName(d)) c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD9E2' } };
      else if (C.isWeekend(m.year, m.month, d))
        c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE7ECC0' } };
    }
    ws.getCell(DAY_ROW, offCol).value = '公休';
    ws.getCell(DAY_ROW, offCol).font = { bold: true };

    // 曜日行（日曜・祝日は赤、祝日名はセルのコメント/メモ代わりに値へ付記しないが赤表示）
    for (let d = 1; d <= N; d++) {
      const c = ws.getCell(WD_ROW, dayCol(d));
      const hol = holName(d);
      c.value = C.weekdayLabel(m.year, m.month, d);
      c.alignment = { horizontal: 'center' };
      const red = hol || C.weekdayIndex(m.year, m.month, d) === 0;
      c.font = { size: 9, color: { argb: red ? 'FFC0392B' : 'FF666666' } };
      if (hol) c.note = hol;
    }

    // スタッフ行（社員を先頭に並べて COUNTIF が社員ブロックを参照できるように）
    const staff = Store.getStaff();
    const social = staff.filter(s => C.GEN_ROLES.indexOf(s.role) >= 0);
    const others = staff.filter(s => C.GEN_ROLES.indexOf(s.role) < 0);
    const ordered = social.concat(others);

    let r = STAFF_ROW0;
    const socialFirstRow = STAFF_ROW0;
    const socialLastRow = STAFF_ROW0 + social.length - 1;

    ordered.forEach(s => {
      ws.getCell(r, ROLE_COL).value = s.role;
      ws.getCell(r, ROLE_COL).font = { bold: true };
      ws.getCell(r, NAME_COL).value = s.name || '';
      for (let d = 1; d <= N; d++) {
        const code = Store.getCell(s.id, d);
        const cell = ws.getCell(r, dayCol(d));
        if (code) cell.value = code;
        cell.alignment = { horizontal: 'center' };
        const f = fillFor(code); if (f) cell.fill = f;
        const ft = fontFor(code); if (ft) cell.font = ft;
      }
      // 公休カウント
      ws.getCell(r, offCol).value = {
        formula: `COUNTIF(${addr(socialColRange(r, N))},"/")`
      };
      r++;
    });
    const lastStaffRow = r - 1;

    // 罫線（ヘッダ〜スタッフ）
    for (let rr = DAY_ROW; rr <= lastStaffRow; rr++)
      for (let cc = ROLE_COL; cc <= offCol; cc++)
        ws.getCell(rr, cc).border = BORDER;

    // 下部集計（社員ブロックを COUNTIF）
    let sr = lastStaffRow + 2;
    ws.getCell(sr, ROLE_COL).value = '下部集計（社員のみ）';
    ws.getCell(sr, ROLE_COL).font = { bold: true };
    sr++;
    const haveSocial = social.length > 0;
    C.SUMMARY_BUCKETS.forEach(b => {
      ws.getCell(sr, ROLE_COL).value = b.code;
      ws.getCell(sr, NAME_COL).value = b.label + (b.req != null ? '（必要' + b.req + '）' : '');
      for (let d = 1; d <= N; d++) {
        const cell = ws.getCell(sr, dayCol(d));
        if (haveSocial) {
          const colL = colLetter(dayCol(d));
          const rng = `${colL}${socialFirstRow}:${colL}${socialLastRow}`;
          // 公休(/) は完全一致。他は部分一致でコード変種も拾う
          const crit = b.code === '/' ? '"/"' : `"*${b.code}*"`;
          cell.value = { formula: `COUNTIF(${rng},${crit})` };
        } else cell.value = 0;
        cell.alignment = { horizontal: 'center' };
        cell.border = BORDER;
      }
      ws.getCell(sr, ROLE_COL).border = BORDER;
      ws.getCell(sr, NAME_COL).border = BORDER;
      sr++;
    });

    // ダウンロード
    const buf = await wb.xlsx.writeBuffer();
    const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'shift_' + sheetName + '.xlsx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function socialColRange(row, N) {
    return { c1: dayCol(1), r1: row, c2: dayCol(N), r2: row };
  }
  function addr(r) {
    return colLetter(r.c1) + r.r1 + ':' + colLetter(r.c2) + r.r2;
  }
  function colLetter(col) {
    let s = '';
    while (col > 0) { const m = (col - 1) % 26; s = String.fromCharCode(65 + m) + s; col = (col - 1 - m) / 26; }
    return s;
  }

  // ============ 取込 ============
  async function importXlsx(file) {
    const buf = await file.arrayBuffer();
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.worksheets[0];
    if (!ws) throw new Error('シートが見つかりません');

    // 月をシート名 (YYYYMM) から推定
    let year = Store.getMonth().year, month = Store.getMonth().month;
    const mm = /(\d{4})\s*[\/\-\.]?\s*(\d{1,2})/.exec(ws.name || '');
    if (mm) { year = +mm[1]; month = +mm[2]; }

    // 日付ヘッダ行を探す: 連続整数 1,2,3.. が並ぶ行
    let dayRow = -1, startCol = -1, N = 0;
    for (let r = 1; r <= Math.min(20, ws.rowCount); r++) {
      for (let c = 1; c <= 10; c++) {
        if (cellNum(ws, r, c) === 1 && cellNum(ws, r, c + 1) === 2 && cellNum(ws, r, c + 2) === 3) {
          dayRow = r; startCol = c;
          let d = 1;
          while (cellNum(ws, r, c + d - 1) === d) d++;
          N = d - 1;
          break;
        }
      }
      if (dayRow > 0) break;
    }
    if (dayRow < 0) throw new Error('日付ヘッダ（1,2,3..）が見つかりません');

    const roleCol = startCol - 2;
    const nameCol = startCol - 1;
    const knownRoles = C.ROLES;

    // シフトらしい値か（マンニング数値や曜日・タイトルを除外するため）
    const SHIFT_TOKENS = ['HR', 'HSK', 'ベル', '出勤'];
    function shiftLike(v) {
      if (!v) return false;
      if (v === '/' || v === 'BD') return true;
      if (v.indexOf('/') >= 0) return true;          // 75/1300 等
      return SHIFT_TOKENS.indexOf(v) >= 0;
    }

    const newStaff = [];
    const newGrid = {};
    const newOff = {};

    for (let r = dayRow + 1; r <= ws.rowCount; r++) {
      const roleRaw = cellStr(ws, r, roleCol);
      const role = roleRaw.replace(/\s+/g, ' ').trim();
      const name = cellStr(ws, r, nameCol).trim();

      // 下部集計に到達したら終了（区分ラベルは 75/.. や TOTAL）
      if (/^75\//.test(role) || /^TOTAL/i.test(role)) break;

      // シフトセルを収集（シフトらしい値だけ取り込む）
      const cells = {};
      let shiftCount = 0;
      for (let d = 1; d <= N; d++) {
        const v = cellStr(ws, r, startCol + d - 1).trim();
        if (!v) continue;
        cells[d] = v;
        if (shiftLike(v)) shiftCount++;
      }

      // スタッフ行の判定: 既知役職 or 実シフトを 2 つ以上持つ行
      const isStaff = (knownRoles.indexOf(role) >= 0) || shiftCount >= 2;
      if (!isStaff) continue;

      const id = 's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + r;
      newStaff.push({ id, role: knownRoles.indexOf(role) >= 0 ? role : (role || 'PT'), name });
      newGrid[id] = cells;
      newOff[id] = [];
    }

    if (!newStaff.length) throw new Error('スタッフ行を取り込めませんでした');

    Store.setMonth(year, month);
    Store.setStaff(newStaff);
    Store.setGrid(newGrid);
    Store.state.desiredOff = newOff;
    try { localStorage.setItem('shift.desiredOff.v1', JSON.stringify(newOff)); } catch (e) {}

    return { count: newStaff.length, year, month, days: N };
  }

  function cellVal(ws, r, c) {
    const cell = ws.getCell(r, c);
    let v = cell.value;
    if (v && typeof v === 'object') {
      if ('result' in v) v = v.result;
      else if ('text' in v) v = v.text;
      else if ('richText' in v) v = v.richText.map(t => t.text).join('');
      else if ('formula' in v) v = '';
    }
    return v;
  }
  function cellStr(ws, r, c) { const v = cellVal(ws, r, c); return v == null ? '' : String(v); }
  function cellNum(ws, r, c) { const v = cellVal(ws, r, c); return typeof v === 'number' ? v : (v != null && /^\d+$/.test(String(v).trim()) ? +v : NaN); }

  g.Xlsx = { exportXlsx, importXlsx };
})(window);
