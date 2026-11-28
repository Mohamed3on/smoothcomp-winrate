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
  -- How many athletes its pages count, and when that was read (crawl.js sizeEvents), for an upcoming event.
  -- Added by ALTER TABLE ... ADD COLUMN on older databases.
  registered INTEGER, sized INTEGER,
  PRIMARY KEY (site, event)
);
-- One row per athlete per division. A results page's rows (fought = 1) replace
-- the registration list's (fought = 0), which only say who entered.
-- The tables written per athlete (entries, tallies, board, board_own, club_board) are WITHOUT ROWID: D1 bills a new row in a
-- rowid table keyed on several columns twice (the row and its key's index), one WITHOUT ROWID once (measured 2026-11-27).
-- D1 was rebuilt to match by hand (copy, check, swap); people and events keep rowids, which their search indexes use.
-- board needs ANALYZE statistics (sqlite_stat1) since: without them SQLite walked every athlete of a site through the
-- primary key instead of board_club (the academies list took 12 s and D1 answered "overloaded"). Run ANALYZE board
-- again after rebuilding it or its indexes.
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
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS entries_user ON entries (site, user);
-- When each layer of an event's entries (fought: 0 registrations, 1 results) was last read: an older read
-- arriving after a newer one changes nothing, and the event page says how fresh each layer is.
CREATE TABLE IF NOT EXISTS reads (
  site TEXT NOT NULL,
  event TEXT NOT NULL,
  fought INTEGER NOT NULL,
  at INTEGER NOT NULL,
  PRIMARY KEY (site, event, fought)
);
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
  priority INTEGER NOT NULL DEFAULT 0, -- higher is read first (viewed 3, then crawl.js RANK: nearest Berlin, known athletes, Smoothcomp; 0 to -23)
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
  -- The events their profile lists that they didn't show at (stats.js missed), left out of listed and last.
  absent INTEGER NOT NULL DEFAULT 0,
  -- When a recount last changed them (ms): their ranking row is rebuilt by then, or that night (worker.js rank, rebuild).
  -- Added by ALTER TABLE ... ADD COLUMN on D1.
  changed INTEGER,
  PRIMARY KEY (site, user)
) WITHOUT ROWID;
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
  -- 1 for a person's other account on the same site (stats.js MERGE): the rankings leave it out. Taken by ALTER TABLE on D1.
  dup INTEGER NOT NULL DEFAULT 0,
  -- The bracket they rank in (rules.js bracketOf: m/f, age group, weight class), from their divisions (worker.js retally). Taken by ALTER TABLE on D1.
  sex TEXT, age TEXT, weight INTEGER,
  PRIMARY KEY (site, user)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS board_club ON board (site, club_id);
