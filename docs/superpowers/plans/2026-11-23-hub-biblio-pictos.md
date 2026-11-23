# Hub bibliothèques (onglet Prismic) + pictos masqués hors édition — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Centraliser les 3 sources de slices (Local, Partagée, Prismic) dans le panneau de droite via un 3ᵉ onglet « Prismic », et masquer les sections pictos hors du mode édition pour gagner de la place.

**Architecture:** Feature B (indépendante) : un marqueur de mode sur `<body>` (`data-mode`) piloté par `preview.setMode`, + attribut `data-editor-only` sur les blocs réservés à l'édition, masqués en CSS en aperçu. Feature A : extraire le navigateur de slices Prismic (fetch + vignettes iframe + filtre + sélection + pont prix) de `modals.js` vers un module réutilisable `src/ui/prismic-browser.js`, puis l'utiliser dans un onglet « Prismic » du panneau ; un clic sur une carte importe via `prismic.doImport` existant.

**Tech Stack:** Electron renderer (ES modules), `node --test` + `jsdom`, Tailwind (iframes de vignettes). Zéro nouvelle dépendance.

**Spec:** ce document (section Design). Direction utilisateur : « centraliser en dédiant le panneau de droite aux bibliothèques en ajoutant une entrée Prismic » + « masquer les pictos quand on n'est pas en mode édition, pense à la technique, on verra l'UX après ». L'UX fine (apparence exacte, animations, retrait éventuel de la modale) est explicitement reportée.

## Design (spec)

### État actuel
- Panneau droit (`index.html`) : onglets `#tab-local`/`#tab-shared` + `#shared-reload` ; grilles `#comp-grid` (local) et `#shared-grid` (partagé) ; sections pictos `#picto-body` (insertion) et `#editor-picto-body` (éditeur). `setLibTab(local|shared)` dans `library.js`.
- Prismic : import via une MODALE (`#prismicImportModal`, ouverte par le bouton toolbar « Importer Prismic », `modals.openPrismicImport`). La logique de navigation (liste `listPrismicSlices`, vignettes `buildThumbDoc` en iframe lazy via IntersectionObserver, filtre `#prismic-lib-search`, sélection `_selectedSliceId`, cache SWR, pont prix postMessage) vit dans `modals.js` (~l.132-329). L'import lui-même = `prismic.doImport(btn)` qui lit la source via le hook `getImportSource()`.
- Mode : `preview.setMode('edit'|'preview')` / `getMode()` ; bascule via `.mode-btn`.

### Décisions (mes choix, UX affinable ensuite)
- **A** : le navigateur Prismic devient un module réutilisable monté DANS le panneau (onglet Prismic) ; la modale Prismic continue d'exister pour l'import par URL/ID + la config du token (le même module peut y rester monté). Le bouton toolbar « Importer Prismic » bascule le panneau sur l'onglet Prismic (au lieu d'ouvrir la modale). Un clic sur une carte de l'onglet = import direct de cette slice.
- **B** : marqueur `data-mode` sur `<body>` (source unique), `data-editor-only` sur les 2 sections pictos ; masquage CSS en `preview`. Généralise à d'autres blocs édition-only plus tard.
- Hors périmètre (reporté) : apparence/animations, retrait total de la modale Prismic, masquage d'autres panneaux que les pictos.

## Global Constraints
- ES modules ; AUCUNE nouvelle dépendance.
- Ne pas régresser : import Prismic par la modale (URL/ID + token) doit continuer de marcher à l'identique ; biblio Local/Partagée inchangées.
- Le store reste seule autorité canvas : tout import passe par `prismic.doImport` → `store.add(..., 'imported')`.
- Tests `node --test` + `jsdom`.
- Branche dédiée `feat-hub-biblio` (jamais `main`). Commits finis par `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Review Focus
- Mode `preview` → sections pictos cachées ; retour `edit` → réaffichées (pas de masquage résiduel) — pinné Task 1.
- Au 1er rendu (avant toute bascule), le mode par défaut (`edit`) ne cache rien — pinné Task 1.
- Onglet Prismic sans token de lecture → invite claire (pas de grille vide muette ni crash) — pinné Task 3.
- Refactor `prismic-browser` : la modale Prismic garde exactement son comportement (vignettes lazy, filtre, sélection, pont prix) — pinné Task 2.
- Clic sur une carte Prismic de l'onglet → importe la BONNE slice (id transmis à `doImport`) — pinné Task 3.

---

### Task 1: Masquer les sections pictos hors mode édition (Feature B)

**Files:**
- Modify: `src/ui/preview.js` (`setMode` ~l.204-229 : poser le marqueur de mode)
- Modify: `index.html` (sections pictos `#picto-body` bloc ~l.477-486 et `#editor-picto-body` ~l.520-529 : attribut `data-editor-only` sur chaque bloc-conteneur ; règle CSS)
- Test: `test/features/preview-mode.test.js`

