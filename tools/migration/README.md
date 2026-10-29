# Migration de l'ancienne shopping list

Transforme le PDF de la shopping list (exporté de PowerPoint) en un dossier de données prêt pour l'appli : `mdeko.sqlite`, `images/` et `rapport-migration.html`.

```
pip install -r tools/migration/requirements.txt
python tools/migration/extraire_shopping_list.py "ressources/Design book SHOPPINGLIST.pdf" donnees
python -m unittest discover tools/migration
```

- Le dossier de sortie doit être neuf : le script ne modifie jamais un dossier existant.
- La base est créée à partir des migrations de l'appli (`src/main/db/migrations`) : même schéma, même version.
- Le tableau de chaque page est découpé grâce à ses traits (colonnes photo · nom · prix · lien · fournisseur). Les liens complets viennent des annotations du PDF, pas du texte affiché (coupé).
- Les pages sans tableau deviennent des **inspirations** (image de la page). Les pastilles de la section COULEURS deviennent des **teintes**.
- **Doublons** : même lien nettoyé et même photo, ou même nom et même photo sans lien → seul le premier est gardé. « Même photo, liens différents » est gardé et listé dans le rapport.
- Les règles de tri (catégories, fournisseurs, prix, dimensions, matières, liens) sont dans `regles.py`.
