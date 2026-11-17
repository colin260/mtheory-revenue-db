-- Mtheory revenue database — Postgres schema (works as-is on Supabase)
-- Source of truth for data entry stays the yearly Google Sheets trackers.
-- This database is rebuilt/refreshed from them; rows are keyed back to the
-- tracker file, tab and row they came from.

create table managers (
  manager_id      serial primary key,
  name            text not null unique,          -- tracker tab name, e.g. 'Grey Slate'
  is_current      boolean not null default false -- tab exists in the current-year tracker
);

create table artists (
  artist_id       serial primary key,
  name            text not null unique           -- e.g. 'Blackberry Smoke'
);

create table clients (                            -- payee / legal entity (tracker column A)
  client_id       serial primary key,
  name            text not null unique,          -- e.g. '3 Legged Machine, Inc.'
  artist_id       int references artists,
  manager_id      int references managers
);

create table revenue_lines (
  line_id              bigint primary key,
  tracker_year         int  not null,            -- which yearly tracker file
  manager_id           int  not null references managers,
  source_row           int  not null,            -- row number in that tab
  client_id            int  references clients,
  artist_id            int  references artists,
  commission_type      text,                     -- Touring, Royalties, Merch, Residuals, Retainer, ...
  source               text,                     -- payer, e.g. 'ORCHARD', 'Live Performance'
  statement_year       int,
  statement_month      text,                     -- as entered ('March', 'Q1', 'Jan & Feb')
  statement_month_num  int check (statement_month_num between 1 and 12),
  deposit_date         date,
  memo                 text,
  amount               numeric(16,4),
  rate                 numeric(9,6),             -- 0.25 = 25%
  commission           numeric(16,4),            -- as calculated on the tracker
  actual_commission    numeric(16,4),            -- only where tracked separately
  fx_rate              numeric(12,6),            -- Biz Wash
  commission_usd       numeric(16,4),            -- Supernormal
  support_file         text,                     -- file name or Drive link
  show_date            date,                     -- WhizzBang touring lines
  sheet_url            text,                     -- deep link to the tracker row
  loaded_at            timestamptz not null default now(),
  unique (tracker_year, manager_id, source_row)
);

-- Monthly settlements where the manager pays a fixed amount rather than the
-- line-level commission (currently Good Cop Bad Cop's "Total [Month]" rows).
create table manager_settlements (
  settlement_id        serial primary key,
  tracker_year         int not null,
  manager_id           int not null references managers,
  source_row           int not null,
  period_label         text not null,            -- 'August', 'March', ...
  expected_commission  numeric(16,4),
  actual_commission    numeric(16,4),
  unique (tracker_year, manager_id, source_row)
);

-- Search / reporting helpers
create index on revenue_lines (artist_id);
create index on revenue_lines (manager_id, tracker_year);
create index on revenue_lines (commission_type);
create index on revenue_lines (source);
create index on revenue_lines (deposit_date);
create extension if not exists pg_trgm;
create index on revenue_lines using gin (memo gin_trgm_ops);
create index on revenue_lines using gin (source gin_trgm_ops);

create view v_revenue as
select l.line_id, l.tracker_year, m.name as manager, m.is_current,
       a.name as artist, c.name as client_name, l.commission_type, l.source,
       l.statement_year, l.statement_month, l.statement_month_num, l.deposit_date,
       l.memo, l.amount, l.rate, l.commission, l.actual_commission,
       l.support_file, l.show_date, l.sheet_url
from revenue_lines l
join managers m using (manager_id)
left join artists a using (artist_id)
left join clients c using (client_id);
