-- Import depuis HomeByMe : lien du projet, et ce que Mélanie a décidé pour chaque objet HomeByMe
-- (« product:<id> » pour le catalogue, « community:<id> » pour le contenu communautaire), d'un projet à l'autre.
ALTER TABLE projects ADD COLUMN homebyme_url TEXT;

CREATE TABLE homebyme_links (
  object_key  TEXT PRIMARY KEY,
  article_id  INTEGER REFERENCES articles (id) ON DELETE SET NULL,
  ignored     INTEGER NOT NULL DEFAULT 0
);

-- Dernier mail préparé pour envoyer le design book au client.
ALTER TABLE projects ADD COLUMN mailed_at TEXT;
