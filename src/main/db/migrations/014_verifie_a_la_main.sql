-- Lien vérifié à la main par Mélanie (site qui refuse les vérifications automatiques) : il ne revient plus
-- dans « Liens à vérifier à la main », même quand une vérification automatique échoue de nouveau.
ALTER TABLE articles ADD COLUMN link_manual_at TEXT;
