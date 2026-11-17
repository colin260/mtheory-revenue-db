import ExcelJS from 'exceljs';
import { parse } from 'csv-parse/sync';
import { query, transaction } from './db';

// Reads a list of upcoming shows (a Gigwell export or any Excel/CSV with similar columns) into projected_shows.
// Columns are matched by header NAME. Each show goes to the artist named on its row (or the Artist box when the file has no Artist column).
// Key = artist + show date + venue: re-uploading updates fee/status/contact instead of duplicating. Past dates are kept: a show that has been played but not yet paid is still income to receive (Colin, Nov 9 2026).
export type ProjShow = { artist: string; show_date: string; venue: string; city: string | null; state: string | null; contact: string | null; fee: number | null; status: string };
export type ProjResult = {
  ok: boolean; dryRun: boolean; errors: string[]; warnings: string[];
  read: number; inserted: number; updated: number; removed: number;
  skipped: { blank: number; duplicates: number; unknownArtist: number };
  byArtist: { artist: string; shows: number; fees: number; nextYear: number }[];
  shows: (ProjShow & { isNew: boolean })[];
};

const ALIASES: Record<string, keyof ProjShow | 'location'> = {
  artist: 'artist', 'artist name': 'artist', act: 'artist', performer: 'artist', talent: 'artist', client: 'artist',
  date: 'show_date', 'show date': 'show_date', 'event date': 'show_date', 'performance date': 'show_date', 'start date': 'show_date', 'play date': 'show_date',
  venue: 'venue', 'venue name': 'venue', event: 'venue', 'event name': 'venue', show: 'venue', 'show / city': 'venue', 'show name': 'venue',
  city: 'city', state: 'state', 'state/province': 'state', province: 'state', st: 'state', region: 'state', location: 'location', 'city, state': 'location', market: 'location',
  contact: 'contact', buyer: 'contact', 'buyer name': 'contact', promoter: 'contact', purchaser: 'contact', 'buyer contact': 'contact',
  fee: 'fee', guarantee: 'fee', 'guarantee amount': 'fee', offer: 'fee', 'offer amount': 'fee', 'artist fee': 'fee', deal: 'fee', amount: 'fee', 'total fee': 'fee',
  status: 'status', 'deal status': 'status', 'booking status': 'status', stage: 'status',
};
const ARTIST_ALIASES: Record<string, string> = { 'twenty one pilots': '21 Pilots' };

const cellText = (v: ExcelJS.CellValue): string => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    const o = v as any;
    if ('result' in o && o.result != null) return o.result instanceof Date ? o.result.toISOString() : String(o.result);
    if ('richText' in o) return o.richText.map((r: any) => r.text).join('');
    if ('text' in o) return String(o.text);
    return '';
  }
  return String(v);
};
const ymd = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
function toDate(s: string): string | null {
  s = s.trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  if (/^\d{5}(\.\d+)?$/.test(s)) return ymd(new Date(Date.UTC(1899, 11, 30) + Number(s) * 86400000)); // Excel serial date
  const m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(s);
  if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
  const d = new Date(s.replace(/^[A-Za-z]{3,9},?\s+/, '')); // "Fri, Feb 6, 2026" / "February 6 2026"
  return Number.isNaN(d.getTime()) || !/\d{4}/.test(s) ? null : ymd(new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())));
}
const money = (s: string): number | null => {
  const t = s.replace(/[$,\s]|USD/gi, '').replace(/^\((.*)\)$/, '-$1');
  if (!t || t === '-') return null;
  const n = Number(t);
  return Number.isNaN(n) ? null : n;
};
function status(s: string): string {
  const t = s.toLowerCase();
  if (/expir|cancel|releas|declin|dead|lost/.test(t)) return 'Expired';
  if (/confirm|contract|booked|settled|signed|accepted|announce/.test(t)) return 'Confirmed';
  return 'Not confirmed';
}

async function readGrid(name: string, buf: Buffer): Promise<string[][]> {
  if (/\.csv$/i.test(name)) return parse(buf.toString('utf8').replace(/^﻿/, ''), { relax_column_count: true, skip_empty_lines: false }) as string[][];
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as any);
  const ws = wb.worksheets.find(w => w.rowCount > 1) ?? wb.worksheets[0];
  if (!ws) throw new Error('The workbook has no sheets.');
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: true }, (row, n) => { const r: string[] = []; row.eachCell({ includeEmpty: true }, (c, i) => { r[i - 1] = cellText(c.value); }); out[n - 1] = r; });
  return Array.from(out, r => Array.from(r ?? [], x => x ?? ''));
}

