# Portage Phase 1 — Socle A (import/export verbatim Prismic) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importer une slice Prismic `custom_slice` **verbatim** (sans aplatissement) dans le canvas EkwaSlice, et repousser les modifications vers le **même** document Prismic (`update_document`).

**Architecture:** Fonctions pures isolées dans `lib/prismic-slice.js` (UMD : `require` côté main + `<script src>` côté renderer + testables via `node --test`). Deux IPC main.js (`pull-prismic`, `update-prismic`) qui spawnent le CLI `claude` avec le MCP Prismic (même patron que `push-prismic`). Renderer : modale « Importer depuis Prismic » + injection verbatim taguée `data-remote-id`/`data-base-version`, et bouton « Mettre à jour dans Prismic » réutilisant `exportPlain()`.

**Tech Stack:** Electron (Node v26), `claude` CLI headless + MCP `mcp__claude_ai_Prismic`, Tailwind (aperçu), `node:test` + `node:assert`.

**Spec:** `docs/superpowers/specs/2026-09-01-portage-slices-design.md` (Phase 1 = §7).

## Global Constraints

- **Verbatim** : à l'import, ne JAMAIS aplatir le CSS en inline (contrairement à `importCode`). CSS → `<style>`, JS → `<script type="text/ekw-js">` (inerte dans le canvas, réactivé en aperçu par `buildPreviewDoc`).
- **Jamais publier** : `update_document`/`create_document` créent/mettent à jour un brouillon ; NE JAMAIS appeler `publish_release` (publication manuelle dans le dashboard).
- **Repo Prismic** : `ekwateur-edito`, custom type `custom_slice`, locale `fr-fr`, champs `html_only` / `css` / `js` / `html`.
- **MCP côté app** : serveur `mcp__claude_ai_Prismic` (celui configuré dans le CLI du poste), outils déférés → charger via `ToolSearch`.
- **Sécurité** : aucun token embarqué. `codeInsee` jamais exposé/mentionné.
- **Garde-fou** : un update ne part que si `documentId` ET `baseVersionId` sont présents.

---

### Task 1: Fonction pure `parsePrismicDocId`

**Files:**
- Create: `lib/prismic-slice.js`
- Create: `test/prismic-slice.test.js`
- Modify: `package.json:6-11` (ajouter le script `test`)

**Interfaces:**
- Consumes: rien.
- Produces: `parsePrismicDocId(input: string): string|null` — extrait l'id d'un document depuis une URL builder Prismic ou un id brut ; `null` si rien de valide. Exporté via UMD sous `PrismicSlice`.

- [ ] **Step 1: Ajouter le script de test**

Dans `package.json`, sous `"scripts"`, ajouter après la ligne `"start"` :

```json
        "test": "node --test test/",
```

- [ ] **Step 2: Écrire le test qui échoue**

Créer `test/prismic-slice.test.js` :

```js
const { test } = require('node:test');
const assert = require('node:assert');
const { parsePrismicDocId } = require('../lib/prismic-slice.js');

test('parsePrismicDocId: URL builder avec query', () => {
  assert.strictEqual(
    parsePrismicDocId('https://ekwateur-edito.prismic.io/builder/pages/aamJGhAAACQALA7F?s=unclassified'),
    'aamJGhAAACQALA7F'
  );
});
test('parsePrismicDocId: id brut', () => {
  assert.strictEqual(parsePrismicDocId('aamJGhAAACQALA7F'), 'aamJGhAAACQALA7F');
});
test('parsePrismicDocId: vide/invalide', () => {
  assert.strictEqual(parsePrismicDocId(''), null);
  assert.strictEqual(parsePrismicDocId('   '), null);
  assert.strictEqual(parsePrismicDocId('pas un id'), null);
});
```

- [ ] **Step 3: Lancer le test — doit échouer**

Run: `npm test`
Expected: FAIL (`Cannot find module '../lib/prismic-slice.js'`).

- [ ] **Step 4: Implémentation minimale**

