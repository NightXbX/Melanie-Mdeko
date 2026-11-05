-- Type de document (design book ou devis), adresse du client sur la couverture, pages retirées du book.
ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'book' CHECK (kind IN ('book', 'quote'));
ALTER TABLE projects ADD COLUMN cover_address INTEGER NOT NULL DEFAULT 0;

-- Une page retirée reste dans l'aperçu (grisée, à remettre d'un clic) mais n'est ni exportée ni comptée.
CREATE TABLE book_hidden_pages (
  project_id  INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  page_key    TEXT NOT NULL,
  PRIMARY KEY (project_id, page_key)
);
