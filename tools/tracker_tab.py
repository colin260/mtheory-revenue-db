#!/usr/bin/env python3 -I
"""Compare one manager tab of a Google Sheets tracker (downloaded as xlsx JSON by the Drive connector) with data/revenue_lines.csv.

  python3 -I tools/tracker_tab.py <download.json> "<Tab name>" <tracker_year> [--apply-data] [--out upload.csv]

Prints rows added / removed / changed (columns matched by header NAME). With --out, writes an upsert CSV (app format) of the added+changed rows that can be
uploaded on Add data > CSV. With --apply-data, adds/updates those rows in data/revenue_lines.csv (never deletes; removals are only reported).
"""
import sys, json, base64, zipfile, io, re, csv, datetime, collections
import xml.etree.ElementTree as ET

NS = {'m': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main', 'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'}
MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
HEADERS = {'Client Name': 'client_name', 'Artist': 'artist', 'Commission Type': 'commission_type', 'Source': 'source', 'Statement Year': 'statement_year',
           'Statement Month': 'statement_month', 'Deposit Date': 'deposit_date', 'Memo/Description': 'memo', 'Amount': 'amount', 'Rate': 'rate',
           'Commission': 'commission', 'Support': 'support_file', 'Show Date': 'show_date', 'FX Rate': 'fx_rate', 'Actual Commission': 'actual_commission',
           'Commission USD': 'commission_usd'}
NUMERIC = ('amount', 'rate', 'commission', 'actual_commission', 'fx_rate', 'commission_usd')
# One name per artist (decided with Colin): the sheet sometimes says "Twenty One Pilots"; the database keeps "21 Pilots" (TOP Financials = 21 Pilots).
# Commission types folded into 'All' (decided with Colin, 4 Nov 2026), whatever the sheet says.
TYPE_ALIASES = {'other': 'All', 'management service': 'All', 'sponsorship': 'All'}
ARTIST_ALIASES = {'twenty one pilots': '21 Pilots', 'twentyone pilots': '21 Pilots'}


def load(path):
    d = json.load(open(path)); z = zipfile.ZipFile(io.BytesIO(base64.b64decode(d['content'])))
    ss = [''.join(t.text or '' for t in si.iter('{%s}t' % NS['m'])) for si in ET.fromstring(z.read('xl/sharedStrings.xml')).findall('m:si', NS)]
    rels = {r.get('Id'): r.get('Target') for r in ET.fromstring(z.read('xl/_rels/workbook.xml.rels'))}
    sheets = {s.get('name'): 'xl/' + rels[s.get('{%s}id' % NS['r'])].lstrip('/').replace('xl/', '') for s in ET.fromstring(z.read('xl/workbook.xml')).find('m:sheets', NS)}
    def col(ref):
        n = 0
        for ch in re.match(r'[A-Z]+', ref).group(): n = n * 26 + ord(ch) - 64
        return n - 1
    def rows(name):
        out = {}
        for row in ET.fromstring(z.read(sheets[name])).iter('{%s}row' % NS['m']):
            vals = {}
            for c in row.findall('m:c', NS):
                v = c.find('m:v', NS)
                if v is None:
                    i = c.find('m:is', NS)
                    if i is not None: vals[col(c.get('r'))] = ''.join(t.text or '' for t in i.iter('{%s}t' % NS['m']))
                    continue
                vals[col(c.get('r'))] = ss[int(v.text)] if c.get('t') == 's' else v.text
            out[int(row.get('r'))] = vals
        return out
    return d['title'], sheets, rows


def num(v):
    try: return float(v)
    except Exception: pass
    try: return float(re.sub(r'[$,\s]', '', v))          # amounts typed as text, e.g. "20,000.00" (Kash Aug 2026 rows 47-54)
    except Exception: return None

def iso(v):
    v = (v or '').strip()
    m = re.match(r'^(\d{1,2})/(\d{1,2})/(\d{2}|\d{4})$', v)                       # text dates typed as 10/21/2026 or 10/21/26
    if m: return f"{m.group(3) if len(m.group(3)) == 4 else '20' + m.group(3)}-{int(m.group(1)):02d}-{int(m.group(2)):02d}"
    try: return (datetime.date(1899, 12, 30) + datetime.timedelta(days=int(float(v)))).isoformat()   # real Excel dates (serial numbers)
    except Exception: return ''     # text that isn't a date (e.g. a range like '12/30/2023 - 12/31/2023') is left blank, as in the original cleaned data

def fmt(x):
    return '' if x is None else (str(int(x)) if float(x).is_integer() else repr(round(x, 8)))


def read_tab(path, tab):
    title, sheets, rows = load(path)
    if tab not in sheets: sys.exit(f'No tab "{tab}" in {title}. Tabs: {list(sheets)}')
    R = rows(tab); hdr = {}
    for k, v in sorted(R[1].items()):                      # columns right of Total are pivot tables (they can repeat headers like 'Deposit Date'): ignore them, first match wins
        if v and v.strip() in HEADERS and HEADERS[v.strip()] not in hdr: hdr[HEADERS[v.strip()]] = k
        if v and v.strip() == 'Total': break
    out = {}
    for r, cells in R.items():
        if r == 1: continue
        g0 = lambda f: (cells.get(hdr[f], '') if f in hdr else '').strip()
        # a data row has a client name OR an amount OR a commission (payroll offsets, beginning balances and unlabeled rows have no client)
        if not (g0('client_name') or g0('amount') != '' or g0('commission') != ''): continue
        if re.match(r'(?i)^(grand )?total\b', g0('client_name')): continue
        if g0('amount') == '' and re.match(r'(?i)^total\b', g0('memo')): continue          # monthly settlement 'Total <Month>' rows live in manager_settlements, not revenue lines
        g = lambda f: (cells.get(hdr[f], '') if f in hdr else '').strip()
        d = {f: g(f) for f in HEADERS.values()}
        if tab == 'Stern' and not d['source']: d['source'] = 'All'      # Stern clients have no source in the sheet: 'All' (Colin, 4 Nov 2026)
        if d['commission_type'] == 'Retainer' and not d['source']: d['source'] = 'Retainer'      # a retainer with no source is listed as Retainer in both columns
        d['artist'] = ARTIST_ALIASES.get(d['artist'].lower(), d['artist'])
        d['commission_type'] = TYPE_ALIASES.get(d['commission_type'].lower(), d['commission_type'])
        # Source clean-up (Colin, 5 Nov 2026): no line shows '(none)' as its source; Merch is never typed Royalties.
        if 'merch' in d['source'].lower() and d['commission_type'] in ('Royalties', 'Residuals'): d['commission_type'] = 'Merch'
        if not d['source']:
            memo = d['memo'].lower()
            if 'payroll offset' in memo: d['source'] = 'Offset'
            elif memo.startswith('kkr deal payout'): d['source'] = 'KKR'
            elif memo.startswith('more than we ever imagined expenses'): d['commission_type'], d['source'] = 'Touring', 'Live Performance'
            elif memo.startswith('beginning balance'): d['source'] = 'Beginning Balance'
            elif memo.startswith('adjust') or memo.startswith('vans warped dc - add exp'): d['source'] = 'Adjustment'
            else: d['source'] = 'All'
        d['deposit_date'] = iso(g('deposit_date')); d['show_date'] = iso(g('show_date')) if g('show_date') else ''
        y = num(g('statement_year')); d['statement_year'] = str(int(y)) if y is not None else ''
        for f in NUMERIC: d[f] = num(g(f))
        out[r] = d
    return title, out


def main():
    a = [x for x in sys.argv[1:] if not x.startswith('--')]
    if len(a) < 3: sys.exit(__doc__)
    path, tab, year = a[0], a[1], a[2]
    out_csv = sys.argv[sys.argv.index('--out') + 1] if '--out' in sys.argv else None
    title, sheet = read_tab(path, tab)
    raw = open('data/revenue_lines.csv', newline='').read(); crlf = '\r\n' in raw[:5000]
    rd = list(csv.reader(io.StringIO(raw, newline=''))); H = rd[0]; I = {c: i for i, c in enumerate(H)}
    mine = {int(r[I['source_row']]): r for r in rd[1:] if r[I['manager']] == tab and r[I['tracker_year']] == year}
    added = sorted(set(sheet) - set(mine)); removed = sorted(set(mine) - set(sheet)); changed = {}
    for r in sorted(set(sheet) & set(mine)):
        diffs = []
        for f, s in sheet[r].items():
            if f not in I: continue
            cur = mine[r][I[f]]
            if f in NUMERIC:
                c = num(cur)
                same = (c is None and s is None) or (c is not None and s is not None and abs(c - s) < (1e-6 if f == 'rate' else 0.0051))
            else: same = (cur or '') == (s or '')
            if not same: diffs.append((f, cur, fmt(s) if f in NUMERIC else s))
        if diffs: changed[r] = diffs
    print(f'{title} / tab "{tab}" / tracker {year}: sheet rows {len(sheet)} | in data {len(mine)}')
    print(f'  added in sheet: {len(added)} {added[:15]} | removed from sheet: {len(removed)} {removed[:15]} | changed: {len(changed)}')
    cnt = collections.Counter(f for d in changed.values() for f, _, _ in d); print('  changed fields:', dict(cnt))
    for r, d in list(changed.items())[:12]: print(f'   row {r}:', [(f, c, s) for f, c, s in d])
    for r in added[:12]: print(f'   NEW row {r}:', {k: (fmt(v) if k in NUMERIC else v) for k, v in sheet[r].items() if v not in ('', None)})
    todo = sorted(set(added) | set(changed))
    if not todo: print('  Nothing to update.'); return
    gid = next((re.search(r'gid=(\d+)', m[I['sheet_url']]).group(1) for m in mine.values() if 'gid=' in m[I['sheet_url']]), None)
    base = next((m[I['sheet_url']].split('#')[0] for m in mine.values() if m[I['sheet_url']]), '')
    manager_cur = next((m[I['current_manager']] for m in mine.values()), '')
    def build(r, line_id=''):
        s = sheet[r]; mi = MONTHS.index(s['statement_month'].lower()) + 1 if s['statement_month'].lower() in MONTHS else ''
        row = {'line_id': line_id, 'tracker_year': year, 'manager': tab, 'current_manager': manager_cur, 'source_row': str(r), 'statement_month_num': str(mi),
               'sheet_url': f'{base}#gid={gid}&range=A{r}' if gid else ''}
        for f in HEADERS.values():
            row[f] = fmt(s[f]) if f in NUMERIC else s[f]
        # keep existing values for columns the tab does not carry
        if r in mine:
            for c in H:
                if c not in row or row[c] == '' and c not in HEADERS.values() and c not in ('line_id',): row.setdefault(c, mine[r][I[c]])
            row['line_id'] = mine[r][I['line_id']]
        return [row.get(c, '') for c in H]
    if out_csv:
        with open(out_csv, 'w', newline='') as f:
            w = csv.writer(f, lineterminator='\n'); w.writerow(H); [w.writerow(build(r)) for r in todo]
        print(f'  wrote {len(todo)} rows to {out_csv}')
    if '--apply-data' in sys.argv:
        nxt = max(int(r[I['line_id']]) for r in rd[1:]) + 1; pos = {int(r[I['source_row']]): i for i, r in enumerate(rd) if i and r[I['manager']] == tab and r[I['tracker_year']] == year}
        for r in todo:
            if r in pos: rd[pos[r]] = build(r)
            else: rd.append(build(r, str(nxt))); nxt += 1
        o = io.StringIO(); csv.writer(o, lineterminator='\r\n' if crlf else '\n').writerows(rd); open('data/revenue_lines.csv', 'w', newline='').write(o.getvalue())
        print(f'  data/revenue_lines.csv updated: {len(added)} added, {len(changed)} changed')

if __name__ == '__main__':
    main()
