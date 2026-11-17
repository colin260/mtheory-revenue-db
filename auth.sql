-- Access control. Idempotent, and deliberately NOT dropped by `node load.mjs --reset`,
-- so reloading revenue data never wipes who has access.
--
-- role: 'finance' = finance team and CEO: everything, can upload data and manage users
--       'senior'  = all revenue lines, but rate, commission and support are hidden
--       'staff'   = only the artists listed in user_artists, same hidden fields as senior
create table if not exists app_users (
  email       text primary key,                       -- stored lowercase
  name        text,
  role        text not null check (role in ('finance', 'senior', 'staff')),
  created_at  timestamptz not null default now()
);

-- Keyed by artist name (not artist_id) so reloading the data doesn't break assignments.
create table if not exists user_artists (
  email        text not null references app_users(email) on delete cascade on update cascade,
  artist_name  text not null,
  primary key (email, artist_name)
);

-- The people who manage each artist (a database-only field; the Google Sheets only have the company tab).
-- Several names per artist are allowed. Keyed by artist name so reloading data doesn't break it; edited on the Users page.
create table if not exists artist_managers (
  artist_name   text not null,
  manager_name  text not null,
  primary key (artist_name, manager_name)
);
alter table artist_managers enable row level security;
