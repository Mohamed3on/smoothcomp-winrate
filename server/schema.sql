CREATE TABLE IF NOT EXISTS athletes (
  site TEXT NOT NULL,
  user TEXT NOT NULL,
  kind TEXT NOT NULL,
  at INTEGER NOT NULL,
  entry TEXT NOT NULL,
  PRIMARY KEY (site, user, kind)
);