**Interfaces:**
- Produces: après `preview.setMode(m)`, `document.body.dataset.mode === m`.

- [ ] **Step 1: Write the failing test**

```js
// jsdom : body + #device-stage/#canvas-scroll stubs minimaux ; initPreview(store,{document,window,canvas})
test('setMode pose data-mode sur body', () => {
  preview.setMode('preview');
  assert.equal(doc.body.dataset.mode, 'preview');
  preview.setMode('edit');
  assert.equal(doc.body.dataset.mode, 'edit');
});
```

- [ ] **Step 2: Run to verify fail** — `node --test test/features/preview-mode.test.js` → FAIL.

- [ ] **Step 3: Implement**

Dans `preview.js setMode(mode)`, après avoir fixé `currentMode`, ajouter `if (doc && doc.body) doc.body.dataset.mode = mode;`. Dans `index.html` : ajouter `data-editor-only` sur le conteneur de section de `#picto-body` ET de `#editor-picto-body` (le bloc incluant le titre/accordéon, pas seulement le corps), et une règle CSS globale : `body[data-mode="preview"] [data-editor-only]{display:none}`.

- [ ] **Step 4: Run to verify pass** — `node --test test/features/preview-mode.test.js` → PASS ; `npm test` vert.

- [ ] **Step 5: Commit**

```bash
git add src/ui/preview.js index.html test/features/preview-mode.test.js
git commit -m "feat(preview): masque les sections editor-only (pictos) hors mode edition"
```

---

### Task 2: Extraire le navigateur Prismic réutilisable (Feature A — socle)

