# Refonte de la gestion du contenu canvas — EkwaSlice

Date : 2026-10-16
Statut : design approuvé (brainstorming), à transformer en plan d'implémentation.

## 1. Intention et pourquoi

EkwaSlice (app Electron, générateur de composants web → import/export/MAJ Prismic)
construit des « slices » dans un canvas éditable. Aujourd'hui **il n'y a aucun modèle de
données** : le DOM de `#canvas` EST la source de vérité, et chaque fonctionnalité relit ou
re-sérialise directement le DOM vivant. Tout (`index.html`) tient dans un seul `<script>` de
~3200 lignes.

Conséquence : la gestion du contenu est « bancale ». Les opérations (ajout, suppression,
import, export, MAJ, prompt chat, édition) mutent le canvas depuis **~12 endroits différents**,
sans autorité unique. Chaque nouvelle feature ou cas d'usage casse un cas existant.

Bugs symptomatiques observés :
- **Fantômes** : supprimer une slice importée laisse une coquille (`data-remote-id` + `<style>`
  + `<script>` orphelins) qui ressort à l'export. Cause : la suppression agit sur `sel` (qui
  peut être un élément imbriqué) et fait `el.remove()` → la racine `[data-comp]` reste, vidée.
- **Scripts cassés à l'export** : l'export renomme les classes `.carousel-track` → `.eks-xxx-N`
  dans le HTML et le CSS, **mais pas dans le JS** → `querySelector('.carousel-track')` ne matche
  plus rien, le widget est mort en prod.
- **Undo destructif** : `undo` fait `canvas.innerHTML = snapshot` → invalide toutes les
  références vivantes (`sel`, `targetEl`, `prismicTarget`, `pending.el`).
- **4 implémentations « clean »** différentes (mountSlice, cleanForSave, cleanHTML, exportPlain)
  avec des listes d'attributs légèrement divergentes.
- **~30 variables d'état** au top-level, sans store central.

But : un **cœur robuste et unique** qui gère de bout en bout add / suppression / import /
export / MAJ / prompt / édition intra-slice, pensé long terme pour que les features futures
s'ajoutent sans tout refixer.

## 2. Objectifs

- **Source de vérité unique** : un `SliceStore` (liste ordonnée de `Slice`) est la seule
  autorité sur le contenu du canvas. Rien d'autre ne mute la structure de `#canvas`.
- **Slices atomiques** : add / remove / move / duplicate / import / export / MAJ opèrent
  toujours sur une slice **entière**. Suppression = racine entière → **zéro fantôme possible**.
- **Édition intra-slice conservée** (c'est la force de l'app) : sélection, texte inline,
  panneau style, états hover/focus/active, swap picto, ciblage chat d'un élément imbriqué.
- **Export fiable** : fonction pure sur `store.list()`, scope uid sans renommage de classe
  (JS par classe survit), `@keyframes`/`font-face` namespacés par slice (anti-collision).
- **Undo/redo non destructif** : snapshots du store (par slice), restauration par diff d'id.
- **Une seule** fonction de nettoyage d'artefacts et **une seule** de sérialisation.
- **Code modulaire** (ES modules), chaque concern isolé, testable → features faciles à ajouter.
- **Migration big-bang sûre** : nouveau cœur bâti à côté ; l'app actuelle reste fonctionnelle
  jusqu'au switch, fait seulement quand la parité est atteinte et testée.

## 3. Non-objectifs

- Pas de framework (React/Vue/…) ni d'étape de build. Vanilla ES modules, Electron `file://`.
- Pas de re-render global type virtual-DOM (approche A2 écartée : casse l'UX d'édition —
  curseur, sélection, inline — et augmente le risque). Le DOM vivant par slice reste édité
  en place ; le modèle est l'autorité sur la **structure/identité**, pas un moteur de rendu.
- Pas de refonte de l'IPC `main.js`/`preload.js` ni des handlers Prismic/API (restent quasi
  inchangés ; on ne touche qu'à leurs appelants côté renderer).
- Pas de refonte visuelle / charte UX de l'app.
- On ne retravaille pas la dynamisation prix (chantier parké, séparé).

## 4. Anti-objectifs (ce qui signerait un échec même si « ça marche »)

