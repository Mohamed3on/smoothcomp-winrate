CREATE TABLE IF NOT EXISTS athletes (
  site TEXT NOT NULL,
  user TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  entry TEXT NOT NULL,
  PRIMARY KEY (site, user, kind)
);
CREATE TABLE IF NOT EXISTS records (
  site TEXT NOT NULL,
  event TEXT NOT NULL,
  user TEXT NOT NULL,
  wins INTEGER NOT NULL,
  losses INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (site, event, user)
);
CREATE INDEX IF NOT EXISTS records_user ON records (site, user);
-- Who an athlete is, as the latest event that showed them says.
CREATE TABLE IF NOT EXISTS people (
  site TEXT NOT NULL,
  user TEXT NOT NULL,
  name TEXT,
  club TEXT,
  club_id TEXT,
  country TEXT,
  country_name TEXT,
  photo TEXT,
  belt TEXT,
  affiliation TEXT, -- their academy's affiliation (Checkmat, Alliance…), as their latest event gave it
  born INTEGER,
  hidden INTEGER,
  seen TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (site, user)
);
CREATE INDEX IF NOT EXISTS people_club ON people (site, club_id);
CREATE TABLE IF NOT EXISTS events (
  site TEXT NOT NULL,
  event TEXT NOT NULL,
  title TEXT,
  start TEXT,
  city TEXT,
  country TEXT,
  organiser TEXT,
  at INTEGER NOT NULL,
  ends INTEGER, -- epoch ms
  -- Kept counts (stats.js EVENT_COUNTS); a database made before them took them by ALTER TABLE ... ADD COLUMN.
  athletes INTEGER, divisions INTEGER, teams INTEGER, fought INTEGER,
  -- Where it is and which sports it holds (Smoothcomp's sport ids, JSON), as the sites' event lists give them
  -- (crawl.js listEvents), and its page. Added by ALTER TABLE ... ADD COLUMN on older databases.
  lat REAL, lng REAL, sports TEXT, url TEXT,
  PRIMARY KEY (site, event)
);
-- One row per athlete per division. A results page's rows (fought = 1) replace
-- the registration list's (fought = 0), which only say who entered.
CREATE TABLE IF NOT EXISTS entries (
  site TEXT NOT NULL,
  event TEXT NOT NULL,
  user TEXT NOT NULL,
  division TEXT NOT NULL,
  club TEXT,
  club_id TEXT,
  place INTEGER,
  wins TEXT,
  losses TEXT,
  fought INTEGER NOT NULL,
  at INTEGER NOT NULL,
  bouts TEXT, -- each match in the division: won, finish, opponent and their user, round (JSON)
  PRIMARY KEY (site, event, user, division)
);
CREATE INDEX IF NOT EXISTS entries_user ON entries (site, user);
-- Every event an athlete entered, as Smoothcomp's past-events list gives it.
CREATE TABLE IF NOT EXISTS history (
  site TEXT NOT NULL,
  user TEXT NOT NULL,
  event TEXT NOT NULL,
  title TEXT,
  start TEXT,
  city TEXT,
  wins INTEGER,
  gold INTEGER,
  silver INTEGER,
  bronze INTEGER,
  at INTEGER NOT NULL,
  image TEXT, -- the event's cover, as the profile's event list gives it
  PRIMARY KEY (site, user, event)
);
CREATE INDEX IF NOT EXISTS entries_club ON entries (site, club_id);
-- Each settled event of an athlete as their profile's match lists give it: finishes won
-- and lost, each loss, and everyone met. Uploaded by profile pages, read by them.
CREATE TABLE IF NOT EXISTS outcomes (
  site TEXT NOT NULL,
  user TEXT NOT NULL,
  event TEXT NOT NULL,
  start TEXT,
  title TEXT,
  out TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (site, user, event)
);
-- When each belt an athlete wore began (epoch ms, null for the first), from their profile's belt list.
CREATE TABLE IF NOT EXISTS belts (
  site TEXT NOT NULL,
  user TEXT NOT NULL,
  worn TEXT NOT NULL,
  starts TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (site, user)
);
-- What else a profile shows (belts in each art, rankings, academy and affiliation, match videos), as JSON.
CREATE TABLE IF NOT EXISTS profiles (
  site TEXT NOT NULL,
  user TEXT NOT NULL,
  entry TEXT NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (site, user)
);
-- Events the server reads results for itself (crawl.js): queued, reading (the schedule and the
-- registrations named so far in `data`), done, gone (no schedule after three tries) or failed.
CREATE TABLE IF NOT EXISTS crawls (
  site TEXT NOT NULL,
  event TEXT NOT NULL,
  state TEXT NOT NULL,
  start TEXT,
  title TEXT,
  city TEXT,
  data TEXT,
  tries INTEGER NOT NULL DEFAULT 0,
  next INTEGER NOT NULL DEFAULT 0,
  at INTEGER NOT NULL,
  priority INTEGER NOT NULL DEFAULT 0, -- higher is read first (Berlin 2, the rest of Germany 1, set by hand)
  wrote INTEGER, -- when the crawler last wrote the event's results: reading it again replaces only its own copy
  PRIMARY KEY (site, event)
);
CREATE INDEX IF NOT EXISTS crawls_next ON crawls (state, start);
-- The events still to read, in the order the crawler takes them (crawl.js lane).
CREATE INDEX IF NOT EXISTS crawls_due ON crawls (priority DESC, start DESC) WHERE state IN ('queued', 'reading');
-- Each athlete's totals (stats.js TALLY), recounted whenever their results, match lists or event
-- list change: per finish [won, lost] as rated (`rec`) and as read (`seen`), medals, events.
CREATE TABLE IF NOT EXISTS tallies (
  site TEXT NOT NULL,
  user TEXT NOT NULL,
  rec TEXT,
  seen TEXT,
  gold INTEGER NOT NULL DEFAULT 0,
  silver INTEGER NOT NULL DEFAULT 0,
  bronze INTEGER NOT NULL DEFAULT 0,
  events INTEGER NOT NULL DEFAULT 0,
  listed INTEGER NOT NULL DEFAULT 0,
  last TEXT,
  PRIMARY KEY (site, user)
);
-- One row per athlete with everything a ranking shows (stats.js BOARD), rebuilt with their tally:
-- who they are, and wins per finish group (w_: career or results; rw_/rl_: the record's won and lost;
-- sl_: results losses), so a ranking sums the columns of the finishes counted.
CREATE TABLE IF NOT EXISTS board (
  site TEXT NOT NULL, user TEXT NOT NULL, source TEXT NOT NULL, at INTEGER, types TEXT,
  name TEXT, club TEXT, club_id TEXT, country TEXT, country_name TEXT, photo TEXT, born INTEGER, hidden INTEGER, belt TEXT,
  last TEXT, events INTEGER, gold INTEGER, silver INTEGER, bronze INTEGER,
  w_submission INTEGER, w_points INTEGER, w_walkover INTEGER, w_decision INTEGER, w_disqualification INTEGER, w_stoppage INTEGER, w_fastest_escape INTEGER, w_other INTEGER,
  rw_submission INTEGER, rw_points INTEGER, rw_walkover INTEGER, rw_decision INTEGER, rw_disqualification INTEGER, rw_stoppage INTEGER, rw_fastest_escape INTEGER, rw_other INTEGER,
  rl_submission INTEGER, rl_points INTEGER, rl_walkover INTEGER, rl_decision INTEGER, rl_disqualification INTEGER, rl_stoppage INTEGER, rl_fastest_escape INTEGER, rl_other INTEGER,
  sl_submission INTEGER, sl_points INTEGER, sl_walkover INTEGER, sl_decision INTEGER, sl_disqualification INTEGER, sl_stoppage INTEGER, sl_fastest_escape INTEGER, sl_other INTEGER,
  PRIMARY KEY (site, user)
);
CREATE INDEX IF NOT EXISTS board_club ON board (site, club_id);
-- The default ranking's wins and losses (every finish but walkovers, in rules.js FINISHES order, as stats.js careersOf
-- sums them: wins, then lost): the athletes ranking reads its page and its count off it. A query that must not walk it
-- (an academy's athletes) writes +wins; without that the academies list walked it once per academy and reset D1 (2026-11-24).
DROP INDEX IF EXISTS board_wins;
CREATE INDEX IF NOT EXISTS board_record ON board (site, (w_submission + w_stoppage + w_fastest_escape + w_points + w_decision + w_disqualification + w_other),
  (iif(rw_submission + rw_stoppage + rw_fastest_escape + rw_points + rw_decision + rw_disqualification + rw_other + rl_submission + rl_stoppage + rl_fastest_escape + rl_points + rl_decision + rl_disqualification + rl_other > 0,
    rl_submission + rl_stoppage + rl_fastest_escape + rl_points + rl_decision + rl_disqualification + rl_other,
    iif(source = 'results', sl_submission + sl_stoppage + sl_fastest_escape + sl_points + sl_decision + sl_disqualification + sl_other, NULL))));
-- Each academy's latest name and its podiums at the events read (stats.js CLUBS), kept as results arrive.
CREATE TABLE IF NOT EXISTS clubs (
  site TEXT NOT NULL, club_id TEXT NOT NULL, club TEXT, podium_gold INTEGER, podium_silver INTEGER, podium_bronze INTEGER, entered INTEGER,
  -- Where it competes most (stats.js CLUBS); added by ALTER TABLE ... ADD COLUMN on older databases.
  lat REAL, lng REAL, city TEXT, country TEXT,
  PRIMARY KEY (site, club_id)
);
CREATE INDEX IF NOT EXISTS people_club ON people (site, club_id);
CREATE INDEX IF NOT EXISTS events_start ON events (site, start);
-- The countries list (stats.js countries), counted from the index alone.
CREATE INDEX IF NOT EXISTS people_country ON people (site, country, country_name);
-- One person's accounts on either site (stats.js IDENT): their name as written, birth year and country.
CREATE INDEX IF NOT EXISTS people_ident ON people (lower(trim(replace(replace(replace(name, '  ', ' '), '  ', ' '), '  ', ' '))), born, country);
-- Where an academy's own page puts it (crawl.js placeClubs): source 'pin' (its map pin), 'town' (the town
-- it names, geocoded), 'google' (neither, but Google Maps found it: crawl.js findClubs), or null (it keeps where
-- it competes most, clubs.lat). checked = last read (ms); google = when Google Maps was asked (ms), added later.
CREATE TABLE IF NOT EXISTS club_places (
  site TEXT NOT NULL, club_id TEXT NOT NULL, lat REAL, lng REAL, city TEXT, country TEXT, address TEXT, source TEXT, checked INTEGER NOT NULL, google INTEGER,
  PRIMARY KEY (site, club_id)
);
-- Small values the worker keeps: 'changed' = when an install last uploaded (ms), so the edge cache knows its copies are old;
-- 'reset' = when every stored copy stopped counting (set by hand after a deploy changes a reply's shape).
CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v INTEGER);
-- Search (stats.js search): athletes' names and academies, and events' titles and cities, indexed by
-- trigram with accents folded (ö = o), kept in step by triggers. Fill once with
-- INSERT INTO people_fts(people_fts) VALUES ('rebuild'); and the same for events_fts.
CREATE VIRTUAL TABLE IF NOT EXISTS people_fts USING fts5(name, club, content = 'people', tokenize = 'trigram remove_diacritics 1');
CREATE TRIGGER IF NOT EXISTS people_fts_insert AFTER INSERT ON people BEGIN
  INSERT INTO people_fts (rowid, name, club) VALUES (new.rowid, new.name, new.club);
