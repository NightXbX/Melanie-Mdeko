"""Règles de migration de l'ancienne shopping list : catégories, fournisseurs, prix, dimensions, liens.

Fonctions pures, testées dans test_regles.py. C'est ici qu'on ajuste le tri des articles.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
import unicodedata
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


# Listes communes avec l'appli (sections, fournisseurs, matières…).
_REGLES = json.loads((Path(__file__).resolve().parents[2] / "src" / "shared" / "import-rules.json").read_text(encoding="utf-8"))


def sans_accents(texte: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texte) if unicodedata.category(c) != "Mn")


def cle(texte: str) -> str:
    """Clé de comparaison : minuscules, sans accents ni ponctuation."""
    return re.sub(r"[^a-z0-9]", "", sans_accents(texte).lower())


# --- Familles et sous-catégories ---------------------------------------------------------------

FAMILLES = _REGLES["familles"]

# Section du PDF -> (famille, sous-catégorie). Une sous-catégorie None = tri au cas par cas par le nom.
SECTIONS: dict[str, tuple[str, str | None]] = {k: tuple(v) for k, v in _REGLES["sections"].items()}

SECTION_COULEURS = "couleurs"
SECTION_DEBUT = "shoppinglist"


def _contient(nom: str, *mots: str) -> bool:
    n = " " + sans_accents(nom).lower() + " "
    return any(re.search(rf"\b{m}", n) for m in mots)


def categorie(section: str, nom: str) -> tuple[str, str]:
    """Famille et sous-catégorie d'un article, d'après sa section dans le PDF et son nom."""
    famille, sous = SECTIONS.get(cle(section), ("Décoration", "Divers"))
    if sous is not None:
        return famille, sous
    s = cle(section)
    if s == "coussinsplaid":
        return ("Textiles", "Plaids") if _contient(nom, "plaid") else ("Textiles", "Coussins")
    if s == "tableschaises":
        if _contient(nom, "chaise", "fauteuil"):
            return "Assises", "Chaises"
        if _contient(nom, "banc", "banquette"):
            return "Assises", "Bancs"
        if _contient(nom, "tabouret"):
            return "Assises", "Tabourets"
        return "Tables & bureaux", "Tables à manger"
    if s == "luminaires":
        if _contient(nom, "suspension", "plafonnier", "lustre"):
            return "Luminaires", "Suspensions"
        if _contient(nom, "lampadaire"):
            return "Luminaires", "Lampadaires"
        if _contient(nom, "applique"):
            return "Luminaires", "Appliques"
        if _contient(nom, "spot", "rail"):
            return "Luminaires", "Spots"
        if _contient(nom, "lampe", "baladeuse"):
            return "Luminaires", "Lampes"
        return "Luminaires", "Luminaires divers"
    if s == "literie":
        if _contient(nom, "matelas", "sommier", "surmatelas"):
            return "Chambre", "Matelas & sommiers"
        if _contient(nom, "tete de lit"):
            return "Chambre", "Têtes de lit"
        if _contient(nom, "linge", "housse", "couette", "drap", "oreiller", "parure"):
            return "Textiles", "Linge de lit"
        return "Chambre", "Lits"
    return famille, "Divers"


# --- Fournisseurs ------------------------------------------------------------------------------

FOURNISSEURS: dict[str, str] = _REGLES["fournisseurs"]


def fournisseur(brut: str) -> str | None:
    """Nom de fournisseur normalisé (casse et variantes unifiées)."""
    texte = " ".join(brut.split())
    if not texte:
        return None
    return FOURNISSEURS.get(cle(texte), texte if not texte.isupper() else texte.title())


def domaine(url: str | None) -> str | None:
    if not url:
        return None
    hote = urlsplit(url).hostname or ""
    return re.sub(r"^(www\d?|fr)\.", "", hote.lower()) or None


# --- Liens -------------------------------------------------------------------------------------

_SUIVI = set(_REGLES["suivi"])


def lien_propre(url: str | None) -> str | None:
    """Lien sans paramètres de suivi publicitaire (les paramètres de variante sont gardés)."""
    if not url:
        return None
    parts = urlsplit(url.strip())
    if parts.scheme not in ("http", "https"):
        return None
    query = [
        (k, v) for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if not k.lower().startswith("utm_") and k.lower() not in _SUIVI
    ]
    # Les ancres « #/… » désignent une variante (couleur, taille) ; les autres sont du suivi.
    fragment = parts.fragment if parts.fragment.startswith("/") else ""
    hote = (parts.hostname or "").lower()
    return urlunsplit(("https", hote, parts.path, urlencode(query), fragment))


# --- Prix --------------------------------------------------------------------------------------

@dataclass
class Prix:
    centimes: int | None
    nature: str  # fixed | from | per_m2 | per_roll | on_quote | unknown
    texte: str


_NOMBRE = re.compile(r"(\d[\d\s  .]*(?:[,.]\d{1,2})?)")


def prix(brut: str) -> Prix:
    texte = " ".join(brut.split())
    t = sans_accents(texte).lower()
    if not texte:
        return Prix(None, "unknown", texte)
    if "devis" in t or "magasin" in t:
        return Prix(None, "on_quote", texte)
    m = _NOMBRE.search(t)
    if not m:
        return Prix(None, "unknown", texte)
    nombre = re.sub(r"[\s  ]", "", m.group(1))
    # « 1.449 » ou « 1 449 » = milliers ; « 19,90 » ou « 19.90 » = décimales.
    if re.fullmatch(r"\d{1,3}(\.\d{3})+", nombre):
        nombre = nombre.replace(".", "")
    nombre = nombre.replace(",", ".")
    try:
        centimes = round(float(nombre) * 100)
    except ValueError:
        return Prix(None, "unknown", texte)
    if re.search(r"/\s*m\s*[2²]|le\s*m\s*[2²]|\bm2\b|m²", t):
        nature = "per_m2"
    elif "rouleau" in t:
        nature = "per_roll"
    elif "partir" in t or "des " in t:
        nature = "from"
    else:
        nature = "fixed"
    return Prix(centimes, nature, texte)


# --- Teintes -----------------------------------------------------------------------------------

def nom_teinte(libelle: str) -> tuple[str, str | None]:
    """« ALL WHITE N° 2005 FORROW&BALL » -> (« All white », « N° 2005 »)."""
    t = " ".join(re.sub(r"f[ao]rrow\s*&?\s*ball", " ", libelle, flags=re.IGNORECASE).split())
    ral = re.fullmatch(r"RAL\s*(\d{4})", t, re.IGNORECASE)
    if ral:
        return f"RAL {ral.group(1)}", None
    reference = None
    m = re.search(r"(?:\bN\s*°?\s*)?\b(\d{1,4})$", t)
    if m:
        reference, t = f"N° {m.group(1)}", t[: m.start()].strip()
    t = re.sub(r"\s+N\s*°?$", "", t).strip()
    return (t.capitalize() if t.isupper() else t), reference


# --- Dimensions, matières, couleurs ------------------------------------------------------------

_DIM = re.compile(
    r"(?:\b(?:diam(?:etre)?\.?|ø)\s*\d+(?:[.,]\d+)?\s*(?:cm|mm)?)"
    r"|(?:\b\d+(?:[.,]\d+)?\s*[x×]\s*\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?)?\s*(?:cm|mm|m)?\b)"
    r"|(?:\b[lhp]\.?\s*\d+(?:[.,]\d+)?\s*cm\b)"
    r"|(?:\b\d+(?:[.,]\d+)?\s*cm\b)",
    re.IGNORECASE,
)


def dimensions(nom: str) -> str | None:
    trouvees = []
    for m in _DIM.finditer(sans_accents(nom)):
        d = re.sub(r"\s*[x×]\s*", " × ", m.group(0).strip(), flags=re.IGNORECASE)
        d = re.sub(r"^(diam(?:etre)?\.?|ø)\s*", "Ø ", d, flags=re.IGNORECASE)
        if d not in trouvees:
            trouvees.append(d)
    return " · ".join(trouvees) or None


_MATIERES = _REGLES["matieres"]


def couleurs_matieres(nom: str) -> str | None:
    n = " " + sans_accents(nom).lower() + " "
    trouvees = [m for m in _MATIERES if re.search(rf"\b{sans_accents(m)}s?\b", n)]
    return ", ".join(trouvees) or None
