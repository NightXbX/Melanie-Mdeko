"""Règles de migration de l'ancienne shopping list : catégories, fournisseurs, prix, dimensions, liens.

Fonctions pures, testées dans test_regles.py. C'est ici qu'on ajuste le tri des articles.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit


def sans_accents(texte: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texte) if unicodedata.category(c) != "Mn")


def cle(texte: str) -> str:
    """Clé de comparaison : minuscules, sans accents ni ponctuation."""
    return re.sub(r"[^a-z0-9]", "", sans_accents(texte).lower())


# --- Familles et sous-catégories ---------------------------------------------------------------

FAMILLES = [
    "Assises",
    "Tables & bureaux",
    "Rangements",
    "Chambre",
    "Luminaires",
    "Textiles",
    "Décoration",
    "Murs & sols",
    "Salle de bain",
    "Cuisine & électroménager",
    "Extérieur",
]

# Section du PDF -> (famille, sous-catégorie). Une sous-catégorie None = tri au cas par cas par le nom.
SECTIONS: dict[str, tuple[str, str | None]] = {
    "comptoir": ("Tables & bureaux", "Comptoirs"),
    "vestiares": ("Rangements", "Vestiaires & patères"),
    "portemanteau": ("Rangements", "Vestiaires & patères"),
    "pateres": ("Rangements", "Vestiaires & patères"),
    "cloisonamovible": ("Murs & sols", "Cloisons & claustras"),
    "cloisonsamovibles": ("Murs & sols", "Cloisons & claustras"),
    "claustra": ("Murs & sols", "Cloisons & claustras"),
    "consoles": ("Tables & bureaux", "Consoles"),
    "poufs": ("Assises", "Poufs"),
    "fauteuils": ("Assises", "Fauteuils"),
    "canapes": ("Assises", "Canapés"),
    "coussinsplaid": ("Textiles", None),
    "plaids": ("Textiles", "Plaids"),
    "cadres": ("Décoration", "Cadres"),
    "tableaux": ("Décoration", "Tableaux & affiches"),
    "tablesbasses": ("Tables & bureaux", "Tables basses & d'appoint"),
    "paniers": ("Décoration", "Paniers"),
    "meubletv": ("Rangements", "Meubles TV"),
    "meublespetitdejeuner": ("Cuisine & électroménager", "Meubles petit-déjeuner"),
    "tapis": ("Textiles", "Tapis"),
    "tableschaises": ("Tables & bureaux", None),
    "chaises": ("Assises", "Chaises"),
    "chaisesdebureau": ("Assises", "Chaises de bureau"),
    "buffets": ("Rangements", "Buffets & vaisseliers"),
    "vaisseliers": ("Rangements", "Buffets & vaisseliers"),
    "banc": ("Assises", "Bancs"),
    "tabourets": ("Assises", "Tabourets"),
    "miroirs": ("Décoration", "Miroirs"),
    "bibliotheque": ("Rangements", "Bibliothèques & étagères"),
    "colonnes": ("Rangements", "Bibliothèques & étagères"),
    "etageres": ("Rangements", "Bibliothèques & étagères"),
    "meublewhisky": ("Rangements", "Bars & meubles d'appoint"),
    "buanderie": ("Rangements", "Buanderie"),
    "rangements": ("Rangements", "Rangements divers"),
    "chemineeethanol": ("Décoration", "Cheminées"),
    "luminaires": ("Luminaires", None),
    "arbresachat": ("Décoration", "Divers"),
    "decorations": ("Décoration", "Objets déco"),
    "bureau": ("Tables & bureaux", "Bureaux"),
    "tabledechevet": ("Chambre", "Chevets"),
    "literie": ("Chambre", None),
    "dressing": ("Rangements", "Dressings"),
    "commodes": ("Rangements", "Commodes"),
    "meubledesalledebain": ("Salle de bain", "Meubles de salle de bain"),
    "baignoire": ("Salle de bain", "Baignoires"),
    "rideauxstores": ("Textiles", "Rideaux & stores"),
    "panneaumural": ("Murs & sols", "Panneaux muraux"),
    "moulures": ("Murs & sols", "Moulures & lambris"),
    "lambris": ("Murs & sols", "Moulures & lambris"),
    "moquette": ("Murs & sols", "Moquettes"),
    "carrelage": ("Murs & sols", "Carrelages"),
    "electromenager": ("Cuisine & électroménager", "Électroménager"),
    "meubledejardin": ("Extérieur", "Mobilier de jardin"),
    "cuisineexterieure": ("Extérieur", "Cuisines extérieures"),
    "gloriette": ("Extérieur", "Pergolas & gloriettes"),
    "plantes": ("Décoration", "Plantes"),
    "divers": ("Décoration", "Divers"),
    "potsdefleurs": ("Décoration", "Pots & cache-pots"),
    "decoetageres": ("Décoration", "Objets déco"),
    "gym": ("Décoration", "Divers"),
    "papierspeints": ("Murs & sols", "Papiers peints"),
    "lamesadhesives": ("Murs & sols", "Parquets & sols"),
    "betons": ("Murs & sols", "Enduits & bétons"),
    "portes": ("Murs & sols", "Portes"),
    "poignees": ("Murs & sols", "Poignées"),
}

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

FOURNISSEURS: dict[str, str] = {
    "laredoute": "La Redoute",
    "maisondumonde": "Maisons du Monde",
    "maisonsdumonde": "Maisons du Monde",
    "ikea": "IKEA",
    "sklum": "Sklum",
    "leroymerlin": "Leroy Merlin",
    "westwing": "Westwing",
    "westwingnow": "Westwing",
    "kavehome": "Kave Home",
    "bobochic": "Bobochic",
    "bobochicparis": "Bobochic",
    "tikamoon": "Tikamoon",
    "loberon": "Loberon",
    "bolia": "Bolia",
    "boconcept": "BoConcept",
    "made": "Made.com",
    "madecom": "Made.com",
    "rugvista": "RugVista",
    "atmosphera": "Atmosphera",
    "alinea": "Alinea",
    "lescarreauxdejean": "Les Carreaux de Jean",
    "carreauxdejean": "Les Carreaux de Jean",
    "zarahome": "Zara Home",
    "hm": "H&M",
    "hmhome": "H&M",
    "camif": "Camif",
    "crack": "Crack",
    "ampm": "AM.PM",
    "castorama": "Castorama",
    "conforama": "Conforama",
    "boulanger": "Boulanger",
    "etsy": "Etsy",
    "maisonjanette": "Maison Janette",
    "janette": "Maison Janette",
    "isidoreleroy": "Isidore Leroy",
    "porcelanosa": "Porcelanosa",
    "gautier": "Gautier",
    "lignroset": "Ligne Roset",
    "ligneroset": "Ligne Roset",
    "storesdiscount": "Stores-Discount",
    "quickstep": "Quick-Step",
    "bonnuit": "Bonnuit",
    "cdiscount": "Cdiscount",
    "amazon": "Amazon",
    "retif": "Rétif",
    "madeinmeubles": "Made in Meubles",
    "questioncommerce": "Question Commerce",
    "4pieds": "4 Pieds",
    "plumliving": "Plum Living",
    "artphotolimited": "Art Photo Limited",
    "octavemaison": "Octave Maison",
    "maisondemonde": "Maisons du Monde",
    "psstore": "PS Store",
    "amazone": "Amazon",
    "nvgallery": "NV Gallery",
    "nvgalerie": "NV Gallery",
    "drawers": "Drawer",
    "etoffecom": "Etoffe",
    "etoffcom": "Etoffe",
    "plum": "Plum Living",
    "sweeek": "Sweeek",
    "decovrac": "Déco Vrac",
    "decovracnieppe": "Déco Vrac",
    "chateudax": "Château d'Ax",
    "chateaudax": "Château d'Ax",
    "gammvert": "Gamm Vert",
    "but": "BUT",
    "lightonline": "Lightonline",
}


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

_SUIVI = {
    "gclid", "gbraid", "wbraid", "fbclid", "msclkid", "dclid", "gad_source", "gad_campaignid",
    "_gl", "srsltid", "cmpid", "queryid", "shoppingtool", "searchkeyword", "kclkid", "kvsid",
    "cod", "kard", "at_medium", "at_source", "at_campaign", "at_placement", "at_market",
    "at_section", "megaboost", "gqt", "id_c", "docid",
}


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


_MATIERES = [
    "bois", "chêne", "noyer", "teck", "acacia", "manguier", "hêtre", "pin", "frêne", "bambou",
    "rotin", "osier", "jonc", "jute", "sisal", "raphia", "lin", "coton", "laine", "velours",
    "bouclette", "cuir", "métal", "acier", "laiton", "fer forgé", "aluminium", "marbre",
    "travertin", "terrazzo", "pierre", "béton", "céramique", "terre cuite", "verre", "tissu",
    "blanc", "noir", "gris", "beige", "écru", "crème", "sable", "naturel", "terracotta",
    "rouille", "ocre", "jaune", "moutarde", "vert", "sauge", "kaki", "bleu", "rose", "rouge",
    "bordeaux", "marron", "taupe", "doré", "cuivre", "argenté",
]


def couleurs_matieres(nom: str) -> str | None:
    n = " " + sans_accents(nom).lower() + " "
    trouvees = [m for m in _MATIERES if re.search(rf"\b{sans_accents(m)}s?\b", n)]
    return ", ".join(trouvees) or None
