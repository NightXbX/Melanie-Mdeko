"""Importe un design book PDF existant (format PowerPoint de Mélanie) dans les données de l'appli.

    python importer_design_book.py "<design book>.pdf" "<dossier Fichiers de l'application>"

- Le projet est créé : client et mois (couverture), pièces et texte « Vos envies », rendus 3D
  (avec leur vignette), shopping list (par section : la première ligne devient « Mon choix »,
  les suivantes des propositions), teintes et artisans.
- Les articles déjà présents dans la shopping list sont réutilisés (même lien, ou même photo et
  même nom) ; les nouveaux y sont ajoutés.
- Une grande shopping list PDF (sans couverture de client) n'ajoute que les nouveaux articles.

Fermer l'appli avant l'import ; elle reconstruit son index de recherche au lancement suivant.
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parent))
import regles  # noqa: E402
from extraire_shopping_list import (  # noqa: E402
    TAILLE_TITRE_SECTION,
    Article,
    Images,
    colonnes_du_tableau,
    distance,
    lignes_du_tableau,
    lire_tableau,
    lire_teintes,
    spans,
)
from textes_par_defaut import paragraphes  # noqa: E402

MOIS = ["janvier", "fevrier", "mars", "avril", "mai", "juin", "juillet", "aout", "septembre", "octobre", "novembre", "decembre"]
CIVILITES = ("Mme et M.", "Mme", "M.", "Mr", "Mlle")
TAILLE_RENDU = 1000  # px : une image plus large que ça est un rendu 3D, pas une photo produit


class Base:
    """Accès à la base de l'appli : retrouve ou ajoute fournisseurs, catégories, images et articles."""

    def __init__(self, chemin: Path, img: Images):
        self.db = sqlite3.connect(chemin)
        self.db.execute("PRAGMA foreign_keys = ON")
        self.img = img
        self.ajoutes = 0
        self.reutilises = 0

    def un(self, sql: str, *params):
        ligne = self.db.execute(sql, params).fetchone()
        return ligne[0] if ligne else None

    def image(self, res: dict) -> int:
        return self.un("SELECT id FROM images WHERE sha256 = ?", res["sha"]) or self.un(
            "INSERT INTO images (rel_path, width, height, sha256, phash) VALUES (?, ?, ?, ?, ?) RETURNING id",
            res["rel"], res["w"], res["h"], res["sha"], res["dhash"],
        )

    def categorie(self, section: str, nom: str) -> int:
        famille, sous = regles.categorie(section, nom)
        fid = self.un("SELECT id FROM families WHERE name = ?", famille)
        return self.un("SELECT id FROM categories WHERE family_id = ? AND name = ?", fid, sous) or self.un(
            "INSERT INTO categories (family_id, name) VALUES (?, ?) RETURNING id", fid, sous
        )

    def fournisseur(self, brut: str, url: str | None) -> int | None:
        nom = regles.fournisseur(brut)
        if not nom and url:
            # Fournisseur déjà connu pour ce site.
            nom = self.un("SELECT name FROM suppliers WHERE domain = ?", regles.domaine(url))
        if not nom:
            return None
        return self.un("SELECT id FROM suppliers WHERE name = ? COLLATE NOCASE", nom) or self.un(
            "INSERT INTO suppliers (name, domain) VALUES (?, ?) RETURNING id", nom, regles.domaine(url)
        )

    def article(self, a: Article) -> int:
        """Article existant (même lien, ou même photo et même nom), sinon nouvel article."""
        lien = regles.lien_propre(a.url)
        photos = [r for r in (self.img.extraire(x) for x in a.images) if r]
        if lien:
            existant = self.un("SELECT id FROM articles WHERE url_clean = ? AND deleted_at IS NULL ORDER BY id LIMIT 1", lien)
            if existant:
                self.reutilises += 1
                return existant
        if photos:
            for aid, nom, phash in self.db.execute(
                """SELECT a.id, a.name, i.phash FROM articles a JOIN article_images ai ON ai.article_id = a.id
                   JOIN images i ON i.id = ai.image_id WHERE a.deleted_at IS NULL AND i.phash IS NOT NULL"""
            ):
                if regles.cle(nom) == regles.cle(a.nom) and distance(phash, photos[0]["dhash"]) <= 4:
                    self.reutilises += 1
                    return aid
        aid = self.un(
            """INSERT INTO articles (name, category_id, supplier_id, price_cents, price_kind, price_text, url, url_clean,
                 dimensions, color_material) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id""",
            a.nom or "Sans nom", self.categorie(a.section, a.nom), self.fournisseur(a.fournisseur_brut, a.url),
            a.prix.centimes, a.prix.nature, a.prix.texte or None, a.url, lien,
            regles.dimensions(a.nom), regles.couleurs_matieres(a.nom),
        )
        for rang, res in enumerate(photos):
            self.db.execute("INSERT OR IGNORE INTO article_images (article_id, image_id, sort) VALUES (?, ?, ?)", (aid, self.image(res), rang))
        self.ajoutes += 1
        return aid


