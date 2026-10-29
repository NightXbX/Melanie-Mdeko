"""Remplit les réglages de l'appli à partir d'un design book PDF existant de Mélanie.

    python textes_par_defaut.py "<design book>.pdf" <dossier de données>

Lit l'avant-propos (page 3), « Vos envies » (page 4, la liste des pièces devient {pieces}),
« C'est à vous » (avant-dernière page), puis les coordonnées et le QR code « Laisser un avis »
(dernière page). Ces textes restent dans les données de Mélanie, jamais dans le code.
"""
from __future__ import annotations

import argparse
import re
import sqlite3
import sys
from pathlib import Path

import pymupdf

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extraire_shopping_list import PIED_DE_PAGE, Images  # noqa: E402


def paragraphes(page: pymupdf.Page) -> list[str]:
    """Texte de la page en paragraphes, sans le pied de page.
    Chaque ligne du PDF est isolée : un écart vertical nettement plus grand marque un nouveau paragraphe."""
    lignes = []
    for b in page.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            t = " ".join("".join(s["text"] for s in l["spans"]).split())
            if t and not PIED_DE_PAGE.match(t) and not re.match(r"^Design Book\s*[–-]\s*Page\s+\d+$", t):
                lignes.append((l["bbox"][1], t))
    lignes.sort()
    if not lignes:
        return []
    ecarts = sorted(b[0] - a[0] for a, b in zip(lignes, lignes[1:]))
    normal = ecarts[len(ecarts) // 4] if ecarts else 0
    paras = [[lignes[0][1]]]
    for (y_avant, _), (y, t) in zip(lignes, lignes[1:]):
        if y - y_avant > normal * 1.5:
            paras.append([t])
        else:
            paras[-1].append(t)
    return [" ".join(p) for p in paras]


def sans_signature(paras: list[str]) -> str:
    # Le dernier paragraphe court est la signature, ajoutée par l'appli à partir du nom.
    if paras and len(paras[-1].split()) <= 3:
        paras = paras[:-1]
    return "\n\n".join(paras)


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("pdf", type=Path)
    p.add_argument("dossier", type=Path)
    args = p.parse_args()

    doc = pymupdf.open(args.pdf)
    intro = sans_signature(paragraphes(doc[2]))
    envies = "\n\n".join(paragraphes(doc[3]))
    envies = re.sub(r"(s[’']appliquerait sur votre )[^.]+\.", r"\1{pieces}.", envies, count=1)
    fin = sans_signature(paragraphes(doc[-2]))

    # 4e de couverture : nom (le plus gros texte après le logo), adresse, téléphone, e-mail.
    dos = doc[-1]
    spans = [
        (s["size"], s["text"].strip())
        for b in dos.get_text("dict")["blocks"]
        for l in b.get("lines", [])
        for s in l["spans"]
        if s["text"].strip()
    ]
    textes = [t for taille, t in spans if 11 <= taille <= 18 and "avis" not in t.lower()]
    email = next((t for t in textes if "@" in t), "")
    telephone = next((t for t in textes if re.fullmatch(r"[\d .]{10,}", t)), "")
    nom = next((t for taille, t in spans if 16 <= taille <= 18), "")
    adresse = " ".join(t for t in textes if t not in (email, telephone, nom))
    # La signature peut être collée au dernier paragraphe : l'appli l'ajoute elle-même.
    if nom:
        intro = re.sub(rf"\s*{re.escape(nom)}\s*$", "", intro)

    db = sqlite3.connect(args.dossier / "mdeko.sqlite")
    reglages = {
        "designer_name": nom,
        "designer_address": adresse,
        "designer_phone": telephone,
        "designer_email": email,
        "text_intro": intro,
        "text_wishes": envies,
        "text_closing": fin,
    }
    images = dos.get_images(full=True)
    if images:
        img = Images(doc, args.dossier)
        res = img.extraire(max(images, key=lambda i: i[2] * i[3])[0])
        if res:
            ligne = db.execute("SELECT id FROM images WHERE sha256 = ?", (res["sha"],)).fetchone()
            if ligne is None:
                ligne = db.execute(
                    "INSERT INTO images (rel_path, width, height, sha256, phash) VALUES (?, ?, ?, ?, ?) RETURNING id",
                    (res["rel"], res["w"], res["h"], res["sha"], res["dhash"]),
                ).fetchone()
            reglages["review_qr_image_id"] = str(ligne[0])
    for cle, valeur in reglages.items():
        db.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (cle, valeur),
        )
    db.commit()
    for cle, valeur in reglages.items():
        print(f"{cle}: {valeur[:70]!r}")


if __name__ == "__main__":
    main()
