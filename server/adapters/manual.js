'use strict';

/*
 * Manual adapter. Degraded mode for haulers without telematics. Operator
 * uploads a daily CSV of weighbridge tickets; the adapter parses it into
 * normalised AXIS trip records. Column order is fixed, with a tolerant
 * header match so the business-day-1 ops person doesn't need to reshape
 * a spreadsheet.
 *
 * Required columns — any subset of:
 *   date          (ISO YYYY-MM-DD or DD/MM/YYYY)
 *   truck         (string identifier)
 *   tonnes        (number)
 *   delay_min     (number, optional)
 *   note          (string, optional)
 */

function parseDate(s) {
  if (!s) return null;
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return { rows: [], errors: ['CSV is empty'] };

  const headers = lines[0].split(',').map((h) => h.trim().toLowerCase());
  const colIdx = {
    date:      headers.indexOf('date'),
    truck:     headers.indexOf('truck'),
    tonnes:    headers.indexOf('tonnes'),
    delay_min: headers.indexOf('delay_min'),
    note:      headers.indexOf('note'),
  };
  if (colIdx.date < 0 || colIdx.truck < 0 || colIdx.tonnes < 0) {
    return { rows: [], errors: ['CSV must include date, truck, and tonnes columns'] };
  }

  const rows = [];
  const errors = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = lines[i].split(',').map((c) => c.trim());
    const iso   = parseDate(cells[colIdx.date]);
    const truck = cells[colIdx.truck];
    const tonnes = Number(cells[colIdx.tonnes]);
    if (!iso || !truck || !Number.isFinite(tonnes)) {
      errors.push(`Row ${i + 1}: missing or invalid value`);
      continue;
    }
    rows.push({
      id:         `manual-${i}`,
      date:       iso,
      truck_id:   truck,
      tonnes:     Number(tonnes.toFixed(2)),
      delay_min:  colIdx.delay_min >= 0 ? Number(cells[colIdx.delay_min]) || 0 : 0,
      note:       colIdx.note      >= 0 ? cells[colIdx.note] || '' : '',
    });
  }
  return { rows, errors };
}

async function probe({ csv_text }) {
  const { rows, errors } = parseCsv(csv_text || '');
  return {
    live: false,
    ok: errors.length === 0 || rows.length > 0,
    account_name: 'Manual CSV',
    rows_parsed: rows.length,
    errors,
    probed_at: new Date().toISOString(),
  };
}

async function syncFleet(_creds, hauler) {
  return {
    live: false,
    vehicles_discovered: hauler.fleet.contracted_trucks,
    last_sync: new Date().toISOString(),
  };
}

module.exports = { probe, parseCsv, syncFleet };