-- A board row of each account that shares its person with another (stats.js MERGE), as that account alone gives it:
-- the board holds every such account's person, summed from these.
CREATE TABLE IF NOT EXISTS board_own (
  site TEXT NOT NULL, user TEXT NOT NULL, source TEXT NOT NULL, at INTEGER, types TEXT,
  name TEXT, club TEXT, club_id TEXT, country TEXT, country_name TEXT, photo TEXT, born INTEGER, hidden INTEGER, belt TEXT,
  last TEXT, events INTEGER, gold INTEGER, silver INTEGER, bronze INTEGER,
  w_submission INTEGER, w_points INTEGER, w_walkover INTEGER, w_decision INTEGER, w_disqualification INTEGER, w_stoppage INTEGER, w_fastest_escape INTEGER, w_other INTEGER,
  rw_submission INTEGER, rw_points INTEGER, rw_walkover INTEGER, rw_decision INTEGER, rw_disqualification INTEGER, rw_stoppage INTEGER, rw_fastest_escape INTEGER, rw_other INTEGER,
  rl_submission INTEGER, rl_points INTEGER, rl_walkover INTEGER, rl_decision INTEGER, rl_disqualification INTEGER, rl_stoppage INTEGER, rl_fastest_escape INTEGER, rl_other INTEGER,
  sl_submission INTEGER, sl_points INTEGER, sl_walkover INTEGER, sl_decision INTEGER, sl_disqualification INTEGER, sl_stoppage INTEGER, sl_fastest_escape INTEGER, sl_other INTEGER,
  sex TEXT, age TEXT, weight INTEGER,
  PRIMARY KEY (site, user)
) WITHOUT ROWID;
-- The default ranking's wins and losses (every finish but walkovers, in rules.js FINISHES order, as stats.js careersOf
-- sums them: wins, then lost), a person's other accounts on a site apart (dup): the athletes ranking reads its page and its count off it. A query that must not walk it
-- (an academy's athletes) writes +wins; without that the academies list walked it once per academy and reset D1 (2026-11-24).
DROP INDEX IF EXISTS board_wins;
DROP INDEX IF EXISTS board_record;
CREATE INDEX IF NOT EXISTS board_ranked ON board (site, dup, (w_submission + w_stoppage + w_fastest_escape + w_points + w_decision + w_disqualification + w_other),
  (iif(rw_submission + rw_stoppage + rw_fastest_escape + rw_points + rw_decision + rw_disqualification + rw_other + rl_submission + rl_stoppage + rl_fastest_escape + rl_points + rl_decision + rl_disqualification + rl_other > 0,
    rl_submission + rl_stoppage + rl_fastest_escape + rl_points + rl_decision + rl_disqualification + rl_other,
    iif(source = 'results', sl_submission + sl_stoppage + sl_fastest_escape + sl_points + sl_decision + sl_disqualification + sl_other, NULL))));
-- The athletes count under any finishes (stats.js MASKS: which finish groups each athlete has a win or loss in, a bit each),
-- with the filters it can take, read from this index alone. The masks lead, so no ranking (site, dup, ...) prefers it;
-- the count names it (INDEXED BY). The expressions are stats.js MASKS word for word (tests/server.test.cjs checks).
-- board_counted is board_count with the bracket filters too (an index changes only by a new one).
DROP INDEX IF EXISTS board_count;
CREATE INDEX IF NOT EXISTS board_counted ON board (site,
  ((w_submission + rl_submission > 0) * 1 + (w_stoppage + rl_stoppage > 0) * 2 + (w_fastest_escape + rl_fastest_escape > 0) * 4 + (w_points + rl_points > 0) * 8 + (w_decision + rl_decision > 0) * 16 + (w_disqualification + rl_disqualification > 0) * 32 + (w_walkover + rl_walkover > 0) * 64 + (w_other + rl_other > 0) * 128),
  ((rw_submission + rl_submission > 0) * 1 + (rw_stoppage + rl_stoppage > 0) * 2 + (rw_fastest_escape + rl_fastest_escape > 0) * 4 + (rw_points + rl_points > 0) * 8 + (rw_decision + rl_decision > 0) * 16 + (rw_disqualification + rl_disqualification > 0) * 32 + (rw_walkover + rl_walkover > 0) * 64 + (rw_other + rl_other > 0) * 128),
  (iif(source = 'results', (sl_submission > 0) * 1 + (sl_stoppage > 0) * 2 + (sl_fastest_escape > 0) * 4 + (sl_points > 0) * 8 + (sl_decision > 0) * 16 + (sl_disqualification > 0) * 32 + (sl_walkover > 0) * 64 + (sl_other > 0) * 128, 0)),
  dup, born, belt, country, events, last, sex, age, weight);
-- One bracket's athletes (an athlete page's rank in theirs; a ranking narrowed to a weight class): weight leads, the filter set most alone.
CREATE INDEX IF NOT EXISTS board_bracket ON board (site, weight, age, sex, belt);
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
-- Each academy's athletes added up under the default filters (walkovers left out, no other filter), as stats.js teams
-- adds them up: the academies list reads these instead of walking every athlete (860k rows read). board_counts is
-- each athlete's share (careersOf's wins and lost for the default); the triggers take a board row's share out before
-- it changes or goes and put the new one in after, only when a column it counts changes. Fill once with
-- INSERT INTO club_board SELECT site, club_id, count(*), sum(wins), sum(submission), sum(points), sum(gold), sum(silver), sum(bronze), sum(won), sum(lost) FROM board_counts GROUP BY site, club_id;
-- won and lost (the win rate's record, 0 for an athlete without one) were added later by ALTER TABLE ... ADD COLUMN on both tables.
CREATE TABLE IF NOT EXISTS club_board (
  site TEXT NOT NULL, club_id TEXT NOT NULL, athletes INTEGER NOT NULL, wins INTEGER NOT NULL, submission INTEGER NOT NULL, points INTEGER NOT NULL,
  gold INTEGER NOT NULL, silver INTEGER NOT NULL, bronze INTEGER NOT NULL, won INTEGER NOT NULL DEFAULT 0, lost INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site, club_id)
) WITHOUT ROWID;
-- club_board over the athletes who competed in the last two years (stats.js keepRecent, hourly from the crawler).
CREATE TABLE IF NOT EXISTS club_recent (
  site TEXT NOT NULL, club_id TEXT NOT NULL, athletes INTEGER NOT NULL, wins INTEGER NOT NULL, submission INTEGER NOT NULL, points INTEGER NOT NULL,
  gold INTEGER NOT NULL, silver INTEGER NOT NULL, bronze INTEGER NOT NULL, won INTEGER NOT NULL DEFAULT 0, lost INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site, club_id)
);
CREATE VIEW IF NOT EXISTS board_counts AS SELECT site, user, club_id, wins, submission, points, gold, silver, bronze, coalesce(won, 0) AS won, coalesce(lost, 0) AS lost FROM (SELECT site, user, club_id,
    w_submission + w_stoppage + w_fastest_escape + w_points + w_decision + w_disqualification + w_other AS wins,
    iif(rw_submission + rw_stoppage + rw_fastest_escape + rw_points + rw_decision + rw_disqualification + rw_other + rl_submission + rl_stoppage + rl_fastest_escape + rl_points + rl_decision + rl_disqualification + rl_other > 0,
      rl_submission + rl_stoppage + rl_fastest_escape + rl_points + rl_decision + rl_disqualification + rl_other,
      iif(source = 'results', sl_submission + sl_stoppage + sl_fastest_escape + sl_points + sl_decision + sl_disqualification + sl_other, NULL)) AS lost,
    iif(rw_submission + rw_stoppage + rw_fastest_escape + rw_points + rw_decision + rw_disqualification + rw_other + rl_submission + rl_stoppage + rl_fastest_escape + rl_points + rl_decision + rl_disqualification + rl_other > 0,
      rw_submission + rw_stoppage + rw_fastest_escape + rw_points + rw_decision + rw_disqualification + rw_other,
      iif(source = 'results', w_submission + w_stoppage + w_fastest_escape + w_points + w_decision + w_disqualification + w_other, NULL)) AS won,
    w_submission AS submission, w_points AS points, coalesce(gold, 0) AS gold, coalesce(silver, 0) AS silver, coalesce(bronze, 0) AS bronze
  FROM board WHERE club_id IS NOT NULL AND dup = 0) WHERE wins > 0 OR lost > 0;
