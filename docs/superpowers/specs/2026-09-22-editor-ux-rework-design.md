# Refonte UX de l'éditeur EkwaSlice — Design

Date : 2026-09-22
Statut : validé en brainstorming, en attente de relecture avant plan d'implémentation.

## Objectif

Rendre le panneau éditeur d'EkwaSlice intuitif, clair et agréable (UX/UI), en
suivant les maquettes de `ressources/Maquette Editeur/` :
- `ekwaslice-maquette-ux.html` — inspecteur clair, contexte élément, onglets
  d'états, groupes en lignes compactes.
- `ekwaslice-color-picker.html` + `ekwaslice-color-picker-prompt.md` — champ
  couleur compact ouvrant un popover sombre avec recherche.

## Principe fondateur : DEUX chartes distinctes (ne jamais confondre)

| | Charte **UX application** (design d'EkwaSlice) | Charte **Composant** (slices générées, contenu du canvas) |
|---|---|---|
| Thème | **LIGHT**, mono-thème, pas de dark activable | **DARK** (comme le site Ekwateur) |
| Police | **Carnero** | Gothic A1 (corps), Carnero (titres) |
| Accent | **Jaune `#ffc969`** | Turquoise `#17E7D0` |
| Majuscules | jamais d'uppercase | jamais d'uppercase |

Le canvas affiche du dark car c'est le rendu des composants. Tout le chrome de
l'app (header, panneaux, éditeur, chat) suit la charte UX → light. Le popover du
color-picker est sombre : c'est un choix local du picker, pas le thème global.

État actuel du code (drift) : le chrome est encore en `bg-slate-900`/`slate-800`.
Le rework repeint l'éditeur + son voisinage immédiat en light. Repeindre TOUT
le chrome app est un lot séparable (hors scope initial, à confirmer plus tard).

## Décisions actées (brainstorming)

1. Thème éditeur = **light** (charte UX). Pas de toggle dark.
2. Onglets d'états **hover/focus/active** = inclus **maintenant** (Lot 4).
3. Sections = **lignes compactes qui déplient** (maquette), remplacent le
   mode-focus accordéon.
4. Palette color-picker = **12 familles** (charte complète) + recherche.
5. Fil d'ariane **cliquable**, les 4 flèches de nav sont **supprimées**.
6. Source de vérité couleurs = `FULL_PALETTE` (charte `--primitivecolors-*`),
   pas les hex approximatifs des maquettes.

## Découpage en lots (ordre d'implémentation)

| Lot | Contenu | Nature |
|---|---|---|
| 1. Coque light + inspecteur | Repeindre éditeur en light ; header contexte élément ; onglets d'états (UI seule) ; groupes APPARENCE/MISE EN PAGE/AVANCÉ en lignes compactes | Visuel, aucun changement du modèle de style |
| 2. Color-picker | Champ compact → popover sombre, 12 familles + recherche + HEX/Appliquer | Auto-contenu |
| 3. Nouveaux contrôles | Ombre, Disposition (flex), Gap, Min/Max, Alignement | Ajouts inline classiques |
| 4. Moteur d'états | hover/focus/active réellement éditables | Architectural |

Chaque lot est vérifié (app relancée + round-trip) avant le suivant. Les onglets
d'états existent visuellement dès le Lot 1 mais ne deviennent fonctionnels qu'au
Lot 4 (Normal seul fonctionne d'ici là).

## Lot 1 — Coque light + structure inspecteur

Cible remplacée : `#editor-panel` (index.html:374) et sa nav (`#editor-nav`).

**Tokens light (charte UX app)** :
- Fond app `#eef2f6` · panneaux `#ffffff` · texte principal `#132527` (ink) ·
  texte atténué gris moyen · bordures fines `#e5e7eb`.
- Accent jaune `#ffc969` : onglet/section actif, focus ring, CTA. Aucun turquoise
  dans l'UX (sauf popover couleur).
- Police Carnero partout (déjà amorcée dans le `<style>` global). Rayons modérés,
  ombres rares.

**Header contexte élément** (remplace `#editor-nav`) :
- Icône du type + nom lisible (`Widget`/`Titre`/`Bouton`/…) + meta
  `Container · <div>` + fil `Page › Section › Widget`.
- Fil cliquable : chaque miette sélectionne l'ancêtre correspondant. Les boutons
  flèches prev/parent/child/next sont supprimés.

**Onglets d'états** : Normal / Hover / Focus / Active. Au Lot 1 : Normal actif,
les autres cliquables mais sans effet (branchés au Lot 4).

**Groupes → lignes compactes** (remplacent `accSection`, index.html:1191) :

| Groupe | Lignes |
|---|---|
| (contextuel) | Contenu (texte affiché — si l'élément porte du texte, ex-`jscomp`) |
| APPARENCE | Texte (couleur, taille, police, alignement, gras/ital) · Fond (couleur+opacité) · Bordure (style, épaisseur+link, couleur, rayon+link) · Ombre |
| MISE EN PAGE | Disposition · Dimensions (L/H/min/max) · Espacement (marge croix + padding croix) |
| AVANCÉ | CSS personnalisé · Pictogrammes |

**Composant ligne** : ligne = icône + label + pastille (si valeur définie sur
l'état courant) + chevron ; déplie un `.detail` de `.control` (label gauche /
champ droite). Multi-ouvrables, état d'ouverture persisté en localStorage.
`applyContextualSections` (index.html:1276) adapté pour montrer/masquer les
lignes selon le type d'élément.

Ombre/Disposition/Gap/Min-Max : lignes présentes au Lot 1, contrôles ajoutés au
Lot 3.

## Lot 2 — Color-picker

Remplace `_colorRow` (palette toujours ouverte, index.html:1205).

**Fermé** (dans la ligne de contrôle) : `[carré couleur] [#hex éditable] [chevron]`.
Pour le fond uniquement, un `%` opacité à côté (l'opacité n'est pas dans le
popover). Réutilise le fix d'opacité existant (regex rgba stricte 4 composantes).

**Popover** (sombre `#0d2020`, ancré au champ, ferme sur clic-dehors / Échap /
Appliquer) :
- Recherche en haut : filtre instantané par nom de famille, numéro de nuance, ou
  hex (sous-chaîne).
- 12 familles en tuiles (nuance + label), ✓ sur la sélectionnée. Données =
  `FULL_PALETTE` (charte). Noms de familles en blanc, labels de nuance atténués.
- Bas : saisie HEX `#RRGGBB` validée + bouton Appliquer.
- Accent d'interaction (anneau/✓) = turquoise, cohérent avec la surface sombre.

Un seul popover réutilisé, repositionné sous le champ actif. Trois usages :
texte, fond, bordure.

## Lot 3 — Nouveaux contrôles

Tous en style inline sur l'état courant (compatibles Lot 4 via la couche
d'application) :
- **Alignement** texte : `text-align`.
- **Ombre** : préréglages `box-shadow` (aucune / douce / moyenne / forte) +
  option custom via CSS avancé.
- **Disposition** : `display` (block / flex). Si flex → direction, justify,
  align, **gap**.
- **Dimensions** : ajout `min-width`/`max-width`/`min-height`/`max-height` aux
  L/H existants.

## Lot 4 — Moteur d'états (architectural)

**Modèle** — Approche A : store en attribut `data-ekw-states` (JSON) sur
l'élément.
- Normal reste inline (`el.style`) — aucune régression.
- hover/focus/active vont dans `data-ekw-states='{"hover":{"prop":"val"},…}'`.
- Chaque élément portant ≥1 règle d'état reçoit un id stable `data-eid` (assigné
  à la volée à la 1re règle).

**Couche d'application** : `setStyle`/apply deviennent indirects.
- état courant = normal → écrit `el.style` (comme aujourd'hui).
- sinon → écrit dans `data-ekw-states[state]` puis régénère le `<style>` live.

**Aperçu live** : un `<style id="ekw-live-states">` unique dans le canvas,
régénéré à chaque edit → règles `#canvas [data-eid="x"]:hover{…}` etc. Onglet
non-Normal actif → l'élément **sélectionné seul** reçoit `.ekw-force-<state>`
(mêmes props sans la pseudo-classe) pour visualiser sans interaction réelle ;
retour Normal retire le force. Indice visuel "aperçu Hover forcé".

**Sérialisation gratuite** : le store étant un attribut DOM, il transporte
d'office via outerHTML → save (index.html:1851), undo/redo (snapshots outerHTML),
copie A→B. Aucun code d'intégration supplémentaire sur ces chemins.

**Export** (`exportPlain`, index.html:2888) : pour chaque élément avec
`data-ekw-states`, émettre les règles scopées `.uid [data-eid="x"]:hover { … }`
dans le canal `css` (mêmes buckets/scope que l'existant), en passant les props
par `fixFonts`. Puis supprimer `data-eid` et `data-ekw-states` du HTML exporté
(ajout à la liste de nettoyage ligne 2896). Normal continue de sortir en inline.

**Import** : le parseur CSS (flux `flattenCssToInline`, index.html:2760) route
les règles à pseudo-classe (`:hover/:focus/:active`) vers `data-ekw-states` au
lieu de les aplatir en inline (impossible pour une pseudo). Règles pseudo sur des
sélecteurs non mappables → ignorées (comme les classes inconnues aujourd'hui).

## Gestion des erreurs

- Hex invalide (≠ `#RRGGBB`) → rejet, conserve la valeur précédente.
- eid manquant à l'ajout d'une 1re règle d'état → assigné à la volée.
- Règles pseudo non mappables à l'import → ignorées silencieusement.
- Export strippe systématiquement `data-eid`/`data-ekw-states` → zéro fuite dans
  la slice publiée.
- Undo d'un changement d'état = restauration outerHTML (déjà couvert).
- MAJ Prismic / sauvegarde userData : inchangés ; les attributs d'état survivent
  en sauvegarde (attribut DOM) et sont retirés à l'export/publication.

## Tests / vérification

Pas de framework de test automatisé dans le projet. Vérification par lot :
1. App relancée (`pkill -f "electron ." ; npm start`) — inspection visuelle.
2. Snapshots navigateur (maquettes de référence rendues).
3. Round-trip export/import (Lot 4) : le CSS exporté contient les règles
   `:hover/:focus/:active` attendues ; le réimport recrée `data-ekw-states`
   identique.
4. Non-régression : save/charge d'une slice, undo/redo, copie d'élément,
   MAJ Prismic — les états sont préservés en save et absents à l'export.

## Contraintes de sécurité (rappel, restent en vigueur)

- Aucune clé API embarquée dans l'app distribuée.
- Tokens Prismic (lecture/écriture) uniquement dans userData `settings.json`,
  jamais embarqués.
- Ne jamais publier dans Prismic par programme (publication manuelle, onglet
  Migration Releases).
- Ne pas lire `ressources/charte-graphique.html` en entier — grep uniquement.
- MAJ ne doit jamais supprimer le dossier des slices sauvegardées (userData).

## Hors scope (à confirmer plus tard)

- Repeindre TOUT le chrome de l'app en light (au-delà de l'éditeur + voisinage).
- Signature Apple (process séparé, en attente).
- Feature bibliothèque partagée (cloud) — en pause.
