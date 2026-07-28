# BUMPSHIFT

**Dérape. Frappe. Termine premier.**

BUMPSHIFT est un jeu de kart 3D multijoueur conçu pour le navigateur. Le projet vise une conduite arcade précise, des courses en ligne à 12 pilotes et un univers entièrement original.

## État jouable

La branche de développement contient maintenant une boucle de course multijoueur complète :

- vrai menu principal avec sélection du circuit, garage et paramètres persistants ;
- deux circuits 3D procéduraux : Circuit Aurore et Riviera Royale ;
- circuits en relief avec ciel diurne, ombres, murs de soutènement et matériaux procéduraux ;
- décors dédiés (forêt boréale, principauté, port, yachts et tunnel) ;
- cinq karts 3D détaillés avec roues animées, visibles par tous les pilotes ;
- kart arcade avec accélération, freinage et marche arrière ;
- dérapage chargé avec trois niveaux de mini-turbo ;
- caméra dynamique, HUD et commandes clavier, tactiles et manette ;
- navigation complète des menus à la manette et vibrations compatibles ;
- réglages de qualité, mouvement de caméra, vibrations et plein écran ;
- grille multijoueur avec validation « prêt » et compte à rebours synchronisé ;
- checkpoints séquentiels, trois tours, classement et résultats chronométrés ;
- collisions autoritaires entre les karts ;
- salons Colyseus jusqu'à 12 pilotes ;
- simulation autoritaire à 60 Hz ;
- prédiction locale, acquittement des entrées et interpolation des adversaires.

## Démarrer

Prérequis : Node.js 22 ou supérieur.

```bash
npm install
npm run dev
```

Ouvrir ensuite `http://localhost:5173`. Pour tester le multijoueur, ouvrir une seconde fenêtre, rejoindre la même grille puis valider « Je suis prêt » sur chaque client.

## Commandes

| Action | Clavier | Manette standard |
|---|---|---|
| Accélérer | `Z`, `W` ou `↑` | `RT` / `R2` |
| Freiner / marche arrière | `S` ou `↓` | `LT` / `L2` |
| Tourner | `Q`, `A`, `D` ou `←` `→` | Stick gauche / croix |
| Déraper | `Espace` ou `Maj` | `A` / `✕` ou gâchettes hautes |

Les commandes tactiles apparaissent automatiquement sur les écrans compatibles.

## Structure

```text
apps/client      rendu 3D, entrées, prédiction et interface
apps/server      salons, simulation autoritaire et synchronisation
packages/shared  protocole, circuit et simulation déterministe
```

Consulter [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour les décisions réseau.
Les ressources 3D externes et leurs licences sont recensées dans
[THIRD_PARTY_ASSETS.md](THIRD_PARTY_ASSETS.md).
