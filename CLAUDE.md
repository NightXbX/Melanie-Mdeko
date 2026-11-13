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
- Icône : `build/icon.png` (1024 px, logo m·deko sur fond crème, coins arrondis à la façon macOS) ; electron-builder en tire l'icône Mac et Windows.
- Appli non signée pendant le test (Gatekeeper : autorisation unique dans Réglages › Confidentialité et sécurité). Pas de mise à jour automatique sans signature : on remplace l'appli à la main. La signature (Apple Developer, 99 $/an) est envisagée après le test.
- Identifiants (code, base de données) en anglais ; textes d'interface et commentaires en français.

## Commandes et organisation du code

- `npm run dev` : appli en développement (données dans `./donnees`, ignoré par git) ; `npm test` ; `npm run typecheck` ; `npm run build`.
- `src/main/` : processus principal (fenêtre, menus, base, sauvegardes, IPC). Migrations : créer `src/main/db/migrations/NNN_nom.sql` **et l'importer dans `migrations/index.ts`** (liste explicite : `import.meta.glob` restait figé dans le cache de Vitest). Ne jamais modifier une migration livrée.
- Recherche : table FTS5 `articles_fts` (nom, fournisseur, catégorie, détails), reconstruite au démarrage si elle ne correspond plus aux articles ; `reindexArticle()` après chaque modification. Fonction SQL `sans_accents()` déclarée à l'ouverture, pour trier comme un dictionnaire.
- **Recherche tolérante** (`ftsQuery` dans `articles.ts`) : petits mots ignorés (« à », « de »…), pluriel retiré, une faute de frappe acceptée (deux au-delà de 8 lettres) d'après le vocabulaire de l'index (`fts5vocab`, en mémoire, relu après chaque modification). Mot absent de l'index : ses corrections les plus probables ; mot présent : on ajoute seulement les variantes bien plus rares (fautes dans les fiches).
- Images : protocole interne `mdeko://media/<chemin>` et `mdeko://miniature/<sha256>` (miniatures JPEG 360 px dans `images/miniatures/`, créées par la migration ; repli sur l'image complète).
- **Écrans gardés ouverts** (`lib/keep-alive.tsx`) : la shopping list et les projets restent montés quand on change d'écran (position de défilement notée au fil de l'eau) ; `useViewActive()` pour les raccourcis clavier.
- **Enregistrement** : tout s'enregistre déjà au fil de la saisie ; copie `automatique` de la base chaque minute si elle a changé (`AutoBackup`, 30 gardées). Bouton « Enregistrer » (barre latérale, ⌘S) : termine la saisie (`flushEdits`), enregistre la fiche article ouverte (`SAVE_EVENT`), fait une copie et affiche l'heure.
- Correcteur d'orthographe : celui de Chromium/macOS (`spellcheck`), suggestions au clic droit (`context-menu.ts`).
- **Fiche depuis un lien** (`product-page.ts`) : JSON-LD « Product » puis Open Graph ; lecture simple, sinon fenêtre invisible (session en mémoire). Ni prix ni photo = échec (« remplissez la fiche à la main ») ; les sites qui bloquent les robots ne sont pas contournés.
- `src/preload/` : pont sécurisé (`window.mdeko`). `src/shared/api.ts` : contrat IPC commun. `src/renderer/` : interface React.
- Fenêtre en `sandbox` + `contextIsolation`, aucun accès Node dans l'interface. Les liens web s'ouvrent dans le navigateur.
- CI : `.github/workflows/build-mac.yml` : Mac (`macos-latest` : typecheck, tests, `.dmg` + `.zip` arm64, signature ad hoc vérifiée par `codesign`) et Windows (`windows-latest` : installateur NSIS). Chaque push sur `main` (ou un tag `vX.Y.Z`) publie une Release GitHub, source des mises à jour intégrées. Guide : `INSTALLATION.md`.
- Sous Windows (PowerShell 5.1) : recharger le PATH avant `git`/`npm`/`gh`, et utiliser `git commit -F fichier` pour les messages accentués sur plusieurs lignes.

## Design book (implémenté)

