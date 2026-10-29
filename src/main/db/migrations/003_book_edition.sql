-- Design book : style choisi par projet, légendes des rendus, annotations posées sur les pages.

ALTER TABLE projects ADD COLUMN book_theme TEXT NOT NULL DEFAULT 'classique';

ALTER TABLE renders ADD COLUMN caption TEXT;

CREATE TABLE book_notes (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_key    TEXT NOT NULL,
  x           REAL NOT NULL,
  y           REAL NOT NULL,
  w           REAL NOT NULL DEFAULT 90,
  text        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX book_notes_project ON book_notes (project_id);
