-- Un seul style de design book (Contemporain), ajustements faits dans l'aperçu, plusieurs photos pour « Mon choix »,
-- et la marque de teintes « Autre » renommée « Teintes et couleurs ».

UPDATE projects SET book_theme = 'contemporain';

UPDATE paint_brands SET name = 'Teintes et couleurs'
  WHERE name = 'Autre' AND NOT EXISTS (SELECT 1 FROM paint_brands WHERE name = 'Teintes et couleurs');
UPDATE paints SET brand_id = (SELECT id FROM paint_brands WHERE name = 'Teintes et couleurs')
  WHERE brand_id = (SELECT id FROM paint_brands WHERE name = 'Autre');
DELETE FROM paint_brands WHERE name = 'Autre';

-- Position et taille (mm), taille du texte (pt) ou texte d'un élément d'une page, propres à un projet.
CREATE TABLE book_adjustments (
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_key    TEXT NOT NULL,
  element_id  TEXT NOT NULL,
  x           REAL,
  y           REAL,
  w           REAL,
  h           REAL,
  size        REAL,
  text        TEXT,
  PRIMARY KEY (project_id, page_key, element_id)
);

-- Photos de « Mon choix » montrées dans le book (aucune ligne : la première photo de l'article).
CREATE TABLE need_images (
  need_id   INTEGER NOT NULL REFERENCES needs(id) ON DELETE CASCADE,
  image_id  INTEGER NOT NULL REFERENCES images(id),
  sort      INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (need_id, image_id)
);
