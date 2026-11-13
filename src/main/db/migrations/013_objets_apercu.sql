-- Aperçu façon PowerPoint : en plus des annotations, Mélanie insère des formes (rectangle, rond, ligne,
-- flèche) et des images, et met en forme textes et formes (couleur, gras, italique, souligné, alignement).
ALTER TABLE book_notes ADD COLUMN kind TEXT NOT NULL DEFAULT 'text';
ALTER TABLE book_notes ADD COLUMN h REAL;
ALTER TABLE book_notes ADD COLUMN image_id INTEGER REFERENCES images(id);
ALTER TABLE book_notes ADD COLUMN style TEXT;
-- Mise en forme d'un élément du book (JSON), comme la position et la taille.
ALTER TABLE book_adjustments ADD COLUMN style TEXT;
