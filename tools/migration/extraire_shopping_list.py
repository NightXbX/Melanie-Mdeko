"""Migre l'ancienne shopping list (PDF) vers un dossier de données neuf de l'appli.

    python extraire_shopping_list.py "<shopping list>.pdf" <dossier_sortie> [--pages 1-200]

Le dossier de sortie doit être vide ou inexistant. On y trouve ensuite mdeko.sqlite, images/
et rapport-migration.html (cas à vérifier). Rien n'est jamais supprimé de l'ancien PDF.
"""
from __future__ import annotations

import argparse
import base64
import collections
import hashlib
import html
import io
import json
import re
import sqlite3
import sys
from bisect import bisect_right
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

import pymupdf
from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
import regles  # noqa: E402

RACINE_DEPOT = Path(__file__).resolve().parents[2]
MIGRATIONS = RACINE_DEPOT / "src" / "main" / "db" / "migrations"

# Tableau type : 5 colonnes photo | nom | prix | lien | fournisseur, d'environ 136 pt chacune.
LARGEUR_COLONNE, LARGEUR_MIN, LARGEUR_MAX = 136, 110, 160
TAILLE_TITRE_SECTION = 40
DPI_INSPIRATIONS = 150


@dataclass
class Article:
    page: int
    section: str
    nom: str
    prix: regles.Prix
    url: str | None
    fournisseur_brut: str
    images: list[int] = field(default_factory=list)  # xrefs, la principale en premier
    doublon_de: "Article | None" = None


@dataclass
class Inspiration:
    page: int
    section: str
    liens: list[str]


@dataclass
class Teinte:
    page: int
    marque: str
    nom: str
    reference: str | None
    hex: str | None
    code_promo: str | None


# --- Lecture des pages ---------------------------------------------------------------------------

PIED_DE_PAGE = re.compile(r"^(Design Book|[–-]?\s*Page\s+\d+)\s*$", re.IGNORECASE)


def spans(page: pymupdf.Page) -> list[tuple[pymupdf.Rect, float, str]]:
    out = []
    for bloc in page.get_text("dict")["blocks"]:
        for ligne in bloc.get("lines", []):
            for s in ligne["spans"]:
                t = s["text"].strip()
                if t and not PIED_DE_PAGE.match(t):
                    out.append((pymupdf.Rect(s["bbox"]), s["size"], s["text"]))
    return out


def colonnes_du_tableau(page: pymupdf.Page) -> list[float] | None:
    """Bords gauches des 5 colonnes : 5 cases de même largeur côte à côte (un plan coté n'a pas ce motif).
    Le tableau n'est pas toujours au même endroit de la page selon les copier-coller."""
    xs = set()
    for d in page.get_drawings():
        for it in d["items"]:
            if it[0] == "l" and abs(it[1].x - it[2].x) < 1 and abs(it[2].y - it[1].y) > 50:
                xs.add(round(it[1].x, 1))
            elif it[0] == "re" and it[1].height > 50:
                xs.update((round(it[1].x0, 1), round(it[1].x1, 1)))
    for depart in sorted(xs):
        bords = [depart]
        while len(bords) < 6:
            suivants = [x for x in xs if LARGEUR_MIN <= x - bords[-1] <= LARGEUR_MAX]
            if not suivants:
                break
            bords.append(min(suivants, key=lambda x: abs(x - bords[-1] - LARGEUR_COLONNE)))
        if len(bords) == 6:
            return bords[:5]
    return None


def lignes_du_tableau(page: pymupdf.Page) -> list[tuple[float, float]]:
    """Bandes horizontales du tableau, déduites des traits qui le traversent entièrement."""
    couverture: dict[int, float] = collections.defaultdict(float)
    for d in page.get_drawings():
        for it in d["items"]:
            if it[0] == "l" and abs(it[1].y - it[2].y) < 1:
                couverture[round(it[1].y)] += abs(it[2].x - it[1].x)
            elif it[0] in ("re", "qu"):
                r = it[1] if it[0] == "re" else it[1].rect
                if r.width > 50:
                    couverture[round(r.y0)] += r.width
                    couverture[round(r.y1)] += r.width
    ys = sorted(y for y, c in couverture.items() if c > 600 and 15 < y < 580)
    fusion: list[int] = []
    for y in ys:
        if not fusion or y - fusion[-1] > 4:
            fusion.append(y)
    return list(zip(fusion, fusion[1:]))