Créer `lib/prismic-slice.js` :

```js
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PrismicSlice = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function parsePrismicDocId(input) {
    const s = String(input || '').trim();
    if (!s) return null;
    const mUrl = s.match(/\/pages\/([A-Za-z0-9_-]+)/);
    if (mUrl) return mUrl[1];
    const mId = s.match(/^[A-Za-z0-9_-]{10,}$/);
    return mId ? s : null;
  }
  return { parsePrismicDocId };
});
```

- [ ] **Step 5: Lancer le test — doit passer**

Run: `npm test`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add lib/prismic-slice.js test/prismic-slice.test.js package.json
git commit -m "feat(portage): parsePrismicDocId + harnais de test node"
```

---

### Task 2: Fonction pure `buildVerbatimSliceHTML`

**Files:**
- Modify: `lib/prismic-slice.js`
- Modify: `test/prismic-slice.test.js`

**Interfaces:**
- Consumes: rien.
- Produces: `buildVerbatimSliceHTML(trio: {html_only?, css?, js?, html?}): string` — retourne UN élément racine `<div>…</div>` : `<style>` (si css), le contenu (`html_only` sinon `html`) avec tout `<script>` neutralisé en `type="text/ekw-js"`, puis `<script type="text/ekw-js">` (si js). Exporté via `PrismicSlice`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `test/prismic-slice.test.js` :

```js
const { buildVerbatimSliceHTML } = require('../lib/prismic-slice.js');

test('buildVerbatimSliceHTML: champs séparés', () => {
  const out = buildVerbatimSliceHTML({ html_only: '<p>Bonjour</p>', css: '.x{color:red}', js: 'console.log(1)' });
  assert.match(out, /^<div>/);
  assert.match(out, /<style>\.x\{color:red\}<\/style>/);
  assert.match(out, /<p>Bonjour<\/p>/);
  assert.match(out, /<script type="text\/ekw-js">console\.log\(1\)<\/script>/);
});
test('buildVerbatimSliceHTML: tout dans html avec script → neutralisé', () => {
  const out = buildVerbatimSliceHTML({ html: '<div id="r"></div><script>init()<\/script>' });
  assert.match(out, /<script type="text\/ekw-js">init\(\)<\/script>/);
  assert.doesNotMatch(out, /<script>/); // plus aucun script brut
});
test('buildVerbatimSliceHTML: vide', () => {
  assert.strictEqual(buildVerbatimSliceHTML({}), '<div></div>');
});
test('buildVerbatimSliceHTML: script déjà typé non doublé', () => {
  const out = buildVerbatimSliceHTML({ html: '<script type="application/json">{}<\/script>' });
  assert.match(out, /<script type="application\/json">/);
});
```

- [ ] **Step 2: Lancer — doit échouer**

Run: `npm test`
Expected: FAIL (`buildVerbatimSliceHTML is not a function`).

- [ ] **Step 3: Implémentation**

Dans `lib/prismic-slice.js`, ajouter avant le `return { … }` :

```js
  function neutralizeScripts(html) {
    return String(html || '').replace(/<script(?![^>]*\btype=)([^>]*)>/gi, '<script type="text/ekw-js"$1>');
  }
  function buildVerbatimSliceHTML(trio) {
    trio = trio || {};
    const css = (trio.css || '').trim();
    const js = (trio.js || '').trim();
    const content = (trio.html_only || '').trim() || (trio.html || '').trim();
    let out = '<div>';
    if (css) out += '<style>' + css + '</style>';
    out += neutralizeScripts(content);
    if (js) out += '<script type="text/ekw-js">' + js + '</script>';
    out += '</div>';
    return out;
  }