CREATE TRIGGER IF NOT EXISTS club_board_insert AFTER INSERT ON board BEGIN
  INSERT INTO club_board SELECT site, club_id, 1, wins, submission, points, gold, silver, bronze, won, lost FROM board_counts WHERE site = new.site AND user = new.user
    ON CONFLICT (site, club_id) DO UPDATE SET athletes = athletes + 1, wins = wins + excluded.wins, submission = submission + excluded.submission, points = points + excluded.points,
      gold = gold + excluded.gold, silver = silver + excluded.silver, bronze = bronze + excluded.bronze, won = won + excluded.won, lost = lost + excluded.lost;
END;
CREATE TRIGGER IF NOT EXISTS club_board_delete BEFORE DELETE ON board BEGIN
  UPDATE club_board SET athletes = athletes - 1, wins = club_board.wins - c.wins, submission = club_board.submission - c.submission, points = club_board.points - c.points,
    gold = club_board.gold - c.gold, silver = club_board.silver - c.silver, bronze = club_board.bronze - c.bronze, won = club_board.won - c.won, lost = club_board.lost - c.lost
  FROM board_counts c WHERE c.site = old.site AND c.user = old.user AND club_board.site = c.site AND club_board.club_id = c.club_id;
END;
-- An athlete moving to another academy: their old share out of the one they leave, the new one into the one they join.
CREATE TRIGGER IF NOT EXISTS club_board_update_out BEFORE UPDATE ON board
WHEN old.club_id IS NOT new.club_id BEGIN
  UPDATE club_board SET athletes = athletes - 1, wins = club_board.wins - c.wins, submission = club_board.submission - c.submission, points = club_board.points - c.points,
    gold = club_board.gold - c.gold, silver = club_board.silver - c.silver, bronze = club_board.bronze - c.bronze, won = club_board.won - c.won, lost = club_board.lost - c.lost
  FROM board_counts c WHERE c.site = old.site AND c.user = old.user AND club_board.site = c.site AND club_board.club_id = c.club_id;
