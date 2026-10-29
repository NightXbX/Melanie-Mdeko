"""Récupère sur internet la photo des articles qui n'en ont pas mais qui ont un lien.

    python completer_photos.py <dossier de données> [--limite 10]

Pour chaque article : ouverture de la page du produit, lecture de l'image annoncée par le site
(og:image, twitter:image ou données produit), téléchargement, puis ajout comme photo principale.
Les liens morts (404) sont marqués « gone ». Une requête à la fois, avec une courte pause.
Les sites qui bloquent les accès automatiques ne sont pas contournés : ils sont listés dans
photos-non-recuperees.txt.
"""
from __future__ import annotations

import argparse
import collections
import html
import io
import json
import re
import sqlite3
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urljoin

from PIL import Image

sys.path.insert(0, str(Path(__file__).resolve().parent))
from extraire_shopping_list import Images  # noqa: E402

# On se présente honnêtement : un site qui refuse les accès automatiques est simplement passé
# (la photo s'ajoute alors à la main en la glissant depuis le site sur le formulaire de l'article).
ENTETES = {
    "User-Agent": "Mdeko/0.1 (recuperation de la photo d'un produit de la shopping list)",
    "Accept": "text/html,application/xhtml+xml,image/avif,image/webp,image/*,*/*;q=0.8",
    "Accept-Language": "fr-FR,fr;q=0.9",
}
FORMATS = {"JPEG": "jpg", "PNG": "png", "WEBP": "webp", "GIF": "gif", "AVIF": "avif"}
MAX_PAGE, MAX_IMAGE = 3_000_000, 20_000_000
PAUSE = 0.8


def telecharger(url: str, maximum: int) -> tuple[bytes, str]:
    req = urllib.request.Request(url, headers=ENTETES)
    with urllib.request.urlopen(req, timeout=20) as r:
        return r.read(maximum), r.headers.get("Content-Type", "")


def image_de_la_page(page: str, base: str) -> str | None:
    """Image principale annoncée par la page produit."""
    motifs = [
        r'<meta[^>]+(?:property|name)=["\']og:image(?::secure_url)?["\'][^>]+content=["\']([^"\']+)',
        r'<meta[^>]+content=["\']([^"\']+)["\'][^>]+(?:property|name)=["\']og:image["\']',
        r'<meta[^>]+name=["\']twitter:image["\'][^>]+content=["\']([^"\']+)',
        r'<link[^>]+rel=["\']image_src["\'][^>]+href=["\']([^"\']+)',
    ]
    for motif in motifs:
        m = re.search(motif, page, re.IGNORECASE)
        if m:
            return urljoin(base, html.unescape(m.group(1).strip()))
    # Données produit (JSON-LD) : "image": "…" ou ["…"] ou {"url": "…"}
    for bloc in re.findall(r'<script[^>]+application/ld\+json[^>]*>(.*?)</script>', page, re.IGNORECASE | re.DOTALL):
        try:
            donnees = json.loads(bloc)
        except ValueError:
            continue
        for objet in donnees if isinstance(donnees, list) else [donnees, *donnees.get("@graph", [])]:
            image = objet.get("image") if isinstance(objet, dict) else None
            if isinstance(image, list):
                image = image[0] if image else None
            if isinstance(image, dict):
                image = image.get("url")
            if isinstance(image, str):
                return urljoin(base, image)
    return None


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("dossier", type=Path)
    p.add_argument("--limite", type=int)
    args = p.parse_args()

    db = sqlite3.connect(args.dossier / "mdeko.sqlite")
    img = Images(None, args.dossier)
    articles = db.execute(
        """SELECT a.id, a.name, a.url FROM articles a
           WHERE a.deleted_at IS NULL AND a.url IS NOT NULL
             AND NOT EXISTS (SELECT 1 FROM article_images ai WHERE ai.article_id = a.id)
           ORDER BY a.id"""
    ).fetchall()
    if args.limite:
        articles = articles[: args.limite]
    print(f"{len(articles)} articles sans photo avec un lien")

    bilan = collections.Counter()
    echecs = []
    for n, (article_id, nom, url) in enumerate(articles, 1):
        try:
            page, _ = telecharger(url, MAX_PAGE)
            source = image_de_la_page(page.decode("utf-8", "replace"), url)
            if not source:
                raise LookupError("pas d'image annoncée sur la page")
            time.sleep(PAUSE)
            donnees, _ = telecharger(source, MAX_IMAGE)
            with Image.open(io.BytesIO(donnees)) as im:
                ext = FORMATS.get(im.format or "")
            if not ext:
                raise LookupError("format d'image non pris en charge")
            res = img.enregistrer(donnees, ext, "articles")
            image_id = db.execute("SELECT id FROM images WHERE sha256 = ?", (res["sha"],)).fetchone()
            if image_id is None:
                image_id = db.execute(
                    "INSERT INTO images (rel_path, width, height, sha256, phash) VALUES (?, ?, ?, ?, ?) RETURNING id",
                    (res["rel"], res["w"], res["h"], res["sha"], res["dhash"]),
                ).fetchone()
            db.execute("INSERT OR IGNORE INTO article_images (article_id, image_id, sort) VALUES (?, ?, 0)",
                       (article_id, image_id[0]))
            db.execute("UPDATE articles SET link_status = 'ok', link_checked_at = datetime('now') WHERE id = ?", (article_id,))
            db.commit()
            bilan["photo ajoutée"] += 1
        except urllib.error.HTTPError as e:
            if e.code in (404, 410):
                db.execute("UPDATE articles SET link_status = 'gone', link_checked_at = datetime('now') WHERE id = ?", (article_id,))
                db.commit()
                bilan["lien mort"] += 1
            else:
                bilan[f"site bloqué ({e.code})"] += 1
            echecs.append((nom, url, f"HTTP {e.code}"))
        except Exception as e:  # réseau, page sans image, image illisible : on passe au suivant
            bilan["photo introuvable"] += 1
            echecs.append((nom, url, str(e)[:80]))
        if n % 10 == 0:
            print(f"{n}/{len(articles)} : {dict(bilan)}", flush=True)
        time.sleep(PAUSE)

    print(json.dumps(dict(bilan), ensure_ascii=False, indent=2))
    (args.dossier / "photos-non-recuperees.txt").write_text(
        "\n".join(f"{nom} | {raison} | {url}" for nom, url, raison in echecs), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