```

Et étendre l'objet exporté : `return { parsePrismicDocId, buildVerbatimSliceHTML };`

- [ ] **Step 4: Lancer — doit passer**

Run: `npm test`
Expected: PASS (7 tests cumulés).

- [ ] **Step 5: Commit**

```bash
git add lib/prismic-slice.js test/prismic-slice.test.js
git commit -m "feat(portage): buildVerbatimSliceHTML (verbatim, scripts inertes)"
```

---

### Task 3: Fonction pure `extractTrioFromClaudeResult`

**Files:**
- Modify: `lib/prismic-slice.js`
- Modify: `test/prismic-slice.test.js`

**Interfaces:**
- Consumes: rien.
- Produces: `extractTrioFromClaudeResult(text: string): object|null` — extrait le JSON renvoyé par le CLI (bloc ```json … ``` en priorité, sinon premier `{` … dernier `}`), le parse, renvoie l'objet s'il contient `html` ou `html_only`, sinon `null`. Exporté via `PrismicSlice`.

- [ ] **Step 1: Écrire les tests qui échouent**

Ajouter à `test/prismic-slice.test.js` :

```js
const { extractTrioFromClaudeResult } = require('../lib/prismic-slice.js');

test('extractTrio: bloc json fencé', () => {
  const txt = 'Voici le doc :\n```json\n{"title":"T","documentId":"d1","baseVersionId":"v1","html_only":"<p>x</p>","css":"","js":""}\n```\nfini';
  const o = extractTrioFromClaudeResult(txt);
  assert.strictEqual(o.documentId, 'd1');
  assert.strictEqual(o.baseVersionId, 'v1');
  assert.strictEqual(o.html_only, '<p>x</p>');
});
test('extractTrio: json brut', () => {
  const o = extractTrioFromClaudeResult('{"html":"<div></div>","css":"a{}"}');
  assert.strictEqual(o.css, 'a{}');
});
test('extractTrio: pas de trio → null', () => {
  assert.strictEqual(extractTrioFromClaudeResult('aucun json ici'), null);
  assert.strictEqual(extractTrioFromClaudeResult('{"foo":1}'), null);
});
```

- [ ] **Step 2: Lancer — doit échouer**

Run: `npm test`
Expected: FAIL (`extractTrioFromClaudeResult is not a function`).

- [ ] **Step 3: Implémentation**

Dans `lib/prismic-slice.js`, ajouter avant le `return { … }` :

```js
  function extractTrioFromClaudeResult(text) {
    const s = String(text || '');
    let jsonStr = null;
    const fence = s.match(/```json\s*([\s\S]*?)```/i);
    if (fence) jsonStr = fence[1];
    else { const b = s.indexOf('{'), e = s.lastIndexOf('}'); if (b >= 0 && e > b) jsonStr = s.slice(b, e + 1); }
    if (!jsonStr) return null;
    try { const o = JSON.parse(jsonStr); if (o && (('html' in o) || ('html_only' in o))) return o; } catch (_) { }
    return null;
  }
