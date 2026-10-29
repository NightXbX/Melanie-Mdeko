# Melanie Mdeko — contexte projet

Application Mac locale pour Mélanie, décoratrice d'intérieur (« m·deko »). Elle n'est pas à l'aise avec l'informatique : simplicité absolue, interface 100 % française sans jargon, pas de bulles d'aide (l'interface doit guider d'elle-même), aucune action irréversible sans confirmation, ⌘Z partout.

Développeur : étudiant ingénieur, **code sous Windows, pas de Mac** (environ 1 h par jour). Code propre, commentaires sobres.

Mac cible : **Mac fixe M1, 16 Go, macOS Tahoe 26.x** (26.2.2 déclaré ; un export PDF récent indique 26.6.2). Il faut une version d'Electron récente : les anciennes versions avaient un bug de lenteur graphique sous Tahoe.

## Modules

1. **Shopping list** : base de meubles et objets façon e-commerce (recherche, filtres, tri, fiche détail, « Ajouter au projet »).
2. **Projets et design books** : infos client, rendus 3D, sélection d'articles, export **PDF + PPTX modifiable**.
3. **Assistant visuels IA** : améliorer un rendu ou y ajouter des éléments, avec comparaison avant/après.

## Stack (décidée)

- **Electron + React + TypeScript**. Développement et tests sous Windows ; build macOS (Apple Silicon, arm64) via **GitHub Actions** sur un runner macOS. Le comportement propre au Mac se vérifie sur le Mac de Mélanie.
- **SQLite intégré à Node** (`node:sqlite`, `DatabaseSync`) : aucun module natif à compiler. FTS5 est disponible et insensible aux accents (`unicode61 remove_diacritics 2`). **PptxGenJS** pour le PPTX, `webContents.printToPDF` pour le PDF, `sharp` pour les images (à ajouter).
- Versions figées (`package.json` sans `^`), toujours publiées depuis au moins 2 semaines : Electron 44.7.2 (Node 24), electron-vite 6, electron-builder 26.17, Vite 8.3, React 19.3, TypeScript 7.0, Vitest 5.0.
- Aspect natif : `titleBarStyle: 'hiddenInset'`, `vibrancy: 'sidebar'`, menus natifs avec raccourcis (⌘N, ⌘S, ⌘F, ⌘Z, ⌘⌫), **mode clair uniquement** (`nativeTheme.themeSource = 'light'`, choix de Mélanie), police système (`-apple-system`), glisser-déposer depuis le Finder.
- Appli non signée pendant le test (Gatekeeper : autorisation unique dans Réglages › Confidentialité et sécurité). Pas de mise à jour automatique sans signature : on remplace l'appli à la main. La signature (Apple Developer, 99 $/an) est envisagée après le test.
- Identifiants (code, base de données) en anglais ; textes d'interface et commentaires en français.

## Commandes et organisation du code

- `npm run dev` : appli en développement (données dans `./donnees`, ignoré par git) ; `npm test` ; `npm run typecheck` ; `npm run build`.
- `src/main/` : processus principal (fenêtre, menus, base, sauvegardes, IPC). `src/main/db/migrations/NNN_nom.sql` est chargé automatiquement : ne jamais modifier une migration livrée, en ajouter une.
- `src/preload/` : pont sécurisé (`window.mdeko`). `src/shared/api.ts` : contrat IPC commun. `src/renderer/` : interface React.
- Fenêtre en `sandbox` + `contextIsolation`, aucun accès Node dans l'interface. Les liens web s'ouvrent dans le navigateur.
- CI : `.github/workflows/build-mac.yml` (runner `macos-latest`) : typecheck, tests, build `.dmg` + `.zip` arm64, signature ad hoc vérifiée par `codesign`. Un tag `vX.Y.Z` crée une Release GitHub (source des mises à jour).
- Sous Windows (PowerShell 5.1) : recharger le PATH avant `git`/`npm`/`gh`, et utiliser `git commit -F fichier` pour les messages accentués sur plusieurs lignes.

## Dépôt public : données sensibles

