# Installer Mdeko

Deux installateurs sont construits automatiquement par GitHub Actions (workflow « Build Mac et Windows ») :

| Fichier | Pour qui |
| --- | --- |
| `Mdeko-<version>-arm64.dmg` | le Mac de Mélanie (Apple Silicon) |
| `Mdeko-<version>-windows-installation.exe` | le PC du développeur, pour tester |

## 1. Récupérer les installateurs

**Version de test (n'importe quelle branche)** : GitHub › onglet *Actions* › *Build Mac et Windows* › *Run workflow* (choisir la branche) › attendre la fin (~10 min) › en bas de la page du passage, section *Artifacts* : `Mdeko-mac-arm64` et `Mdeko-windows` (des `.zip` qui contiennent les installateurs, gardés 14 jours).

**Version officielle (Release)** : chaque push sur `main` publie automatiquement une Release numérotée `0.1.N`. Les applis déjà installées la proposent d'elles-mêmes (voir « Mises à jour » plus bas). On peut aussi publier un numéro choisi avec un tag, après l'avoir mis dans `package.json` :

```bash
git tag v0.1.0
```

```bash
git push origin v0.1.0
```

Les deux installateurs apparaissent dans *Releases*. Le numéro de version est visible dans Mdeko › À propos de Mdeko.

## 2. Sur le Mac de Mélanie

1. Télécharger le `.dmg` **sur son Mac** (ou le copier avec une clé USB), l'ouvrir et glisser **Mdeko** dans **Applications**.
2. Ouvrir Mdeko depuis Applications. Comme l'appli n'est pas signée par Apple, macOS refuse la première fois : fermer le message.
3. **Réglages Système › Confidentialité et sécurité**, tout en bas : « Mdeko a été bloqué… » › **Ouvrir quand même**, puis confirmer avec le mot de passe du Mac. C'est à faire une seule fois.
4. Si macOS dit que l'appli est « endommagée » (fichier venu d'un autre ordinateur), ouvrir le Terminal et taper :

   ```bash
   xattr -dr com.apple.quarantine /Applications/Mdeko.app
   ```

5. Clic droit sur l'icône dans le Dock › Options › **Garder dans le Dock**.

Au premier lancement, Mdeko crée `Documents/Melanie Mdeko/` avec `Projets/` et `Fichiers de l’application/` (la base, les images, les sauvegardes).

**Mettre à jour** : voir « Mises à jour » plus bas, rien à retélécharger.

## 3. Sur le PC (Windows), pour tester

1. Lancer `Mdeko-<version>-windows-installation.exe`. Windows SmartScreen prévient que l'appli est inconnue : **Informations complémentaires › Exécuter quand même**.
2. L'installation est immédiate (pas de droits administrateur) ; un raccourci Mdeko est posé sur le bureau.
3. Les données sont dans `Documents\Melanie Mdeko\`, comme sur le Mac.

Pour désinstaller : Paramètres › Applications › Mdeko. Le dossier `Documents\Melanie Mdeko` est conservé.

Sans installer, `npm run dev` lance l'appli depuis le code (données dans `./donnees`). `npm run dist:win` construit l'installateur Windows en local, dans `release/`.

## 4. Mises à jour (sans rien retélécharger)

Il suffit d'installer Mdeko **une seule fois**, depuis une Release (pas depuis les *Artifacts* d'Actions, dont le numéro de version reste 0.1.0).

- Au démarrage, puis toutes les 6 heures, Mdeko regarde la dernière Release sur GitHub. S'il y en a une plus récente, un encadré « Nouvelle version » apparaît en bas de la barre latérale.
- **Installer** : Mdeko télécharge la nouvelle version, vérifie le fichier, fait une copie de la base, se ferme puis se rouvre à jour. Sur Mac, la version téléchargée par l'appli n'est pas bloquée par Gatekeeper.
- À la demande : Mdeko › Rechercher une mise à jour… (Mac), Aide › Rechercher une mise à jour… (Windows).
- Le numéro de version est affiché en bas de la barre latérale : le joindre à chaque retour.
- Sur Mac, l'appli doit être dans **Applications** pour pouvoir se remplacer.

Pour publier une mise à jour : fusionner les changements sur `main`. Environ 10 minutes plus tard, la Release est en ligne.

## 5. Mettre la shopping list dans l'appli

Deux façons, sur le Mac comme sur le PC :

- **La plus complète** (photos complétées, textes modèles, coordonnées, QR code) : suivre « Installation chez Mélanie (données) » dans `CLAUDE.md` avec les scripts de `tools/migration/`, puis copier le dossier produit **à la place** de `Documents/Melanie Mdeko/Fichiers de l’application/`, Mdeko fermé.
- **La plus simple** : dans Mdeko, Fichier › Importer (⌘I) et choisir le PDF de la shopping list ; on peut aussi importer ses design books un par un. Ses coordonnées, textes modèles et QR code se règlent ensuite dans Réglages (⌘,).

Ne jamais placer `Fichiers de l’application` sur iCloud Drive.
