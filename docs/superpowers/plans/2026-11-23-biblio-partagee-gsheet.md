# Bibliothèque partagée sur Google Sheets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Réactiver la bibliothèque partagée dans la nouvelle app (`src/`), adossée à Google Sheets au lieu de Supabase, avec une clé de compte de service importée une fois et conservée dans le userData.

**Architecture:** Un module main-process `lib/gsheet.js` (CommonJS) gère la clé (import → copie userData → `chmod 600`), l'auth (JWT RS256 via `crypto`, token mis en cache) et le CRUD sur un onglet Sheets (1 ligne = 1 composant). `main.js` garde les 5 handlers IPC `shared-*` existants (mêmes noms/formes de retour) mais délègue à `lib/gsheet.js`, et ajoute `gsheet-import-key` / `gsheet-key-status`. L'UI partagée historique (présente dans `index.legacy.html`, absente de la nouvelle app) est portée dans `src/features/library.js` + `index.html`. Zéro nouvelle dépendance npm.

**Tech Stack:** Electron (main CommonJS + renderer ES modules), Node `crypto` (JWT RS256) + `fetch` (Node 18+), Google Sheets API v4, tests `node --test` + `jsdom`.

**Spec:** ce document — section « Design (spec) » ci-dessous. Issu de : investigation du code existant (feature Supabase complète côté main, UI en standby `CLOUD_LIB=false`, non portée dans `src/`) + spike de dé-risquage réussi (CRUD complet prouvé avec la vraie clé le 2026-11-23).

## Design (spec)

**Contexte prouvé par le spike (2026-11-23).** La clé `~/Desktop/Credential/ekwaslice_gsheet.json` (compte de service `ekwaslice@esoteric-sled-515613-h6.iam.gserviceaccount.com`) authentifie en JWT RS256 (Node `crypto`) → `access_token` ; le Sheet `1UyRgL40gGxsmEF6Dq2mXpE4Jp55eH4BjWGZVZRc31EM` est partagé en Éditeur avec ce compte, l'API Sheets est activée ; onglet `Sheet1` (gid 0), **vide** (sans en-têtes) ; lecture/append/suppression (batchUpdate deleteDimension) OK.