- Toute régression d'une capacité d'édition intra-slice existante.
- Un deuxième chemin de mutation du canvas hors du store (on retomberait dans le problème).
- Une slice qui laisse un résidu après suppression (fantôme).
- Un script de slice qui marche dans l'aperçu mais casse à l'export (ou l'inverse).
- Perte d'identité Prismic (`data-remote-*`) après une édition chat / un undo.

## 5. Contraintes

- Electron, renderer en `file://`, `nodeIntegration:false`, `contextIsolation:true`, tout passe
  par `window.api` (preload). Les ES modules fonctionnent via `<script type="module" src>`.
- Pas de réseau garanti au chargement (assets vendorisés : Tailwind, FontAwesome, lottie).
- Le JS de slice est stocké **inerte** (`<script type="text/ekw-js">`) dans le studio, et n'est
  exécuté QUE dans l'iframe d'aperçu et dans l'export/prod.
- Isolation CSS d'une slice : wrapper à classe unique `uid` + reset `all:initial` déjà en place.
- L'API prix (api-so) n'est appelable que depuis `main.js` (referer forcé) ; l'aperçu passe par
  un shim `window.fetch` relayé via `getQuotation` IPC. Inchangé.

## 6. Architecture décidée (A1 — store DOM-backed)

### 6.1 Modèle

```
Slice = {
  id: string,                 // identité interne stable (jamais exposée à l'export)
  root: HTMLElement,          // la racine DOM vivante de la slice (éditée en place)
  origin: 'generated' | 'imported' | 'library' | 'code',
  meta: {
    prismicId?, prismicTitle?, prismicField?, baseVersion?, prismicUid?,  // identité Prismic
    libId?,                   // origine bibliothèque
    name?                     // nom affiché/registre
  }
}
```

`root` est l'unité atomique : il contient le markup + le `<style>` scellé + le
`<script type="text/ekw-js">` + les attributs d'états (`data-ekw-states`, `data-eid`).

**Usage réel : une seule slice dans le canvas.** Le store supporte N slices (robustesse,
réordonnancement), mais en pratique on édite/exporte UNE slice. Les flux Prismic (export / push /
MAJ) sont **par slice** : 1 slice = 1 document `custom_slice` (voir 6.4).

### 6.2 SliceStore — seule autorité sur `#canvas`

API (toute mutation structurelle passe par là) :
- `add(html, origin, meta?) → Slice` — crée la racine via `createSliceRoot`, l'ajoute au
  canvas et à la liste, émet un événement de changement.
- `remove(id)` — retire la **racine entière** du DOM et de la liste (jamais de coquille).
- `move(id, dir)` — réordonne (DOM + liste).
- `duplicate(id) → Slice` — clone propre (passe par `createSliceRoot` → contrat identique).
- `replaceContent(id, html) → Slice` — remplace le contenu **en préservant `meta`/identité**
  (ce que fait `replaceTargeted` aujourd'hui, mais centralisé et atomique).
- `clear()` — vide le canvas (utilisé par un futur « reset canvas » ; `newChat` ne l'appelle
  pas, il ne touche toujours pas au contenu).
- `get(id)`, `sliceOf(node) → Slice|null` (map n'importe quel nœud → sa slice), `list() → Slice[]`.
- `serialize() → SerializedSlice[]` — pour snapshots/undo (voir 6.5).
- Événement `change` (ou callback) → déclenche MAJ UI (bouton MAJ Prismic, état vide, nav…).

Helpers internes **uniques** (remplacent les doublons) :
- `createSliceRoot(html, meta) → HTMLElement` — **un seul** contrat de racine : applique
  `data-comp`, classe `relative`, (marge gérée par le conteneur, voir note migration), monte
  pictos + régénère les styles d'états. Utilisé par `add`, `duplicate` ET `replaceContent`.
- `cleanArtifacts(node)` — **une seule** fonction de nettoyage (poignées, `.ekw-selected`,
  `.ekw-editing`, `contenteditable`, `data-ekw-pending`, boutons legacy). Remplace les 4
  implémentations divergentes.
- `serializeSlice(slice) → string` — point d'entrée unique de sérialisation, mais qui
  **branche sur `slice.origin`** :
  - `imported` (Prismic verbatim) → extraction **verbatim** (le trio d'origine, AUCUN
    scope/compile/renommage), renvoyé dans le même champ Prismic (`meta.prismicField`). Préserve
    le round-trip Prismic (anti-objectif : ne pas mangler le HTML importé).
  - `generated` / `code` / `library` → HTML auteur canonique (classes Tailwind + hooks),
    destiné au pipeline de compile/scope de l'export (6.4).
  Consommé par export, save bibliothèque, snapshot undo, extraction Prismic.

### 6.3 Édition intra-slice ↔ sérialisation

L'édition reste du DOM vivant **dans** `slice.root` (inchangée fonctionnellement) :
sélection (`sel`), texte inline (`contenteditable` + formatbar), panneau style (inline styles),
états (`data-ekw-states` + `<style id="ekw-live-states">`), picto, textes dynamiques du JS.

Règles :
- Ces éditions ne changent **jamais** quelles slices existent ni leur ordre (pas d'opération
  structurelle). Supprimer un élément imbriqué = édition intra-slice (autorisée) ; supprimer
  « la slice » = `store.remove(id)` (opération structurelle). La barre d'outils et le clavier
  distinguent les deux via `store.sliceOf(sel)` : si `sel` est la racine → `remove`, sinon
  suppression d'un nœud interne (édition).
- La sérialisation ne se fait qu'**à la demande** (export/save/snapshot/MAJ), via
  `serializeSlice`. Pas de re-render permanent.
- **Édition qui modifie le contenu d'une slice** (texte, style, états, picto, remplacement d'un
  nœud imbriqué par le chat) : elle agit sur le DOM vivant **dans** `slice.root`, puis appelle
  `store.touch(id)` → le store émet `change` (déclenche snapshot historique + MAJ UI). C'est la
  frontière propre `editing.js`/`chat.js` ↔ store : les ops **structurelles** passent par
  `add/remove/move/replaceContent` ; les éditions **de contenu** passent par le DOM + `touch(id)`.
  Le ciblage chat **racine** → `store.replaceContent(id, html)` ; le ciblage chat **imbriqué** →
  remplacement du nœud dans la racine (editing) + `store.touch(id)`.
- `createSliceRoot` **re-génère des `data-eid` neufs** au `duplicate()` et à l'import (les styles
  d'états sont scopés par `data-eid` dans un `<style>` global → sans re-mint, deux slices
  partageraient leurs états). `replaceContent` **préserve** les `data-eid` existants quand
  possible, et l'undo-restore les garde stables (clé = `id` de slice).

### 6.4 Export — **par slice** (1 slice = 1 document Prismic)

L'export produit **un trio `{html, css, js}` par slice** (pas un bundle du canvas entier).
En usage normal il n'y a qu'une slice → un seul trio. Si plusieurs slices existent, chacune
s'exporte indépendamment (son propre uid, son propre doc).

- Slice `imported` → `serializeSlice` renvoie le **verbatim** (champ Prismic d'origine), sans
  aucune transformation. Round-trip Prismic préservé.
- Slice `generated`/`code`/`library` → pipeline de compile/scope :
  - scope **par uid** : chaque règle CSS devient `.eks-uid <selecteur>`, reset `all:initial`
    sur le wrapper.
  - **renommage de classe conservé** (`.title` → `.eks-uid-N`) : assure l'isolation **inter-slices
    ET vis-à-vis du CSS générique de la page Ekwateur** (une règle `.title{}` du site ne peut pas
    déteindre sur la slice). 
  - **le même renommage est appliqué au `<script>`** : la table d'alias classe→alias est passée
    sur le JS (remplacement des tokens de classe dans les sélecteurs/chaînes) → les sélecteurs JS
    par classe **survivent** (fin du bug carrousel). Complété par la règle CHARTE existante
    (cibler de préférence par `data-*`). Cas limite documenté : un nom de classe construit
    dynamiquement en JS (concat) ne peut pas être réécrit de façon fiable → la CHARTE impose
    `data-*` pour ce cas ; le plan prévoit un garde-fou/avertissement.
  - **`@keyframes` et `font-face` namespacés par slice** (`spin` → `spin-<uid>`, + réécriture des
    `animation`/`animation-name`) — collision globale non couverte par le scope de classe.
  - JS enveloppé en IIFE. Stocké dans `lastExport`.
- **Dépendance runtime** : la source CSS reste la feuille Tailwind **générée au runtime**
  (`document.styleSheets`) + lectures `getComputedStyle` pour les styles/états. L'export n'est
  donc PAS une fonction pure de `store.list()` seul : il lit le runtime Tailwind (l'`index2.html`
  charge Tailwind, qui doit avoir scanné le canvas avant export). **Testables en Node** : les
  seules transformations de chaînes (préfixe uid, renommage classe HTML+CSS+JS cohérent,
  namespacing keyframes) sur des fixtures ; l'intégration (collecte runtime) se teste dans l'app.
- Le même pipeline sert copy / push Prismic / update Prismic (par slice).

### 6.5 Undo / redo = snapshots du store

- Snapshot = `SerializedSlice[]` = `[{ id, html (serializeSlice), origin, meta, order }]`
  (plus jamais `canvas.innerHTML` brut).
- `restore(snapshot)` : diff par `id` → ne reconstruit (`createSliceRoot`) que les slices
  changées/ajoutées, retire les supprimées, réordonne. Les refs des slices inchangées sont
  préservées → sélection/édition survivent mieux qu'aujourd'hui.
- Déclenchement : le store émet `change` ; le module history débounce et pousse un snapshot
  (remplace la MutationObserver actuelle). `_suspendHistory` conservé pour les éditions d'état.

### 6.6 Découpage en modules ES

- `src/core/store.js` — `SliceStore`, modèle `Slice`, événement `change` (autorité).
- `src/core/slice.js` — `createSliceRoot`, `serializeSlice`, `cleanArtifacts`, mount pictos,
  styles d'états, helpers de scope.
- `src/core/export.js` — export pur (scope uid, keyframes namespacées), `lastExport`.
- `src/core/history.js` — undo/redo sur snapshots du store.
- `src/features/editing.js` — sélection, texte inline, panneau style, états, picto (intra-slice).
- `src/features/chat.js` — ciblage chat (`effectiveTarget`), apply/reject, `store.replaceContent`.
- `src/features/prismic.js` — import verbatim / push / pull / update (via store + meta).
- `src/features/library.js` — save / load / insert bibliothèque.
- `src/features/importCode.js` — import de code collé (flatten CSS).
- `src/ui/*` — toolbar, modales, aperçu (iframe), overlay génération.
- `src/bootstrap.js` — câblage/démarrage.
- `main.js` / `preload.js` / `lib/prismic-slice.js` — IPC/helpers, quasi inchangés.

### 6.7 Bascule big-bang

- Nouveau cœur bâti dans `src/` + un `index2.html` (`<script type="module" src="src/bootstrap.js">`).
  L'`index.html` actuel continue de tourner (aucune régression pendant le chantier).
- Parité validée via la **checklist** (§8) couvrant les 12 zones de la cartographie.
- Switch : `index.html` ← nouveau (ancien gardé en `index.legacy.html` le temps d'un filet),
  `package.json main`/`build.files` ajustés si besoin. Release ensuite.

## 7. Ce qui est laissé au builder (plan d'implémentation)

- Ordre de construction des modules et des slices de travail (le plan détaillera les étapes +
  tests). Suggestion : `store` + `slice` + `createSliceRoot`/`cleanArtifacts`/`serializeSlice`
  d'abord (cœur testable isolément), puis export, puis history, puis features (editing, chat,
  prismic, library), puis UI/bootstrap, puis parité + switch.
- TDD où c'est possible : les **transformations de chaînes** de l'export (préfixe uid, renommage
  classe cohérent HTML+CSS+**JS**, namespacing `@keyframes`) et le **diff d'historique** sont
  testables en Node (`node --test`) sur fixtures. La **collecte CSS runtime** (Tailwind via
  `document.styleSheets`) n'est pas pure → testée en intégration dans l'app, pas en Node.
- Détails d'implémentation du scope : extraction des `@keyframes`/`font-face` et réécriture des
  références `animation(-name)` ; **application de la table d'alias classe→alias au `<script>`**
  (réécriture des tokens de classe dans le JS) ; vérifier qu'aucune règle n'échappe au préfixe uid.
- Mécanique précise de `restore` par diff d'id (clé de réconciliation, préservation `sel`).
- Contrat de marge/espacement entre slices (aujourd'hui `.mb-6` ajouté incohéremment par
  `injectGenerated` seulement) → à uniformiser (marge portée par le conteneur, pas la racine).

## 8. Checklist de parité (critère de switch — dérivée de la cartographie)

Chaque point doit marcher dans le nouveau cœur avant la bascule :
1. ADD : génération chat (nouvel élément), import Prismic, insert bibliothèque, insert picto.
2. DELETE : barre d'outils + clavier ; racine entière via store (zéro coquille) ; suppression
   d'un nœud imbriqué = édition (slice conservée).
3. ÉDITION intra-slice : sélection, texte inline + formatbar, lien, couleur, panneau style,
   états hover/focus/active, swap picto, textes dynamiques du JS.
4. CHAT : `effectiveTarget` (explicite > sélection > slice présente > ajout), aperçu candidat +
   Accepter/Rejeter via `store.replaceContent`, préservation identité Prismic.
5. IMPORT : Prismic verbatim + code collé (flatten CSS).
6. EXPORT (par slice) : scope uid, **renommage classe conservé + appliqué au JS** (JS par classe
   fonctionnel), keyframes namespacées, verbatim pour les slices importées ; copy HTML/CSS/JS.
7. PRISMIC : push (création draft, 1 slice = 1 doc), pull (import), update (MAJ par slice,
   identité conservée), bouton MAJ.
8. BIBLIOTHÈQUE : save (clean), load, insert, delete.
9. UNDO/REDO : snapshots store, restore par diff, pas de refs mortes.
10. RESET « Nouveau » : reset chat seul, canvas intact.
11. ÉTAT : plus de variables éparses pour le contenu — tout dérive du store (l'état d'édition UI
    — `sel`, `editing`, `editState` — reste, mais pointe vers des slices du store).
12. SCRIPTS : stockage inerte `text/ekw-js`, exécution aperçu (iframe) + export identiques.

Validation finale : refaire le scénario du bug d'origine (importer une slice → supprimer →
reset chat → générer une autre slice → exporter) et vérifier **une seule** slice à l'export,
sans coquille ni double script ; et un widget à script-par-classe (carrousel) fonctionnel à
l'export.
