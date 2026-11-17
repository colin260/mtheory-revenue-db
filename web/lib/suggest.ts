import { query } from './db';
import { scoped } from './scope';
import type { Viewer } from './session';

// Candidate names to match a search against: artists, managers, sources, clients. Built from the
// viewer's scoped lines, so nobody is ever suggested a name they can't see.
const names = (v: Viewer) => `
  select 'artist' kind, artist v from ${scoped(v)} where artist is not null
  union select 'manager', manager from ${scoped(v)}
  union select 'source', source from ${scoped(v)} where source is not null
  union select 'client', client_name from ${scoped(v)} where client_name is not null`;

export type Suggestion = { kind: 'artist' | 'manager' | 'source' | 'client'; v: string };

// Closest names to `q`, tolerating typos (pg_trgm similarity) and partial words.
export async function similarNames(v: Viewer, q: string, limit = 5): Promise<Suggestion[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  return query<Suggestion>(
    `select kind, v from (${names(v)}) n
     where similarity(lower(v), lower($1)) > 0.3 or word_similarity(lower($1), lower(v)) > 0.5
     order by greatest(similarity(lower(v), lower($1)), word_similarity(lower($1), lower(v))) desc, v
     limit ${limit}`, [term]);
}

// For type-ahead: names containing the text first, then fuzzy matches.
export async function typeahead(v: Viewer, q: string): Promise<string[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const rows = await query<{ v: string }>(
    `select v from (select distinct v from (${names(v)}) n) d
     where v ilike $2 or similarity(lower(v), lower($1)) > 0.3
     order by (v ilike $3) desc, (v ilike $2) desc, similarity(lower(v), lower($1)) desc, v limit 8`,
    [term, `%${term}%`, `${term}%`]);
  return rows.map(r => r.v);
}