def colonne(x: float, colonnes: list[float]) -> int:
    return max(0, bisect_right(colonnes, x) - 1)


def texte_cellule(morceaux: list[tuple[pymupdf.Rect, str]], colle: bool = False) -> str:
    """Texte d'une cellule dans l'ordre de lecture ; `colle` pour les liens coupés en plusieurs lignes."""
    ordre = sorted(morceaux, key=lambda m: (round(m[0].y0), m[0].x0))
    if colle:
        return "".join(t.strip() for _, t in ordre)
    return " ".join(" ".join(t.split()) for _, t in ordre).strip()


def lire_tableau(page: pymupdf.Page, section: str, colonnes: list[float], bandes, textes) -> list[Article]:
    images = page.get_image_info(xrefs=True)
    liens = [l for l in page.get_links() if l.get("uri")]
    articles = []
    for haut, bas in bandes:
        def dans(r: pymupdf.Rect) -> bool:
            return haut <= (r.y0 + r.y1) / 2 < bas

        cellules: dict[int, list] = collections.defaultdict(list)
        for rect, _taille, t in textes:
            if dans(rect):
                cellules[colonne((rect.x0 + rect.x1) / 2, colonnes)].append((rect, t))
        photos = [
            i for i in images
            if i["xref"] and dans(pymupdf.Rect(i["bbox"]))
            and colonne((i["bbox"][0] + i["bbox"][2]) / 2, colonnes) == 0
        ]
        photos.sort(key=lambda i: -(i["bbox"][2] - i["bbox"][0]) * (i["bbox"][3] - i["bbox"][1]))
        uris = collections.Counter(l["uri"] for l in liens if dans(l["from"]))

        nom = texte_cellule(cellules[1])
        prix_brut = texte_cellule(cellules[2])
        url = uris.most_common(1)[0][0] if uris else None
        if not url:
            brut = texte_cellule(cellules[3], colle=True)
            url = brut if brut.startswith("http") else None
        if not (nom or prix_brut or photos):
            continue
        articles.append(Article(
            page=page.number + 1,
            section=section,
            nom=nom,
            prix=regles.prix(prix_brut),
            url=url,
            fournisseur_brut=texte_cellule(cellules[4]),
            images=list(dict.fromkeys(i["xref"] for i in photos)),
        ))
    return articles


LIBELLES_EXCLUS = re.compile(r"code\s*promo|https?:|/\s*rouleau", re.IGNORECASE)


def lire_teintes(page: pymupdf.Page, textes, img: Images) -> list[Teinte]:
    """Pastilles de couleur (disques dessinés ou carrés photo) et leur nom écrit juste à droite."""
    tout = " ".join(t for _, _, t in textes)
    contenu = regles.cle(tout)
    promo = re.search(r"code\s*promo\s*:\s*(\S+)", tout, re.IGNORECASE)
    if "farrow" in contenu or "forrow" in contenu:
        marque = "Farrow & Ball"
    elif promo or "bilboquet" in contenu:
        # Le logo Bilbo Quet Deco est une image ; son code promo pro, lui, est écrit sur la page.
        marque = "Bilbo Quet Deco"
    else:
        marque = "Autre"

    pastilles: list[tuple[pymupdf.Rect, str | None]] = []
    for d in page.get_drawings():
        r, couleur = d["rect"], d.get("fill")
        if couleur and 25 < r.width < 120 and abs(r.width - r.height) <= 4:
            pastilles.append((r, "#" + "".join(f"{round(c * 255):02X}" for c in couleur[:3])))
    for info in page.get_image_info(xrefs=True):
        r = pymupdf.Rect(info["bbox"])
        if info["xref"] and 30 < r.width < 160 and 0.7 < r.width / max(r.height, 1) < 1.4:
            pastilles.append((r, img.couleur_moyenne(info["xref"])))

    teintes = []
    for r, hexa in pastilles:
        cy = (r.y0 + r.y1) / 2
        voisins = sorted(
            (rect.x0 - r.x1, rect.y0, t) for rect, taille, t in textes
            if rect.x0 >= r.x1 - 2 and rect.x0 - r.x1 < 160 and taille < 20
            and abs((rect.y0 + rect.y1) / 2 - cy) < r.height / 2 + 12
        )
        if not voisins:
            continue
        # Le nom peut tenir sur deux lignes alignées sur le même bord gauche.
        ecart_min = voisins[0][0]
        lignes = sorted((y, t) for ecart, y, t in voisins if ecart - ecart_min < 30)
        libelle = " ".join(t.strip() for _, t in lignes)
        if not libelle.strip() or LIBELLES_EXCLUS.search(libelle):
            continue
        nom, reference = regles.nom_teinte(libelle)
        est_ral = nom.upper().startswith("RAL")
        teintes.append(Teinte(page.number + 1, "RAL" if est_ral else marque, nom, reference, hexa,
                              promo.group(1) if promo and not est_ral else None))
    return teintes