END;
CREATE TRIGGER IF NOT EXISTS club_board_update_in AFTER UPDATE ON board
WHEN old.club_id IS NOT new.club_id BEGIN
  INSERT INTO club_board SELECT site, club_id, 1, wins, submission, points, gold, silver, bronze, won, lost FROM board_counts WHERE site = new.site AND user = new.user
    ON CONFLICT (site, club_id) DO UPDATE SET athletes = athletes + 1, wins = wins + excluded.wins, submission = submission + excluded.submission, points = points + excluded.points,
      gold = gold + excluded.gold, silver = silver + excluded.silver, bronze = bronze + excluded.bronze, won = won + excluded.won, lost = lost + excluded.lost;
END;
-- An athlete who stays at their academy changes its totals by the difference, in one write (D1 bills each row written: the
-- pair above, which takes their old share out and puts the new one in, wrote two). The share is board_counts' over old and new.
CREATE TRIGGER IF NOT EXISTS club_board_update_same AFTER UPDATE ON board
WHEN old.club_id IS new.club_id AND new.club_id IS NOT NULL AND (old.club_id, old.dup, old.source, old.gold, old.silver, old.bronze, old.w_submission, old.w_stoppage, old.w_fastest_escape, old.w_points, old.w_decision, old.w_disqualification, old.w_other, old.rw_submission, old.rw_stoppage, old.rw_fastest_escape, old.rw_points, old.rw_decision, old.rw_disqualification, old.rw_other, old.rl_submission, old.rl_stoppage, old.rl_fastest_escape, old.rl_points, old.rl_decision, old.rl_disqualification, old.rl_other, old.sl_submission, old.sl_stoppage, old.sl_fastest_escape, old.sl_points, old.sl_decision, old.sl_disqualification, old.sl_other) IS NOT
  (new.club_id, new.dup, new.source, new.gold, new.silver, new.bronze, new.w_submission, new.w_stoppage, new.w_fastest_escape, new.w_points, new.w_decision, new.w_disqualification, new.w_other, new.rw_submission, new.rw_stoppage, new.rw_fastest_escape, new.rw_points, new.rw_decision, new.rw_disqualification, new.rw_other, new.rl_submission, new.rl_stoppage, new.rl_fastest_escape, new.rl_points, new.rl_decision, new.rl_disqualification, new.rl_other, new.sl_submission, new.sl_stoppage, new.sl_fastest_escape, new.sl_points, new.sl_decision, new.sl_disqualification, new.sl_other) BEGIN
  INSERT INTO club_board (site, club_id, athletes, wins, submission, points, gold, silver, bronze, won, lost)
  SELECT new.site, new.club_id, n.athletes - o.athletes, n.wins - o.wins, n.submission - o.submission, n.points - o.points, n.gold - o.gold, n.silver - o.silver, n.bronze - o.bronze, n.won - o.won, n.lost - o.lost
  FROM (SELECT iif((new.club_id IS NOT NULL AND new.dup = 0 AND ((new.w_submission + new.w_stoppage + new.w_fastest_escape + new.w_points + new.w_decision + new.w_disqualification + new.w_other) > 0 OR iif((new.rw_submission + new.rw_stoppage + new.rw_fastest_escape + new.rw_points + new.rw_decision + new.rw_disqualification + new.rw_other + new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other) > 0, new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other, iif(new.source = 'results', new.sl_submission + new.sl_stoppage + new.sl_fastest_escape + new.sl_points + new.sl_decision + new.sl_disqualification + new.sl_other, NULL)) > 0)), 1, 0) AS athletes,
      iif((new.club_id IS NOT NULL AND new.dup = 0 AND ((new.w_submission + new.w_stoppage + new.w_fastest_escape + new.w_points + new.w_decision + new.w_disqualification + new.w_other) > 0 OR iif((new.rw_submission + new.rw_stoppage + new.rw_fastest_escape + new.rw_points + new.rw_decision + new.rw_disqualification + new.rw_other + new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other) > 0, new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other, iif(new.source = 'results', new.sl_submission + new.sl_stoppage + new.sl_fastest_escape + new.sl_points + new.sl_decision + new.sl_disqualification + new.sl_other, NULL)) > 0)), (new.w_submission + new.w_stoppage + new.w_fastest_escape + new.w_points + new.w_decision + new.w_disqualification + new.w_other), 0) AS wins,
      iif((new.club_id IS NOT NULL AND new.dup = 0 AND ((new.w_submission + new.w_stoppage + new.w_fastest_escape + new.w_points + new.w_decision + new.w_disqualification + new.w_other) > 0 OR iif((new.rw_submission + new.rw_stoppage + new.rw_fastest_escape + new.rw_points + new.rw_decision + new.rw_disqualification + new.rw_other + new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other) > 0, new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other, iif(new.source = 'results', new.sl_submission + new.sl_stoppage + new.sl_fastest_escape + new.sl_points + new.sl_decision + new.sl_disqualification + new.sl_other, NULL)) > 0)), new.w_submission, 0) AS submission,
      iif((new.club_id IS NOT NULL AND new.dup = 0 AND ((new.w_submission + new.w_stoppage + new.w_fastest_escape + new.w_points + new.w_decision + new.w_disqualification + new.w_other) > 0 OR iif((new.rw_submission + new.rw_stoppage + new.rw_fastest_escape + new.rw_points + new.rw_decision + new.rw_disqualification + new.rw_other + new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other) > 0, new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other, iif(new.source = 'results', new.sl_submission + new.sl_stoppage + new.sl_fastest_escape + new.sl_points + new.sl_decision + new.sl_disqualification + new.sl_other, NULL)) > 0)), new.w_points, 0) AS points,
      iif((new.club_id IS NOT NULL AND new.dup = 0 AND ((new.w_submission + new.w_stoppage + new.w_fastest_escape + new.w_points + new.w_decision + new.w_disqualification + new.w_other) > 0 OR iif((new.rw_submission + new.rw_stoppage + new.rw_fastest_escape + new.rw_points + new.rw_decision + new.rw_disqualification + new.rw_other + new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other) > 0, new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other, iif(new.source = 'results', new.sl_submission + new.sl_stoppage + new.sl_fastest_escape + new.sl_points + new.sl_decision + new.sl_disqualification + new.sl_other, NULL)) > 0)), coalesce(new.gold, 0), 0) AS gold,
      iif((new.club_id IS NOT NULL AND new.dup = 0 AND ((new.w_submission + new.w_stoppage + new.w_fastest_escape + new.w_points + new.w_decision + new.w_disqualification + new.w_other) > 0 OR iif((new.rw_submission + new.rw_stoppage + new.rw_fastest_escape + new.rw_points + new.rw_decision + new.rw_disqualification + new.rw_other + new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other) > 0, new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other, iif(new.source = 'results', new.sl_submission + new.sl_stoppage + new.sl_fastest_escape + new.sl_points + new.sl_decision + new.sl_disqualification + new.sl_other, NULL)) > 0)), coalesce(new.silver, 0), 0) AS silver,
      iif((new.club_id IS NOT NULL AND new.dup = 0 AND ((new.w_submission + new.w_stoppage + new.w_fastest_escape + new.w_points + new.w_decision + new.w_disqualification + new.w_other) > 0 OR iif((new.rw_submission + new.rw_stoppage + new.rw_fastest_escape + new.rw_points + new.rw_decision + new.rw_disqualification + new.rw_other + new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other) > 0, new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other, iif(new.source = 'results', new.sl_submission + new.sl_stoppage + new.sl_fastest_escape + new.sl_points + new.sl_decision + new.sl_disqualification + new.sl_other, NULL)) > 0)), coalesce(new.bronze, 0), 0) AS bronze,
      iif((new.club_id IS NOT NULL AND new.dup = 0 AND ((new.w_submission + new.w_stoppage + new.w_fastest_escape + new.w_points + new.w_decision + new.w_disqualification + new.w_other) > 0 OR iif((new.rw_submission + new.rw_stoppage + new.rw_fastest_escape + new.rw_points + new.rw_decision + new.rw_disqualification + new.rw_other + new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other) > 0, new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other, iif(new.source = 'results', new.sl_submission + new.sl_stoppage + new.sl_fastest_escape + new.sl_points + new.sl_decision + new.sl_disqualification + new.sl_other, NULL)) > 0)), coalesce(iif((new.rw_submission + new.rw_stoppage + new.rw_fastest_escape + new.rw_points + new.rw_decision + new.rw_disqualification + new.rw_other + new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other) > 0, new.rw_submission + new.rw_stoppage + new.rw_fastest_escape + new.rw_points + new.rw_decision + new.rw_disqualification + new.rw_other, iif(new.source = 'results', new.w_submission + new.w_stoppage + new.w_fastest_escape + new.w_points + new.w_decision + new.w_disqualification + new.w_other, NULL)), 0), 0) AS won,
      iif((new.club_id IS NOT NULL AND new.dup = 0 AND ((new.w_submission + new.w_stoppage + new.w_fastest_escape + new.w_points + new.w_decision + new.w_disqualification + new.w_other) > 0 OR iif((new.rw_submission + new.rw_stoppage + new.rw_fastest_escape + new.rw_points + new.rw_decision + new.rw_disqualification + new.rw_other + new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other) > 0, new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other, iif(new.source = 'results', new.sl_submission + new.sl_stoppage + new.sl_fastest_escape + new.sl_points + new.sl_decision + new.sl_disqualification + new.sl_other, NULL)) > 0)), coalesce(iif((new.rw_submission + new.rw_stoppage + new.rw_fastest_escape + new.rw_points + new.rw_decision + new.rw_disqualification + new.rw_other + new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other) > 0, new.rl_submission + new.rl_stoppage + new.rl_fastest_escape + new.rl_points + new.rl_decision + new.rl_disqualification + new.rl_other, iif(new.source = 'results', new.sl_submission + new.sl_stoppage + new.sl_fastest_escape + new.sl_points + new.sl_decision + new.sl_disqualification + new.sl_other, NULL)), 0), 0) AS lost) n, (SELECT iif((old.club_id IS NOT NULL AND old.dup = 0 AND ((old.w_submission + old.w_stoppage + old.w_fastest_escape + old.w_points + old.w_decision + old.w_disqualification + old.w_other) > 0 OR iif((old.rw_submission + old.rw_stoppage + old.rw_fastest_escape + old.rw_points + old.rw_decision + old.rw_disqualification + old.rw_other + old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other) > 0, old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other, iif(old.source = 'results', old.sl_submission + old.sl_stoppage + old.sl_fastest_escape + old.sl_points + old.sl_decision + old.sl_disqualification + old.sl_other, NULL)) > 0)), 1, 0) AS athletes,
      iif((old.club_id IS NOT NULL AND old.dup = 0 AND ((old.w_submission + old.w_stoppage + old.w_fastest_escape + old.w_points + old.w_decision + old.w_disqualification + old.w_other) > 0 OR iif((old.rw_submission + old.rw_stoppage + old.rw_fastest_escape + old.rw_points + old.rw_decision + old.rw_disqualification + old.rw_other + old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other) > 0, old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other, iif(old.source = 'results', old.sl_submission + old.sl_stoppage + old.sl_fastest_escape + old.sl_points + old.sl_decision + old.sl_disqualification + old.sl_other, NULL)) > 0)), (old.w_submission + old.w_stoppage + old.w_fastest_escape + old.w_points + old.w_decision + old.w_disqualification + old.w_other), 0) AS wins,
      iif((old.club_id IS NOT NULL AND old.dup = 0 AND ((old.w_submission + old.w_stoppage + old.w_fastest_escape + old.w_points + old.w_decision + old.w_disqualification + old.w_other) > 0 OR iif((old.rw_submission + old.rw_stoppage + old.rw_fastest_escape + old.rw_points + old.rw_decision + old.rw_disqualification + old.rw_other + old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other) > 0, old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other, iif(old.source = 'results', old.sl_submission + old.sl_stoppage + old.sl_fastest_escape + old.sl_points + old.sl_decision + old.sl_disqualification + old.sl_other, NULL)) > 0)), old.w_submission, 0) AS submission,
      iif((old.club_id IS NOT NULL AND old.dup = 0 AND ((old.w_submission + old.w_stoppage + old.w_fastest_escape + old.w_points + old.w_decision + old.w_disqualification + old.w_other) > 0 OR iif((old.rw_submission + old.rw_stoppage + old.rw_fastest_escape + old.rw_points + old.rw_decision + old.rw_disqualification + old.rw_other + old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other) > 0, old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other, iif(old.source = 'results', old.sl_submission + old.sl_stoppage + old.sl_fastest_escape + old.sl_points + old.sl_decision + old.sl_disqualification + old.sl_other, NULL)) > 0)), old.w_points, 0) AS points,
      iif((old.club_id IS NOT NULL AND old.dup = 0 AND ((old.w_submission + old.w_stoppage + old.w_fastest_escape + old.w_points + old.w_decision + old.w_disqualification + old.w_other) > 0 OR iif((old.rw_submission + old.rw_stoppage + old.rw_fastest_escape + old.rw_points + old.rw_decision + old.rw_disqualification + old.rw_other + old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other) > 0, old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other, iif(old.source = 'results', old.sl_submission + old.sl_stoppage + old.sl_fastest_escape + old.sl_points + old.sl_decision + old.sl_disqualification + old.sl_other, NULL)) > 0)), coalesce(old.gold, 0), 0) AS gold,
      iif((old.club_id IS NOT NULL AND old.dup = 0 AND ((old.w_submission + old.w_stoppage + old.w_fastest_escape + old.w_points + old.w_decision + old.w_disqualification + old.w_other) > 0 OR iif((old.rw_submission + old.rw_stoppage + old.rw_fastest_escape + old.rw_points + old.rw_decision + old.rw_disqualification + old.rw_other + old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other) > 0, old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other, iif(old.source = 'results', old.sl_submission + old.sl_stoppage + old.sl_fastest_escape + old.sl_points + old.sl_decision + old.sl_disqualification + old.sl_other, NULL)) > 0)), coalesce(old.silver, 0), 0) AS silver,
      iif((old.club_id IS NOT NULL AND old.dup = 0 AND ((old.w_submission + old.w_stoppage + old.w_fastest_escape + old.w_points + old.w_decision + old.w_disqualification + old.w_other) > 0 OR iif((old.rw_submission + old.rw_stoppage + old.rw_fastest_escape + old.rw_points + old.rw_decision + old.rw_disqualification + old.rw_other + old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other) > 0, old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other, iif(old.source = 'results', old.sl_submission + old.sl_stoppage + old.sl_fastest_escape + old.sl_points + old.sl_decision + old.sl_disqualification + old.sl_other, NULL)) > 0)), coalesce(old.bronze, 0), 0) AS bronze,
      iif((old.club_id IS NOT NULL AND old.dup = 0 AND ((old.w_submission + old.w_stoppage + old.w_fastest_escape + old.w_points + old.w_decision + old.w_disqualification + old.w_other) > 0 OR iif((old.rw_submission + old.rw_stoppage + old.rw_fastest_escape + old.rw_points + old.rw_decision + old.rw_disqualification + old.rw_other + old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other) > 0, old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other, iif(old.source = 'results', old.sl_submission + old.sl_stoppage + old.sl_fastest_escape + old.sl_points + old.sl_decision + old.sl_disqualification + old.sl_other, NULL)) > 0)), coalesce(iif((old.rw_submission + old.rw_stoppage + old.rw_fastest_escape + old.rw_points + old.rw_decision + old.rw_disqualification + old.rw_other + old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other) > 0, old.rw_submission + old.rw_stoppage + old.rw_fastest_escape + old.rw_points + old.rw_decision + old.rw_disqualification + old.rw_other, iif(old.source = 'results', old.w_submission + old.w_stoppage + old.w_fastest_escape + old.w_points + old.w_decision + old.w_disqualification + old.w_other, NULL)), 0), 0) AS won,
      iif((old.club_id IS NOT NULL AND old.dup = 0 AND ((old.w_submission + old.w_stoppage + old.w_fastest_escape + old.w_points + old.w_decision + old.w_disqualification + old.w_other) > 0 OR iif((old.rw_submission + old.rw_stoppage + old.rw_fastest_escape + old.rw_points + old.rw_decision + old.rw_disqualification + old.rw_other + old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other) > 0, old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other, iif(old.source = 'results', old.sl_submission + old.sl_stoppage + old.sl_fastest_escape + old.sl_points + old.sl_decision + old.sl_disqualification + old.sl_other, NULL)) > 0)), coalesce(iif((old.rw_submission + old.rw_stoppage + old.rw_fastest_escape + old.rw_points + old.rw_decision + old.rw_disqualification + old.rw_other + old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other) > 0, old.rl_submission + old.rl_stoppage + old.rl_fastest_escape + old.rl_points + old.rl_decision + old.rl_disqualification + old.rl_other, iif(old.source = 'results', old.sl_submission + old.sl_stoppage + old.sl_fastest_escape + old.sl_points + old.sl_decision + old.sl_disqualification + old.sl_other, NULL)), 0), 0) AS lost) o
  WHERE (n.athletes, n.wins, n.submission, n.points, n.gold, n.silver, n.bronze, n.won, n.lost) IS NOT (o.athletes, o.wins, o.submission, o.points, o.gold, o.silver, o.bronze, o.won, o.lost)
  ON CONFLICT (site, club_id) DO UPDATE SET athletes = athletes + excluded.athletes, wins = wins + excluded.wins, submission = submission + excluded.submission, points = points + excluded.points, gold = gold + excluded.gold, silver = silver + excluded.silver, bronze = bronze + excluded.bronze, won = won + excluded.won, lost = lost + excluded.lost;
