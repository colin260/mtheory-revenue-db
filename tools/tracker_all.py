#!/usr/bin/env python3 -I
"""Compare EVERY revenue tab of the downloaded yearly trackers with data/revenue_lines.csv.

  python3 -I tools/tracker_all.py <download1.json> [<download2.json> ...]            # report only
  python3 -I tools/tracker_all.py <downloads...> --apply                             # add/update lines in data/revenue_lines.csv and drop lines the sheet no longer has

Lines whose statement year is before 2023 are never kept (2022 and earlier was removed); they are archived to data/archive/ on --apply.
Non-revenue tabs (Summary, Expectations, Retainers, Sheet25) are skipped. Columns are matched by header name.
"""
import sys, csv, io, re, json, collections, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import tracker_tab as T

MIN_YEAR = 2023
SKIP = {'Summary', 'Expectations', 'Retainers', 'Sheet25'}

def main():
    files = [a for a in sys.argv[1:] if not a.startswith('--')]; apply = '--apply' in sys.argv
    hold = {tuple(a[len('--hold='):].split('|', 1)) for a in sys.argv[1:] if a.startswith('--hold=')}   # --hold='2023|Jelly Roll': leave that tab exactly as loaded
    raw = open('data/revenue_lines.csv', newline='').read(); crlf = '\r\n' in raw[:5000]
    rd = list(csv.reader(io.StringIO(raw, newline=''))); H = rd[0]; I = {c: i for i, c in enumerate(H)}
    body = rd[1:]
    by = collections.defaultdict(dict)            # (year, manager) -> {row: data row}
    for r in body: by[(r[I['tracker_year']], r[I['manager']])][int(r[I['source_row']])] = r
    cur = {m: r[I['current_manager']] for r in body for m in [r[I['manager']]]}
    sheetfound = {}; report = []; add_rows = []; upd = {}; gone = []
    for path in files:
        d = json.load(open(path)); year = d['title'][:4]
        title, sheets, rows = T.load(path)
        for tab in sheets:
            if tab in SKIP: continue
            try: _, sheet = T.read_tab(path, tab)
            except SystemExit: continue
            if not sheet: continue
            sheet = {r: v for r, v in sheet.items() if not (v['statement_year'] and int(v['statement_year']) < MIN_YEAR)}
            mine = by.get((year, tab), {})
            added = sorted(set(sheet) - set(mine)); removed = sorted(r for r in set(mine) - set(sheet) if r < 9000); chg = {}
            for r in sorted(set(sheet) & set(mine)):
                diffs = []
                for f, s in sheet[r].items():
                    if f not in I: continue
                    c = mine[r][I[f]]
                    if f in T.NUMERIC:
                        cn = T.num(c); same = (cn is None and s is None) or (cn is not None and s is not None and abs(cn - s) < (1e-6 if f == 'rate' else 0.0051))
                    else: same = (c or '') == (s or '')
                    if not same: diffs.append((f, c, T.fmt(s) if f in T.NUMERIC else s))
                if diffs: chg[r] = diffs
            sheetfound[(year, tab)] = len(sheet)
            report.append((year, tab, len(sheet), len(mine), added, removed, chg))
            for r in added: add_rows.append((year, tab, r, sheet[r]))
            for r in chg: upd[(year, tab, r)] = sheet[r]
            for r in removed: gone.append((year, tab, r))
    # ---- report
    print(f"{'year':4} {'tab':28} {'sheet':>5} {'data':>5} {'added':>6} {'removed':>7} {'changed':>7}")
    for year, tab, ns, nd, a, rm, c in sorted(report):
        if a or rm or c: print(f'{year:4} {tab[:28]:28} {ns:5d} {nd:5d} {len(a):6d} {len(rm):7d} {len(c):7d}')
    tabs_in_data = {(r[I['tracker_year']], r[I['manager']]) for r in body}
    # Retainers and Unsupported payments come from the "MT MS <year> Income tracking" workbook, not the revenue trackers,
    # so a company whose lines are all of those types is expected to have no tracker tab.
    income_only = {k for k in tabs_in_data if all(r[I['commission_type']] in ('Retainer', 'Unsupported') for r in body if (r[I['tracker_year']], r[I['manager']]) == k)}
    missing = sorted(tabs_in_data - set(sheetfound) - income_only); new = sorted(set(sheetfound) - tabs_in_data)
    print(f'\nTOTAL: added {len(add_rows)} | removed {len(gone)} | changed {len(upd)} | tabs in data not found in sheets: {missing} | new tabs: {new}')
    print(f'income-tracking only (retainers/unsupported, expected, kept): {sorted(income_only - set(sheetfound))}')
    fields = collections.Counter(f for (_, _, _), s in upd.items() for f in [None])
    cf = collections.Counter(); ex = {}
    for year, tab, ns, nd, a, rm, c in report:
        for r, ds in c.items():
            for f, cv, sv in ds: cf[f] += 1; ex.setdefault(f, (year, tab, r, cv, sv))
    print('changed-field counts:', dict(cf))
    for f, e in ex.items(): print(f'   e.g. {f}: {e[0]} {e[1]} row {e[2]}: {e[3]!r} -> {e[4]!r}')
    old = [r for r in body if r[I['statement_year']] and int(r[I['statement_year']]) < MIN_YEAR]
    print(f'lines in data with statement year before {MIN_YEAR}: {len(old)}')
    held = [(y, t) for y, t in sorted(hold)]
    if hold:
        print('\nHELD (left exactly as loaded, nothing applied):', held)
        add_rows = [x for x in add_rows if (x[0], x[1]) not in hold]; upd = {k: v for k, v in upd.items() if (k[0], k[1]) not in hold}; gone = [g for g in gone if (g[0], g[1]) not in hold]
    json.dump({'added': [(y, t, r) for y, t, r, _ in add_rows], 'removed': gone}, open('/tmp/tracker_all_last.json', 'w'))
    if not apply: print('\n(report only: nothing changed. Re-run with --apply to update data/revenue_lines.csv)'); return
    # ---- apply
    nxt = max(int(r[I['line_id']]) for r in body) + 1
    drop = {(y, t, r) for y, t, r in gone}
    arch = [r for r in body if (r[I['tracker_year']], r[I['manager']], int(r[I['source_row']])) in drop or (r[I['statement_year']] and int(r[I['statement_year']]) < MIN_YEAR and (r[I['tracker_year']], r[I['manager']]) not in hold)]
    keep = [r for r in body if r not in arch]
    def build(year, tab, r, s, line_id, existing=None):
        mi = T.MONTHS.index(s['statement_month'].lower()) + 1 if s['statement_month'].lower() in T.MONTHS else ''
        gid = next((re.search(r'gid=(\d+)', m[I['sheet_url']]).group(1) for m in by.get((year, tab), {}).values() if 'gid=' in m[I['sheet_url']]), None)
        base = next((m[I['sheet_url']].split('#')[0] for m in by.get((year, tab), {}).values() if m[I['sheet_url']]), '')
        row = {'line_id': line_id, 'tracker_year': year, 'manager': tab, 'current_manager': cur.get(tab, 'True' if year == '2026' else 'False'), 'source_row': str(r),
               'statement_month_num': str(mi), 'sheet_url': f'{base}#gid={gid}&range=A{r}' if gid else ''}
        for f in T.HEADERS.values(): row[f] = T.fmt(s[f]) if f in T.NUMERIC else s[f]
        if existing:
            for c in H:
                if c not in row: row[c] = existing[I[c]]
            row['sheet_url'] = existing[I['sheet_url']] or row['sheet_url']
        return [row.get(c, '') for c in H]
    for i, r in enumerate(keep):
        k = (r[I['tracker_year']], r[I['manager']], int(r[I['source_row']]))
        if k in upd: keep[i] = build(k[0], k[1], k[2], upd[k], r[I['line_id']], r)
    for year, tab, r, s in add_rows: keep.append(build(year, tab, r, s, str(nxt))); nxt += 1
    os.makedirs('data/archive/refresh', exist_ok=True)
    with open('data/archive/refresh/removed_lines.csv', 'w', newline='') as f: w = csv.writer(f, lineterminator='\n'); w.writerow(H); w.writerows(arch)
    o = io.StringIO(); csv.writer(o, lineterminator='\r\n' if crlf else '\n').writerows([H] + keep); open('data/revenue_lines.csv', 'w', newline='').write(o.getvalue())
    write_recon(files, keep, H, I, hold)
    print(f'\nAPPLIED: {len(add_rows)} added, {len(upd)} updated, {len(arch)} removed (archived in data/archive/refresh/removed_lines.csv). data/revenue_lines.csv now has {len(keep)} lines.')

