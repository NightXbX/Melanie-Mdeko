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

Ensuite :

```
python tools/migration/completer_photos.py donnees
python tools/migration/textes_par_defaut.py "ressources/<un design book>.pdf" donnees
```

- `completer_photos.py` récupère la photo annoncée par la page produit (og:image) des articles sans photo, et marque les liens morts. Il se présente honnêtement et ne contourne pas les sites qui refusent les accès automatiques : ceux-là sont listés dans `photos-non-recuperees.txt` (photo à glisser à la main depuis le site).
- `textes_par_defaut.py` range dans les réglages l'avant-propos, « Vos envies » (pièces remplacées par `{pieces}`), « C'est à vous », les coordonnées et le QR code d'avis.

## Importer un design book existant

```
python tools/migration/importer_design_book.py "ressources/<design book>.pdf" "donnees/Fichiers de l’application"
```

Pour un projet que Mélanie a déjà commencé dans PowerPoint (exporté en PDF) : le projet est créé dans l'appli (client, mois, pièces, « Vos envies », rendus et vignettes, shopping list par sous-catégorie avec « Mon choix » + propositions, teintes, artisans). Les articles déjà présents dans la shopping list sont réutilisés (même lien, ou même photo et même nom), les nouveaux y sont ajoutés. Avec une grande shopping list PDF (sans couverture de client), seuls les nouveaux articles sont ajoutés. Fermer l'appli avant l'import.