END;
CREATE TRIGGER IF NOT EXISTS people_fts_delete AFTER DELETE ON people BEGIN
  INSERT INTO people_fts (people_fts, rowid, name, club) VALUES ('delete', old.rowid, old.name, old.club);
END;
CREATE TRIGGER IF NOT EXISTS people_fts_update AFTER UPDATE OF name, club ON people WHEN old.name IS NOT new.name OR old.club IS NOT new.club BEGIN
  INSERT INTO people_fts (people_fts, rowid, name, club) VALUES ('delete', old.rowid, old.name, old.club);
  INSERT INTO people_fts (rowid, name, club) VALUES (new.rowid, new.name, new.club);
END;
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(title, city, content = 'events', tokenize = 'trigram remove_diacritics 1');
CREATE TRIGGER IF NOT EXISTS events_fts_insert AFTER INSERT ON events BEGIN
  INSERT INTO events_fts (rowid, title, city) VALUES (new.rowid, new.title, new.city);
END;
CREATE TRIGGER IF NOT EXISTS events_fts_delete AFTER DELETE ON events BEGIN
  INSERT INTO events_fts (events_fts, rowid, title, city) VALUES ('delete', old.rowid, old.title, old.city);
END;
CREATE TRIGGER IF NOT EXISTS events_fts_update AFTER UPDATE OF title, city ON events WHEN old.title IS NOT new.title OR old.city IS NOT new.city BEGIN
  INSERT INTO events_fts (events_fts, rowid, title, city) VALUES ('delete', old.rowid, old.title, old.city);
  INSERT INTO events_fts (rowid, title, city) VALUES (new.rowid, new.title, new.city);
END;