def write_recon(files, keep, H, I, hold):
    old = {(r['tracker_year'], r['manager']): r for r in csv.DictReader(open('data/reconciliation.csv', newline=''))}
    total = {}
    for path in files:
        year = json.load(open(path))['title'][:4]; _, sheets, rows = T.load(path)
        for tab in sheets:
            if tab in SKIP: continue
            R = rows(tab); hdr = {(v or '').strip(): k for k, v in R.get(1, {}).items()}
            if 'Total' in hdr and 2 in R: total[(year, tab)] = T.num(R[2].get(hdr['Total']))
    agg = collections.defaultdict(lambda: [0, 0.0])
    for r in keep:
        a = agg[(r[I['tracker_year']], r[I['manager']])]; a[0] += 1; a[1] += float(r[I['commission']] or 0)
    out = []
    for k in sorted(set(agg) | set(old)):
        n, c = agg.get(k, [0, 0.0]); c = round(c, 2); tot = total.get(k); o = old.get(k, {})
        if tot is None: status, note, diff = 'No Total cell', o.get('note', ''), ''
        else:
            diff = round(c - tot, 2)
            if abs(diff) < 0.015: status, note = 'Ties', ''
            elif k in hold: status, note = 'Held', 'Sheet changed; not applied pending confirmation'
            elif o.get('status') == 'Explained': status, note = 'Explained', o.get('note', '')
            else: status, note = 'Check', 'Does not tie to the tab Total cell after refresh'
        out.append([k[0], k[1], n, f'{c:.2f}', '' if tot is None else f'{tot:.2f}', '' if diff == '' else f'{diff:.2f}', status, note])
    with open('data/reconciliation.csv', 'w', newline='') as f:
        w = csv.writer(f, lineterminator='\n'); w.writerow(['tracker_year', 'manager', 'lines', 'export_commission', 'tab_total_cell', 'difference', 'status', 'note']); w.writerows(out)
    print('reconciliation.csv rewritten:', dict(collections.Counter(r[6] for r in out)), 'tabs', len(out))

if __name__ == '__main__': main()
