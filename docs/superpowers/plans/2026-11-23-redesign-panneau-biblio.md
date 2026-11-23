# Redesign du panneau Bibliothèque — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre le panneau Bibliothèque (Local / Partagée / Prismic) lisible, cohérent et utilisable : titre de panneau, texte plus grand, cartes unifiées à vignette fidèle, filtre sur les 3 onglets, actions visibles, et noms Prismic propres.

**Architecture:** Trois lots additifs sur le panneau existant. Lot 1 : en-tête de panneau + tailles/contraste (index.html + libellés générés). Lot 2 : un composant de vignette fidèle partagé (iframe Tailwind lazy) réutilisé par les cartes Local/Partagée/Prismic, filtre sur Local/Partagée, actions toujours visibles. Lot 3 : nettoyage du nom de slice Prismic + cadrage de la vignette. AUCUN changement de couleurs ni de mode clair/sombre : on garde le chrome sombre actuel (`bg-slate-900`/`slate-800`).

**Tech Stack:** Electron renderer (ES modules), main.js (CommonJS) pour le nom Prismic, `node --test` + `jsdom`. Zéro nouvelle dépendance.

**Spec:** ce document + la maquette validée dans la conversation (panneau redessiné : titre « Bibliothèque » + compteur, onglet actif net, barre de filtre, cartes unifiées nom 13px + badge auteur + boutons importer/MAJ/renommer/suppr visibles). L'autocritique UX de la conversation en est la liste de défauts corrigés.

## Design (spec)

### Défauts corrigés (de l'autocritique)
- Texte trop petit (10-11px) et contraste faible → ≥12-13px, hints ≥11px, hints en `slate-400`.
- Pas de titre de panneau → en-tête « Bibliothèque » + compteur.
- Cartes incohérentes : Local/Partagée = `libCardShell` (div scalé SANS Tailwind, souvent cassé) ; Prismic = iframe fidèle → unifier sur l'iframe fidèle (lazy).
- Filtre seulement sur Prismic → filtre sur Local et Partagée aussi.
- Actions en `opacity-0 group-hover` (invisibles, non clavier/tactile) → toujours visibles.
- Noms de slices Prismic pollués (ex. `@font-face { font-family:…`) → fallback propre.
- Vignette Prismic rognée (coin haut-gauche) dans le panneau étroit → cadrage plus représentatif.

### Décisions (mes choix, ajustables)
- Couleurs inchangées (chrome sombre actuel) ; on ne touche qu'à structure/tailles/cartes.
- Vignette fidèle = même technique que le navigateur Prismic (`buildThumbDoc` + iframe lazy via IntersectionObserver). Extraite en helper partagé `src/ui/slice-thumb.js` pour Local/Partagée/Prismic.
- Perf : iframes lazy (seules les vignettes visibles chargent), comme déjà fait pour Prismic.
- Branche `feat-redesign-biblio`.

## Global Constraints
- AUCUNE nouvelle dépendance ; ES modules (renderer), CommonJS (main.js).
- NE PAS changer les couleurs du chrome ni introduire de mode clair/sombre.
- Les 3 onglets gardent leur logique (`setLibTab`) et l'autorité store pour l'insertion/import.
- Tests `node --test` ; parties pures (filtre, nettoyage de nom) testées ; vignettes/tailles = vérif visuelle.
- Branche `feat-redesign-biblio` (jamais `main`). Commits finis par `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Review Focus
- En-tête : le compteur reflète le nombre réel d'items de l'onglet courant — pinné Task 1.
- Filtre Local/Partagée : une requête filtre bien la grille, vidage = tout réaffiché — pinné Task 2.
- Vignette fidèle : lazy (pas N iframes d'un coup) ; fallback si pas d'IntersectionObserver — pinné Task 2.
- Actions visibles : importer/publier/MAJ/suppr accessibles sans survol, et le clic n'insère pas en plus de l'action — pinné Task 2.
- Nom Prismic pollué (CSS/@font-face, trop long) → fallback lisible (nom nettoyé ou id) — pinné Task 3.

---

### Task 1: En-tête de panneau + lisibilité (Lot 1)

**Files:**
- Modify: `index.html` (panneau `#library-panel` ~l.465-490 : en-tête titre+compteur ; tailles des onglets/hints)
- Modify: `src/features/library.js` (libellés de carte 11px→13px ; met à jour un compteur `#lib-count`)
- Modify: `src/ui/prismic-browser.js` (libellés de carte/méta 11px→≥12px)
- Test: `test/features/library.test.js` (compteur)

