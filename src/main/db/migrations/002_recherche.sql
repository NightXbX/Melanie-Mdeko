-- Index de recherche des articles, insensible aux accents et à la casse.
-- Maintenu par l'application (src/main/articles.ts) ; reconstruit s'il n'est pas à jour.

CREATE VIRTUAL TABLE articles_fts USING fts5(
  name,
  supplier,
  category,
  details,
  tokenize = 'unicode61 remove_diacritics 2'
);