```

Et étendre l'export : `return { parsePrismicDocId, buildVerbatimSliceHTML, extractTrioFromClaudeResult };`

- [ ] **Step 4: Lancer — doit passer**

Run: `npm test`
Expected: PASS (10 tests cumulés).

- [ ] **Step 5: Commit**

```bash
git add lib/prismic-slice.js test/prismic-slice.test.js
git commit -m "feat(portage): extractTrioFromClaudeResult"
```

---

### Task 4: IPC `pull-prismic` (main) + pont preload

**Files:**
- Modify: `main.js` (après le handler `push-prismic`, ~ligne 657) et en tête pour `require` de la lib
- Modify: `preload.js:9` (ajouter `pullPrismic`)

**Interfaces:**
- Consumes: `extractTrioFromClaudeResult` (Task 3), `resolveClaudeBin()` (existant), `MODEL` (existant).
- Produces: IPC `pull-prismic(docId: string)` → `{ ok:true, trio:{html_only,css,js,html}, documentId, baseVersionId, title } | { error }`. Pont preload : `window.api.pullPrismic(docId)`.

- [ ] **Step 1: Requérir la lib dans main.js**

En haut de `main.js`, près des autres `require` (ex. après `const os = require('os');`), ajouter :

```js
const PrismicSlice = require('./lib/prismic-slice.js');
```

- [ ] **Step 2: Ajouter le handler `pull-prismic`**

Juste après la fin du handler `push-prismic` (avant le commentaire du proxy prix), ajouter :

```js
ipcMain.handle('pull-prismic', async (event, docId) => {
  const id = PrismicSlice.parsePrismicDocId(docId);
  if (!id) return { error: 'Identifiant Prismic invalide.' };
  const bin = resolveClaudeBin();
  const prompt = [
    'Objectif : LIRE un document Prismic (repository "ekwateur-edito") et renvoyer son contenu.',
    'Les outils MCP Prismic sont déférés : charge-les avec ToolSearch si nécessaire.',
    '1. get_document repository "ekwateur-edito", documentId ' + JSON.stringify(id) + '.',
    '2. Renvoie UNIQUEMENT un bloc ```json contenant EXACTEMENT :',
    '   {"title":"…","documentId":"' + id + '","baseVersionId":"<version.id renvoyé>",',
    '    "html_only":"<valeur du champ html_only ou \\"\\">","css":"<champ css>","js":"<champ js>","html":"<champ html>"}',
    '   Valeurs texte EXACTES des champs (chaîne vide si le champ est absent). Ne modifie rien. Aucune autre sortie.'
  ].join('\n');
  const args = ['-p', prompt,
    '--allowedTools', 'ToolSearch', 'mcp__claude_ai_Prismic', 'mcp__claude_ai_Prismic__get_document',
    '--model', MODEL, '--output-format', 'json'];
  return new Promise((resolve) => {
    let child;
    try { child = spawn(bin, args, { cwd: os.tmpdir() }); }
    catch (e) { return resolve({ error: 'Impossible de lancer claude : ' + e.message }); }
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); resolve({ error: 'Délai dépassé (180 s).' }); }, 180000);
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: 'CLI claude introuvable : ' + e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve({ error: err.trim() || ('claude a quitté (code ' + code + ')') });
      let result = '';
      try { result = JSON.parse(out).result || ''; } catch (_) { return resolve({ error: 'Parsing réponse impossible.' }); }
      const o = PrismicSlice.extractTrioFromClaudeResult(result);
      if (!o || !o.documentId) return resolve({ error: 'Réponse inattendue de Claude', raw: result.slice(0, 300) });
      resolve({ ok: true, trio: { html_only: o.html_only || '', css: o.css || '', js: o.js || '', html: o.html || '' }, documentId: o.documentId, baseVersionId: o.baseVersionId || '', title: o.title || '' });
    });
  });
});
```

- [ ] **Step 3: Exposer dans preload.js**

Après la ligne `pushPrismic: …` (preload.js:26), ajouter :

```js
  pullPrismic: (docId) => ipcRenderer.invoke('pull-prismic', docId),
