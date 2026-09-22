# Lot 1 — Coque light + structure inspecteur — Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Repeindre l'éditeur en light (charte UX app) et remplacer l'accordéon mode-focus par la structure de la maquette : header contexte élément, onglets d'états (UI), groupes en lignes compactes qui déplient.

**Architecture:** Une seule app Electron, tout dans `index.html` (renderer). Le rendu de l'éditeur est monolithique dans la fonction qui construit `styleBox.innerHTML` (~index.html:1160-1340). On remplace `accSection` par un composant `row` groupé, on remplace `#editor-nav` par un header contexte, on ajoute une barre d'onglets d'états. Aucun changement du modèle de style (Normal inline, comme aujourd'hui).

**Tech Stack:** HTML + Tailwind Play CDN (config `window.EKW_TW` dans `<head>`), FontAwesome, JS vanilla.

**Spec:** `docs/superpowers/specs/2026-09-22-editor-ux-rework-design.md`

## Global Constraints

- Charte UX app = LIGHT / Carnero / accent jaune `#ffc969`. Jamais d'uppercase. Le canvas (composants) reste DARK, inchangé.
- Pas de framework de test → vérif = relance app (`pkill -f "electron ." ; npm start`) + inspection DOM/visuelle. Commits fréquents.
- Ne pas lire `ressources/charte-graphique.html` en entier (grep only).
- Ne toucher qu'à `index.html` pour ce lot.

---

### Task 1 : Tokens light + repeinture coque éditeur

**Files:** Modify `index.html` — `<style>` (~l.39), `<body>` (l.272), asides (l.331, l.516), header (l.294), `#editor-panel` + enfants (l.374-427).

**Interfaces:**
- Produces : classes/couleurs light stables réutilisées par les tasks suivantes — surface panneau `bg-white`, texte `text-[#132527]`, texte atténué `text-slate-500`, bordure `border-[#e5e7eb]`, accent actif `bg-[#ffc969] text-[#132527]`, focus `ring-[#ffc969]`.

- [ ] **Step 1 :** Dans `<body>` (l.272) remplacer `bg-slate-900 text-slate-100` par `bg-[#eef2f6] text-[#132527]`.
- [ ] **Step 2 :** Header (l.294) et les deux `<aside>` (l.331, l.516) : `bg-slate-800 border-slate-700` → `bg-white border-[#e5e7eb]`.
- [ ] **Step 3 :** Dans `#editor-panel` (l.374-427) remplacer toutes les classes sombres (`text-slate-200/300/400`, `border-slate-700`, `hover:bg-slate-700`, `bg-slate-900`) par les tokens light ci-dessus. Le titre "Éditeur d'élément" garde son icône (retirer `text-black` incohérent → `text-[#132527]`).
- [ ] **Step 4 :** Vérifier : `pkill -f "electron ." ; (cd projet && npm start &)`, sélectionner un élément → panneau éditeur clair, texte lisible, canvas toujours dark. Snapshot.
- [ ] **Step 5 :** Commit `feat(editor): coque light (charte UX app)`.

Note : le reste du chrome (chat, barres) peut rester sombre pour ce lot (hors scope) ; si clash visuel gênant au voisinage immédiat, éclaircir uniquement ce voisinage.

---

### Task 2 : Header contexte élément (remplace #editor-nav)

**Files:** Modify `index.html` — `#editor-nav` (l.384-403) ; fonction de rendu des miettes (chercher `editor-crumbs` / `data-nav`).

**Interfaces:**
- Consumes : `sel` (élément sélectionné courant), `selectEl(node)` (fonction de sélection existante — vérifier son nom réel via grep `function select`), `elLabel(el)` (nom lisible, existe ~l.1536).
- Produces : `renderElementContext()` qui remplit le header (icône type, nom, `Type · <tag>`, fil cliquable).

- [ ] **Step 1 :** Remplacer le markup `#editor-nav` par : ligne 1 `[icône type] [nom] · <span meta>Type · &lt;tag&gt;</span>` ; ligne 2 `#editor-crumbs` (fil). Supprimer les 4 boutons `data-nav`.
- [ ] **Step 2 :** Écrire `renderElementContext()` : icône selon type (texte→fa-font, image/picto→fa-image, conteneur→fa-square, bouton→fa-hand-pointer), nom via `elLabel(sel)`, meta `Container/Texte/… · <tag>`, fil = chaîne d'ancêtres `[data-comp]`→sel, chaque miette = `<button>` qui appelle la fonction de sélection sur cet ancêtre.
- [ ] **Step 3 :** Retirer les handlers `data-nav` (prev/parent/child/next) devenus morts (grep `data-nav`).
- [ ] **Step 4 :** Appeler `renderElementContext()` là où l'ancienne nav était rafraîchie (grep `editor-crumbs` dans le JS de sélection).
- [ ] **Step 5 :** Vérifier : sélection d'un élément profond → fil complet, clic sur une miette sélectionne l'ancêtre. Commit `feat(editor): header contexte élément + fil cliquable`.

---

### Task 3 : Barre d'onglets d'états (UI seule)

