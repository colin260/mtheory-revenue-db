import Link from 'next/link';
import { query } from '@/lib/db';
import { scoped } from '@/lib/scope';
import { requireViewer } from '@/lib/session';
import { FILTER_KEYS, basisLabel, filtersFrom, managerNames, orderBy, where, yearExpr, yearOptions, type SP } from '@/lib/filters';
import { SearchBox } from '@/lib/SearchBox';
import { similarNames } from '@/lib/suggest';
import { usd } from '@/lib/format';
import { LinesTable } from '@/lib/LinesTable';

export const dynamic = 'force-dynamic';
const PAGE = 100;

// Dropdown options narrow to the other selections (pick an artist and Source lists only that artist's sources). A dropdown ignores its own filter, so you can always switch it.
const options = (rel: string, col: string, key: (typeof FILTER_KEYS)[number], f: ReturnType<typeof filtersFrom>) => {
  const w = where({ ...f, [key]: '' });
  return query<{ v: string }>(`select distinct ${col} v from ${rel} ${w.sql ? w.sql + ' and' : 'where'} ${col} is not null order by 1`, w.params).then(r => r.map(x => String(x.v)));
};

export default async function Database({ searchParams }: { searchParams: Promise<SP> }) {
  const viewer = await requireViewer();
  const rel = scoped(viewer);
  const sp = await searchParams;
  const f = filtersFrom(sp);
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);
  const sort = (Array.isArray(sp.sort) ? sp.sort[0] : sp.sort) ?? '';
  const w = where(f);

  const [artists, managers, mgrs, types, sources, years, totals, rows] = await Promise.all([
    options(rel, 'artist', 'artist', f), options(rel, 'manager', 'manager', f), managerNames(rel, f.legacy), options(rel, 'commission_type', 'type', f), options(rel, 'source', 'source', f), query<{ v: number }>(yearOptions(rel, f.basis)).then(r => r.map(x => String(x.v))),
    query(`select count(*)::int n, coalesce(sum(amount),0)::float8 amount, coalesce(sum(commission),0)::float8 commission from ${rel} ${w.sql}`, w.params),
    query(`select v.*, l.source_row from (select * from ${rel} ${w.sql}) v join revenue_lines l using(line_id)
           order by ${orderBy(sort, viewer.sees.money, 'v.')} limit ${PAGE} offset ${(page - 1) * PAGE}`, w.params),
  ]);
  const t = totals[0];
  // Few or no hits: offer the closest known names (typo-tolerant).
  const similar = f.q && !/\s/.test(f.q.trim()) && t.n < 5 ? await similarNames(viewer, f.q) : [];
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]);
  if (sort) qs.set('sort', sort);
  const sortHref = (s: string) => { const u = new URLSearchParams(qs); u.set('sort', s); u.delete('page'); return `/database?${u}`; };
  const link = (p: number) => `/database?${new URLSearchParams([...qs, ['page', String(p)]])}`;
  const pages = Math.max(1, Math.ceil(t.n / PAGE));

  const Select = ({ name, label, opts }: { name: (typeof FILTER_KEYS)[number]; label: string; opts: string[] }) => (
    <label>{label}
      <select name={name} defaultValue={f[name]}>
        <option value="">All</option>
        {name === 'type' && <option value="(none)">(no type)</option>}
        {name === 'type' && <option value="Touring*">Touring (incl. VIP)</option>}
        {name === 'type' && <option value="Royalties*">Royalties (incl. Residuals)</option>}
        {name === 'type' && <option value="All*">All (incl. Other, Brand, Deduction, no type)</option>}
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );

  return (
    <>
      {(f.aq || f.hasartist || f.sign) && (
        <p className="note">Opened from a summary
          {f.aq ? <> · artist name contains “{f.aq}”</> : null}{f.hasartist ? <> · lines with an artist only</> : null}{f.sign ? <> · {f.sign === 'neg' ? 'expenses (negative amounts)' : 'income (positive amounts)'} only</> : null}
          {' '}(<Link href="/database">clear all filters</Link>)</p>
      )}
      <form className="filters" method="get">
        {f.aq && <input type="hidden" name="aq" value={f.aq} />}
        {f.hasartist && <input type="hidden" name="hasartist" value={f.hasartist} />}
        {f.sign && <input type="hidden" name="sign" value={f.sign} />}
        {sort && <input type="hidden" name="sort" value={sort} />}
        <label className="q">Search memo, source, artist or client
          <SearchBox defaultValue={f.q} />
        </label>
        <Select name="artist" label="Artist" opts={artists} />
        {f.co && <Select name="manager" label="Company" opts={managers} />}
        <Select name="mgr" label="Manager" opts={mgrs} />
        <Select name="type" label="Commission type" opts={types} />
        <Select name="source" label="Source" opts={sources} />
        <label>Year basis
          <select name="basis" defaultValue={f.basis}>
            <option value="">Cash year (tracker sheet)</option>
            <option value="statement">Statement year (as reported)</option>
          </select>
        </label>
        <Select name="year" label={basisLabel(f.basis)} opts={years} />
        <label>Deposited from<input type="date" name="from" defaultValue={f.from} /></label>
        <label>Deposited to<input type="date" name="to" defaultValue={f.to} /></label>
        <div className="actions">
          <label className="check"><input type="checkbox" name="co" value="1" defaultChecked={!!f.co} /> Show company</label>
          <label className="check"><input type="checkbox" name="legacy" value="1" defaultChecked={!!f.legacy} /> Include legacy managers</label>
          <button type="submit">Apply</button>
          <Link className="btn ghost" href="/database">Clear</Link>
          <a className="btn ghost" href={`/api/export?${qs}`}>Export CSV</a>
        </div>
      </form>

      {similar.length > 0 && (
        <div className="suggest">
          {t.n === 0 ? 'No matches.' : 'Few matches.'} Did you mean:{' '}
          {similar.map(x => {
            const u = new URLSearchParams(qs); u.delete('q'); u.delete('page');
            u.set(x.kind === 'client' ? 'q' : x.kind, x.v);
            return <a key={x.kind + x.v} href={`/database?${u}`}>{x.v} <span className="muted">({x.kind})</span></a>;
          })}
        </div>
      )}

      <div className="stats">
        <div className="stat"><b>{t.n.toLocaleString()}</b><span>lines</span></div>
        <div className="stat"><b>{usd(t.amount)}</b><span>revenue</span></div>
        {viewer.sees.money && <div className="stat"><b>{usd(t.commission)}</b><span>commission</span></div>}
      </div>

      <LinesTable company={!!f.co} rows={rows} money={viewer.sees.money} sorting={{ current: sort, href: sortHref }} />
      <div className="pager">
        {page > 1 && <Link href={link(page - 1)}>← Previous</Link>}
        <span>Page {page} of {pages}</span>
        {page < pages && <Link href={link(page + 1)}>Next →</Link>}
      </div>
    </>
  );
}
