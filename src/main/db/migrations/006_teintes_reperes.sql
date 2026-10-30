-- « Bilboquet Deco » s'écrit en un seul mot : les anciennes graphies sont réunies sous ce nom.
INSERT OR IGNORE INTO paint_brands (name)
  SELECT 'Bilboquet Deco' WHERE EXISTS (
    SELECT 1 FROM paint_brands WHERE replace(lower(name), ' ', '') IN ('bilboquetdeco', 'bilboquet', 'billboquetdeco', 'billboquet')
  );
UPDATE paint_brands SET promo_code = coalesce(promo_code, (
    SELECT o.promo_code FROM paint_brands o
    WHERE replace(lower(o.name), ' ', '') IN ('bilboquetdeco', 'bilboquet', 'billboquetdeco', 'billboquet')
      AND o.name <> 'Bilboquet Deco' AND o.promo_code IS NOT NULL LIMIT 1
  ))
  WHERE name = 'Bilboquet Deco';
UPDATE paints SET brand_id = (SELECT id FROM paint_brands WHERE name = 'Bilboquet Deco')
  WHERE brand_id IN (
    SELECT id FROM paint_brands
    WHERE replace(lower(name), ' ', '') IN ('bilboquetdeco', 'bilboquet', 'billboquetdeco', 'billboquet') AND name <> 'Bilboquet Deco'
  );
DELETE FROM paint_brands
  WHERE replace(lower(name), ' ', '') IN ('bilboquetdeco', 'bilboquet', 'billboquetdeco', 'billboquet') AND name <> 'Bilboquet Deco';
UPDATE paint_brands SET name = 'Bilboquet Deco' WHERE name = 'Bilboquet Deco';

-- Objets repérés sur un rendu 3D : chaque repère montre un article (position de 0 à 1 sur l'image).
CREATE TABLE render_markers (
  id          INTEGER PRIMARY KEY,
  render_id   INTEGER NOT NULL REFERENCES renders(id) ON DELETE CASCADE,
  article_id  INTEGER NOT NULL REFERENCES articles(id) ON DELETE CASCADE,
  x           REAL NOT NULL,
  y           REAL NOT NULL,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX render_markers_render ON render_markers (render_id);
