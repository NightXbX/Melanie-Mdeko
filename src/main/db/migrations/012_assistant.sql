-- Assistant : discussions (une ou plusieurs par projet, ou générales), vocaux transcrits, mémo du projet et
-- dépenses d'IA hors retouches d'images (discussion, transcription, vérification des prix).
CREATE TABLE chats (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER REFERENCES projects(id) ON DELETE CASCADE, -- NULL : discussion générale
  title       TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at  TEXT
);
CREATE INDEX chats_project ON chats(project_id, updated_at);

CREATE TABLE chat_messages (
  id          INTEGER PRIMARY KEY,
  chat_id     INTEGER NOT NULL REFERENCES chats(id) ON DELETE CASCADE,
  role        TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content     TEXT NOT NULL,
  images      TEXT,    -- identifiants d'images (JSON) : jointes par Mélanie ou produites par la retouche
  recording_id INTEGER REFERENCES project_recordings(id) ON DELETE SET NULL,
  model       TEXT,
  cost_cents  REAL NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX chat_messages_chat ON chat_messages(chat_id, id);

CREATE TABLE project_recordings (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  rel_path    TEXT,    -- copie du fichier audio dans le dossier de données
  duration_s  REAL,
  transcript  TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at  TEXT
);
CREATE INDEX project_recordings_project ON project_recordings(project_id);

CREATE TABLE ai_usage (
  id          INTEGER PRIMARY KEY,
  kind        TEXT NOT NULL, -- chat | transcription | check
  model       TEXT NOT NULL,
  cost_cents  REAL NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX ai_usage_created ON ai_usage(created_at);

-- Mémo du projet : ce que l'assistant doit savoir et retenir (modifiable par Mélanie).
ALTER TABLE projects ADD COLUMN ai_memory TEXT;