```

- [ ] **Step 4: Vérifier la syntaxe**

Run: `node --check main.js && node --check preload.js`
Expected: aucune erreur.

- [ ] **Step 5: Vérification manuelle live (lecture seule, sans risque)**

Lancer l'app (`npm start`), ouvrir la console du renderer (DevTools) et exécuter :

```js
await window.api.pullPrismic('aamJGhAAACQALA7F')
```

Expected : objet `{ ok:true, documentId:'aamJGhAAACQALA7F', baseVersionId:'…', title:'[Custom slice] Carte interactive petits producteurs', trio:{ html:'…leaflet…', css:'…', js:'…' } }`. (Lecture seule : ne modifie rien.)

- [ ] **Step 6: Commit**

```bash
git add main.js preload.js
git commit -m "feat(portage): IPC pull-prismic (get_document -> trio verbatim)"
```

---

### Task 5: Import depuis Prismic dans l'UI (renderer)

**Files:**
- Modify: `index.html` (charger la lib ; bouton header ; modale ; fonctions `openPrismicImport`, `doPrismicImport`, `injectVerbatimSlice`)

**Interfaces:**
- Consumes: `window.api.pullPrismic` (Task 4), `window.PrismicSlice.buildVerbatimSliceHTML` (Task 2), `injectGenerated` / `setMode` / `selectElement` / `toast` / `askName` (existants).
- Produces: `injectVerbatimSlice(trio, meta): Element` — injecte la slice verbatim et pose `data-remote-id`, `data-base-version`, `data-remote-title` sur l'élément `data-comp`. Bouton header « Importer Prismic ».

- [ ] **Step 1: Charger la lib dans le renderer**

Dans `index.html`, juste avant le grand `<script>` de l'app (ou dans le `<head>`), ajouter :

```html
<script src="lib/prismic-slice.js"></script>
```

- [ ] **Step 2: Ajouter le bouton header**

Dans le `<div class="flex items-center gap-4">` du header (à côté du bouton « Envoi Prismic »), ajouter :

```html
            <button onclick="openPrismicImport()" title="Importer une slice existante depuis Prismic (verbatim)"
                class="px-3 py-2 text-sm bg-slate-700 hover:bg-slate-600 rounded-lg transition text-slate-200 font-medium flex items-center gap-2">
                <i class="fa-solid fa-cloud-arrow-down"></i>Importer Prismic
            </button>
```

- [ ] **Step 3: Ajouter la modale**

Avant `</body>`, ajouter :

```html
<div id="prismicImportModal" class="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 hidden flex items-center justify-center p-6">
  <div class="bg-slate-800 rounded-2xl p-6 w-full max-w-lg space-y-4">
    <h2 class="text-white font-bold text-lg">Importer depuis Prismic</h2>
    <p class="text-slate-400 text-sm">Colle l'URL du document (builder) ou son identifiant. La slice est importée telle quelle (verbatim).</p>
    <input id="prismic-import-input" type="text" placeholder="https://ekwateur-edito.prismic.io/builder/pages/… ou aamJGhAAACQALA7F"
      class="w-full bg-slate-950 border border-slate-600 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-primary">
    <div class="flex justify-end gap-2">
      <button onclick="closePrismicImport()" class="px-4 py-2 text-sm text-slate-300 hover:text-white">Annuler</button>
      <button id="prismic-import-go" onclick="doPrismicImport(this)" class="px-4 py-2 text-sm bg-[#d97757] hover:brightness-110 rounded-lg text-white font-semibold">Importer</button>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Ajouter les fonctions JS**

Dans le `<script>` de l'app (près de `openImport`/`importCode`), ajouter :

```js
function openPrismicImport() { document.getElementById('prismicImportModal').classList.remove('hidden'); document.getElementById('prismic-import-input').focus(); }
function closePrismicImport() { document.getElementById('prismicImportModal').classList.add('hidden'); }
function injectVerbatimSlice(trio, meta) {
  const html = window.PrismicSlice.buildVerbatimSliceHTML(trio);
  const el = injectGenerated(html);
  if (el && meta) {
    el.setAttribute('data-remote-id', meta.documentId || '');
    el.setAttribute('data-base-version', meta.baseVersionId || '');
    if (meta.title) el.setAttribute('data-remote-title', meta.title);
  }
  if (currentMode !== 'edit') setMode('edit');
  if (el) { selectElement(el); el.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
  return el;
}
async function doPrismicImport(btn) {
  if (!window.api || !window.api.pullPrismic) { toast("Dispo seulement dans l'app"); return; }
  const raw = (document.getElementById('prismic-import-input').value || '').trim();
  if (!raw) { toast('Colle une URL ou un id.'); return; }
  const o = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i>Import…'; }
  let r; try { r = await window.api.pullPrismic(raw); } catch (e) { r = { error: e.message }; }
  if (btn) { btn.disabled = false; btn.innerHTML = o; }
  if (!r || r.error || !r.ok) { toast('Échec import : ' + ((r && (r.error || r.raw)) || 'inconnu')); return; }
  closePrismicImport();
  injectVerbatimSlice(r.trio, { documentId: r.documentId, baseVersionId: r.baseVersionId, title: r.title });
  document.getElementById('prismic-import-input').value = '';
  toast('Slice importée depuis Prismic (verbatim) ✓');
}
```

