"""python -m unittest discover tools/migration"""
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import regles  # noqa: E402


class Prix(unittest.TestCase):
    def test_formats(self):
        cas = {
            "249,99": (24999, "fixed"),
            "1 449": (144900, "fixed"),
            "1.449": (144900, "fixed"),
            "19.90": (1990, "fixed"),
            "à partir de 19,90": (1990, "from"),
            "27,90/m2": (2790, "per_m2"),
            "27,90 le m²": (2790, "per_m2"),
            "89/rouleau": (8900, "per_roll"),
            "sur devis": (None, "on_quote"),
            "voir tarif magasin": (None, "on_quote"),
            "": (None, "unknown"),
            "no": (None, "unknown"),
        }
        for texte, attendu in cas.items():
            p = regles.prix(texte)
            self.assertEqual((p.centimes, p.nature), attendu, texte)


class Dimensions(unittest.TestCase):
    def test_extraction(self):
        self.assertEqual(regles.dimensions("Besta banc tv 180x42x38cm"), "180 × 42 × 38cm")
        self.assertEqual(regles.dimensions("Table basse marbre et bois diam. 85 cm"), "Ø 85 cm")
        self.assertEqual(regles.dimensions("Tapis 200 x 300"), "200 × 300")
        self.assertIsNone(regles.dimensions("Fauteuil bouclette"))

    def test_matieres(self):
        self.assertEqual(regles.couleurs_matieres("Table basse marbre et bois"), "bois, marbre")
        self.assertEqual(regles.couleurs_matieres("Applique, métal noir"), "métal, noir")
        self.assertIsNone(regles.couleurs_matieres("Pinceau"))


class Liens(unittest.TestCase):
    def test_suivi_retire(self):
        self.assertEqual(
            regles.lien_propre("https://www.sklum.com/fr/x.html?id_c=508856&utm_source=g&gclid=abc"),
            "https://www.sklum.com/fr/x.html",
        )
        self.assertEqual(
            regles.lien_propre("https://www.laredoute.fr/ppdp/prod-1.aspx#searchkeyword=pouf&shoppingtool=search"),
            "https://www.laredoute.fr/ppdp/prod-1.aspx",
        )

    def test_variante_gardee(self):
        self.assertEqual(
            regles.lien_propre("https://bobochicparis.com/fr/lit.html?utm_source=x#/7-couleur-beige"),
            "https://bobochicparis.com/fr/lit.html#/7-couleur-beige",
        )
        self.assertEqual(
            regles.lien_propre("https://bonnuit-matelas.fr/products/lit?variant=43077388435624"),
            "https://bonnuit-matelas.fr/products/lit?variant=43077388435624",
        )

    def test_invalide(self):
        self.assertIsNone(regles.lien_propre("www.ikea.com/fr"))
        self.assertIsNone(regles.lien_propre(None))


class Fournisseurs(unittest.TestCase):
    def test_variantes_unifiees(self):
        for brut in ("Ikea", "IKEA", " ikea "):
            self.assertEqual(regles.fournisseur(brut), "IKEA")
        self.assertEqual(regles.fournisseur("MAISON DU MONDE"), "Maisons du Monde")
        self.assertEqual(regles.fournisseur("La redoute"), "La Redoute")
        self.assertEqual(regles.fournisseur("Atmosphèra"), "Atmosphera")
        self.assertEqual(regles.fournisseur("SOMEWHERE NEW"), "Somewhere New")
        self.assertIsNone(regles.fournisseur("  "))


class Teintes(unittest.TestCase):
    def test_nom_et_reference(self):
        self.assertEqual(regles.nom_teinte("ALL WHITE N ° 2005 FORROW&BALL"), ("All white", "N° 2005"))
        self.assertEqual(regles.nom_teinte("SCHOOL HOUSE 291 FORROW&BALL"), ("School house", "N° 291"))
        self.assertEqual(regles.nom_teinte("SAUTE DANS LES FLAQUES"), ("Saute dans les flaques", None))
        self.assertEqual(regles.nom_teinte("RAL7021"), ("RAL 7021", None))


class Categories(unittest.TestCase):
    def test_section_directe(self):
        self.assertEqual(regles.categorie("FAUTEUILS", "Fauteuil Ulit"), ("Assises", "Fauteuils"))
        self.assertEqual(regles.categorie("ÉTAGÈRES", "Étagère murale"), ("Rangements", "Bibliothèques & étagères"))

    def test_tri_par_nom(self):
        self.assertEqual(regles.categorie("TABLES & CHAISES", "Chaise Visby"), ("Assises", "Chaises"))
        self.assertEqual(regles.categorie("TABLES & CHAISES", "Table à manger"), ("Tables & bureaux", "Tables à manger"))
        self.assertEqual(regles.categorie("LUMINAIRES", "Suspension grappe"), ("Luminaires", "Suspensions"))
        self.assertEqual(regles.categorie("LITERIE", "Le matelas en latex"), ("Chambre", "Matelas & sommiers"))
        self.assertEqual(regles.categorie("LITERIE", "Tête de lit"), ("Chambre", "Têtes de lit"))
        self.assertEqual(regles.categorie("COUSSINS - PLAID", "Plaid blanc cassé"), ("Textiles", "Plaids"))

    def test_section_inconnue(self):
        self.assertEqual(regles.categorie("NOUVEAUTÉ", "Truc"), ("Décoration", "Divers"))


if __name__ == "__main__":
    unittest.main()