**Files:**
- Create: `src/ui/prismic-browser.js`
- Modify: `src/ui/modals.js` (remplacer la logique inline de la grille Prismic par l'usage du module ; garder la modale, le token, l'URL, l'ouverture)
- Test: `test/ui/prismic-browser.test.js`

**Interfaces:**
- Consumes: `buildThumbDoc` (de `./preview.js`), `window.api.listPrismicSlices(opts)`, `window.api.getQuotation`.
- Produces: `initPrismicBrowser(ctx) -> { mount(container), load(opts), render(), getSelectedId(), clearSelection(), dispose() }`
  - `ctx` : `{ document, window, api, buildThumbDoc?, onPick(sliceId), getReadToken()/hasReadToken() , saveReadToken? }`.
  - `mount(container)` : rend la grille de vignettes DANS `container` (filtre optionnel via un input fourni par l'appelant ou interne) ; `load({force,silent})` : fetch + cache SWR (mémoire module) ; sélection + pont prix postMessage gérés dedans ; clic carte → `onPick(id)`.

- [ ] **Step 1: Write the failing test**

```js
// jsdom + api mock : listPrismicSlices renvoie {ok:true, slices:[{id,name,html,date}]}.
test('mount + load rend une carte par slice (data-slice-id)', async () => {
  const b = initPrismicBrowser({ document: doc, window: win, api, buildThumbDoc: () => '<html></html>', onPick(){} });
  b.mount(container); await b.load();
  assert.equal(container.querySelectorAll('[data-slice-id]').length, 1);
});
test('clic sur une carte appelle onPick avec son id', async () => {
  let picked = null;
  const b = initPrismicBrowser({ document: doc, window: win, api, buildThumbDoc: () => '', onPick: (id)=>{picked=id;} });
  b.mount(container); await b.load();
  container.querySelector('[data-slice-id]').click();
  assert.equal(picked, 'the-id');
});
```

- [ ] **Step 2: Run to verify fail** — `node --test test/ui/prismic-browser.test.js` → FAIL.

- [ ] **Step 3: Implement**

Déplacer dans `prismic-browser.js` : `_prismicLib` (cache module), `loadPrismicLibrary`→`load`, `renderPrismicLib`→`render` (vignettes iframe + IntersectionObserver lazy + filtre + sélection + le badge « choisi »), et le pont prix postMessage (restreint aux iframes du conteneur monté). Remplacer la sélection interne de la modale par `getSelectedId()`/`clearSelection()`. Dans `modals.js` : instancier `initPrismicBrowser` pour la grille de `#prismicImportModal` (container `#prismic-lib-list`), brancher `onPick` sur l'ancien comportement de sélection (met à jour l'état du bouton import), et faire pointer `getImportSource()` sur `browser.getSelectedId()` (ou l'URL). Comportement modale INCHANGÉ.

- [ ] **Step 4: Run to verify pass** — `node --test test/ui/prismic-browser.test.js` → PASS ; `npm test` vert.

- [ ] **Step 5: Commit**

```bash
git add src/ui/prismic-browser.js src/ui/modals.js test/ui/prismic-browser.test.js
git commit -m "refactor(prismic): navigateur de slices Prismic reutilisable (extrait de modals)"
```

---

### Task 3: Onglet « Prismic » dans le panneau + import au clic (Feature A — intégration)

**Files:**
- Modify: `index.html` (panneau : bouton `#tab-prismic` à côté de `#tab-shared` ; conteneur `#prismic-grid` à côté de `#shared-grid` ; optionnel : input filtre `#prismic-grid-search`)
- Modify: `src/features/library.js` (`setLibTab` gère `'prismic'` : affiche `#prismic-grid`, monte/charge le browser, import au pick)
- Modify: `src/bootstrap.js` (wiring : `#tab-prismic` → `library.setLibTab('prismic')` ; injecter dans la lib un browser Prismic + un hook d'import `prismicImport(sliceId)` qui appelle `prismic.doImport` ; bouton toolbar « Importer Prismic » → `library.setLibTab('prismic')`)
- Test: `test/features/library.test.js` (ajout)

**Interfaces:**
- Consumes: `initPrismicBrowser` (Task 2) ; `prismic.doImport` ; `prismic` hook `getImportSource`.
- Produces: `library.setLibTab('prismic')` ; `library` monte le browser dans `#prismic-grid` au 1er affichage (lazy).

- [ ] **Step 1: Write the failing test**

```js
// jsdom : api.listPrismicSlices -> {ok, slices:[{id,name,html}]} ; hooks.hasReadToken -> true.
test('setLibTab(prismic) affiche la grille Prismic et la peuple', async () => {
  await library.setLibTab('prismic');
  assert.equal(byId('prismic-grid').classList.contains('hidden'), false);
  // au moins une carte rendue (via le browser injecté/mock)
});
test('setLibTab(prismic) sans token invite a configurer', async () => {
  // hasReadToken -> false : message d'invite, pas de crash
});
```

- [ ] **Step 2: Run to verify fail** — `node --test test/features/library.test.js` → FAIL.

- [ ] **Step 3: Implement**

`index.html` : ajouter `#tab-prismic` (même style que `#tab-shared`) et `#prismic-grid` (`hidden flex-col …`, comme `#shared-grid`). `library.setLibTab` : accepter `'prismic'` → masquer les autres grilles, afficher `#prismic-grid`, et au 1er affichage monter le browser (injecté via `ctx.prismicBrowser` ou un hook) et `load()` ; si pas de token de lecture → afficher une invite (texte + lien vers la config token de la modale). Le `onPick(id)` du browser → `ctx.hooks.prismicImport(id)`. `bootstrap.js` : créer le browser Prismic (ou réutiliser celui de modals), le passer à la lib ; définir `prismicImport(id)` = poser la source puis `prismic.doImport()` (réutilise `getImportSource` en le faisant renvoyer `id`) ; câbler `#tab-prismic` et rediriger le bouton toolbar « Importer Prismic » vers `library.setLibTab('prismic')`.

- [ ] **Step 4: Run to verify pass** — `node --test test/features/library.test.js` → PASS ; `npm test` vert.

- [ ] **Step 5: Vérif manuelle (app)** — onglet Prismic liste les slices, filtre OK, clic → la slice s'importe dans le canvas (identité `data-remote-*` conservée) ; sans token → invite. (Preview-only.)

- [ ] **Step 6: Commit**

```bash
git add index.html src/features/library.js src/bootstrap.js test/features/library.test.js
git commit -m "feat(library): onglet Prismic dans le hub bibliotheques + import au clic"
```

---

## Notes d'exécution
- Ordre : Task 1 (indépendante) peut partir en premier ou en parallèle conceptuellement ; Task 3 dépend de Task 2.
- Filet anti-régression : tests existants (`library.test.js`, suite complète) + vérif manuelle de la modale Prismic (Task 2) et de l'onglet (Task 3).
- UX fine reportée : apparence exacte de l'onglet/grille, animations de masquage, éventuel retrait complet de la modale Prismic au profit de l'onglet.