**Modèle de données.** Onglet `Sheet1`, une ligne par composant, 7 colonnes dans cet ordre exact :
`id | name | author | html | created_at | updated_at | owner_key`. Ligne 1 = en-têtes (créée si l'onglet est vide). `owner_key` n'est **JAMAIS** renvoyé au renderer (comme l'ancien `select` Supabase qui l'excluait).

**Modèle de sécurité (décidé avec l'utilisateur).**
- Clé partagée **hors app**, de façon sécurisée, aux coéquipiers. **Jamais** embarquée dans le build (`package.json` `files` ne doit jamais inclure la clé), jamais commitée.
- Import une fois dans l'app → **copie** vers `userData/gsheet-credentials.json`, `chmod 0o600`. L'original peut ensuite être supprimé/déplacé sans casser l'app.
- Vérification de propriété (`owner_key` pour update/delete/rename) faite **dans `lib/gsheet.js`** (côté app). Molle (contournable par qui a la clé) : accepté pour outil interne de confiance, données récupérables via l'historique du Sheet.
- `lib/gsheet.js` ne renvoie jamais la clé privée ni l'`access_token` au renderer ; seul `client_email` est exposé (affichage « connecté en tant que »).

**Auth.** JWT `{iss: client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: token_uri, iat, exp: iat+3600}`, signé RS256 avec `private_key`, échangé sur `token_uri` (`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`). Token mis en cache en mémoire jusqu'à ~5 min avant expiration.

**Mapping des handlers IPC (noms et retours inchangés → l'UI se rebranche telle quelle).**
- `shared-list` → `lib.list()` → `{ list: [{id,name,author,html,created_at,updated_at}] }` | `{error}`
- `shared-publish` ({name,html,author,ownerKey}) → `lib.publish(...)` → `{ row: {id} }` | `{error}`
- `shared-update` ({id,ownerKey,name?,html?}) → `lib.update(...)` → `{ ok }` | `{error}`
- `shared-delete` ({id,ownerKey}) → `lib.remove(...)` → `{ ok }` | `{error}`
- `shared-rename-author` ({ownerKey,author}) → `lib.renameAuthor(...)` → `{ count }` | `{error}`
- NOUVEAU `gsheet-key-status` → `{ present: bool, email?: string }`
- NOUVEAU `gsheet-import-key` → ouvre un dialog natif (ou reçoit un chemin), valide, copie → `{ ok, email }` | `{error}`
- Cas « pas de clé » : les handlers `shared-*` renvoient `{ error: 'NO_KEY' }` ; le renderer propose alors l'import (pattern identique à `NO_WRITE_TOKEN` de `push-prismic`).

**Config non secrète.** `SPREADSHEET_ID` et `TAB='Sheet1'` sont des constantes de `lib/gsheet.js` (déplaçables dans settings plus tard).

## Global Constraints

- AUCUNE nouvelle dépendance npm ; `lib/gsheet.js` en CommonJS (comme `lib/prismic-slice.js`), main-process uniquement.
- La clé privée ne doit jamais : être commitée, figurer dans `package.json` `build.files`, être loggée, ni renvoyée au renderer.
- Les 5 handlers IPC `shared-*` gardent leurs noms et formes de retour actuels (compat UI).
- `owner_key` jamais renvoyé au renderer.
- Tests : `node --test` ; parties pures de `lib/gsheet.js` testées sans réseau (JWT, mapping, strip owner_key, validation). Les appels réseau sont couverts par le spike + vérif manuelle.
- Branche dédiée `feat-biblio-gsheet` (jamais `main`). Commits finis par `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

## Review Focus

- `owner_key` ne doit JAMAIS apparaître dans la sortie de `shared-list`/`list()` — pinné Task 2.
- Onglet vide (1er démarrage équipe) : `publish` doit poser la ligne d'en-têtes avant d'ajouter — pinné Task 2.
- Import d'un JSON qui n'est pas un `service_account` (mauvais fichier) : rejet clair, pas de copie — pinné Task 1.
- `update`/`delete` avec un `ownerKey` qui ne correspond pas : `{ ok: false }`, aucune modif du Sheet — pinné Task 2.
- Action partagée sans clé importée : `{ error: 'NO_KEY' }` → l'UI propose l'import au lieu de planter — pinné Task 4.
- `html` d'une slice proche de 50 000 caractères (limite cellule Sheets) : échec API rapporté proprement (`{error}`), pas de crash — pinné Task 2.

---

### Task 1: `lib/gsheet.js` — gestion de clé + auth

**Files:**
- Create: `lib/gsheet.js`
- Test: `test/gsheet.test.js`
- Reference: `main.js:493-502` (`settingsPath`/`readSettings` pour le pattern userData)

**Interfaces:**
- Produces (CommonJS `module.exports`) :
  - `credPath() -> string` (= `path.join(app.getPath('userData'), 'gsheet-credentials.json')` ; `app` injectable pour test)
  - `isServiceAccount(json) -> boolean` (type==='service_account' && private_key && client_email)
  - `importKey(srcPath) -> { ok:true, email } | { error }` (lit, valide, copie vers credPath, `chmod 0o600`)
  - `keyStatus() -> { present:boolean, email?:string }`
  - `buildJwt(key, now) -> string` (header.claim.signature RS256)
  - `getAccessToken() -> Promise<string>` (cache mémoire ; `{error}`-safe via exception captée par l'appelant)

- [ ] **Step 1: Write the failing tests (parties pures)**

```js
test('isServiceAccount rejette un JSON non service_account', () => {
  assert.equal(isServiceAccount({ type: 'authorized_user' }), false);
  assert.equal(isServiceAccount({ type: 'service_account', private_key: 'x', client_email: 'a@b' }), true);
});
test('buildJwt produit 3 segments base64url et un header RS256', () => {
  const jwt = buildJwt({ client_email: 'a@b', token_uri: 'https://t', private_key: TEST_RSA_PEM }, 1000);
  const parts = jwt.split('.');
  assert.equal(parts.length, 3);
  const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
  assert.equal(header.alg, 'RS256');
  const claim = JSON.parse(Buffer.from(parts[1], 'base64url'));
  assert.equal(claim.exp - claim.iat, 3600);
});
test('importKey copie et chmod, refuse un mauvais fichier', () => {
  // srcPath pointant un JSON valide -> {ok, email}; fichier texte -> {error}
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/gsheet.test.js`
Expected: FAIL (module absent).

- [ ] **Step 3: Implement `lib/gsheet.js` (clé + auth)**

Génère `TEST_RSA_PEM` dans le test via `crypto.generateKeyPairSync('rsa',{modulusLength:2048})`. `getAccessToken` : charge la clé depuis `credPath()`, `buildJwt`, POST `token_uri`, cache `{token, exp}` en module. `importKey` : `fs.copyFileSync` puis `fs.chmodSync(dst, 0o600)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/gsheet.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/gsheet.js test/gsheet.test.js
git commit -m "feat(gsheet): import de cle service account (userData) + auth JWT RS256"
```

---

### Task 2: `lib/gsheet.js` — CRUD Sheets

**Files:**
- Modify: `lib/gsheet.js`
- Test: `test/gsheet.test.js`

**Interfaces:**
- Consumes: `getAccessToken` (Task 1).
- Produces :
  - `COLUMNS = ['id','name','author','html','created_at','updated_at','owner_key']`
  - `rowToObject(row) -> { id,name,author,html,created_at,updated_at,owner_key }`
  - `objectToRow(obj) -> string[]` (ordre `COLUMNS`)
  - `stripOwnerKey(obj) -> obj sans owner_key`
  - `list() -> Promise<{list}|{error}>` · `publish({name,author,html,ownerKey}) -> {row:{id}}|{error}` · `update({id,ownerKey,name?,html?}) -> {ok}|{error}` · `remove({id,ownerKey}) -> {ok}|{error}` · `renameAuthor({ownerKey,author}) -> {count}|{error}`

- [ ] **Step 1: Write the failing tests (mapping/pur)**

```js
test('rowToObject / objectToRow sont réciproques dans l ordre COLUMNS', () => {
  const o = { id:'1', name:'n', author:'a', html:'<i>', created_at:'t', updated_at:'', owner_key:'k' };
  assert.deepEqual(rowToObject(objectToRow(o)), o);
});
test('stripOwnerKey retire owner_key', () => {
  assert.equal('owner_key' in stripOwnerKey({ id:'1', owner_key:'k' }), false);
});
test('list ne renvoie jamais owner_key (via mapping)', () => {
  const mapped = [['1','n','a','<i>','t','','SECRET']].map(rowToObject).map(stripOwnerKey);
  assert.equal(JSON.stringify(mapped).includes('SECRET'), false);
});
```

- [ ] **Step 2: Run to verify fail** — `node --test test/gsheet.test.js` → FAIL.

- [ ] **Step 3: Implement le CRUD**

Endpoints Sheets v4 (prouvés par le spike) :
- `list` : GET `…/values/Sheet1!A:G` ; ignore la ligne d'en-têtes ; `rows.slice(1).map(rowToObject).map(stripOwnerKey)`.
- `publish` : si l'onglet est vide → écrire d'abord `COLUMNS` (append) ; générer `id` (`crypto.randomUUID()`), `created_at=ISO` ; append `objectToRow`.
- `update`/`remove`/`renameAuthor` : GET `A:G`, retrouver la/les ligne(s) par `id`/`owner_key`, vérifier `owner_key` ; `update` → PUT `…/values/Sheet1!A{r}:G{r}` ; `remove` → `:batchUpdate` `deleteDimension` avec `sheetId` récupéré via GET `?fields=sheets.properties` ; `renameAuthor` → PUT des cellules `author` des lignes du propriétaire, renvoyer le compte.
- Toute erreur réseau/HTTP → `{ error: '...' }` (jamais d'exception non capturée ; `html` trop gros = HTTP 400 rapporté).

- [ ] **Step 4: Run to verify pass** — `node --test test/gsheet.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/gsheet.js test/gsheet.test.js
git commit -m "feat(gsheet): CRUD composants (list/publish/update/remove/renameAuthor), owner_key jamais expose"
```

---

### Task 3: `main.js` + `preload.js` — brancher Gsheet, retirer Supabase

**Files:**
- Modify: `main.js` (require `electron` ligne 1 → ajouter `dialog` ; bloc Supabase `main.js:534-635` → délégation `lib/gsheet.js` ; ajouter 2 handlers)
- Modify: `preload.js` (ajouter `gsheetImportKey`, `gsheetKeyStatus`)
- Reference: `lib/gsheet.js` (Tasks 1-2), `main.js:643-651` (pattern `NO_WRITE_TOKEN`)

**Interfaces:**
- Consumes: `lib/gsheet.js` (toutes fonctions).
- Produces: handlers `gsheet-import-key`, `gsheet-key-status` ; `preload`: `gsheetImportKey() -> {ok,email}|{error}`, `gsheetKeyStatus() -> {present,email?}`.

- [ ] **Step 1: Rewire `main.js`**

`const { app, BrowserWindow, ipcMain, shell, dialog } = require('electron');` + `const gsheet = require('./lib/gsheet');`. Supprimer `SUPABASE_URL/SUPABASE_KEY/sbHeaders/sbRpc`. Réécrire les 5 handlers `shared-*` pour `await gsheet.list()/publish/update/remove/renameAuthor(...)` (si pas de clé présente → renvoyer `{error:'NO_KEY'}`). Ajouter `gsheet-key-status` → `gsheet.keyStatus()` et `gsheet-import-key` → `dialog.showOpenDialog({properties:['openFile'],filters:[{name:'JSON',extensions:['json']}]})` puis `gsheet.importKey(path)`.

- [ ] **Step 2: Rewire `preload.js`** — ajouter les 2 passerelles dans `exposeInMainWorld('api', …)`.

- [ ] **Step 3: Verify — plus aucune référence Supabase**

Run: `grep -rn "SUPABASE\|supabase\|sbRpc\|sbHeaders" main.js`
Expected: aucune ligne.

- [ ] **Step 4: Verify manuel — import + statut via DevTools**

Lancer l'app ; en console renderer : `await window.api.gsheetImportKey()` (choisir le JSON) → `{ok, email}` ; `await window.api.gsheetKeyStatus()` → `{present:true, email}` ; `await window.api.sharedPublish({name:'t',html:'<i>x</i>',author:'moi',ownerKey:'k'})` → `{row:{id}}` ; vérifier la ligne dans le Sheet ; `await window.api.sharedList()` → la contient, **sans** `owner_key`.

- [ ] **Step 5: Commit**

```bash
git add main.js preload.js
git commit -m "feat(gsheet): handlers shared-* bascules sur Google Sheets + import/statut de cle; Supabase retire"
```

---

### Task 4: Portage de l'UI bibliothèque partagée dans la nouvelle app

**Files:**
- Modify: `src/features/library.js` (ajouter le volet partagé)
- Modify: `index.html` (onglet `tab-shared`, bouton recharger, modale auteur `authorModal`)
- Modify: `src/bootstrap.js` (câblage onglets/boutons, prompt import clé)
- Reference (source à porter, code fonctionnel) : `index.legacy.html:2244-2459` (ownerKey, authorName/settings, publish/update/delete/renameSharedComponent/editAuthorName, renderSharedGrid)
- Test: `test/features/library.test.js`

**Interfaces:**
- Consumes: `window.api.shared*`, `window.api.gsheetKeyStatus/gsheetImportKey`, `window.api.settingsGet/settingsSet`.
- Produces: `library` expose en plus `loadShared()`, `publish(item)`, `setLibTab(tab)`.

- [ ] **Step 1: Write the failing test**

```js
// jsdom + api mock. Monte library avec api.sharedList renvoyant 1 row {id,name,author,html}
// (sans owner_key), api.gsheetKeyStatus -> {present:true}.
test('loadShared peuple la grille partagee depuis l API', async () => {
  await library.loadShared();
  assert.equal(sharedGrid.querySelectorAll('[data-shared-card]').length, 1);
});
test('publish sans cle declenche le prompt d import (NO_KEY)', async () => {
  api.sharedPublish = async () => ({ error: 'NO_KEY' });
  const asked = [];
  library.publish({ name:'t', html:'<i>x</i>' }); // doit appeler gsheetImportKey
  // assert que importKey a été proposé (flag mock)
});
```

- [ ] **Step 2: Run to verify fail** — `node --test test/features/library.test.js` → FAIL.

- [ ] **Step 3: Porter l'UI**

Depuis `index.legacy.html:2244-2459`, porter dans `src/features/library.js` : `ownerKey()` (localStorage `ekwa_owner_key`), identité auteur via `settingsGet/Set` (`authorName`, `setAuthorName`, `editAuthorName`), `loadShared()`, `renderSharedGrid()` (badge auteur, boutons renommer/supprimer si propriétaire via `ownedIds()`), `publish/update/delete/rename`. Insertion d'une slice partagée via `store.add(html,'library')` (autorité store, comme l'insertion locale). Gérer `{error:'NO_KEY'}` → appeler `gsheetImportKey()` puis réessayer. Dans `index.html` : onglet `tab-shared`, `#shared-reload`, grille, et la modale `authorModal` (champ nom). `bootstrap.js` : câbler onglets local/partagé, boutons, et le prompt d'import. (Le drapeau `CLOUD_LIB` legacy n'existe pas ici : la nouvelle app a l'UI partagée active par construction.)

- [ ] **Step 4: Run to verify pass** — `node --test test/features/library.test.js` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/features/library.js index.html src/bootstrap.js test/features/library.test.js
git commit -m "feat(library): portage UI bibliotheque partagee (onglet, publier/MAJ/suppr, identite auteur)"
```

---

### Task 5: Vérification bout-en-bout + nettoyage

**Files:**
- Verify only (+ corrections éventuelles dans les fichiers ci-dessus)

- [ ] **Step 1: Suite complète**

Run: `npm test`
Expected: PASS (dont `test/gsheet.test.js`, `test/features/library.test.js`, et les tests existants inchangés).

- [ ] **Step 2: Vérif manuelle dans l'app (parcours équipe)**

Lancer l'app : importer la clé (1ère fois) → publier une slice → la voir dans le Sheet et dans l'onglet « Partagée » → recharger → renommer (propriétaire) → supprimer (propriétaire) → vérifier le Sheet. Depuis une install SANS clé : une action partagée propose l'import.

- [ ] **Step 3: Vérif sécurité**

Run: `grep -rn "private_key\|BEGIN PRIVATE KEY\|esoteric-sled" src main.js preload.js index.html` → aucune ligne. Confirmer que `package.json` `build.files` n'inclut pas la clé et que `userData/gsheet-credentials.json` est `0o600`.

- [ ] **Step 4: Commit (si corrections)**

```bash
git add -A
git commit -m "test(gsheet): verification bout-en-bout biblio partagee Google Sheets"
```

---

## Notes d'exécution

- Ordre : 1 → 2 → 3 → 4 → 5 (3 dépend de 1-2 ; 4 dépend de 3).
- Prérequis Google (confirmés par le spike) : Sheet partagé Éditeur avec le compte de service, Sheets API activée, onglet `Sheet1`.
- Reporté/hors périmètre : rotation de clé, `SPREADSHEET_ID` configurable via réglages, limite 50 000 car./cellule (découpage d'une slice géante).
- Après cette feature : reprise de la sérialisation (plan `2026-11-23-serialiseur-profils.md`).
