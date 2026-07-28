# BUMPSHIFT

**Dérape. Frappe. Termine premier.**

BUMPSHIFT est un jeu de kart 3D multijoueur conçu pour le navigateur. Le projet vise une conduite arcade précise, des courses en ligne à 12 pilotes et un univers entièrement original.

## État jouable

La branche de développement contient maintenant une boucle de course multijoueur complète :

- circuit 3D procédural ;
- kart arcade avec accélération, freinage et marche arrière ;
- dérapage chargé avec trois niveaux de mini-turbo ;
- caméra dynamique, HUD et commandes clavier/tactiles ;
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