def couverture(page: pymupdf.Page) -> tuple[str, str, str | None] | None:
    """(civilité, nom, AAAA-MM) lus sur la couverture, ou None si ce n'est pas un design book client."""
    # Texte brut : spans() écarte « Design Book », pris pour un pied de page.
    textes = [
        " ".join(s["text"].split())
        for b in page.get_text("dict")["blocks"]
        for l in b.get("lines", [])
        for s in l["spans"]
        if s["text"].strip()
    ]
    if not any(t.lower() == "design book" for t in textes):
        return None
    date = None
    for t in textes:
        m = re.fullmatch(r"([A-Za-zéûÉÛ]+)\s+(\d{4})", t)
        if m and regles.sans_accents(m.group(1)).lower() in MOIS:
            date = f"{m.group(2)}-{MOIS.index(regles.sans_accents(m.group(1)).lower()) + 1:02d}"
    client = next((t for t in textes if t.lower() != "design book" and not re.fullmatch(r"[\w·]+", t) and t != (date or "")
                   and not re.search(r"\d{4}$", t)), "")
    civilite = next((c for c in CIVILITES if client.startswith(c + " ")), "")
    nom = client[len(civilite):].strip() if civilite else client
    return civilite.replace("Mr", "M."), nom.title() if nom.isupper() else nom, date


def lignes_de_texte(page: pymupdf.Page) -> list[str]:
    """Texte de la page ligne par ligne (morceaux de même hauteur réunis de gauche à droite)."""
    morceaux = sorted(spans(page), key=lambda m: ((m[0].y0 + m[0].y1) / 2, m[0].x0))
    lignes: list[list[tuple[float, str]]] = []
    for rect, _taille, t in morceaux:
        y = (rect.y0 + rect.y1) / 2
        if lignes and abs(lignes[-1][0][0] - y) < 4:
            lignes[-1].append((y, t))
        else:
            lignes.append([(y, t)])
    return [" ".join(" ".join(t for _, t in ligne).split()) for ligne in lignes]