**Interfaces:**
- Produces: `#lib-header` (titre « Bibliothèque ») + `#lib-count` (compteur) dans `index.html` ; `library` met à jour `#lib-count` à chaque rendu de grille et sur `setLibTab`.

- [ ] **Step 1: Write the failing test**

```js
// PAGE : ajouter <span id="lib-count"></span>.
test('le compteur reflete le nombre d items de l onglet courant', async () => {
  const t = setup({ items: [{ id:'c1', name:'A', html:'<p>a</p>' }, { id:'c2', name:'B', html:'<p>b</p>' }] });
  await t.lib.load();
  assert.equal(t.document.getElementById('lib-count').textContent.trim(), '2');
});
```

- [ ] **Step 2: Run to verify fail** — `node --test test/features/library.test.js` → FAIL.

- [ ] **Step 3: Implement**

`index.html` : ajouter au-dessus de la rangée d'onglets un en-tête `#lib-header` (icône + « Bibliothèque » à ~15px + `#lib-count` à droite) ; monter les tailles — onglets `text-xs`→`text-[13px]`, hints/états vides `text-[10px]`→`text-[11px]`, et passer les hints de `slate-500/600` à `slate-400`. `library.js` : libellés de carte `text-[11px]`→`text-[13px]` ; fonction `updateCount()` qui écrit la longueur de la liste de l'onglet courant dans `#lib-count`, appelée dans `renderGrid`/`renderSharedGrid`/`setLibTab`. `prismic-browser.js` : nom de carte `text-[11px]`→`text-[12px]`, date `text-[10px]`→`text-[11px]`.

- [ ] **Step 4: Run to verify pass** — `node --test test/features/library.test.js` → PASS ; `npm test` vert.

- [ ] **Step 5: Commit**

```bash
git add index.html src/features/library.js src/ui/prismic-browser.js test/features/library.test.js
git commit -m "feat(library): en-tete de panneau + compteur + tailles de texte lisibles"
```

---

### Task 2: Cartes unifiées (vignette fidèle), filtre Local/Partagée, actions visibles (Lot 2)

**Files:**
- Create: `src/ui/slice-thumb.js` (helper vignette iframe lazy partagé)
- Modify: `src/features/library.js` (`libCardShell` → vignette fidèle ; filtre Local/Partagée ; actions sans `opacity-0 group-hover`)
- Modify: `index.html` (inputs filtre `#comp-grid-search`, `#shared-grid-search`)
- Modify: `src/ui/prismic-browser.js` (réutiliser `slice-thumb.js` pour DRY)
- Test: `test/ui/slice-thumb.test.js`, `test/features/library.test.js`

**Interfaces:**
- Consumes: `buildThumbDoc` (de `./preview.js`).
- Produces:
  - `mountSliceThumb(container, html, opts?) -> void` : crée une iframe de vignette fidèle (scale cadré) dans `container`, lazy via IntersectionObserver (repli srcdoc direct), pont prix scoping au conteneur.
  - `library` : `renderGrid`/`renderSharedGrid` filtrent par `#comp-grid-search`/`#shared-grid-search`.

- [ ] **Step 1: Write the failing tests**

```js
// slice-thumb : mount cree une iframe avec le html (repli srcdoc en l'absence d'IntersectionObserver).
test('mountSliceThumb cree une iframe de vignette', () => {
  mountSliceThumb(container, '<b>x</b>', { buildThumbDoc: () => '<html>x</html>' });
  assert.equal(container.querySelectorAll('iframe').length, 1);
});
// library : filtre local.
test('renderGrid filtre par #comp-grid-search', async () => {
  const t = setup({ items: [{id:'c1',name:'Hero',html:'<p>a</p>'},{id:'c2',name:'Footer',html:'<p>b</p>'}] });
  await t.lib.load();
  t.document.getElementById('comp-grid-search').value = 'foot';
  t.lib.renderGrid();
  assert.equal(t.document.querySelectorAll('#comp-grid > [data-lib-card]').length, 1);
});
```

