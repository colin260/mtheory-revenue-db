import { query } from './db';
import { scoped } from './scope';
import type { Viewer } from './session';

// Booked or offered shows not yet paid, from a Gigwell export or an upload on Add data (source says which). Not revenue: they live in projected_shows, apart from the tracker lines.
// Commission = fee x the artist's usual touring rate (the most common rate on their touring lines). Staff only see their own artists. For now only the current calendar year is shown (Colin, Nov 2026). Past dates stay until removed: played but not yet paid is still income to receive (Colin, Nov 9 2026).
export type Projected = { show_date: string; venue: string; city: string | null; state: string | null; contact: string | null; fee: number | null; status: string; source: string | null; commission: number | null; custom: boolean };

// Rate for artists with no touring lines yet, so projected commission still has a rate. Used only when the artist has no touring history.
export const PROJECTION_RATES: Record<string, number> = { 'Logan Crosby': 0.15 };   // Colin, Nov 17 2026

// Artists with projected shows this year or later that the viewer may see (so an artist with no tracker lines yet still appears on the Touring tab).
export async function projectedArtists(v: Viewer): Promise<string[]> {
  const rows = await query<{ artist: string }>(`select distinct artist from projected_shows where extract(year from show_date) >= $1 order by 1`, [new Date().getFullYear()]);
  return rows.map(r => r.artist).filter(a => v.artists === null || v.artists.includes(a));
}

// One calendar year at a time (Colin, Nov 2026): the current year by default, or a later year picked on the page (`pyear=`). If the current year has none, the first later year.
export type ProjectedSet = { rate: number | null; setRate?: boolean; shows: Projected[]; year?: number; years?: number[] };
export async function projectedFor(v: Viewer, artist: string, want?: string): Promise<ProjectedSet> {
  if (v.artists !== null && !v.artists.includes(artist)) return { rate: null, shows: [] };
  const now = new Date().getFullYear();
  const years = (await query<{ y: number }>(`select distinct extract(year from show_date)::int y from projected_shows where artist = $1 and extract(year from show_date) >= $2 order by 1`, [artist, now])).map(r => r.y);
  const year = years.includes(Number(want)) ? Number(want) : years.includes(now) ? now : years[0] ?? now;
  const rows = await query<Omit<Projected, 'commission' | 'custom'> & { override: number | null }>(
    `select to_char(show_date, 'YYYY-MM-DD') show_date, venue, city, state, contact, fee::float8 fee, coalesce(status, 'Not confirmed') status, source, commission_override::float8 override
     from projected_shows where artist = $1 and extract(year from show_date) = $2 order by show_date, venue`, [artist, year]);
  if (!rows.length) return { rate: null, shows: [] };
  const r = await query<{ rate: number }>(
    `select rate::float8 rate from ${scoped(v)} where artist = $1 and commission_type like 'Touring%' and rate is not null group by rate order by count(*) desc, rate desc limit 1`, [artist]);
  const rate = r[0]?.rate ?? PROJECTION_RATES[artist] ?? null;
  return { year, years, rate: v.sees.money ? rate : null, setRate: r[0]?.rate == null && rate != null, shows: rows.map(({ override, ...s }) => {
    const custom = v.sees.money && override != null; // commission typed in by finance for this show
    return { ...s, custom, commission: !v.sees.money || s.status === 'Expired' ? null : custom ? override : rate != null && s.fee ? s.fee * rate : null };
  }) };
}