**Files:** Modify `index.html` — insérer sous le header contexte, avant `#editor-style` (l.408).

**Interfaces:**
- Produces : `getEditState()`/`setEditState(name)` (état courant en variable module, défaut `'normal'`), attribut visuel actif ; barre `#editor-states` avec 4 boutons `data-estate="normal|hover|focus|active"`.

- [ ] **Step 1 :** Ajouter `<div id="editor-states">` avec 4 boutons (Normal/Hover/Focus/Active), classes light, actif = `bg-[#ffc969] text-[#132527]`.
- [ ] **Step 2 :** Variable `let editState='normal';` + `setEditState(n)` qui met à jour l'actif visuel. Au Lot 1, les états ≠ normal affichent un bandeau discret "édition d'état bientôt disponible" et ne modifient rien (branchés au Lot 4).
- [ ] **Step 3 :** Clic → `setEditState`. Reset à `'normal'` à chaque nouvelle sélection.
- [ ] **Step 4 :** Vérifier : onglets cliquables, actif jaune, retour normal à la re-sélection. Commit `feat(editor): onglets d'états (UI)`.

---

### Task 4 : Composant ligne compacte + groupes (remplace accSection)

**Files:** Modify `index.html` — `accSection` (l.1191-1200), `styleBox.innerHTML` (l.1247-1254), `openOnly` (l.1258-1274), CSS d'appui dans `<style>`.

**Interfaces:**
- Consumes : fragments existants `fJs, fTexte, fFond, fBordure, fEspacement, fTaille, fCss`.
- Produces : `groupHeader(title)` (titre de groupe gris, non-cliquable) ; `row(id, icon, title, body)` (ligne compacte : icône+label+pastille+chevron, déplie `.detail`) ; `rowState` persistant `{[id]:bool}` en localStorage ; `toggleRow(id)` (multi-ouvrable, indépendant).

- [ ] **Step 1 :** Écrire `row(id, icon, title, body)` : `<div class="ekw-row" data-row=id>` bouton ligne (`data-row-head`) + `<div data-row-body class="ekw-detail hidden">body</div>`. Label en casse normale.
- [ ] **Step 2 :** Écrire `groupHeader(title)` : petit label groupe (`text-[10px] tracking-wide text-slate-500`, casse normale).
- [ ] **Step 3 :** Remplacer le bloc `styleBox.innerHTML = accSection(...)...` par groupes + rows : Contenu (jscomp, contextuel) ; groupe APPARENCE → row texte, fond, bordure, (ombre — placeholder Lot 3) ; MISE EN PAGE → (disposition — Lot 3), taille, espacement ; AVANCÉ → css, (pictogrammes déjà séparé plus bas — laisser).
- [ ] **Step 4 :** Remplacer `openOnly`/mode-focus par `toggleRow(id)` (ouvre/ferme une row indépendamment) + `applyRowState()` qui restaure l'ouverture depuis localStorage. Remplacer le handler de clic `[data-acc-head]` par `[data-row-head]` (grep le listener, ~l.1440-1470 zone `data-acc`).
- [ ] **Step 5 :** Adapter `applyContextualSections` (l.1276) : `setSectionVisible` → cible `[data-row="…"]` ; supprimer la logique `openOnly(pref)` mono-section, la remplacer par : ouvrir par défaut la row pertinente (texte/taille/fond) si aucune préférence localStorage.
- [ ] **Step 6 :** Vérifier : rows dépliables indépendamment, état retenu au re-render, contrôles (couleur/espacement/taille) toujours fonctionnels, contextualité OK (row Texte cachée sur conteneur pur). Commit `feat(editor): inspecteur en lignes compactes groupées`.

---

### Task 5 : Nettoyage + cohérence accent jaune

**Files:** Modify `index.html` — occurrences résiduelles `ring-secondary`/`text-secondary` déjà OK (jaune) ; retirer refs mortes à `accSection`/`openOnly` ; vérifier `spSync` (l.1294) référence toujours des sélecteurs valides.

- [ ] **Step 1 :** Grep `accSection|data-acc|openOnly` → supprimer/adapter les restes.
- [ ] **Step 2 :** Vérifier `spSync` : les `styleBox.querySelector('[data-acc-body]')` éventuels remplacés par `[data-row-body]`.
- [ ] **Step 3 :** Vérif complète : sélection texte/image/conteneur, tous contrôles, onglets états, fil cliquable, thème light homogène dans l'éditeur. Snapshot final.
- [ ] **Step 4 :** Commit `refactor(editor): retrait accordéon mode-focus mort`.

---

## Self-Review

- Spec coverage Lot 1 : tokens light (T1), header contexte + fil (T2), onglets états UI (T3), lignes compactes groupées (T4), nettoyage (T5). ✓
- Lots 2-4 (color-picker, contrôles, moteur d'états) = plans séparés ultérieurs.
- Pas de placeholder de code non résolu ; les fragments réutilisés existent déjà dans le fichier.
- Cohérence noms : `row/groupHeader/toggleRow/applyRowState/renderElementContext/editState/setEditState` définis en T2-T4, référencés en T5.
