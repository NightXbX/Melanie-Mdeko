-- Quantité à acheter pour chaque besoin, options du design book et planche tendance.

ALTER TABLE needs ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity >= 1);

-- Prix affichés dans le book ; choix sans autre proposition regroupés sur une même page.
ALTER TABLE projects ADD COLUMN show_prices INTEGER NOT NULL DEFAULT 1;
ALTER TABLE projects ADD COLUMN group_single_choices INTEGER NOT NULL DEFAULT 0;

-- Photos de la planche tendance, au début du book (aucune photo : pas de planche).
CREATE TABLE project_trend_images (
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  image_id    INTEGER NOT NULL REFERENCES images(id),
  sort        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (project_id, image_id)
);