END;

-- A match's card as a browser read it (profile.js readPoints, site read-scores.tsx), by its match id: both sides'
-- users, their [points, advantages, penalties] and the clock. Kept whether or not its event's results were read, so a
-- profile's points come from here for everyone after its first reader (worker.js scored).
CREATE TABLE IF NOT EXISTS cards (
  site TEXT NOT NULL,
  match INTEGER NOT NULL,
  users TEXT NOT NULL, -- [left, right] (JSON)
  s TEXT NOT NULL, -- each side's [points, advantages, penalties] (JSON)
  clock TEXT, -- [ended at, left] in seconds (JSON)
  at INTEGER NOT NULL,
  PRIMARY KEY (site, match)
);
-- Each athlete's rating (rating.js rerate, nightly), only theirs rated with doubt under rating.js DOUBT: `rating` is
-- mean - 2 doubt, what the rankings sort by, so a short record ranks below a long one as strong; `matches` those it counts.
CREATE TABLE IF NOT EXISTS ratings (
  site TEXT NOT NULL, user TEXT NOT NULL, rating INTEGER NOT NULL, mean INTEGER NOT NULL, doubt INTEGER NOT NULL, matches INTEGER NOT NULL,
  PRIMARY KEY (site, user)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS ratings_rank ON ratings (site, rating);