def artisans(page: pymupdf.Page) -> list[tuple[str, str, str | None, str | None]]:
    """« Menuisier : Atelier (Ville) : 06 … » -> (métier, nom, ville, téléphone)."""
    out = []
    for ligne in lignes_de_texte(page):
        morceaux = [m.strip() for m in ligne.split(":") if m.strip()]
        if len(morceaux) < 2:
            continue
        metier, reste = morceaux[0], morceaux[1:]
        tel = next((m for m in reste if re.fullmatch(r"[\d .]{10,}", m)), None)
        nom = " ".join(m for m in reste if m != tel)
        ville = re.search(r"\(([^)]+)\)", nom)
        out.append((metier, re.sub(r"\s*\([^)]*\)", "", nom).strip(), ville.group(1).strip() if ville else None, tel))
    return out


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("pdf", type=Path)
    p.add_argument("dossier", type=Path, help="dossier contenant mdeko.sqlite")
    args = p.parse_args()

    doc = pymupdf.open(args.pdf)
    img = Images(doc, args.dossier)
    base = Base(args.dossier / "mdeko.sqlite", img)
    db = base.db
    infos = couverture(doc[0])

    section = ""
    besoins: dict[str, list[Article]] = {}
    rendus: list[tuple[int, int | None, str]] = []  # (image, vignette, section)
    teintes = []
    pros = []
    for numero, page in enumerate(doc):
        if infos and numero in (0, doc.page_count - 1):
            continue  # couverture et 4e de couverture : leur grand logo n'est pas un titre de section
        textes = spans(page)
        titres = [t for _, taille, t in textes if taille >= TAILLE_TITRE_SECTION]
        if titres:
            section = " ".join(" ".join(titres).split())
            continue
        colonnes = colonnes_du_tableau(page)
        bandes = lignes_du_tableau(page) if colonnes else []
        lus = lire_tableau(page, section, colonnes, bandes, textes) if bandes else []
        if lus and sum(1 for a in lus if a.url or a.images) * 2 >= len(lus):
            for a in lus:
                besoins.setdefault(regles.categorie(section, a.nom)[1], []).append(a)
            continue
        # 2. page des artisans (« Métier : Nom (Ville) : téléphone »), avant la lecture des teintes
        if infos and any(":" in t and re.search(r"\d{2} \d{2} \d{2}", t) for _, _, t in textes):
            pros += artisans(page)
            continue
        if regles.cle(section) == regles.SECTION_COULEURS:
            teintes += lire_teintes(page, textes, img)
            continue
        if not infos:
            continue
        # Page de rendu : la plus grande image ; une autre image (hors cartouche m·deko) devient la vignette.
        images = sorted(page.get_images(full=True), key=lambda i: -i[2] * i[3])
        if images and images[0][2] >= TAILLE_RENDU and regles.cle(section) in ("", "modifications"):
            principale = img.extraire(images[0][0])
            autres = [i for i in images[1:] if not (i[2] >= 4 * i[3])]  # le cartouche est très allongé
            vignette = img.extraire(autres[0][0]) if autres else None
            if principale:
                rendus.append((base.image(principale), base.image(vignette) if vignette else None,
                               "changes" if regles.cle(section) == "modifications" else "plans"))

    articles_par_section = {s: [base.article(a) for a in lignes] for s, lignes in besoins.items()}

    if infos:
        civilite, nom, date = infos
        projet = base.un(
            "INSERT INTO projects (client_title, client_name, book_date) VALUES (?, ?, ?) RETURNING id",
            civilite or None, nom, date,
        )
        envies = "\n\n".join(paragraphes(doc[3])) if doc.page_count > 3 else ""
        m = re.search(r"s[’']appliquerait sur votre ([^.]+)\.", envies)
        if m:
            pieces = [x.strip() for x in re.split(r",| et ", m.group(1)) if x.strip()]
            for rang, piece in enumerate(pieces):
                db.execute("INSERT INTO rooms (project_id, name, sort) VALUES (?, ?, ?)", (projet, piece.capitalize(), rang))
        if envies:
            db.execute("UPDATE projects SET wishes_text = ? WHERE id = ?", (envies, projet))
        for rang, (image, vignette, sect) in enumerate(rendus):
            db.execute("INSERT INTO renders (project_id, image_id, inset_image_id, section, sort) VALUES (?, ?, ?, ?, ?)",
                       (projet, image, vignette, sect, rang))
        for rang, (sect, ids) in enumerate(articles_par_section.items()):
            uniques = list(dict.fromkeys(ids))
            if not uniques:
                continue
            besoin = base.un("INSERT INTO needs (project_id, category_id, label, sort) SELECT ?, category_id, ?, ? FROM articles WHERE id = ? RETURNING id",
                             projet, sect, rang, uniques[0])
            db.execute("INSERT INTO need_articles (need_id, article_id, role) VALUES (?, ?, 'choice')", (besoin, uniques[0]))
            for k, aid in enumerate(uniques[1:]):
                db.execute("INSERT INTO need_articles (need_id, article_id, role, sort) VALUES (?, ?, 'alternative', ?)", (besoin, aid, k))
        vues = set()
        for rang, t in enumerate(teintes):
            if (t.marque, regles.cle(t.nom)) in vues:
                continue
            vues.add((t.marque, regles.cle(t.nom)))
            marque = base.un("SELECT id FROM paint_brands WHERE name = ?", t.marque) or base.un(
                "INSERT INTO paint_brands (name, promo_code) VALUES (?, ?) RETURNING id", t.marque, t.code_promo)
            teinte = base.un("SELECT id FROM paints WHERE brand_id = ? AND name = ? COLLATE NOCASE", marque, t.nom) or base.un(
                "INSERT INTO paints (brand_id, name, reference, hex) VALUES (?, ?, ?, ?) RETURNING id", marque, t.nom, t.reference, t.hex)
            db.execute("INSERT OR IGNORE INTO project_paints (project_id, paint_id, sort) VALUES (?, ?, ?)", (projet, teinte, rang))
        for rang, (metier, nom_pro, ville, tel) in enumerate(pros):
            pro = base.un("SELECT id FROM artisans WHERE name = ? COLLATE NOCASE", nom_pro) or base.un(
                "INSERT INTO artisans (trade, name, city, phone) VALUES (?, ?, ?, ?) RETURNING id", metier, nom_pro, ville, tel)
            db.execute("INSERT OR IGNORE INTO project_artisans (project_id, artisan_id, sort) VALUES (?, ?, ?)", (projet, pro, rang))
        print(f"Projet créé : {civilite} {nom} ({date}) — {len(rendus)} rendus, {len(articles_par_section)} besoins, "
              f"{len(vues)} teintes, {len(pros)} artisans")
    db.commit()
    print(f"Shopping list : {base.ajoutes} articles ajoutés, {base.reutilises} déjà présents")


if __name__ == "__main__":
    main()