export async function importProjections(name: string, buf: Buffer, o: { artist?: string; replace: boolean; dryRun: boolean }): Promise<ProjResult> {
  const res: ProjResult = { ok: false, dryRun: o.dryRun, errors: [], warnings: [], read: 0, inserted: 0, updated: 0, removed: 0,
    skipped: { blank: 0, duplicates: 0, unknownArtist: 0 }, byArtist: [], shows: [] };
  const grid = await readGrid(name, buf);

  // Header row = the row (in the first 20) matching the most known column names; needs a date and a venue or fee.
  let hdr = -1, col: Partial<Record<keyof ProjShow | 'location', number>> = {};
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const m: typeof col = {};
    grid[i].forEach((h, j) => { const k = ALIASES[h.trim().toLowerCase().replace(/\s+/g, ' ').replace(/:$/, '')]; if (k && m[k] == null) m[k] = j; });
    if (m.show_date != null && (m.venue != null || m.fee != null) && Object.keys(m).length > Object.keys(col).length) { hdr = i; col = m; }
  }
  if (hdr < 0) { res.errors.push('Could not find the header row. The file needs a date column (e.g. "Date" or "Show Date") and a "Venue" or "Fee" column.'); return res; }
  if (col.artist == null && !o.artist) { res.errors.push('The file has no Artist column. Type the artist in the Artist box.'); return res; }

  const known = new Map((await query<{ name: string }>('select name from artists')).map(r => [r.name.toLowerCase(), r.name]));
  const resolve = (a: string) => { const t = a.trim(); const k = (ARTIST_ALIASES[t.toLowerCase()] ?? t).toLowerCase(); return known.get(k) ?? null; };
  const boxArtist = o.artist ? resolve(o.artist) : null;
  if (o.artist && !boxArtist) { res.errors.push(`"${o.artist}" isn't an artist in the database. Check the spelling (it must match the artist name on the tracker).`); return res; }

  const year = new Date().getFullYear();
  const unknown = new Set<string>(), bad: number[] = [];
  const shows = new Map<string, ProjShow>();
  const get = (r: string[], k: keyof typeof col) => (col[k] != null ? (r[col[k]!] ?? '').trim() : '');
  for (let i = hdr + 1; i < grid.length; i++) {
    const r = grid[i] ?? [];
    if (!r.some(x => x?.trim())) { res.skipped.blank++; continue; }
    const rawDate = get(r, 'show_date'), d = toDate(rawDate);
    let venue = get(r, 'venue'), city = get(r, 'city') || null, state = get(r, 'state') || null;
    const loc = get(r, 'location');
    if (loc && !city) { const [c, s] = loc.split(/,\s*/); city = c || null; state = state ?? (s || null); }
    if (!d) { if (/total/i.test(r.join(' ')) || !rawDate) res.skipped.blank++; else bad.push(i + 1); continue; }
    if (!venue) venue = [city, state].filter(Boolean).join(', ') || 'TBA';
    const rowArtist = get(r, 'artist');
    const artist = rowArtist ? resolve(rowArtist) : boxArtist;
    res.read++;
    if (!artist) { unknown.add(rowArtist); res.skipped.unknownArtist++; continue; }
    const key = `${artist}|${d}|${venue.toLowerCase()}`;
    if (shows.has(key)) res.skipped.duplicates++;
    shows.set(key, { artist, show_date: d, venue, city, state, contact: get(r, 'contact') || null, fee: money(get(r, 'fee')), status: status(get(r, 'status')) });
  }
  if (bad.length) res.warnings.push(`${bad.length} row(s) have a date that couldn't be read and were skipped (file rows ${bad.slice(0, 10).join(', ')}${bad.length > 10 ? ', …' : ''}).`);
  if (unknown.size) res.warnings.push(`Not an artist in the database, skipped: ${[...unknown].join(', ')}. Check the spelling against the tracker's Artist column.`);
  if (!shows.size) { res.ok = !res.errors.length; if (!res.read) res.errors.push('No shows found under the header row.'), res.ok = false; return res; }

  const list = [...shows.values()].sort((a, b) => a.artist.localeCompare(b.artist) || a.show_date.localeCompare(b.show_date));
  const artists = [...new Set(list.map(s => s.artist))];
  const existing = await query<{ artist: string; d: string; venue: string }>(
    `select artist, to_char(show_date, 'YYYY-MM-DD') d, venue from projected_shows where artist = any($1)`, [artists]);
  const have = new Set(existing.map(e => `${e.artist}|${e.d}|${e.venue.toLowerCase()}`));
  res.shows = list.map(s => ({ ...s, isNew: !have.has(`${s.artist}|${s.show_date}|${s.venue.toLowerCase()}`) }));
  res.inserted = res.shows.filter(s => s.isNew).length;
  res.updated = res.shows.length - res.inserted;
  const stale = existing.filter(e => !shows.has(`${e.artist}|${e.d}|${e.venue.toLowerCase()}`));
  if (o.replace) res.removed = stale.length;
  else if (stale.length) res.warnings.push(`${stale.length} show(s) already saved for ${artists.join(', ')} are not in this file. They are kept; tick "Replace" to remove them (e.g. shows that have since been paid).`);
  res.byArtist = artists.map(a => { const g = list.filter(s => s.artist === a); return { artist: a, shows: g.length, fees: g.filter(s => s.status !== 'Expired').reduce((t, s) => t + (s.fee ?? 0), 0), nextYear: g.filter(s => Number(s.show_date.slice(0, 4)) > year).length }; });
  const later = res.byArtist.reduce((t, a) => t + a.nextYear, 0);
  if (later) res.warnings.push(`${later} show(s) are after ${year}. They are saved but the Touring tab only shows ${year} for now.`);
  res.ok = true;
  if (o.dryRun) return res;

  await transaction(async run => {
    if (o.replace) for (const e of stale) await run('delete from projected_shows where artist = $1 and show_date = $2 and lower(venue) = lower($3)', [e.artist, e.d, e.venue]);
    for (const s of list) {
      // Same show with different capitalisation of the venue: update that row rather than add a second one.
      await run('delete from projected_shows where artist = $1 and show_date = $2 and lower(venue) = lower($3) and venue <> $3', [s.artist, s.show_date, s.venue]);
      await run(`insert into projected_shows (artist, show_date, venue, city, state, contact, fee, status, source) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        on conflict (artist, show_date, venue) do update set city = excluded.city, state = excluded.state, contact = excluded.contact, fee = excluded.fee, status = excluded.status, source = excluded.source`,
        [s.artist, s.show_date, s.venue, s.city, s.state, s.contact, s.fee, s.status, `Upload: ${name}`.slice(0, 200)]);
    }
  });
  return res;
}