- [ ] **Step 5: Vérifier la syntaxe des scripts inline**

Run:
```bash
node -e 'const fs=require("fs"),vm=require("vm");const h=fs.readFileSync("index.html","utf8");const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;let m,i=0,bad=0;while((m=re.exec(h))){i++;const c=m[1];if(!c.trim())continue;try{new vm.Script(c,{filename:"#"+i});}catch(e){bad++;console.log("#"+i,e.message);}}console.log("scripts:",i,"errors:",bad);'
```
Expected: `errors: 0`.

- [ ] **Step 6: Vérification manuelle live**

`npm start` → bouton **Importer Prismic** → coller `aamJGhAAACQALA7F` → Importer.
Expected : la carte apparaît dans le canvas (coquille visible) ; passer en **Aperçu** → la carte Leaflet se charge et affiche les vraies centrales (JS réactivé + proxy api-so). Vérifier en console : `document.querySelector('[data-comp][data-remote-id]').getAttribute('data-base-version')` non vide.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "feat(portage): import verbatim d'une slice depuis Prismic (UI)"
```

---

### Task 6: IPC `update-prismic` (main) + pont preload

**Files:**
- Modify: `main.js` (après le handler `pull-prismic`)
- Modify: `preload.js` (ajouter `updatePrismic`)

**Interfaces:**
- Consumes: `resolveClaudeBin()`, `MODEL` (existants).
- Produces: IPC `update-prismic({ documentId, baseVersionId, html, css, js })` → `{ ok:true, documentId } | { error }`. Pont : `window.api.updatePrismic(payload)`.

- [ ] **Step 1: Ajouter le handler `update-prismic`**

Après le handler `pull-prismic`, ajouter :

```js
ipcMain.handle('update-prismic', async (event, payload) => {
  const documentId = ((payload && payload.documentId) || '').trim();
  const baseVersionId = ((payload && payload.baseVersionId) || '').trim();
  const html = (payload && payload.html) || '';
  const css = (payload && payload.css) || '';
  const js = (payload && payload.js) || '';
  if (!documentId || !baseVersionId) return { error: 'Document/version Prismic manquant (réimporte la slice).' };
  const bin = resolveClaudeBin();
  const prompt = [
    'Objectif : METTRE À JOUR un document Prismic existant via le MCP Prismic (repository "ekwateur-edito").',
    'Les outils MCP Prismic sont déférés : charge-les avec ToolSearch si nécessaire.',
    'Étapes STRICTES :',
    '1. update_document : repository "ekwateur-edito", documentId ' + JSON.stringify(documentId) + ', baseVersionId ' + JSON.stringify(baseVersionId) + ',',
    '   updates = { "html_only": {"__TYPE__":"FieldContent","type":"Text","value": <HTML>},',
    '               "css": {"__TYPE__":"FieldContent","type":"Text","value": <CSS>},',
    '               "js": {"__TYPE__":"FieldContent","type":"Text","value": <JS>} }',
    '   où <HTML>/<CSS>/<JS> sont EXACTEMENT les blocs délimités ci-dessous (ne les modifie pas).',
    '2. NE PUBLIE JAMAIS (pas de publish_release).',
    'Termine par UNE SEULE ligne JSON et rien d\'autre : {"documentId":"…","ok":true}',
    '',
    '===HTML_ONLY_START===', html, '===HTML_ONLY_END===',
    '===CSS_START===', css, '===CSS_END===',
    '===JS_START===', js, '===JS_END==='
  ].join('\n');
  const args = ['-p', prompt,
    '--allowedTools', 'ToolSearch', 'mcp__claude_ai_Prismic', 'mcp__claude_ai_Prismic__update_document',
    '--model', MODEL, '--output-format', 'json'];
  return new Promise((resolve) => {
    let child;
    try { child = spawn(bin, args, { cwd: os.tmpdir() }); }
    catch (e) { return resolve({ error: 'Impossible de lancer claude : ' + e.message }); }
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); resolve({ error: 'Délai dépassé (180 s).' }); }, 180000);
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: 'CLI claude introuvable : ' + e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve({ error: err.trim() || ('claude a quitté (code ' + code + ')') });
      let result = '';
      try { result = JSON.parse(out).result || ''; } catch (_) { return resolve({ error: 'Parsing réponse impossible.' }); }
      const m = result.match(/\{[^{}]*"documentId"[^{}]*\}/);
      let info = null; if (m) { try { info = JSON.parse(m[0]); } catch (_) { } }
      if (info && info.documentId) return resolve({ ok: true, documentId: info.documentId });
      return resolve({ ok: false, error: 'Réponse inattendue de Claude', raw: result.slice(0, 300) });
    });
  });
});
```

- [ ] **Step 2: Exposer dans preload.js**

Après `pullPrismic: …`, ajouter :

```js
  updatePrismic: (payload) => ipcRenderer.invoke('update-prismic', payload),