- [ ] **Step 2: Run to verify fail** — FAIL (module/éléments absents).

- [ ] **Step 3: Implement**

`slice-thumb.js` : extraire la logique iframe de `prismic-browser.js` (création iframe scalée, `_ekwHtml`, IntersectionObserver lazy + repli, pont prix scoping conteneur) en `mountSliceThumb`. `prismic-browser.js` : utiliser `mountSliceThumb` (DRY). `library.js` : `libCardShell` rend la vignette via `mountSliceThumb` (au lieu du `<div>` scalé) ; ajouter un attribut `data-lib-card` aux cartes ; `renderGrid`/`renderSharedGrid` filtrent par la valeur de leur input ; retirer `opacity-0 group-hover` des boutons d'action (toujours visibles) ; brancher les inputs filtre. `index.html` : ajouter `#comp-grid-search` et `#shared-grid-search` (masqués hors de leur onglet, togglés dans `setLibTab`).

- [ ] **Step 4: Run to verify pass** — tests ciblés PASS ; `npm test` vert.

- [ ] **Step 5: Vérif manuelle** — vignettes Local/Partagée fidèles (Tailwind), filtre OK sur les 3 onglets, boutons visibles sans survol, clic sur un bouton n'insère pas la slice. (Preview-only.)

- [ ] **Step 6: Commit**

```bash
git add src/ui/slice-thumb.js src/features/library.js index.html src/ui/prismic-browser.js test/ui/slice-thumb.test.js test/features/library.test.js
git commit -m "feat(library): cartes unifiees a vignette fidele + filtre Local/Partagee + actions visibles"
```

---

### Task 3: Nom de slice Prismic propre + cadrage de vignette (Lot 3)

**Files:**
- Modify: `main.js` (résolution du nom dans `list-prismic-slices` : fallback propre)
- Modify: `src/ui/slice-thumb.js` (cadrage de la vignette : montrer plus que le coin haut-gauche)
- Test: `test/prismic-slice.test.js` ou `test/core/*` (fonction pure de nom), selon où vit le helper

**Interfaces:**
- Produces: `cleanSliceName(raw, id) -> string` (pure) : si `raw` est vide, trop long, ou ressemble à du CSS/`@font-face`/`{`…`}`, renvoie un nom lisible (tronqué nettoyé) ou un libellé dérivé de `id`.

- [ ] **Step 1: Write the failing test**

```js
test('cleanSliceName rejette le CSS et tombe sur un libelle lisible', () => {
  assert.equal(cleanSliceName("@font-face { font-family:'GothicA1'", 'abc123').startsWith('@font-face'), false);
  assert.equal(cleanSliceName('Recharge en borne', 'x'), 'Recharge en borne');
  assert.ok(cleanSliceName('', 'abc123').length > 0);
});
```

- [ ] **Step 2: Run to verify fail** — FAIL.

- [ ] **Step 3: Implement**

Écrire `cleanSliceName` (pure, testable, dans un module importable par main.js — ex. `lib/prismic-slice.js` ou un util dédié) : détecte `{`/`}`/`@font-face`/`src:`/`url(` ou longueur > ~80 → fallback (`'Slice ' + id.slice(0,6)` ou premier texte propre). Brancher dans `main.js` `list-prismic-slices` sur le champ nom. `slice-thumb.js` : ajuster l'échelle/dimensions de l'iframe pour un cadrage représentatif dans une colonne étroite (montrer le haut de la slice en largeur, pas un crop 0.25 du coin).

- [ ] **Step 4: Run to verify pass** — test PASS ; `npm test` vert.

- [ ] **Step 5: Commit**

```bash
git add main.js lib/prismic-slice.js src/ui/slice-thumb.js test/*
git commit -m "fix(prismic): nom de slice propre (fallback anti-CSS) + cadrage de vignette"
```

---

## Notes d'exécution
- Ordre : Task 1 → 2 → 3 (Task 3 affine la vignette de Task 2 ; Task 2 crée `slice-thumb.js` que Task 3 ajuste).
- Filet : tests existants (library, prismic-browser, preview-mode) + vérif manuelle dans l'app.
- Hors périmètre : refonte visuelle plus poussée (densité, 2 colonnes), toute modification de couleurs/thème.
