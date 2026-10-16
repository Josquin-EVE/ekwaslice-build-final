# Refonte gestion contenu canvas (SliceStore) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer la gestion « DOM = source de vérité » du canvas par un cœur unique `SliceStore` (liste ordonnée de slices atomiques), en modules ES, avec export/undo/édition fiables, sans régression — bascule big-bang quand la parité est atteinte.

**Architecture:** A1 « store DOM-backed » : le modèle est l'autorité sur la structure/identité des slices ; chaque slice garde un DOM vivant édité en place, re-sérialisé à la demande. Nouveau code dans `src/` chargé par `index2.html` (`<script type="module">`), l'`index.html` actuel reste fonctionnel jusqu'au switch. `main.js`/`preload.js`/`lib/prismic-slice.js` quasi inchangés.

**Tech Stack:** JavaScript vanilla, ES modules (pas de bundler), Electron `file://`. Tests du cœur en `node --test` + `jsdom` (devDependency). Tailwind runtime vendorisé (déjà présent).

**Spec:** `docs/superpowers/specs/2026-10-16-canvas-content-architecture-design.md`

## Global Constraints

- Vanilla ES modules, **aucune étape de build**, chargés via `<script type="module" src>` en `file://`.
- `nodeIntegration:false`, `contextIsolation:true` ; renderer ne touche jamais à `child_process`/IPC sauf via `window.api` (preload).
- Assets **vendorisés** uniquement (Tailwind `assets/vendor/tailwindcss.js`, FontAwesome, lottie) — pas de CDN runtime.
- JS de slice stocké **inerte** `<script type="text/ekw-js">` ; exécuté seulement en aperçu (iframe) et à l'export/prod.
- Isolation slice = wrapper classe unique `uid` + `all:initial` sur le wrapper.
- Identité Prismic portée par `data-remote-id`, `data-remote-title`, `data-remote-field`, `data-base-version`, `data-remote-uid` sur la racine.
- **1 slice = 1 document Prismic** ; usage réel = 1 slice dans le canvas (le store supporte N).
- `main.js`/`preload.js`/`lib/prismic-slice.js` : non modifiés (on ne touche qu'aux appelants renderer).
- API prix inchangée (proxy `getQuotation`, referer forcé côté main).

## Review Focus

- **Suppression d'un nœud imbriqué vs racine** : supprimer un enfant ne doit PAS laisser de slice vide ni retirer la slice ; supprimer la racine retire toute la slice (zéro coquille). → test Task 4 (store.remove) + Task 10 (editing delete routing).
- **Slice importée éditée puis exportée** : le round-trip Prismic reste verbatim et garde `data-remote-*` (pas de scope/compile sur l'importé). → test Task 7 (serializeSlice imported) + Task 9 (exportSlice imported).
- **Widget JS ciblant par classe (carrousel) après export** : les sélecteurs `querySelector('.x')` matchent encore car la même table d'alias est appliquée au JS. → test Task 8 (`rewriteJsClasses`) + Task 9.
- **Undo après add/delete/edit** : pas de référence morte ; la slice réapparaît/disparaît, l'ordre et `meta` sont restaurés. → test Task 11 (history restore diff).
- **Deux slices, mêmes noms de classe, CSS différent, même page** : aucune fuite (uid + renommage). → test Task 9 (exportSlice isolation).

---

## Phase 0 — Scaffold + harness de test

### Task 1: Scaffold `src/`, harness de test, `index2.html` vide

**Files:**
- Create: `src/bootstrap.js` (stub exportant `boot()` vide pour l'instant)
- Create: `index2.html` (doc minimal : mêmes `<head>` vendors que `index.html`, `<script type="module" src="src/bootstrap.js">`)
- Create: `test/helpers/dom.js` (helper jsdom : crée `document`/`window` globaux pour un test)
- Create: `test/core/scaffold.test.js`
- Modify: `package.json` (devDependency `jsdom`, script `test` déjà `node --test test/*.test.js` → étendre glob à `test/**/*.test.js`)

**Interfaces:**
- Produces: `test/helpers/dom.js` exporte `withDom(html?) → { window, document, cleanup }`.

- [ ] **Step 1: Écrire le test scaffold** — `test/core/scaffold.test.js` importe `withDom`, monte `<div id="canvas"></div>`, asserte `document.getElementById('canvas')` non nul.
- [ ] **Step 2: Lancer, vérifier l'échec** — `npm test` → FAIL (`jsdom` absent / helper absent).
- [ ] **Step 3: Installer jsdom + écrire `withDom`** — `npm i -D jsdom` ; `withDom` instancie `new JSDOM`, pose `global.window/document/HTMLElement` si besoin, renvoie `cleanup`.
- [ ] **Step 4: Étendre le glob de test** — `package.json` `"test": "node --test test/**/*.test.js"`.
- [ ] **Step 5: Lancer, vérifier le succès** — `npm test` → PASS.
- [ ] **Step 6: Commit** — `chore(refonte): scaffold src/ + harness jsdom + index2.html`.

---

## Phase 1 — Cœur : slice + store + sérialisation

### Task 2: `createSliceRoot` + `cleanArtifacts` (`src/core/slice.js`)

**Files:**
- Create: `src/core/slice.js`
- Test: `test/core/slice.test.js`

**Interfaces:**
- Produces:
  - `createSliceRoot(html: string, { origin, meta }) → HTMLElement` — construit la racine : wrapper `div[data-comp="1"].relative`, injecte `html`, `cleanArtifacts`, **mint `data-eid` neufs** sur les éléments portant `data-ekw-states` (ou tous les descendants marqués), applique les attributs d'identité depuis `meta` (`data-remote-*`). Ne monte PAS les pictos ici (dépend du catalogue runtime — fait côté UI).
  - `cleanArtifacts(node: HTMLElement) → void` — retire `.ekw-selected`, `.ekw-editing`, `.drag-handle`, `[contenteditable]`, `[data-ekw-pending]`, `button[onclick*="remove"]`.
  - `newEid() → string` — id court unique.

- [ ] **Step 1: Écrire les tests** (`test/core/slice.test.js`, jsdom) :
  - `createSliceRoot('<p>x</p>', {origin:'generated',meta:{}})` → racine `hasAttribute('data-comp')`, contient `<p>`.
  - racine avec `meta:{prismicId:'A', prismicField:'html_only'}` → `data-remote-id="A"`, `data-remote-field="html_only"`.
  - `createSliceRoot` sur html contenant `.ekw-selected` + `contenteditable` → attributs retirés.
  - deux appels sur du html avec `data-ekw-states` → `data-eid` **différents** entre les deux racines.
- [ ] **Step 2: Lancer, vérifier l'échec** — `node --test test/core/slice.test.js` → FAIL.
- [ ] **Step 3: Implémenter `slice.js`** — signatures ci-dessus.
- [ ] **Step 4: Lancer, vérifier le succès.**
- [ ] **Step 5: Commit** — `feat(core): createSliceRoot + cleanArtifacts`.

### Task 3: `serializeSlice` (branche sur `origin`) (`src/core/slice.js`)

**Files:**
- Modify: `src/core/slice.js`
- Test: `test/core/serialize.test.js`

**Interfaces:**
- Consumes: `Slice` shape `{ id, root, origin, meta }` (défini en Task 4 ; ici on sérialise depuis `{root, origin, meta}`).
- Produces: `serializeSlice(slice) → string` — `origin==='imported'` → `root.innerHTML` **verbatim** (clone nettoyé des seuls artefacts d'édition, aucun scope) ; sinon → HTML auteur canonique (clone + `cleanArtifacts`, `data-eid` conservés, `<script type="text/ekw-js">` conservé).

- [ ] **Step 1: Écrire les tests** :
  - imported : html verbatim (avec son `<style>`/`<script type=text/ekw-js>`) ressort identique (hors artefacts d'édition).
  - generated : `.ekw-selected`/`contenteditable` absents ; classes Tailwind et `data-*` conservés.
- [ ] **Step 2: Échec.** **Step 3: Implémenter.** **Step 4: Succès.**
- [ ] **Step 5: Commit** — `feat(core): serializeSlice (branche origin verbatim/canonique)`.

### Task 4: `SliceStore` (`src/core/store.js`)

**Files:**
- Create: `src/core/store.js`
- Test: `test/core/store.test.js`

**Interfaces:**
- Consumes: `createSliceRoot`, `serializeSlice` (Task 2-3).
- Produces: classe `SliceStore` construite avec `(canvasEl)` :
  - `add(html, origin='generated', meta={}) → Slice` (append DOM + liste, émet `change`)
  - `remove(id) → void` (retire racine entière du DOM + liste)
  - `move(id, dir: 'up'|'down') → void`
  - `duplicate(id) → Slice` (via `createSliceRoot`, `data-eid` neufs, `meta` sans identité Prismic)
  - `replaceContent(id, html) → Slice` (remplace le contenu de la racine, **préserve `meta` + `data-remote-*` + `data-eid`**)
  - `clear() → void`
  - `touch(id) → void` (émet `change` sans mutation structurelle — pour les éditions de contenu)
  - `get(id) → Slice|null`, `sliceOf(node) → Slice|null`, `list() → Slice[]`
  - `serialize() → Array<{id,html,origin,meta,order}>`
  - `on('change', cb)` / `off`
  - `Slice = { id, root, origin, meta }`

- [ ] **Step 1: Écrire les tests** :
  - `add` → `list().length===1`, slice a un `id`, `root` est enfant direct de canvas, `change` émis.
  - `remove(id)` → canvas n'a plus d'enfant `[data-comp]` (zéro coquille), `list()` vide.
  - `replaceContent(id, '<p>new</p>')` sur une slice avec `meta.prismicId='A'` → contenu changé, `data-remote-id` toujours `A`, même `id` de slice.
  - `sliceOf(nestedNode)` → la slice propriétaire.
  - `move`/`duplicate` : ordre et nombre corrects ; `duplicate` donne des `data-eid` différents.
  - `serialize()` → tableau avec `order` croissant et `html` = `serializeSlice`.
- [ ] **Step 2: Échec.** **Step 3: Implémenter `store.js`.** **Step 4: Succès.**
- [ ] **Step 5: Commit** — `feat(core): SliceStore (autorité unique du canvas)`.

---

## Phase 2 — Export

### Task 5: Transfos chaîne d'export (`src/core/export-transforms.js`)

**Files:**
- Create: `src/core/export-transforms.js`
- Test: `test/core/export-transforms.test.js`

**Interfaces:**
- Produces (fonctions pures) :
  - `buildAlias(usedClasses: string[], knownClasses: Set<string>, uid) → Map<string,string>` (classe → `eks-<uid>-N`, seulement si connue d'une règle CSS).
  - `rewriteHtmlClasses(html, alias) → string` (remplace les classes sur les éléments ; classe sans alias = supprimée du HTML).
  - `rewriteSelector(selector, alias) → string` (renomme les tokens `.classe` d'un sélecteur CSS).
  - `rewriteJsClasses(js, alias) → string` (remplace, dans les chaînes du JS, les tokens de classe connus de l'alias : `'.carousel-track'`→`'.eks-uid-5'`, `classList.add('x')`, etc. — remplacement par token de mot entier précédé de `.` ou en littéral de chaîne).
  - `namespaceKeyframes(css, uid) → { css, renames: Map }` et `applyKeyframeRefs(css, renames) → string` (réécrit `@keyframes name`→`name-uid` et les `animation`/`animation-name`).
  - `scopeRule(selector, body, uid) → string` (préfixe `.<uid> ` + body).

- [ ] **Step 1: Écrire les tests** (fixtures chaîne, pas de DOM requis) :
  - `buildAlias(['title','px-4'], new Set(['title','px-4']), 'ab12cd')` → map non vide ; classe inconnue d'une règle → absente.
  - HTML `<div class="title">` + alias → `<div class="eks-ab12cd-1">`.
  - `rewriteJsClasses("q('.carousel-track')", alias('carousel-track'→'eks-ab12cd-2'))` → `"q('.eks-ab12cd-2')"`.
  - `namespaceKeyframes('@keyframes spin{...} .x{animation:spin 1s}', 'ab12cd')` → `@keyframes spin-ab12cd` ET `animation: spin-ab12cd 1s`.
  - `scopeRule('.title','color:red','ab12cd')` → `.ab12cd .title{color:red}` (ordre/forme exacte fixée par le test).
- [ ] **Step 2: Échec.** **Step 3: Implémenter.** **Step 4: Succès.**
- [ ] **Step 5: Commit** — `feat(export): transfos chaîne (alias classes HTML+CSS+JS, keyframes)`.

### Task 6: `exportSlice` (intégration runtime) (`src/core/export.js`)

**Files:**
- Create: `src/core/export.js`
- Test: `test/core/export.test.js` (jsdom + fixture de règles CSS injectées à la main, PAS le vrai Tailwind)

**Interfaces:**
- Consumes: `serializeSlice`, les transfos (Task 5).
- Produces:
  - `exportSlice(slice, { collectCssRules }) → { html, css, js }` — `origin==='imported'` → verbatim `{ html, css, js }` depuis le DOM de la slice (extraction actuelle `extractVerbatimForExport` portée telle quelle) ; sinon → pipeline : collecte classes `used` depuis la racine, `known` via `collectCssRules()`, `buildAlias`, réécrit HTML+CSS+JS, scope uid, namespace keyframes, wrappe JS en IIFE.
  - `collectCssRules()` dans `export.js` — lit `document.styleSheets` (runtime), renvoie `[{media,selector,body}]` (porté de l'actuel).
  - `lastExport` exposé/retourné.

- [ ] **Step 1: Écrire les tests** (injecter une `<style>` fixture dans le jsdom pour simuler les règles) :
  - generated : une slice `<div class="card"><button class="btn" onclick…></div>` + `<script>document.querySelector('.card')</script>` et règles `.card{}`/`.btn{}` → HTML a classes aliasées, CSS scopé `.uid`, **le JS contient le même alias que `.card`** (sélecteur survit).
  - imported : slice `origin:'imported'` → `{html,css,js}` = verbatim (inchangé, `data-remote-*` présents dans le html verbatim).
  - isolation : deux slices mêmes classes, CSS différent → deux uid distincts, pas de collision (règles préfixées différemment).
- [ ] **Step 2: Échec.** **Step 3: Implémenter.** **Step 4: Succès.**
- [ ] **Step 5: Commit** — `feat(export): exportSlice par slice (verbatim | compile+scope)`.

---

## Phase 3 — Historique

### Task 7: Undo/redo sur snapshots du store (`src/core/history.js`)

**Files:**
- Create: `src/core/history.js`
- Test: `test/core/history.test.js` (jsdom)

**Interfaces:**
- Consumes: `SliceStore` (`serialize`, `list`, et une méthode de reconstruction).
- Produces: `History(store)` avec `snapshot()`, `undo()`, `redo()`, `canUndo()`, `canRedo()`. `restore(snap)` reconstruit : retire les slices absentes du snap, `createSliceRoot` pour les nouvelles/changées (diff par `id` + hash html), réordonne ; préserve les racines inchangées.

- [ ] **Step 1: Écrire les tests** :
  - add → snapshot ; remove → snapshot ; undo → la slice supprimée réapparaît (même `id`, `meta` restaurés), ordre correct.
  - edit (replaceContent) puis undo → ancien html ; redo → nouveau.
  - restore ne reconstruit QUE les slices dont le html a changé (vérifier qu'une racine inchangée garde la même référence d'objet `Slice`).
- [ ] **Step 2: Échec.** **Step 3: Implémenter.** **Step 4: Succès.**
- [ ] **Step 5: Commit** — `feat(core): history undo/redo par snapshots de slices`.

---

## Phase 4 — Features (portage vers le store)

> Ces tâches **portent** la logique existante d'`index.html` vers des modules qui passent par le store. Tests unitaires limités (DOM lourd) → vérification surtout par **intégration dans l'app** (`index2.html`). Chaque tâche liste les comportements à revalider.

### Task 8: `editing.js` — sélection + édition intra-slice

**Files:**
- Create: `src/features/editing.js`
- Test: `test/features/editing.test.js` (jsdom — cibles unitaires : routing delete + touch)

**Interfaces:**
- Consumes: `store` (`sliceOf`, `remove`, `touch`).
- Produces: `initEditing(store, ctx)` exposant `selectElement`, `deselect`, `startEditing`/`stopEditing`, panneau style, états (`setEditState`/`_commitStateEdits`/`regenStateStyles`), picto, textes dynamiques. **Toute modif de contenu appelle `store.touch(sliceId)`.** Suppression : si `sel` est la racine d'une slice → `store.remove(id)` ; sinon retrait du nœud interne + `store.touch(id)`.

- [ ] **Step 1: Test (jsdom)** : fonction de suppression — sur racine → `store.remove` appelé, slice partie ; sur nœud imbriqué → slice toujours là, `touch` appelé, nœud parti (zéro coquille).
- [ ] **Step 2: Échec.** **Step 3: Porter la logique d'édition depuis `index.html`** (sélection, inline, style, états, picto, textes dyn.) en remplaçant les mutations structurelles par le store. **Step 4: Succès (test unitaire delete/touch).**
- [ ] **Step 5: Commit** — `feat(features): editing intra-slice routé via store (delete atomique + touch)`.

### Task 9: `chat.js` — ciblage + application

**Files:**
- Create: `src/features/chat.js`
- Test: `test/features/chat.test.js` (jsdom — `effectiveTarget`)

**Interfaces:**
- Consumes: `store`, `editing`, `window.api.sendChat`.
- Produces: `initChat(store, ctx)` : `effectiveTarget()` (explicite > sélection > slice présente `loneSlice` > null), `sendChat`, `renderAssistant`, apply/reject. Cible **racine** → `store.replaceContent(id, html)` ; cible **imbriquée** → remplacement du nœud (editing) + `store.touch(id)` ; **aucune cible** → `store.add(html, 'generated')`.

- [ ] **Step 1: Test** : avec une seule slice dans le store et aucune sélection, `effectiveTarget()` renvoie cette slice (pas null → pas d'ajout en doublon). Avec `forceNewEl` → null.
- [ ] **Step 2: Échec.** **Step 3: Porter.** **Step 4: Succès.**
- [ ] **Step 5: Commit** — `feat(features): chat via store (replaceContent / add, plus de doublon)`.

### Task 10: `prismic.js` — import / push / pull / update (par slice)

**Files:**
- Create: `src/features/prismic.js`
- Test: vérification intégration (pas de test unitaire — dépend IPC/réseau)

**Interfaces:**
- Consumes: `store` (`add` origin `imported`, `get`, `serialize`), `exportSlice`, `window.api.{pullPrismic,pushPrismic,updatePrismic}`.
- Produces: `initPrismic(store, ctx)` : import → `store.add(verbatimHtml, 'imported', {prismicId,…})` ; push → `exportSlice(slice)` → `pushPrismic` ; update → cible la slice portant `meta.prismicId` → `exportSlice` (verbatim) → `updatePrismic` ; bouton MAJ reflète la présence d'une slice `imported`.

- [ ] **Step 1: Porter la logique** (depuis `index.html` : `injectVerbatimSlice`, `doPrismicImport`, `pushToPrismic`, `updateInPrismic`, `extractVerbatimForExport`) en passant par le store.
- [ ] **Step 2: Vérif intégration** (après Task 12) : import d'une slice → 1 slice `imported` ; MAJ → identité conservée.
- [ ] **Step 3: Commit** — `feat(features): prismic import/push/update par slice via store`.

### Task 11: `library.js` + `importCode.js`

**Files:**
- Create: `src/features/library.js`, `src/features/importCode.js`
- Test: intégration

**Interfaces:**
- Consumes: `store` (`add` origin `library`/`code`), `serializeSlice`, `window.api.library*`.
- Produces: `initLibrary(store, ctx)` (save = `serializeSlice`, insert = `store.add(html,'library',{libId})`, load/delete) ; `initImportCode(store, ctx)` (flatten CSS → `store.add(html,'code')`).

- [ ] **Step 1: Porter.** **Step 2: Vérif intégration.** **Step 3: Commit** — `feat(features): library + import code via store`.

---

## Phase 5 — UI, bootstrap, parité, bascule

### Task 12: UI + `bootstrap.js` + `index2.html` complet

**Files:**
- Create: `src/ui/toolbar.js`, `src/ui/modals.js`, `src/ui/preview.js`, `src/ui/overlay.js`
- Modify: `src/bootstrap.js`, `index2.html`
- Test: intégration (lancer l'app sur `index2.html`)

**Interfaces:**
- Consumes: tous les modules ci-dessus.
- Produces: `boot()` instancie `SliceStore(canvas)`, `History(store)`, `initEditing/initChat/initPrismic/initLibrary/initImportCode`, câble toolbar (undo/redo/up/down/dup/del/save/target/mode), modales (export, import Prismic, save, settings), aperçu (iframe + shim fetch prix), overlay Lottie. Export/preview lisent `store.list()`.

- [ ] **Step 1: Porter les handlers UI + buildPreviewDoc/collectPreviewHTML** vers `store.list()`.
- [ ] **Step 2: Lancer l'app** (`index2.html` via electron) — smoke test : canvas vide, générer une slice au chat, elle apparaît.
- [ ] **Step 3: Commit** — `feat(ui): bootstrap + toolbar/modales/aperçu/overlay sur le store`.

### Task 13: Parité (checklist §8 du spec) + corrections

**Files:** corrections ponctuelles dans `src/**`.

- [ ] **Step 1:** Dérouler la **checklist de parité** du spec (12 points) dans l'app sur `index2.html`. Noter les écarts.
- [ ] **Step 2:** Corriger chaque écart (commits ciblés).
- [ ] **Step 3: Scénario anti-régression du bug d'origine** : importer une slice → supprimer → « Nouveau » (reset chat) → générer une autre slice → exporter → vérifier **une seule** slice à l'export, sans coquille ni double `<script>`. Puis exporter un carrousel (script par classe) → vérifier qu'il fonctionne à l'export.
- [ ] **Step 4: Commit** — `test(refonte): parité validée (checklist + scénario bug d'origine)`.

### Task 14: Bascule big-bang + release

**Files:**
- Rename: `index.html` → `index.legacy.html` ; `index2.html` → `index.html`
- Modify: `package.json` (`build.files` : inclure `src/**`, retirer la legacy si souhaité ; bump version)

- [ ] **Step 1:** Switch des fichiers, ajuster `build.files` pour embarquer `src/**` + `index.html`.
- [ ] **Step 2:** Lancer l'app → smoke test complet.
- [ ] **Step 3:** Bump version, commit, tag, push (procédure habituelle GIT_ASKPASS).
- [ ] **Step 4: Commit** — `chore(release): bascule nouveau cœur canvas vX.Y.Z`.

---

## Notes d'implémentation

- **jsdom** ne charge pas Tailwind : les tests d'export injectent des règles CSS fixtures à la main (on teste la transformation, pas la génération Tailwind).
- Les tâches 10-12 sont des **portages** : réutiliser le code existant d'`index.html` quasi tel quel, en remplaçant seulement les points de mutation du canvas par des appels store (`add/remove/replaceContent/touch`) et les lectures par `store.list()`/`sliceOf`.
- Garder l'`index.html` legacy jouable jusqu'à Task 14 (aucune régression pendant le chantier).