```

- [ ] **Step 3: Vérifier la syntaxe**

Run: `node --check main.js && node --check preload.js`
Expected: aucune erreur.

- [ ] **Step 4: Vérification manuelle live (sur un doc JETABLE, jamais le doc de référence)**

Créer d'abord un doc de test via « Envoi Prismic » (bouton existant), noter son `documentId`, l'importer via **Importer Prismic**, modifier un texte, puis en console :

```js
const el = document.querySelector('[data-comp][data-remote-id]');
const out = exportPlain();
await window.api.updatePrismic({ documentId: el.getAttribute('data-remote-id'), baseVersionId: el.getAttribute('data-base-version'), html: out.html, css: out.css, js: out.js });
```

Expected : `{ ok:true, documentId:'…' }`. Vérifier dans le dashboard Prismic que le brouillon du doc de test reflète la modif. **Ne jamais viser le doc `aamJGhAAACQALA7F` de référence.**

- [ ] **Step 5: Commit**

```bash
git add main.js preload.js
git commit -m "feat(portage): IPC update-prismic (update_document, brouillon)"
```

---

### Task 7: Bouton « Mettre à jour dans Prismic » (renderer)

**Files:**
- Modify: `index.html` (bouton header conditionnel + fonction `updateInPrismic`)

**Interfaces:**
- Consumes: `window.api.updatePrismic` (Task 6), `exportPlain()` (existant, renvoie `{html,css,js}` + renseigne `lastExport`), `toast`.
- Produces: `updateInPrismic(btn)` ; `refreshPrismicUpdateBtn()` qui affiche le bouton seulement si le canvas contient une slice importée (`[data-comp][data-remote-id]`).

- [ ] **Step 1: Ajouter le bouton header (caché par défaut)**

Dans le `<div class="flex items-center gap-4">` du header, après « Importer Prismic », ajouter :

```html
            <button id="prismic-update-btn" onclick="updateInPrismic(this)" title="Repousser les modifications vers le document Prismic importé"
                class="hidden px-3 py-2 text-sm bg-emerald-600 hover:brightness-110 rounded-lg transition text-white font-semibold items-center gap-2">
                <i class="fa-solid fa-cloud-arrow-up"></i>Mettre à jour Prismic
            </button>