Le dépôt GitHub est **public**. Ne jamais y mettre :
- les fichiers de `ressources/` (PDF et PPTX des clients, shopping list) ;
- des noms de clients, l'adresse, le téléphone ou l'e-mail de Mélanie, les coordonnées des artisans, les codes promo ;
- des clés d'API ou fichiers `.env` ;
- des bases SQLite, des images de clients, des rendus ou des exports.

Les coordonnées de Mélanie, le QR code « avis », les textes et les artisans vivent **dans ses données** (`settings` et tables), jamais dans le code. Les tests utilisent des données fictives. La clé OpenRouter est stockée sur son Mac via `safeStorage` (Trousseau macOS). Les commits utilisent l'e-mail `noreply` de GitHub. Avant chaque commit, vérifier `git status` et le contenu ajouté.

## Données et sauvegarde

- Dossier : `~/Documents/Melanie Mdeko/` → `mdeko.sqlite`, `images/` (chemins relatifs en base), `sauvegardes/`. Compatible Time Machine.
- Copie automatique quotidienne de la base (`VACUUM INTO`, 30 copies conservées).
- Menu « Fichier › Sauvegarder une copie… » : produit un `.zip` daté là où elle veut.
- **Jamais la base sur iCloud Drive** (risque de corruption de SQLite).
- Suppressions → corbeille (suppression douce, champ `deleted_at`).

## Charte du design book (source : les deux design books d'exemple dans `ressources/`)

- **A4 paysage** : 842 × 595 pt (297 × 210 mm).
- **Police unique : Poppins ExtraLight.** Tailles : corps 17 pt, sommaire 26 pt, titres de section 47 pt (texte vertical en bas à droite), cellules de tableau 13 pt, couverture 19/17/13 pt.
- **Couleurs** : taupe `#BFB6A3` (le « m » du logo, « Design Book » en pied de page, titres de section), gris clair `#CCC7B9`, texte `#000000`, accents `#2B3840` et `#5E4553`.
- **Logo** « m·deko » : « m » taupe, « deko » foncé. Petit filigrane m·deko en bas à droite de chaque rendu.
- **Pied de page** sur toutes les pages sauf les intercalaires : « Design Book » (taupe) suivi de « – Page N » (foncé).
- **Enchaînement des pages** :
  1. Couverture (nom du client, mois et année)
  2. Sommaire (numéros de page **calculés**)
  3. Avant-propos
  4. Vos envies
  5. Plans d'aménagement : rendus 16:9 pleine largeur, une petite vignette en option
  6. [Modifications : variantes de rendus + vignettes produit]
  7. Intercalaire SHOPPING LIST, puis par catégorie : intercalaire + tableaux
  8. Intercalaire COULEURS + pastilles de teintes
  9. Artisans
  10. C'est à vous
  11. 4e de couverture : logo dans un disque taupe, coordonnées, QR code « Laisser un avis »
