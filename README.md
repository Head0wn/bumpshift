# BUMPSHIFT

**Dérape. Frappe. Termine premier.**

BUMPSHIFT est un jeu de kart 3D multijoueur conçu pour le navigateur. Le projet vise une conduite arcade précise, des courses en ligne à 12 pilotes et un univers entièrement original.

## Premier jalon

Cette branche pose une tranche verticale volontairement jouable :

- circuit 3D procédural ;
- kart arcade avec accélération, freinage, marche arrière et collisions de piste ;
- dérapage chargé avec trois niveaux de mini-turbo ;
- caméra dynamique, HUD et commandes clavier/tactiles ;
- salons multijoueurs Colyseus ;
- simulation autoritaire à 60 Hz ;
- prédiction locale, acquittement des entrées et interpolation des adversaires.

## Démarrer

Prérequis : Node.js 22 ou supérieur.

```bash
npm install
npm run dev
```

Ouvrir ensuite `http://localhost:5173`. Pour tester le multijoueur, ouvrir une seconde fenêtre ou un autre appareil sur le même réseau.

## Commandes

| Action | Clavier |
|---|---|
| Accélérer | `Z`, `W` ou `↑` |
| Freiner / marche arrière | `S` ou `↓` |
| Tourner | `Q`, `A`, `D` ou `←` `→` |
| Déraper | `Espace` ou `Maj` |

Les commandes tactiles apparaissent automatiquement sur les écrans compatibles.

## Structure

```text
apps/client      rendu 3D, entrées, prédiction et interface
apps/server      salons, simulation autoritaire et synchronisation
packages/shared  protocole, circuit et simulation déterministe
```

Consulter [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) pour les décisions réseau.