```

- [ ] **Step 2: Ajouter les fonctions JS**

Près de `quickPushPrismic` :

```js
function refreshPrismicUpdateBtn() {
  const b = document.getElementById('prismic-update-btn');
  if (!b) return;
  const has = !!document.querySelector('#canvas [data-comp][data-remote-id]');
  b.classList.toggle('hidden', !has);
  b.classList.toggle('flex', has);
}
async function updateInPrismic(btn) {
  if (!window.api || !window.api.updatePrismic) { toast("Dispo seulement dans l'app"); return; }
  const el = document.querySelector('#canvas [data-comp][data-remote-id]');
  if (!el) { toast('Aucune slice importée de Prismic.'); return; }
  const out = exportPlain();
  const o = btn ? btn.innerHTML : '';
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i>MàJ…'; }
  let r; try {
    r = await window.api.updatePrismic({ documentId: el.getAttribute('data-remote-id'), baseVersionId: el.getAttribute('data-base-version'), html: out.html, css: out.css, js: out.js });
  } catch (e) { r = { error: e.message }; }
  if (btn) { btn.disabled = false; btn.innerHTML = o; }
  if (!r || r.error || !r.ok) { toast('Échec MàJ : ' + ((r && (r.error || r.raw)) || 'inconnu')); return; }
  toast('Document Prismic mis à jour (brouillon) ✓ — à publier dans le dashboard');
}
```

- [ ] **Step 3: Rafraîchir le bouton après import et après changement de canvas**

Dans `injectVerbatimSlice` (Task 5), avant le `return el;`, ajouter :

```js
  refreshPrismicUpdateBtn();
```

Et à la fin de `doPrismicImport` (après le `toast(...)`), c'est déjà couvert par `injectVerbatimSlice`. Ajouter aussi un appel dans `clearCanvas()` (près de la suppression des `[data-comp]`) :

```js
  refreshPrismicUpdateBtn();
```

- [ ] **Step 4: Vérifier la syntaxe des scripts inline**

Run:
```bash
node -e 'const fs=require("fs"),vm=require("vm");const h=fs.readFileSync("index.html","utf8");const re=/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;let m,i=0,bad=0;while((m=re.exec(h))){i++;const c=m[1];if(!c.trim())continue;try{new vm.Script(c,{filename:"#"+i});}catch(e){bad++;console.log("#"+i,e.message);}}console.log("scripts:",i,"errors:",bad);'
```
Expected: `errors: 0`.

- [ ] **Step 5: Vérification manuelle live (doc jetable)**

`npm start` → **Importer Prismic** (doc de test) → le bouton **Mettre à jour Prismic** apparaît → modifier un texte (section Textes dynamiques) → cliquer **Mettre à jour Prismic** → toast succès → vérifier le brouillon dans le dashboard. Vider le canvas → le bouton disparaît.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "feat(portage): bouton Mettre à jour dans Prismic (round-trip)"
```

---

## Self-Review

**1. Couverture spec (Phase 1 = §7 socle A) :**
- Import verbatim (`get_document` → trio, sans aplatissement) → Tasks 2, 4, 5. ✓
- Rendu verbatim (CSS `<style>`, JS `text/ekw-js`) → Task 2 + aperçu existant. ✓
- Export/update-back (`update_document`, baseVersionId) → Tasks 6, 7. ✓
- Round-trip via `exportPlain()` → Task 7. ✓
- Parse id URL/brut → Task 1. ✓
- Réutilisation envoi Prismic existant (patron spawn) → Tasks 4, 6. ✓
- Hors périmètre (agent de portage, diff screenshot) = Phases 2-3, non couvert ici. ✓ (voulu)

**2. Placeholders :** aucun TODO/TBD ; tout le code est fourni.

**3. Cohérence des types :** `parsePrismicDocId`, `buildVerbatimSliceHTML`, `extractTrioFromClaudeResult` définies Task 1-3, utilisées Task 4-5 avec les mêmes signatures ; `pull-prismic` renvoie `{trio,documentId,baseVersionId,title}` consommés tels quels Task 5 ; `data-remote-id`/`data-base-version` posés Task 5, lus Task 7 (mêmes noms) ; `update-prismic` attend `{documentId,baseVersionId,html,css,js}` fournis exactement Task 7.

**Note test :** Tasks 1-3 en TDD `node --test` (fonctions pures). Tasks 4-7 = vérification manuelle live (spawn `claude` + MCP + GUI Electron non automatisables sans harnais, cohérent avec la pratique du projet). Les updates de test visent TOUJOURS un doc jetable, jamais `aamJGhAAACQALA7F`.
