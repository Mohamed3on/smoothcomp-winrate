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