- `src/main/book/` : `charte.ts` (mesures relevées sur ses PDF, en mm), `layout.ts` (pages = éléments positionnés : textes, images, formes, liens ; sommaire calculé), `html.ts` (aperçu et PDF, Poppins intégrée via @fontsource), `pptx.ts` (PptxGenJS : chaque élément est natif et modifiable), `data.ts` (assemblage depuis la base), `export.ts` (PDF imprimé par Chromium, boîte d'enregistrement, dernier dossier mémorisé).
- **Une seule mise en page pour les deux formats** : modifier `layout.ts` change le PDF et le PPTX à l'identique.
- Shopping list modernisée : une page par besoin (« Mon choix » en grand + 3 propositions, les suivantes sur des pages « suite » de 8 ; nombre illimité), « Voir le produit › » cliquable, puis une page « Récapitulatif de mes choix » avec le total (hors prix au m², au rouleau ou sur devis).
- **Un seul style : Contemporain** (Classique et Épuré retirés ; la migration 004 met tous les projets en Contemporain, la colonne `projects.book_theme` n'est plus lue). Sobre, sans aplats sauf le bandeau de la 4e de couverture et les échantillons de teintes ; rendus 3D pleine largeur. Intercalaires **horizontaux et numérotés**, sans pied de page.
- Couverture : « DESIGN BOOK » (« DEVIS » pour un devis), **m·deko en grand au centre**, client et mois en bas ; en option l'adresse du client sous son nom (`projects.cover_address`). 4e de couverture : logo, nom et coordonnées étiquetées à gauche, bandeau taupe pleine hauteur à droite avec le QR code dans une carte blanche (« Votre avis compte » ; sans QR code, le logo en clair). Sous les coordonnées, « Retrouvez-moi » : site, Facebook et Instagram en liens cliquables (Réglages `designer_website`, `designer_facebook`, `designer_instagram` ; `socialLinks` n'accepte que http(s) et affiche « mdeko.com », le nom de la page, le @compte).
- **Devis** (`projects.kind` = `quote`, migration 010) : bouton « Nouveau devis » (Projets) ou choix « Document » dans l'étape Client. Même mise en page ; à la création (ou en passant en devis), les pages `QUOTE_HIDDEN_PAGES` (sommaire, avant-propos, envies, artisans, « C'est à vous ») sont retirées, et remises en repassant en design book. Fichier « Devis <client> (date) ».
- **Pages retirées** (`book_hidden_pages`) : « Retirer la page » au survol de chaque page de l'aperçu (⌘Z ou « Remettre la page ») ; la page reste grisée dans l'aperçu (`Page.hidden`) mais n'est ni exportée (`exportedPages`), ni dans le diaporama, ni comptée dans la numérotation et le sommaire ; une section toute retirée perd son intercalaire (clé `section:N` d'après toutes les sections, numéro affiché d'après celles montrées). Sans sommaire, `read-mdeko.ts` devine la section de chaque page (`guessSection` : pages de texte ignorées).
- Teintes : section « Teintes et couleurs », **nuancier façon architecte** (grands rectangles numérotés, nom, référence, code couleur ; une marque par page). Marque par défaut : « Teintes et couleurs » (`DEFAULT_PAINT_BRAND`, ancien « Autre »).
- **Shopping list par pièce** : les pièces de « Vos envies » (`needs.room_id`) rangent les besoins dans l'écran du projet et dans le book (articles sans pièce d'abord, puis un intercalaire par pièce ; le récapitulatif est groupé par pièce). `setRooms` garde l'identifiant des pièces conservées.
- **Aperçu modifiable** (`BookPreview.tsx`, mêmes pages que le PDF rendues en React) : clic sur un texte pour le changer ; les éléments qui ont un `id` (unique dans la page) se déplacent en les faisant glisser et se redimensionnent par la poignée (une image garde ses proportions), A−/A+ change la taille d'un texte, « Remettre à sa place » / « Remettre la page en place » annulent (les textes écrits restent). Ces réglages vivent dans `book_adjustments` (projet, page, élément) et sont appliqués par `applyAdjustments` dans `layout.ts` : PDF et PPTX identiques. Les textes sans équivalent en base (clé `text:<page>|<élément>`) sont propres au book ; textes de la base : avant-propos, envies, fin, titre de besoin, légende. Les ids d'articles incluent l'id de l'article (`choice:<id>:name`) pour ne pas suivre un autre article. Double-clic : annotation (`book_notes`), déplaçable et redimensionnable comme le reste. Les textes à saisir vides (`placeholder`) ne sont pas exportés.
- **Barre d'outils de l'aperçu, façon PowerPoint** (`Ribbon` dans `BookPreview.tsx`, migration 013) : Insérer (Texte, Image… ou image glissée sur une page, Rectangle, Rond, Ligne, Flèche) ; Texte (A−/A+, Gras, Italique, Souligné, couleur, alignement) ; Forme (fond ou « Sans fond », trait, épaisseur, rotation des traits par 15°) ; Supprimer (ou Suppr), flèches du clavier pour déplacer. Les objets insérés sont des `book_notes` (`kind`, `h`, `image_id`, `style` JSON) ; la mise en forme d'un élément du book va dans `book_adjustments.style` (effacée par « Remettre à sa place »). `cleanStyle` (`shared/book.ts`) ne garde que des valeurs sûres. Élément `line` (trait ou flèche, tourné autour de son centre) : SVG dans le PDF et l'aperçu (`lineGeometry`), forme native avec pointe dans le PPTX ; vraies italiques de Poppins intégrées au PDF. Chaque geste se défait par ⌘Z (`adjust` renvoie l'ajustement d'avant, `deleteNote` l'objet supprimé).
- **Plusieurs photos pour « Mon choix »** : `need_images` (vide = première photo de l'article), choisies et rangées dans la fiche du besoin ; jusqu'à 4 dans le book (`photoGrid`).
- Modèle de page partagé : `src/shared/book.ts` (éléments en mm, clés d'édition, clés de page).
- Dans le projet : « Créer un nouvel article » (même fiche que la shopping list, `ArticleEditorSheet`) et « Modifier l'article » sur chaque article.
- **Glisser-déposer partout** (`lib/sortable.ts`) : besoins (y compris d'une pièce à l'autre), propositions (lâchée sur « Mon choix » = devient le choix), pièces, teintes et artisans du projet, photos d'un article, rendus.
- Alternatives automatiques : même sous-catégorie, prix le plus proche, avec photo de préférence, sans doublon de lien.
- **Teintes** : chaque teinte se modifie ou se supprime (crayon au survol, confirmation) ; couleur par code (`normalizeHex`) ou palette (+ sélecteur du Mac) ; « Modifier la marque » renomme une marque et son code promo (un nom existant réunit les deux marques).
- **Plans 3D en grand** (`RenderViewer.tsx`) : clic sur un rendu ; « Remplacer l'image… » (ou dépôt) garde la place, la vignette et les repères (`replaceRenderImage`, la retouche IA n'est plus montrée). **Repères** (`render_markers`, position 0–1) : « Repérer un objet », clic sur l'image, choix d'un article (ceux du projet d'abord) ou création ; un article absent du projet y devient un nouveau choix (`addMarker`). Les repères ne vont jamais dans le book : ils servent seulement à composer la shopping list plus vite.
- **Description d'article** (`articles.description`, migration 007) : sous « Mon choix », sous les 3 premières propositions et dans « Mes choix » (pas sur les pages « suite ») ; relue par `read-mdeko.ts`.
- Titre d'un besoin modifiable dans l'écran du projet (`needLabel`). Une proposition glissée sur un autre besoin y est **copiée** (elle reste dans le sien).
- **Diaporama** (`Slideshow.tsx`, bouton dans l'aperçu ou F5) : pages du book en plein écran, flèches, Échap.
- Export : boîte « Enregistrer sous », dernier dossier mémorisé (`settings.last_export_dir`), sinon le dossier du projet.
- **Import HomeByMe** (`src/main/homebyme/`, `HomeByMeImport.tsx`, bouton dans la shopping list du projet) : lien de partage public, sans connexion. On lit les fichiers chargés par la page « Liste de course » (pas une API officielle : si HomeByMe change, corriger `read.ts`) : `/ajax/project/<id>` (dont `bmProjURL`, le plan 3D JSON), `/ajax/project/<id>/rooms-furnitures` (produits du catalogue : marque, nom souvent anglais, lien vendeur, vignette), `/ajax/user-product/<id>` (objets de la communauté, `isUserProduct` dans le plan : nom, jamais de lien). Pièce de chaque objet calculée d'après les murs de la pièce (« Pièce N » = sans nom). Nouveaux produits : page du vendeur lue si elle a un prix, catégorie devinée seulement si nette. Choix retenus dans `homebyme_links` (migration 008) pour les projets suivants. CSP : seules les vignettes HomeByMe (S3 et CloudFront) sont autorisées.
- **Assistant IA** : une image lâchée n'importe où dans la fenêtre devient une référence ; « Entourer sur le rendu » et clic sur une référence pour tracer en rouge (`MarkupLayer.tsx`, ⌘Z retire le dernier trait via `useUndoHandler`). Le rendu part toujours propre, une copie annotée part en plus (`markup.ts`, consignes `instructions-v2.txt`).
- **Envoyer au client** (étape du projet, `SendSection.tsx`, `main/mail.ts`) : mail type des Réglages (`{client}`, `{mois}`, `{signature}`), book recréé dans le dossier du projet puis message préparé dans Mail par AppleScript (`osascript`, autorisation « Automatisation » demandée par macOS, `NSAppleEventsUsageDescription`) ; Mail Drop pour les gros fichiers. Ailleurs que sur Mac : `mailto:` sans pièce jointe. `projects.mailed_at`.
- **Rognage façon Canva** (`CropSheet.tsx`, géométrie dans `src/shared/crop.ts`) : rendus (vue en grand et survol de la carte), photos d'un article, planche tendance, images de référence de l'IA. Cadre déplaçable, poignées, formats (Libre, Original, 16:9 « Page du book » pour un rendu, 4:3, Carré, Portrait), ⌘Z, flèches, Entrée/Échap. Une image rognée est une **nouvelle image** (`images.crop_of` = l'original, `images.crop` = cadre en fractions, migration 009) : l'original n'est jamais modifié ni purgé tant qu'un rognage sert, l'outil rouvre toujours l'original entier avec le cadre choisi, et le cadre entier redonne l'original. Découpe en pleine définition dans l'interface (`cropImage`, même format que l'original). `cropRender` remplace l'image montrée (version IA gardée sinon original) et reporte les repères (`movePoint`) ; un repère hors du cadre est caché, pas supprimé. Une photo d'article rognée suit dans `need_images` (`followCrops`).
- Réglages (⌘, ou bouton en bas de la barre latérale) : coordonnées, QR code d'avis, textes modèles (`{pieces}` = pièces du projet).
- **Quantités** (`needs.quantity`) : « 2 × 219 € » sous « Mon choix », colonne « Qté » et total multiplié dans le récapitulatif.
- **Options du book par projet** (étape Shopping list) : afficher les prix (`projects.show_prices`) ; réunir par 4 sur une page « Mes choix » les choix d'une pièce sans autre proposition (`projects.group_single_choices`).
- **Compte-rendu de réunion** (`projects.report_text`, migration 011, étape « Compte-rendu » du projet) : pages juste après « Vos envies », avant les plans (vide = pas de page). Texte en **Markdown réduit** (`src/shared/markdown.ts` : # ## ###, listes « - » ou « 1. », **gras** ; `cleanMarkdown` retire entités HTML, échappements « \- », puces typographiques). Éditeur mis en forme (`RichText.tsx`, contentEditable : Titre, Sous-titre, Texte, Gras, Liste, ⌘B) ; un texte collé depuis ChatGPT (Markdown brut ou HTML) arrive mis en forme. Dans le book, chaque bloc est un texte placé (titres taupe/plus grands, puces, gras en graisse 500) : `reportLayout` mesure ligne par ligne (`measure.ts`, largeurs Poppins 300/400/500 dans `poppins-widths.ts`, produit par `tools/largeurs-poppins.mjs`), une colonne en grand (15 à 12 pt), sinon deux colonnes (14 à 10 pt), la plus grande taille qui donne le moins de pages ; un titre n'est jamais seul en bas de colonne ; dernière page équilibrée. Un bloc sans gras se modifie dans l'aperçu (`report:<début>:<fin>` dans le texte nettoyé). Section `unkeyed` : n'en décale pas les clés `section:N`.
- **Projets : deux catégories** (onglets « Design books » / « Devis » de l'écran Projets, d'après `projects.kind`, onglet retenu dans `localStorage`). **Dupliquer** (survol d'une carte, ou étape Client) : `duplicateProject` copie tout en une transaction (pièces, rendus et versions, repères, besoins et leurs articles/photos, pages libres, teintes, artisans, planche tendance, mémo, annotations, ajustements et pages retirées, clés `need:/render:/choices:/note:` renumérotées), sauf les discussions et vocaux ; nouveau client et document au choix (passer en devis retire ses pages).
- **Assistant** (`src/main/assistant/`, `Assistant.tsx`, migration 012) : discussions comme ChatGPT, par projet (étape « Assistant » du projet) ou générales (écran « Assistant » de la barre latérale). Tables `chats`, `chat_messages` (images jointes ou produites, vocal), `project_recordings`, `ai_usage` ; `projects.ai_memory`. À chaque message, le modèle relit : consignes (`consignes-v1.txt`), mémo de l'entreprise (Réglages), contexte du projet assemblé par `bookData` (client, pièces, shopping list, teintes, artisans sans coordonnées, compte-rendu, liste des vocaux) et mémo du projet ; les 40 derniers messages, les 4 images les plus récentes. Outils : `remember` (ajoute au mémo) et `edit_image` (retouche par les moteurs d'images des Réglages, en duel). Sous chaque réponse : Copier, « Mettre dans le compte-rendu » (remplacer après confirmation, sinon à la suite) ; sous une image : Retoucher, « Ajouter aux plans 3D ».
- **Vocaux** (Dictaphone de l'iPhone, synchronisé sur le Mac) : glissés dans la discussion d'un projet ou « Importer un vocal… ». L'interface décode le son (Chromium, `lib/audio.ts`) en 16 kHz mono, morceaux WAV de 5 min ; le modèle audio (`input_audio`) transcrit 3 morceaux à la fois. Le fichier d'origine est gardé dans `vocaux/<id>.<ext>` du dossier de données ; la transcription entre dans la discussion.
- **Vérification des prix par l'IA** (`ai/prices.ts`, écran Vérification) : articles des projets ou prix de plus d'un an ; page lue (`readPageHtml` : lecture simple puis fenêtre invisible), texte utile (`pageDigest` : JSON-LD, meta de prix, texte visible) envoyé au modèle `ai_check_model` (défaut `openai/gpt-5.4-mini`), réponse JSON. **Rien n'est changé tout seul** : écarts proposés, « Appliquer » écrit le prix et `price_history` (origine `verification-ia`).
- **Shopping list du projet** : affichage Détaillé / Compact (une ligne par article, `localStorage`), pièces repliables ; glisser-déposer : dans une zone, l'élément est placé d'après le pointeur (`nearest` dans `lib/sortable.ts`), défilement automatique près des bords pendant un déplacement (partout dans l'appli).
- **Planche tendance** (`project_trend_images`) : photos glissées ou prises dans les inspirations ; pages en mosaïque (6 par page) juste après le sommaire, absentes sans photo.
- Nuancier : sous chaque teinte, la marque (où la trouver) et la référence, plus de code couleur.
- Écran **Artisans** (barre latérale) : le carnet commun à tous les projets.

## Vérification de la base (implémentée)

Écran « Vérification » (`src/main/check.ts`, `views/CheckView.tsx`) : `PRAGMA integrity_check` et `foreign_key_check`, emplacement et taille de la base, photos introuvables, produits disparus, doublons d'URL, articles d'un projet à la corbeille, prix inchangés depuis un an, articles sans photo, prix, lien ou catégorie. Mise à la corbeille depuis l'écran : un article (survol), une sélection (cases à cocher, barre en bas) ou toute une anomalie (`checkGroupIds`, pas seulement les 120 affichés ; pour les doublons, on garde un article par produit : celui d'un projet, sinon avec photo, sinon le plus ancien). Confirmation qui dit combien sont dans un projet ; `trashArticles` = un seul ⌘Z. « Vérifier les liens » ouvre les pages produit (6 à la fois, interruptible) : 404/410 ou renvoi vers l'accueil = disparu ; refus des robots = à vérifier à la main. **Actions par anomalie** (article, sélection ou tout le groupe, un seul ⌘Z) : « Retirer des projets » (`removeFromProjects` : un « Mon choix » retiré laisse la place à la première proposition, un besoin vide disparaît, repères des plans supprimés ; proposé aussi juste après une mise à la corbeille), « Remettre dans la shopping list » (articles à la corbeille encore dans un projet), « Vérifié à la main » / « Prix vérifié » / « Toujours en vente » (`markVerified`, `articles.link_manual_at`, migration 014 : un site qui refuse les robots ne remet plus le lien en « à vérifier »), « Faire vérifier par l'IA » (liens à vérifier, disparus, prix à revoir). La vérification des prix par l'IA vaut aussi vérification du lien (trouvé = en ligne, plus vendu ou page disparue = disparu).

## Dossiers de Mélanie

`~/Documents/Melanie Mdeko/` ne montre que **Projets/AAAA/<client>/** (design books exportés automatiquement, datés, jamais écrasés) et **Fichiers de l’application/** (base, images, sauvegardes). Une ancienne organisation est rangée automatiquement au démarrage (`paths.ts`).

## Import dans l'appli (implémenté)

- Projets › « Importer… », dépôt d'un PDF sur la liste, ou Fichier › Importer (⌘I) : un design book devient un projet (client, date, pièces, rendus, besoins par sous-catégorie, teintes, artisans) et ses nouveaux articles rejoignent la shopping list ; une shopping list seule ajoute ses articles.
- **Book exporté par Mdeko** (titre PDF `mdeko-book-…`) : lu par `read-mdeko.ts` d'après les positions de `layout.ts` (sommaire, besoins avec propositions et quantités, rendus, teintes, artisans, textes, planche tendance), pour reprendre un projet sur un autre ordinateur. **Toute modification de `layout.ts` doit garder cette lecture** (test : copier un book exporté sous `ressources/design-book-mdeko-test.pdf`).
- `src/main/import/` : `read-pdf.ts` (lecture par mupdf, en WASM, sans module natif), `rules.ts` (classement, mêmes listes que `tools/migration` via `src/shared/import-rules.json`), `apply.ts` (doublons : URL nettoyée, ou même nom et photo proche), `index.ts` (une seule transaction : en cas d'erreur, rien n'est modifié).
- **Besoins** : un article surligné au fluo est « Mon choix », les autres articles de sa page sont ses propositions ; une page sans fluo prolonge le choix du même genre déjà fait dans la pièce, sinon chacun de ses articles est un choix. Book sans aucun fluo (ancien format) : un besoin par sous-catégorie, premier article = « Mon choix ».
- **Pièces** : un intercalaire de pièce (« ENTRÉE », « CHAMBRE PARENTALE »…, `isRoomSection`) range les besoins qui suivent dans cette pièce. Sous une pièce, la catégorie d'un nouvel article se devine d'après les noms des articles existants ; un article réutilisé qui n'est qu'en « Divers » est reclassé.
- mupdf est sous licence **AGPL-3.0** (compatible avec le dépôt public). La CI vérifie que `mupdf-wasm.wasm` est bien dans le paquet.
- Test d'import réel : copier un design book sous `ressources/design-book-test.pdf` (jamais versionné).

## Installation chez Mélanie (données)

1. `python tools/migration/extraire_shopping_list.py "<shopping list>.pdf" <dossier neuf>`
2. `python tools/migration/completer_photos.py <dossier>` (photos manquantes ; les sites qui refusent les accès automatiques ne sont pas contournés : liste dans `photos-non-recuperees.txt`).
3. `python tools/migration/textes_par_defaut.py "<un design book>.pdf" <dossier>` (textes modèles, coordonnées, QR code).
4. Copier le dossier produit dans `~/Documents/Melanie Mdeko/Fichiers de l’application/` sur son Mac.

## Dépôt public : données sensibles

Le dépôt GitHub est **public**. Ne jamais y mettre :
- les fichiers de `ressources/` (PDF et PPTX des clients, shopping list) ;
- des noms de clients, l'adresse, le téléphone ou l'e-mail de Mélanie, les coordonnées des artisans, les codes promo ;
- des clés d'API ou fichiers `.env` ;
- des bases SQLite, des images de clients, des rendus ou des exports.

Avant chaque commit, vérifier les ajouts avec les motifs de `ressources/mots-sensibles.txt` (non versionné) : `git diff --cached | grep -i -E -f ressources/mots-sensibles.txt` doit être vide. Ne jamais citer un vrai nom de client, même en exemple dans un commentaire (utiliser « Mme Durand »).

Les coordonnées de Mélanie, le QR code « avis », les textes et les artisans vivent **dans ses données** (`settings` et tables), jamais dans le code. Les tests utilisent des données fictives. La clé OpenRouter est stockée sur son Mac via `safeStorage` (Trousseau macOS). Les commits utilisent l'e-mail `noreply` de GitHub. Avant chaque commit, vérifier `git status` et le contenu ajouté.

## Sécurité et confidentialité (revue du 29/10/2026)

- **Tout reste sur l'ordinateur** : base, images, projets, coordonnées des clients. Rien n'est envoyé ailleurs, sauf trois cas :
  1. **Assistant IA** : le rendu, les images de référence (réencodés en JPEG, donc sans métadonnées EXIF) et la demande écrite partent chez OpenRouter, puis chez Google ou OpenAI. Pour la retouche, aucun nom, adresse ou coordonnée de client. **Assistant (discussions)** : le contexte du projet part avec chaque message (nom du client, pièces, shopping list, teintes, artisans sans coordonnées, compte-rendu, mémos) ainsi que les vocaux (son) et leurs transcriptions ; jamais l'adresse, le téléphone ni l'e-mail du client. OpenRouter ne garde pas les requêtes par défaut ; l'API d'images n'accepte pas `zdr` ni `data_collection` par requête, donc la confidentialité se règle sur le compte (Settings › Privacy : refuser l'entraînement sur les données, laisser « OpenRouter Use of Inputs/Outputs » et « Input & Output Logging » désactivés).
  2. **Vérification des liens** : visite des pages produit (rien n'est envoyé).
  3. **Mises à jour** : lecture de la dernière Release GitHub publique ; téléchargement accepté seulement depuis `https://github.com/NightXbX/Melanie-Mdeko/releases/download/`, taille et SHA-256 contrôlés.
- Dossier `Fichiers de l’application` en `700` (Mac) : illisible par les autres comptes de l'ordinateur. `~/Documents` est en plus protégé par macOS (les autres applis doivent demander l'autorisation).
- Clé OpenRouter chiffrée par `safeStorage`, jamais renvoyée à l'interface ; une sauvegarde de la base ne contient que la version chiffrée (inutilisable sur un autre Mac).
- Interface en `sandbox` + `contextIsolation`, CSP stricte, IPC en listes blanches (`PROJECT_METHODS`, `AI_METHODS`), requêtes SQL paramétrées (les noms de table interpolés sont fixés dans le code), protocole `mdeko://` limité au dossier de données.
- CI : jetons GitHub en lecture seule sauf pour la publication. **Qui peut pousser sur `main` peut livrer du code sur le Mac de Mélanie** : compte GitHub avec double authentification, et personne d'autre en écriture sur le dépôt.
- Historique du dépôt vérifié : aucune base, aucun PDF ni rendu, aucune coordonnée, aucune clé.

## Données et sauvegarde

- Dossier : `~/Documents/Melanie Mdeko/Fichiers de l’application/` → `mdeko.sqlite`, `images/` (chemins relatifs en base), `sauvegardes/`. Compatible Time Machine.
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
  11. 4e de couverture : logo et coordonnées, bandeau taupe avec le QR code « Laisser un avis »
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

**Implémenté** (`src/main/ai/`) :
- `openrouter.ts` : connecteur `ImageEditProvider` sur l'API d'images d'OpenRouter (`POST /api/v1/images`, `input_references` en data URL : le rendu d'abord, puis les références ; `aspect_ratio` 16:9 et `resolution` 2K, relancé sans ces options si le moteur répond 400 ; image en `data[].b64_json`, coût en `usage.cost` en dollars). Erreurs traduites en français.
- `versions.ts` : chaque proposition est une `render_versions` (moteur, demande, coût en centimes de dollar, éventuellement fractionnaires) ; « Garder » met `kept = 1` et `renders.active_version_id`. Le book et l'écran du projet montrent la version gardée, l'original reste (« Versions de ce rendu »). Dépense du mois = somme des coûts du mois ; plafond `ai_monthly_cap_cents` (10 $ par défaut) ; moteurs `ai_models` (duel par défaut : `google/gemini-3.1-flash-image` contre `openai/gpt-image-2`, liste proposée par `GET /api/v1/images/models`).
- `index.ts` : clé chiffrée par `safeStorage` (réglage `openrouter_key`), rendu envoyé en JPEG 2048 px, références en 1024 px, les deux moteurs en parallèle, propositions dans un ordre tiré au sort (duel à l'aveugle), 4 min au plus, « Arrêter ». Instructions système : `instructions-v1.txt` (nouvelle version = nouveau fichier).
- **Budget commun** : `monthSpentCents` = retouches (`render_versions`) + `ai_usage` (discussion, transcription, vérification, retouches depuis l'assistant) ; `checkCap` avant chaque appel. Crédit restant OpenRouter (`GET /api/v1/credits`) affiché dans la retouche et les Réglages ; 402 = « crédit épuisé, rechargez sur openrouter.ai ». Modèles : `ai_chat_model` (défaut `openai/gpt-5.4`), `ai_audio_model` (défaut `google/gemini-2.5-flash`), modifiables dans les Réglages. Facturation : l'abonnement ChatGPT ne sert pas aux applis tierces ; recharge automatique sur OpenRouter = facture à chaque recharge.
- Interface : « Retoucher avec l'IA » sous chaque rendu (`AiSheet.tsx` : demande, idées, références depuis la shopping list ou l'ordinateur, propositions A/B, curseur avant/après, Garder / Réessayer, versions) ; Réglages : clé, moteurs, plafond, dépense, score du duel.

## Méthode (validée)

**Une v0.1 « tout-en-un », testable d'un coup par Mélanie, puis des corrections quotidiennes** selon ses retours (captures d'écran transmises par le développeur). Pas de livraison module par module.

**Contenu de la v0.1**
- Shopping list avec les vrais articles migrés : recherche, filtres, tri, fiche, ajout, modification, suppression, corbeille, ⌘Z.
- Projets : client, pièces, textes préremplis, rendus en glisser-déposer, besoins avec « Mon choix » et des alternatives (même sous-catégorie, prix proche).
- Export PDF et PPTX selon la charte.
- Assistant IA : demande en langage naturel, image de référence, duel de 2 moteurs, avant/après, Garder ou Réessayer, compteur de dépense.
- Bouton « Signaler », sauvegarde avant chaque mise à jour, mise à jour intégrée.

**Repoussé à la v0.2 et après** : ressemblance visuelle (CLIP local) pour les alternatives, rubrique Inspirations, vérification des liens automatique en tâche de fond (pour l'instant à la demande, écran Vérification), mise à jour automatique des prix, préremplissage depuis un lien produit, budget par projet, zone à peindre pour l'IA, signature Apple.

**Boucle quotidienne** : retour de Mélanie → correction → push → build macOS par GitHub Actions (~10 min) → mise à jour au prochain lancement.

**Règles pour le test**
- Les données ne sont jamais en danger : elles vivent hors de l'appli, une sauvegarde est faite avant chaque mise à jour, les migrations de la base sont versionnées.
- On ne réorganise pas l'interface d'un jour à l'autre.
- Le numéro de version est visible et joint à chaque retour.

**Mise à jour pendant le test** : système maison gratuit. L'appli télécharge la nouvelle version depuis GitHub Releases et remplace son bundle (téléchargée par l'appli elle-même, la nouvelle version n'est pas mise en quarantaine). Signature Apple et `electron-updater` après le test si on continue.

Implémenté (`src/main/update/`) : chaque push sur `main` publie une Release `v0.1.<run_number>` (la CI règle la version de `package.json`, dont seuls les deux premiers nombres sont à changer à la main). `release.ts` lit `releases/latest` (API GitHub publique), compare les versions et choisit le fichier (`-arm64.zip` sur Mac, `-windows-installation.exe` sur Windows). `index.ts` : vérification au démarrage (15 s) puis toutes les 6 h, téléchargement avec progression, contrôle de la taille et du SHA-256 (`digest` GitHub), sauvegarde `avant-mise-a-jour`, puis sur Mac `ditto` + script qui remplace le bundle après la fermeture et le rouvre (retour à l'ancienne version en cas d'échec), sur Windows installateur NSIS en silence (`/S --force-run`). Inactif en développement. Interface : `UpdateBar.tsx` (version et « Installer ») et menu « Rechercher une mise à jour… ».

**Installation** : faite par le développeur, présent sur place (autorisation Gatekeeper « Ouvrir quand même », clé OpenRouter, import des données).

## Points ouverts

- `.pptx` original (exporté depuis PowerPoint Mac) à récupérer sur son Mac : la version iLovePDF ne sert pas.
- Canal de remontée des retours (Mail d'Apple) : à préciser par le développeur.
- Validation avec Mélanie des familles et sous-catégories, et des maquettes d'écrans.