# --- Images ---------------------------------------------------------------------------------------

class Images:
    """Extrait chaque image une seule fois, dédoublonnée par contenu."""

    def __init__(self, doc: pymupdf.Document, racine: Path):
        self.doc, self.racine = doc, racine
        self.par_xref: dict[int, dict | None] = {}
        self.par_sha: dict[str, dict] = {}

    def extraire(self, xref: int) -> dict | None:
        if xref in self.par_xref:
            return self.par_xref[xref]
        try:
            info = self.doc.extract_image(xref)
            smask = info.get("smask") or 0
            donnees, ext = info["image"], info["ext"]
            if smask or info.get("colorspace", 3) >= 4 or ext not in ("jpeg", "jpg", "png"):
                pix = pymupdf.Pixmap(self.doc, xref)
                if pix.n - pix.alpha >= 4:
                    pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                if smask:
                    pix = pymupdf.Pixmap(pix, pymupdf.Pixmap(self.doc, smask))
                donnees, ext = pix.tobytes("png"), "png"
            ext = "jpg" if ext == "jpeg" else ext
            res = self.enregistrer(donnees, ext, "articles")
        except Exception as e:  # image illisible : on garde l'article sans photo
            print(f"  image {xref} ignorée : {e}", file=sys.stderr)
            res = None
        self.par_xref[xref] = res
        return res

    def couleur_moyenne(self, xref: int) -> str | None:
        res = self.extraire(xref)
        if not res:
            return None
        with Image.open(self.racine / res["rel"]) as im:
            r, g, b = im.convert("RGB").resize((1, 1), Image.Resampling.BOX).getpixel((0, 0))
        return f"#{r:02X}{g:02X}{b:02X}"

    def enregistrer(self, donnees: bytes, ext: str, dossier: str) -> dict:
        sha = hashlib.sha256(donnees).hexdigest()
        if sha in self.par_sha:
            return self.par_sha[sha]
        rel = f"images/{dossier}/{sha[:2]}/{sha}.{ext}"
        chemin = self.racine / rel
        chemin.parent.mkdir(parents=True, exist_ok=True)
        chemin.write_bytes(donnees)
        with Image.open(io.BytesIO(donnees)) as im:
            largeur, hauteur = im.size
            dhash = empreinte(im)
        res = {"rel": rel, "sha": sha, "w": largeur, "h": hauteur, "dhash": dhash}
        self.par_sha[sha] = res
        return res


