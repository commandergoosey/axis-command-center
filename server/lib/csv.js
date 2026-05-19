'use strict';

/*
 * Shared CSV utilities — LP-30.
 *
 * Extracted from admin.js (LP-18) so the same parser/serialiser can be
 * used by multiple route files without duplication.
 */

/** Parse a CSV string into an array of row objects keyed by header. */
function parseCSV(text) {
  const rows  = [];
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  let header  = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const cells = splitCSVLine(line);
    if (!header) { header = cells.map((c) => c.trim()); continue; }
    const obj = {};
    header.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
    rows.push(obj);
  }
  return rows;
}

function splitCSVLine(line) {
  const cells = [];
  let cur  = '';
  let inQ  = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === ',' && !inQ) {
      cells.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  cells.push(cur);
  return cells;
}

/** Serialise an array of objects to CSV using the supplied column order. */
function toCSV(headers, rows) {
  const esc = (v) => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"`
      : s;
  };
  const lines = [
    headers.join(','),
    ...rows.map((r) => headers.map((h) => esc(r[h])).join(',')),
  ];
  return lines.join('\r\n');
}

module.exports = { parseCSV, toCSV };
