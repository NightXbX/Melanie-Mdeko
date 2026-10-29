-- Schéma initial : shopping list, projets, teintes, artisans, réglages.
-- Prix en centimes. Dates en texte ISO 8601 (UTC). Suppression douce via deleted_at.

CREATE TABLE families (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE,
  sort  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE categories (
  id         INTEGER PRIMARY KEY,
  family_id  INTEGER NOT NULL REFERENCES families(id),
  name       TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  UNIQUE (family_id, name)
);

CREATE TABLE suppliers (
  id      INTEGER PRIMARY KEY,
  name    TEXT NOT NULL UNIQUE COLLATE NOCASE,
  domain  TEXT
);

CREATE TABLE images (
  id          INTEGER PRIMARY KEY,
  rel_path    TEXT NOT NULL UNIQUE,
  width       INTEGER,
  height      INTEGER,
  sha256      TEXT,
  phash       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX images_sha256 ON images (sha256);

CREATE TABLE articles (
  id               INTEGER PRIMARY KEY,
  name             TEXT NOT NULL,
  category_id      INTEGER REFERENCES categories(id),
  supplier_id      INTEGER REFERENCES suppliers(id),
  price_cents      INTEGER,
  price_kind       TEXT NOT NULL DEFAULT 'fixed'
                   CHECK (price_kind IN ('fixed', 'from', 'per_m2', 'per_roll', 'on_quote', 'unknown')),
  url              TEXT,
  url_clean        TEXT,
  dimensions       TEXT,
  color_material   TEXT,
  private_note     TEXT,
  link_status      TEXT NOT NULL DEFAULT 'unchecked'
                   CHECK (link_status IN ('unchecked', 'ok', 'gone', 'unverifiable')),
  link_checked_at  TEXT,
  flagged          INTEGER NOT NULL DEFAULT 0,
  flag_reason      TEXT,
  embedding        BLOB,
  source_page      INTEGER,
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at       TEXT
);
CREATE INDEX articles_category ON articles (category_id);
CREATE INDEX articles_supplier ON articles (supplier_id);
CREATE INDEX articles_url_clean ON articles (url_clean);

CREATE TABLE price_history (
  id          INTEGER PRIMARY KEY,
  article_id  INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  old_cents   INTEGER,
  new_cents   INTEGER,
  changed_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  origin      TEXT NOT NULL
);

CREATE TABLE article_images (
  article_id  INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  image_id    INTEGER NOT NULL REFERENCES images(id),
  sort        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (article_id, image_id)
);

CREATE TABLE tags (
  id    INTEGER PRIMARY KEY,
  name  TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE article_tags (
  article_id  INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  tag_id      INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (article_id, tag_id)
);

CREATE TABLE inspirations (
  id           INTEGER PRIMARY KEY,
  title        TEXT NOT NULL,
  note         TEXT,
  category_id  INTEGER REFERENCES categories(id),
  url          TEXT,
  source_page  INTEGER,
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at   TEXT
);

CREATE TABLE inspiration_images (
  inspiration_id  INTEGER NOT NULL REFERENCES inspirations(id) ON DELETE CASCADE,
  image_id        INTEGER NOT NULL REFERENCES images(id),
  sort            INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (inspiration_id, image_id)
);

CREATE TABLE projects (
  id            INTEGER PRIMARY KEY,
  client_title  TEXT,
  client_name   TEXT NOT NULL,
  address       TEXT,
  phone         TEXT,
  email         TEXT,
  book_date     TEXT,
  intro_text    TEXT,
  wishes_text   TEXT,
  closing_text  TEXT,
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  deleted_at    TEXT
);

CREATE TABLE rooms (
  id          INTEGER PRIMARY KEY,
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  sort        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE renders (
  id                 INTEGER PRIMARY KEY,
  project_id         INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  room_id            INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  section            TEXT NOT NULL DEFAULT 'plans' CHECK (section IN ('plans', 'changes')),
  image_id           INTEGER NOT NULL REFERENCES images(id),
  inset_image_id     INTEGER REFERENCES images(id),
  active_version_id  INTEGER,
  sort               INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE render_versions (
  id          INTEGER PRIMARY KEY,
  render_id   INTEGER NOT NULL REFERENCES renders(id) ON DELETE CASCADE,
  parent_id   INTEGER REFERENCES render_versions(id),
  image_id    INTEGER NOT NULL REFERENCES images(id),
  prompt      TEXT,
  model       TEXT,
  cost_cents  INTEGER,
  kept        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE needs (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category_id  INTEGER REFERENCES categories(id),
  room_id      INTEGER REFERENCES rooms(id) ON DELETE SET NULL,
  label        TEXT,
  sort         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE need_articles (
  need_id         INTEGER NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
  article_id      INTEGER NOT NULL REFERENCES articles(id),
  role            TEXT NOT NULL CHECK (role IN ('choice', 'alternative')),
  auto_suggested  INTEGER NOT NULL DEFAULT 0,
  sort            INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (need_id, article_id)
);

CREATE TABLE free_pages (
  id           INTEGER PRIMARY KEY,
  project_id   INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category_id  INTEGER REFERENCES categories(id),
  text         TEXT,
  url          TEXT,
  sort         INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE free_page_images (
  free_page_id  INTEGER NOT NULL REFERENCES free_pages(id) ON DELETE CASCADE,
  image_id      INTEGER NOT NULL REFERENCES images(id),
  sort          INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (free_page_id, image_id)
);

CREATE TABLE paint_brands (
  id          INTEGER PRIMARY KEY,
  name        TEXT NOT NULL UNIQUE COLLATE NOCASE,
  promo_code  TEXT
);

CREATE TABLE paints (
  id         INTEGER PRIMARY KEY,
  brand_id   INTEGER NOT NULL REFERENCES paint_brands(id),
  name       TEXT NOT NULL,
  reference  TEXT,
  hex        TEXT,
  image_id   INTEGER REFERENCES images(id)
);

CREATE TABLE project_paints (
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  paint_id    INTEGER NOT NULL REFERENCES paints(id),
  sort        INTEGER NOT NULL DEFAULT 0,
  note        TEXT,
  PRIMARY KEY (project_id, paint_id)
);

CREATE TABLE artisans (
  id     INTEGER PRIMARY KEY,
  trade  TEXT NOT NULL,
  name   TEXT NOT NULL,
  city   TEXT,
  phone  TEXT,
  email  TEXT
);

CREATE TABLE project_artisans (
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  artisan_id  INTEGER NOT NULL REFERENCES artisans(id),
  sort        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, artisan_id)
);

CREATE TABLE settings (
  key    TEXT PRIMARY KEY,
  value  TEXT
);

INSERT INTO families (name, sort) VALUES
  ('Assises', 1),
  ('Tables & bureaux', 2),
  ('Rangements', 3),
  ('Luminaires', 4),
  ('Textiles', 5),
  ('Décoration', 6),
  ('Murs & sols', 7),
  ('Salle de bain', 8),
  ('Cuisine & électroménager', 9),
  ('Extérieur', 10);