def empreinte(im: Image.Image) -> str:
    """Empreinte visuelle (dHash 64 bits) : deux photos identiques réencodées restent proches."""
    petit = im.convert("L").resize((9, 8), Image.Resampling.LANCZOS)
    px = petit.tobytes()
    bits = sum(1 << i for i in range(64) if px[(i // 8) * 9 + i % 8] > px[(i // 8) * 9 + i % 8 + 1])
    return f"{bits:016x}"


def distance(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


# --- Doublons -------------------------------------------------------------------------------------

def marquer_doublons(articles: list[Article], img: Images) -> list[tuple[Article, Article]]:
    """Fusionne les doublons certains ; renvoie les paires « même photo, liens différents » à vérifier."""
    def photo(a: Article) -> str | None:
        for x in a.images:
            r = img.extraire(x)
            if r:
                return r["dhash"]
        return None

    vus_lien: dict[str, list[Article]] = collections.defaultdict(list)
    vus_nom: dict[tuple[str, str], Article] = {}
    for a in articles:
        p, lien = photo(a), regles.lien_propre(a.url)
        if lien:
            for autre in vus_lien[lien]:
                po = photo(autre)
                if (p is None and po is None) or (p and po and distance(p, po) <= 6):
                    a.doublon_de = autre
                    break
            if not a.doublon_de:
                vus_lien[lien].append(a)
        elif p:
            k = (regles.cle(a.nom), p)
            if k in vus_nom:
                a.doublon_de = vus_nom[k]
            else:
                vus_nom[k] = a

    a_verifier = []
    par_photo: dict[str, Article] = {}
    for a in articles:
        p = photo(a)
        if a.doublon_de or not p:
            continue
        for q, autre in par_photo.items():
            if distance(p, q) <= 4 and regles.lien_propre(autre.url) != regles.lien_propre(a.url):
                a_verifier.append((autre, a))
                break
        else:
            par_photo[p] = a
    return a_verifier


# --- Écriture de la base --------------------------------------------------------------------------

def creer_base(chemin: Path) -> sqlite3.Connection:
    db = sqlite3.connect(chemin)
    db.execute("PRAGMA foreign_keys = ON")
    version = 0
    for f in sorted(MIGRATIONS.glob("*.sql")):
        db.executescript(f.read_text(encoding="utf-8"))
        version = int(f.name.split("_")[0])
    db.execute(f"PRAGMA user_version = {version}")
    return db


def ecrire(db: sqlite3.Connection, articles, inspirations, teintes, img: Images, doc, racine: Path) -> dict:
    familles = dict(db.execute("SELECT name, id FROM families"))
    categories: dict[tuple[str, str], int] = {}

    def categorie_id(famille: str, sous: str) -> int:
        if (famille, sous) not in categories:
            cur = db.execute("INSERT INTO categories (family_id, name) VALUES (?, ?)", (familles[famille], sous))
            categories[(famille, sous)] = cur.lastrowid
        return categories[(famille, sous)]

    # Fournisseur : nom normalisé, sinon déduit du site (fournisseur le plus fréquent pour ce domaine).
    par_domaine: dict[str, collections.Counter] = collections.defaultdict(collections.Counter)
    for a in articles:
        f, d = regles.fournisseur(a.fournisseur_brut), regles.domaine(a.url)
        if f and d:
            par_domaine[d][f] += 1
    fournisseurs: dict[str, int] = {}

    def fournisseur_id(a: Article) -> int | None:
        nom = regles.fournisseur(a.fournisseur_brut)
        d = regles.domaine(a.url)
        if not nom and d in par_domaine:
            nom = par_domaine[d].most_common(1)[0][0]
        if not nom:
            return None
        if nom not in fournisseurs:
            dom = next((dd for dd, c in par_domaine.items() if c.most_common(1)[0][0] == nom), None)
            cur = db.execute("INSERT INTO suppliers (name, domain) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET name = name RETURNING id", (nom, dom))
            fournisseurs[nom] = cur.fetchone()[0]
        return fournisseurs[nom]

    images_ids: dict[str, int] = {}

    def image_id(res: dict) -> int:
        if res["sha"] not in images_ids:
            cur = db.execute(
                "INSERT INTO images (rel_path, width, height, sha256, phash) VALUES (?, ?, ?, ?, ?)",
                (res["rel"], res["w"], res["h"], res["sha"], res["dhash"]),
            )
            images_ids[res["sha"]] = cur.lastrowid
        return images_ids[res["sha"]]

    nb = 0
    for a in articles:
        if a.doublon_de:
            continue
        famille, sous = regles.categorie(a.section, a.nom)
        cur = db.execute(
            """INSERT INTO articles (name, category_id, supplier_id, price_cents, price_kind, price_text,
                 url, url_clean, dimensions, color_material, source_page)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                a.nom or "Sans nom", categorie_id(famille, sous), fournisseur_id(a), a.prix.centimes,
                a.prix.nature, a.prix.texte or None, a.url, regles.lien_propre(a.url),
                regles.dimensions(a.nom), regles.couleurs_matieres(a.nom), a.page,
            ),
        )
        for rang, xref in enumerate(a.images):
            res = img.extraire(xref)
            if res:
                db.execute("INSERT OR IGNORE INTO article_images (article_id, image_id, sort) VALUES (?, ?, ?)",
                           (cur.lastrowid, image_id(res), rang))
        nb += 1

    for insp in inspirations:
        famille, sous = regles.categorie(insp.section, "")
        pix = doc[insp.page - 1].get_pixmap(dpi=DPI_INSPIRATIONS)
        tampon = io.BytesIO()
        Image.frombytes("RGB", (pix.width, pix.height), pix.samples).save(tampon, "JPEG", quality=82)
        res = img.enregistrer(tampon.getvalue(), "jpg", "inspirations")
        note = "\n".join(insp.liens[1:]) or None
        cur = db.execute(
            "INSERT INTO inspirations (title, note, category_id, url, source_page) VALUES (?, ?, ?, ?, ?)",
            (" ".join(insp.section.split()).capitalize(), note,
             categorie_id(famille, sous) if regles.cle(insp.section) in regles.SECTIONS else None,
             insp.liens[0] if insp.liens else None, insp.page),
        )
        db.execute("INSERT INTO inspiration_images (inspiration_id, image_id) VALUES (?, ?)", (cur.lastrowid, image_id(res)))

    marques: dict[str, int] = {}
    vues = set()
    for t in teintes:
        if (t.marque, regles.cle(t.nom)) in vues:
            continue
        vues.add((t.marque, regles.cle(t.nom)))
        if t.marque not in marques:
            marques[t.marque] = db.execute(
                "INSERT INTO paint_brands (name, promo_code) VALUES (?, ?) RETURNING id", (t.marque, t.code_promo)
            ).fetchone()[0]
        db.execute("INSERT INTO paints (brand_id, name, reference, hex) VALUES (?, ?, ?, ?)",
                   (marques[t.marque], t.nom, t.reference, t.hex))

    bilan = {
        "date": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "articles": nb,
        "doublons_fusionnes": sum(1 for a in articles if a.doublon_de),
        "inspirations": len(inspirations),
        "teintes": len(vues),
        "fournisseurs": len(fournisseurs),
        "images": len(images_ids),
    }
    db.execute("INSERT INTO settings (key, value) VALUES ('migration_shopping_list', ?)", (json.dumps(bilan),))
    db.commit()
    return bilan


# --- Rapport --------------------------------------------------------------------------------------

def rapport(chemin: Path, articles, a_verifier, inspirations, teintes, bilan, img: Images) -> None:
    miniatures: dict[str, str] = {}

    def miniature(res: dict) -> str:
        """Miniature intégrée au fichier (data URI) : le rapport s'affiche partout, même copié ailleurs."""
        if res["sha"] not in miniatures:
            with Image.open(img.racine / res["rel"]) as im:
                im = im.convert("RGBA")
                im.thumbnail((340, 260))
                fond = Image.new("RGB", im.size, "white")
                fond.paste(im, mask=im.split()[3])
                tampon = io.BytesIO()
                fond.save(tampon, "JPEG", quality=70)
            miniatures[res["sha"]] = "data:image/jpeg;base64," + base64.b64encode(tampon.getvalue()).decode()
        return miniatures[res["sha"]]

    def vignette(a: Article) -> str:
        res = next((img.extraire(x) for x in a.images if img.extraire(x)), None)
        visuel = f'<img src="{miniature(res)}" loading="lazy">' if res else '<div class=vide>Pas de photo</div>'
        return (f'<figure>{visuel}<figcaption>{html.escape(a.nom)}<br>'
                f'{html.escape(a.prix.texte)} · {html.escape(a.fournisseur_brut)}</figcaption></figure>')

    def section(titre: str, lignes: list[str]) -> str:
        return f"<h2>{html.escape(titre)} ({len(lignes)})</h2><div class=grille>{''.join(lignes)}</div>"

    gardes = [a for a in articles if not a.doublon_de]
    fusions = [a for a in articles if a.doublon_de]
    par_cat = collections.Counter(regles.categorie(a.section, a.nom) for a in gardes)
    tableau_cat = "".join(f"<tr><td>{html.escape(f)}</td><td>{html.escape(s)}</td><td>{n}</td></tr>"
                          for (f, s), n in sorted(par_cat.items()))
    par_f = collections.Counter(regles.fournisseur(a.fournisseur_brut) or "—" for a in gardes)
    tableau_f = "".join(f"<tr><td>{html.escape(f)}</td><td>{n}</td></tr>" for f, n in par_f.most_common())
    prix_douteux = [a for a in gardes if a.prix.nature == "unknown"]
    sans_lien = [a for a in gardes if not a.url]
    sans_photo = [a for a in gardes if not a.images]

    corps = f"""<!doctype html><meta charset=utf-8><title>Rapport de migration</title>
<style>body{{font:14px -apple-system,Segoe UI,sans-serif;margin:24px;color:#222}}
.grille{{display:flex;flex-wrap:wrap;gap:10px}}figure{{width:170px;margin:0;font-size:11px}}
figure img,.vide{{width:170px;height:130px;object-fit:contain;background:#f4f4f4}}
.vide{{display:flex;align-items:center;justify-content:center;color:#999}}
.paire{{display:flex;gap:10px;padding:8px;border:1px solid #ddd;border-radius:8px}}
table{{border-collapse:collapse}}td{{padding:2px 10px;border-bottom:1px solid #eee}}</style>
<h1>Rapport de migration de la shopping list</h1>
<pre>{html.escape(json.dumps(bilan, ensure_ascii=False, indent=2))}</pre>
<h2>Articles par catégorie</h2><table>{tableau_cat}</table>
<h2>Fournisseurs</h2><table>{tableau_f}</table>
<h2>Doublons fusionnés : seul le premier est gardé ({len(fusions)})</h2>
<div class=grille>{''.join(f'<div class=paire>{vignette(a.doublon_de)}{vignette(a)}</div>' for a in fusions)}</div>
<h2>Même photo, liens différents : à vérifier ({len(a_verifier)})</h2>
<div class=grille>{''.join(f'<div class=paire>{vignette(x)}{vignette(y)}</div>' for x, y in a_verifier)}</div>
{section("Prix non reconnu", [vignette(a) for a in prix_douteux])}
{section("Sans lien", [vignette(a) for a in sans_lien])}
{section("Sans photo", [vignette(a) for a in sans_photo])}
<h2>Teintes ({len(teintes)})</h2><p>{''.join(f'<span style="display:inline-block;margin:4px;padding:4px 8px;border-left:24px solid {t.hex or "#fff"}">{html.escape(t.marque)} · {html.escape(t.nom)} {html.escape(t.reference or "")}</span>' for t in teintes)}</p>
<h2>Inspirations ({len(inspirations)})</h2>
"""
    chemin.write_text(corps, encoding="utf-8")


# --- Programme principal --------------------------------------------------------------------------

def plage(texte: str | None, total: int) -> range:
    if not texte:
        return range(1, total + 1)
    debut, _, fin = texte.partition("-")
    return range(int(debut), int(fin or debut) + 1)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("pdf", type=Path)
    p.add_argument("sortie", type=Path)
    p.add_argument("--pages", help="ex. 1-200 (pour un essai rapide)")
    args = p.parse_args()

    if args.sortie.exists() and any(args.sortie.iterdir()):
        sys.exit(f"Le dossier {args.sortie} n'est pas vide : choisissez un dossier neuf.")
    args.sortie.mkdir(parents=True, exist_ok=True)

    doc = pymupdf.open(args.pdf)
    img = Images(doc, args.sortie)
    articles: list[Article] = []
    inspirations: list[Inspiration] = []
    teintes: list[Teinte] = []
    section = ""

    for numero in plage(args.pages, doc.page_count):
        page = doc[numero - 1]
        textes = spans(page)
        titres = [t for _, taille, t in textes if taille >= TAILLE_TITRE_SECTION]
        if titres:
            section = " ".join(" ".join(titres).split())
            continue
        colonnes = colonnes_du_tableau(page)
        bandes = lignes_du_tableau(page) if colonnes else []
        lus = lire_tableau(page, section, colonnes, bandes, textes) if bandes else []
        # Un plan coté peut ressembler à une grille : un vrai tableau d'articles a des liens ou des photos.
        if sum(1 for a in lus if a.url or a.images) * 2 < len(lus):
            lus = []
        if regles.cle(section) == regles.SECTION_COULEURS:
            teintes += lire_teintes(page, textes, img)
        if lus:
            articles += lus
        else:
            liens = list(dict.fromkeys(l["uri"] for l in page.get_links() if l.get("uri")))
            inspirations.append(Inspiration(numero, section or "Shopping list", liens))
        if numero % 100 == 0:
            print(f"page {numero}/{doc.page_count} : {len(articles)} articles", flush=True)

    a_verifier = marquer_doublons(articles, img)
    db = creer_base(args.sortie / "mdeko.sqlite")
    bilan = ecrire(db, articles, inspirations, teintes, img, doc, args.sortie)
    db.close()
    rapport(args.sortie / "rapport-migration.html", articles, a_verifier, inspirations, teintes, bilan, img)
    print(json.dumps(bilan, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