- **Tableaux de la shopping list** : 4 lignes par page, 5 colonnes (photo · désignation · prix · lien · fournisseur), traits fins noirs. Pour chaque besoin, **une première ligne « Mon choix » mise en avant**, puis 2 ou 3 alternatives. Lien affiché sous la forme **« Voir le produit »** cliquable (jamais l'URL brute). Prix affichés tels quels (« à partir de », « /m² », « /rouleau », « sur devis »).
- Il faut pouvoir insérer des **pages libres** (captures de configurateur, échantillons de tissu, sols) dans une catégorie.
- Textes (avant-propos, vos envies, c'est à vous, artisans) : **modèle par défaut dans les réglages, modifiable dans chaque projet**.
- PPTX : **elle le retouche après génération**. Il doit donc utiliser des zones de texte et des images natives, positionnées proprement (pas d'image aplatie). Poppins est installée sur son Mac.
- Usage : présentation au client sur son ordinateur, puis envoi du PDF par lien cloud. La taille du fichier n'est pas un critère : on garde une bonne qualité d'image.
- La charte et les règles de pagination vivent dans un **moteur de templates interne** (fichier de charte déclaratif + règles). Un **skill Claude Code** documente cette charte pour faire évoluer les gabarits sans casser la cohérence.

## Rendus 3D

HomeByMe, toujours en **4K 16:9** (3840 × 2160). L'original est toujours conservé.

## Shopping list : source et migration

- Source : `ressources/Design book SHOPPINGLIST.pdf` (1 385 pages, environ 4 060 articles, 4 024 images, 3 194 URL uniques, environ 70 sections, plus de 60 fournisseurs). Les URL complètes se lisent dans les annotations de lien, pas dans le texte (qui est coupé).
- Tout migrer **sauf les doublons** : comparaison de l'URL nettoyée, d'une empreinte d'image et du couple nom + prix. Les cas ambigus sont soumis à validation, jamais supprimés automatiquement.
- Environ 70 sections → **11 grandes familles** + sous-catégories : Assises, Tables & bureaux, Rangements, Chambre (ajoutée pour la section LITERIE : lits, têtes de lit, matelas), Luminaires, Textiles, Décoration, Murs & sols, Salle de bain, Cuisine & électroménager, Extérieur.
- Outil : `tools/migration/` (Python + PyMuPDF, voir son README). Il produit un dossier de données complet, à copier tel quel sur le Mac lors de l'installation. Environ 22 % des lignes du PDF sont des copies du même article : elles sont fusionnées, et seule la première est gardée.
- Les pages qui ne sont pas des articles (plans, configurations IKEA, nuanciers, planches d'ambiance) vont dans **Inspirations**.
- **Vérification des liens** : statut en ligne / disparu / non vérifiable ; un lien disparu est **signalé**, pas archivé (le développeur vérifie à la main au début). **Les prix trouvés sont mis à jour automatiquement**, avec un historique des prix.
- Analyse : Python 3.12 dans `%LOCALAPPDATA%\Programs\Python\Python312` (PyMuPDF, pdfplumber, python-pptx, Pillow). Lancer avec `-I`.

## Structure de la base (première version)

- `families` (id, name, sort) → `categories` (id, family_id, name, sort)
- `suppliers` (id, name, domain)
- `articles` : id, name, category_id, supplier_id, price_cents, price_kind (`fixed` | `from` | `per_m2` | `per_roll` | `on_quote` | `unknown`), url, url_clean, dimensions, color_material, private_note, link_status (`unchecked` | `ok` | `gone` | `unverifiable`), link_checked_at, flagged, flag_reason, embedding (BLOB, similarité visuelle), source_page, created_at, updated_at, deleted_at
- `price_history` (article_id, old_cents, new_cents, changed_at, origin)
- `images` (id, rel_path, width, height, sha256, phash) ; `article_images` (article_id, image_id, sort)
- `tags` (id, name) ; `article_tags` : étiquettes de style
- `inspirations` (id, title, note, category_id, url, created_at) + images
- `projects` : id, client_title, client_name, address, phone, email, book_date, intro_text, wishes_text, closing_text (texte nul = modèle par défaut), created_at, updated_at, deleted_at
- `rooms` (id, project_id, name, sort)
- `renders` (id, project_id, room_id, section `plans` | `changes`, image_id, inset_image_id, active_version_id, sort)
- `render_versions` (id, render_id, parent_id, image_id, prompt, model, cost_cents, created_at, kept)
- `needs` (id, project_id, category_id, room_id, label, sort) ; `need_articles` (need_id, article_id, role `choice` | `alternative`, auto_suggested, sort)
- `free_pages` (id, project_id, category_id, text, url, sort) + images
- `paint_brands` (id, name, promo_code) ; `paints` (id, brand_id, name, reference, hex, image_id) ; `project_paints` (project_id, paint_id, sort, note)
- `artisans` (id, trade, name, city, phone, email) ; `project_artisans` (project_id, artisan_id, sort)
- `settings` (key, value) : textes par défaut, coordonnées, QR code avis, plafond IA, dépense IA du mois

## Suggestions d'alternatives

Une empreinte visuelle de chaque photo est calculée **en local** (petit modèle de type CLIP, gratuit et hors ligne). Les 2 ou 3 articles les plus proches de la même sous-catégorie, dans une fourchette de prix proche, sont ajoutés automatiquement comme alternatives, et elle peut les remplacer en un clic.

## Assistant IA

- **Accès via OpenRouter** (API compatible OpenAI, une seule clé) avec **10 $ de crédit prépayé**, ce qui fait un plafond strict. Compte créé par le développeur. Compteur de dépense affiché dans l'appli.
- **Première semaine du test : duel** Nano Banana (Google) contre GPT Image 2 / 2.5 (OpenAI). Chaque demande produit 2 propositions, elle garde la meilleure, et on note quel moteur gagne. Ensuite, un seul moteur par défaut (environ 0,05 $ par image en 2K).
- Le moteur est un **réglage**, jamais codé en dur : les identifiants de modèle changent souvent (Nano Banana 2.5 sera arrêté le 15/03/2027).
- Interface `ImageEditProvider` avec un connecteur par fournisseur. Connecteurs directs possibles plus tard : Google Gemini, OpenAI, Black Forest Labs FLUX.2 (européen, jusqu'à 8 à 10 images de référence, absent d'OpenRouter). Écartés : Seedream (revendeurs, données des clients), modèles locaux (M1 trop lent).
- On garde, pour chaque version d'image : modèle utilisé, prompt, coût, image d'origine.
- Instructions système versionnées dans un fichier : **ne jamais modifier les meubles ni les couleurs** sauf demande explicite ; conserver la géométrie, la caméra et les matériaux.
- Demandes typiques : ajouter des lumières, des petits objets de déco, ou **un meuble à partir d'une autre image** (photo d'un article de la shopping list ou image importée, à passer comme image de référence).
- Pas de mention « retouché par IA » dans le book.

## Méthode (validée)

**Une v0.1 « tout-en-un », testable d'un coup par Mélanie, puis des corrections quotidiennes** selon ses retours (captures d'écran transmises par le développeur). Pas de livraison module par module.

**Contenu de la v0.1**
- Shopping list avec les vrais articles migrés : recherche, filtres, tri, fiche, ajout, modification, suppression, corbeille, ⌘Z.
- Projets : client, pièces, textes préremplis, rendus en glisser-déposer, besoins avec « Mon choix » et des alternatives (même sous-catégorie, prix proche).
- Export PDF et PPTX selon la charte.
- Assistant IA : demande en langage naturel, image de référence, duel de 2 moteurs, avant/après, Garder ou Réessayer, compteur de dépense.
- Bouton « Signaler », sauvegarde avant chaque mise à jour, mise à jour intégrée.

**Repoussé à la v0.2 et après** : ressemblance visuelle (CLIP local) pour les alternatives, rubrique Inspirations, vérification des liens en tâche de fond dans l'appli (en attendant, un script côté développeur), préremplissage depuis un lien produit, budget par projet, zone à peindre pour l'IA, signature Apple.

**Boucle quotidienne** : retour de Mélanie → correction → push → build macOS par GitHub Actions (~10 min) → mise à jour au prochain lancement.

**Règles pour le test**
- Les données ne sont jamais en danger : elles vivent hors de l'appli, une sauvegarde est faite avant chaque mise à jour, les migrations de la base sont versionnées.
- On ne réorganise pas l'interface d'un jour à l'autre.
- Le numéro de version est visible et joint à chaque retour.

**Mise à jour pendant le test** : système maison gratuit. L'appli télécharge la nouvelle version depuis GitHub Releases et remplace son bundle (téléchargée par l'appli elle-même, la nouvelle version n'est pas mise en quarantaine). Signature Apple et `electron-updater` après le test si on continue.

**Installation** : faite par le développeur, présent sur place (autorisation Gatekeeper « Ouvrir quand même », clé OpenRouter, import des données).

## Points ouverts

- `.pptx` original (exporté depuis PowerPoint Mac) à récupérer sur son Mac : la version iLovePDF ne sert pas.
- Canal de remontée des retours (Mail d'Apple) : à préciser par le développeur.
- Validation avec Mélanie des familles et sous-catégories, et des maquettes d'écrans.
