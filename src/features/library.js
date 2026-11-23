// Bibliothèque de composants locale : sauvegarde / chargement / insertion / suppression,
// routées via le SliceStore. Porté depuis index.html (saveComponent, confirmSave,
// insertSavedComponent, deleteSavedComponent, loadLibrary, renderLocalGrid, cleanForSave).
//
// Règles :
//  - Le store est la SEULE autorité sur le canvas. Insertion = store.add(html, 'library',
//    { libId }) ; rien n'est posé à la main sur un nœud. Le lien « slice ← item de biblio »
//    vit dans slice.meta.libId (remplace l'ancien dataset.libId).
//  - Sauvegarde = serializeSlice(slice) : MÊME sérialiseur que l'export (html auteur propre,
//    sans artefacts d'édition ni wrappers [data-comp] ; `imported` reste verbatim). Remplace
//    cleanForSave. Ce que la biblio stocke est donc le contenu de la racine (pas l'enveloppe).
//  - Persistance : IPC window.api.library{List,Save,Delete} (userData/library.json) ; repli
//    localStorage hors Electron (comportement historique conservé).
//  - Bibliothèque PARTAGÉE cloud (Google Sheets) : PORTÉE ici (onglet « Partagée »). Les cartes
//    locales exposent publier/MAJ cloud ; l'onglet partagé liste le catalogue cloud (badge auteur,
//    renommer/supprimer si propriétaire via ownedIds()). Clé de service absente → {error:'NO_KEY'}
//    sur toute action cloud → on propose gsheetImportKey() puis on réessaie une fois.
//
// -------------------------------------------------------------------------------------
// Contrat `ctx` (fourni par le bootstrap — Task 12). Tout est OPTIONNEL et gardé :
//   document / window : hôtes (défaut globalThis.document / document.defaultView).
//   api               : couche IPC (défaut window.api) : libraryList(), librarySave(item) ->
//                       {list}|{error}, libraryDelete(id) -> {list}.
//   storage           : repli hors Electron (défaut window.localStorage).
//   grid              : conteneur de la grille (défaut #comp-grid).
//   getSelected       : () => élément sélectionné (ou ctx.editing.getSelected()).
//   editing           : { getSelected, deselect, selectElement } (instance de features/editing.js).
//   hooks : collaborateurs HORS périmètre bibliothèque, appelés s'ils existent :
//       toast(msg)
//       confirm(msg) → boolean | Promise<boolean>   (repli : window.confirm)
//       resolvePictos(containerEl)                   (résout img[data-picto] des vignettes)
//       deselect() / selectElement(el)               (surchargent ctx.editing)
//   Modale de nommage : ids #saveModal, #save-name-input, #save-overwrite-row, #save-overwrite,
//   #save-overwrite-name (affichage via classes hidden/flex, comme l'historique).
//
// Retourne : { load(), saveComponent(target?), confirmSave(), closeSaveModal(), insert(item),
//   remove(id), renderGrid(), getItems(), dispose }.
//   - saveComponent(target) : target = élément du canvas OU slice ; défaut = sélection courante.
//     Ouvre la modale de nommage ; l'écriture n'a lieu qu'à confirmSave().
//   - Câblage UI (Task 12) : bouton « sauvegarder » → saveComponent(sel) ; modale → confirmSave /
//     closeSaveModal ; au démarrage → load().
// -------------------------------------------------------------------------------------

import { serializeSlice } from '../core/slice.js';

const LIB_LS = 'ekwaslice_library';

const escHtml = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function initLibrary(store, ctx = {}) {
  const doc = ctx.document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
  const win = ctx.window || (doc && doc.defaultView) || (typeof globalThis !== 'undefined' ? globalThis : null);
  const hooks = ctx.hooks || {};
  const editing = ctx.editing || {};
  const api = () => ctx.api || (win && win.api) || null;
  const byId = (id) => (doc ? doc.getElementById(id) : null);
  const grid = () => ctx.grid || byId('comp-grid');

  const sharedGridEl = () => ctx.sharedGrid || byId('shared-grid');

  const call = (name, ...args) => { const fn = hooks[name]; return typeof fn === 'function' ? fn(...args) : undefined; };
  const toast = (m) => call('toast', m);
  const getSelected = () => (typeof editing.getSelected === 'function' ? editing.getSelected()
    : (typeof ctx.getSelected === 'function' ? ctx.getSelected() : null));
  const deselect = () => {
    if (typeof hooks.deselect === 'function') hooks.deselect();
    else if (typeof editing.deselect === 'function') editing.deselect();
  };
  const selectElement = (el) => {
    if (typeof hooks.selectElement === 'function') hooks.selectElement(el);
    else if (typeof editing.selectElement === 'function') editing.selectElement(el);
  };
  const askConfirm = async (m) => (typeof hooks.confirm === 'function' ? await hooks.confirm(m)
    : (win && typeof win.confirm === 'function' ? win.confirm(m) : true));
  // Modale de saisie générique (réutilise #authorModal via le bootstrap) ; repli window.prompt.
  const askName = async (opts) => {
    opts = opts || {};
    if (typeof hooks.askName === 'function') return await hooks.askName(opts);
    if (win && typeof win.prompt === 'function') { const v = win.prompt(opts.label || opts.title || 'Nom', opts.pre || ''); return v ? v.trim() : null; }
    return null;
  };

  let LIB = [];
  let SHARED = [];                 // catalogue cloud (live, NON persisté — le cloud est la source)
  let currentLibTab = 'local';

  // --- persistance (IPC, repli localStorage) --------------------------------------------

  const storage = () => { try { return ctx.storage || (win && win.localStorage) || null; } catch (_) { return null; } };
  const lsLoad = () => { try { return JSON.parse(storage().getItem(LIB_LS)) || []; } catch (_) { return []; } };
  const lsSave = () => { try { storage().setItem(LIB_LS, JSON.stringify(LIB)); } catch (_) { /* quota / indispo */ } };

  async function load() {
    const a = api();
    if (a && a.libraryList) {
      try { LIB = (await a.libraryList()) || []; } catch (_) { LIB = []; }
    } else LIB = lsLoad();
    renderGrid();
    return LIB.slice();
  }

  // --- sauvegarde -----------------------------------------------------------------------

  // Cible de la sauvegarde : élément du canvas OU slice (sinon sélection courante).
  function resolveSlice(target) {
    const t = target || getSelected();
    if (!t) return null;
    return t.root && t.id ? store.get(t.id) : store.sliceOf(t);
  }

  function suggestName(slice) {
    const h = slice.root.querySelector('h1, h2, h3, [class*="text-2xl"], [class*="text-xl"]');
    const t = h && h.textContent.trim();
    return (t && t.slice(0, 40)) || 'Composant';
  }

  let pendingHtml = null;     // html de la slice en attente de sauvegarde (figé à l'ouverture)
  let pendingOriginId = null; // id de l'item d'origine si la slice vient de la biblio (-> écrasement possible)

  function saveComponent(target) {
    const slice = resolveSlice(target);
    if (!slice) { toast('Sélectionnez un bloc à sauvegarder'); return false; }
    pendingOriginId = (slice.meta && slice.meta.libId) || null;
    pendingHtml = serializeSlice(slice).trim();
    const origin = pendingOriginId ? LIB.find((x) => x.id === pendingOriginId) : null;
    const input = byId('save-name-input');
    if (input) input.value = origin ? origin.name : suggestName(slice);
    const row = byId('save-overwrite-row');
    const cb = byId('save-overwrite');
    if (row && cb) {
      if (origin) {
        const nm = byId('save-overwrite-name');
        if (nm) nm.textContent = '« ' + origin.name + ' »';
        cb.checked = true;
        row.classList.remove('hidden'); row.classList.add('flex');
      } else {
        cb.checked = false; row.classList.add('hidden'); row.classList.remove('flex');
      }
    }
    const m = byId('saveModal');
    if (m) { m.classList.remove('hidden'); m.classList.add('flex'); }
    if (input && win && typeof win.setTimeout === 'function') win.setTimeout(() => { input.focus(); input.select(); }, 30);
    return true;
  }

  function closeSaveModal() {
    const m = byId('saveModal');
    if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
    pendingHtml = null; pendingOriginId = null;
  }

  async function confirmSave() {
    if (!pendingHtml) { closeSaveModal(); return false; }
    const input = byId('save-name-input');
    const name = ((input && input.value) || '').trim() || 'Composant';
    const cb = byId('save-overwrite');
    const overwrite = !!(pendingOriginId && cb && cb.checked);
    const item = { name, html: pendingHtml };
    if (overwrite) item.id = pendingOriginId; // main.js préserve remoteId/source/author de l'item écrasé
    const a = api();
    if (a && a.librarySave) {
      let r;
      try { r = await a.librarySave(item); } catch (e) { r = { error: e && e.message }; }
      if (r && r.list) { LIB = r.list; renderGrid(); toast(overwrite ? 'Composant mis à jour' : 'Composant sauvegardé'); }
      else { toast('Échec : ' + ((r && r.error) || 'inconnu')); return false; }
    } else {
      if (!item.id) { item.id = 'c-' + Date.now().toString(36); item.createdAt = Date.now(); }
      const i = LIB.findIndex((x) => x.id === item.id);
      if (i >= 0) LIB[i] = Object.assign({}, LIB[i], item); else LIB.unshift(item);
      lsSave(); renderGrid(); toast(overwrite ? 'Composant mis à jour (local)' : 'Composant sauvegardé (local)');
    }
    closeSaveModal();
    return true;
  }

  // --- insertion / suppression ----------------------------------------------------------

  // Insère un item de la biblio comme nouvelle slice (origin 'library', lien libId).
  function insert(item) {
    if (!item || !item.html) return null;
    deselect();
    const slice = store.add(item.html, 'library', { libId: item.id });
    selectElement(slice.root);
    if (typeof slice.root.scrollIntoView === 'function') slice.root.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return slice;
  }

  async function remove(id) {
    const ok = await askConfirm('Retirer ce composant de la bibliothèque locale ?');
    if (!ok) return false;
    const a = api();
    if (a && a.libraryDelete) {
      let r;
      try { r = await a.libraryDelete(id); } catch (_) { r = null; }
      if (r && r.list) { LIB = r.list; renderGrid(); return true; }
      return false;
    }
    LIB = LIB.filter((x) => x.id !== id); lsSave(); renderGrid();
    return true;
  }

  // --- grilles (vignette commune local / partagé) ---------------------------------------

  // Cadre carte : aperçu scalé + libellé. (Boutons d'action ajoutés par l'appelant.)
  function libCardShell(card, html, name) {
    card.className = 'relative group w-full rounded-lg border border-slate-700 bg-slate-900 overflow-hidden cursor-pointer hover:border-secondary transition';
    card.innerHTML =
      '<div class="h-24 w-full overflow-hidden bg-night pointer-events-none">'
      + '<div class="origin-top-left" style="transform:scale(0.27);width:370%;">' + (html || '') + '</div></div>'
      + '<div class="px-2 py-1.5 text-[11px] text-slate-300 truncate border-t border-slate-800">' + escHtml(name) + '</div>';
  }

  // Grille LOCALE — cartes avec publier/MAJ cloud (la biblio partagée est active ici).
  function renderGrid() {
    const g = grid();
    if (!g || !doc) return;
    g.innerHTML = '';
    if (!LIB.length) {
      g.innerHTML = '<p class="text-[10px] text-slate-600 leading-snug">Aucun composant local. Sauvegarde un slice pour le retrouver ici.</p>';
      return;
    }
    LIB.forEach((item) => {
      const linked = !!item.remoteId;
      const card = doc.createElement('div');
      card.title = 'Insérer : ' + item.name;
      libCardShell(card, item.html, item.name);
      const cloudTag = linked ? '<div class="absolute top-1 left-1 w-4 h-4 rounded bg-secondary/90 text-ink-deep text-[9px] font-bold flex items-center justify-center" title="Publié en ligne"><i class="fa-solid fa-cloud"></i></div>' : '';
      const actBtn = linked
        ? '<button data-upd title="Mettre à jour la version en ligne" class="absolute top-1 right-7 w-5 h-5 rounded bg-black/60 text-secondary opacity-0 group-hover:opacity-100 transition text-[10px] flex items-center justify-center"><i class="fa-solid fa-rotate"></i></button>'
        : '<button data-pub title="Publier en ligne" class="absolute top-1 right-7 w-5 h-5 rounded bg-black/60 text-secondary opacity-0 group-hover:opacity-100 transition text-[10px] flex items-center justify-center"><i class="fa-solid fa-cloud-arrow-up"></i></button>';
      card.insertAdjacentHTML('beforeend', cloudTag + actBtn
        + '<button data-del title="Retirer du local" class="absolute top-1 right-1 w-5 h-5 rounded bg-black/60 text-red-300 opacity-0 group-hover:opacity-100 transition text-[10px] flex items-center justify-center"><i class="fa-solid fa-xmark"></i></button>');
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-del]')) { e.stopPropagation(); remove(item.id); return; }
        if (e.target.closest('[data-pub]')) { e.stopPropagation(); publish(item); return; }
        if (e.target.closest('[data-upd]')) { e.stopPropagation(); updateShared(item); return; }
        insert(item);
      });
      call('resolvePictos', card);
      g.appendChild(card);
    });
  }

  // =====================================================================================
  // BIBLIOTHÈQUE PARTAGÉE (Google Sheets) — onglets, identité auteur, publier/MAJ/suppr.
  // =====================================================================================

  // Clé de propriété : générée une fois par install (secrète, jamais exposée aux autres).
  const OWNER_LS = 'ekwa_owner_key';
  function ownerKey() {
    try {
      const s = storage();
      if (!s) return null;
      let k = s.getItem(OWNER_LS);
      if (!k) {
        k = (win && win.crypto && typeof win.crypto.randomUUID === 'function')
          ? win.crypto.randomUUID()
          : ('ok-' + Date.now() + '-' + Math.random().toString(36).slice(2));
        s.setItem(OWNER_LS, k);
      }
      return k;
    } catch (_) { return null; }
  }
  // « Mes » publications = celles dont je détiens le remoteId en local (pas besoin d'exposer la clé).
  function ownedIds() { return new Set(LIB.map((x) => x.remoteId).filter(Boolean)); }

  // --- identité auteur (settings.json via IPC ; repli localStorage) ----------------------
  const AUTHOR_LS = 'ekwa_author';
  let authorCache = null;
  function authorName() {
    if (typeof hooks.authorName === 'function') return hooks.authorName() || '';
    if (authorCache) return authorCache;
    try { const s = storage(); return (s && s.getItem(AUTHOR_LS)) || ''; } catch (_) { return ''; }
  }
  async function refreshAuthor() {
    if (typeof hooks.authorName === 'function') return; // source gérée par le bootstrap
    const a = api();
    if (a && a.settingsGet) { try { const s = await a.settingsGet(); if (s && s.author) { authorCache = s.author; return; } } catch (_) { } }
    try { const st = storage(); const ls = st && st.getItem(AUTHOR_LS); if (ls) authorCache = ls; } catch (_) { }
  }
  async function setAuthorName(v) {
    if (typeof hooks.setAuthorName === 'function') { await hooks.setAuthorName(v); authorCache = v; return; }
    authorCache = v;
    try { const s = storage(); if (s) s.setItem(AUTHOR_LS, v); } catch (_) { }
    const a = api();
    if (a && a.settingsSet) { try { await a.settingsSet({ author: v }); } catch (_) { } }
  }

  // Enveloppe « clé absente » : toute action cloud renvoyant {error:'NO_KEY'} propose l'import
  // de la clé de service puis réessaie UNE fois ; annulation → {error:'CANCELLED'} (silencieux).
  async function runShared(action) {
    const a = api();
    let r;
    try { r = await action(); } catch (e) { return { error: (e && e.message) || 'erreur' }; }
    if (r && r.error === 'NO_KEY') {
      if (!a || !a.gsheetImportKey) { toast('Clé de service Google requise (indisponible).'); return { error: 'CANCELLED' }; }
      let imp; try { imp = await a.gsheetImportKey(); } catch (_) { imp = null; }
      if (imp && imp.ok) {
        try { r = await action(); } catch (e) { return { error: (e && e.message) || 'erreur' }; }
        // NO_KEY persistant après import : message clair (toast ici), puis silencieux pour les appelants.
        if (r && r.error === 'NO_KEY') { toast('Clé Google Sheets introuvable ou illisible — réimporte la clé.'); return { error: 'CANCELLED' }; }
      }
      else if (imp && imp.error === 'CANCELLED') return { error: 'CANCELLED' };
      else { toast('Import de la clé impossible : ' + ((imp && imp.error) || 'inconnu')); return { error: 'CANCELLED' }; }
    }
    return r;
  }

  // Insère une slice partagée comme nouvelle slice (autorité store, origin 'library').
  function insertShared(row) {
    if (!row || !row.html) return null;
    deselect();
    const slice = store.add(row.html, 'library');
    selectElement(slice.root);
    if (typeof slice.root.scrollIntoView === 'function') slice.root.scrollIntoView({ block: 'center', behavior: 'smooth' });
    return slice;
  }

  // Grille PARTAGÉE — bandeau identité + cartes (badge auteur ; renommer/suppr si propriétaire).
  function renderSharedGrid() {
    const g = sharedGridEl();
    if (!g || !doc) return;
    g.innerHTML = '';
    const owned = ownedIds();
    const bar = doc.createElement('div');
    bar.className = 'flex items-center justify-between text-[10px] text-slate-400 px-0.5 pb-1';
    bar.innerHTML = '<span>Publié en tant que <b class="text-secondary">' + escHtml(authorName() || '—') + '</b></span>'
      + '<button data-editauthor class="hover:text-secondary underline">Modifier</button>';
    const eb = bar.querySelector('[data-editauthor]');
    if (eb) eb.addEventListener('click', () => editAuthorName());
    g.appendChild(bar);
    if (!SHARED.length) {
      g.insertAdjacentHTML('beforeend', '<p class="text-[10px] text-slate-600 leading-snug">Bibliothèque partagée vide (ou pas encore chargée). Clique « Recharger ».</p>');
      return;
    }
    SHARED.forEach((row) => {
      const mine = owned.has(row.id);
      const card = doc.createElement('div');
      card.setAttribute('data-shared-card', row.id || '');  // Ruling B : point d'ancrage du test
      card.title = 'Insérer : ' + row.name;
      libCardShell(card, row.html, row.name);
      const badge = '<div class="absolute top-1 left-1 max-w-[70%] px-1.5 py-0.5 rounded bg-secondary/90 text-ink-deep text-[9px] font-bold flex items-center gap-1 truncate"><i class="fa-solid fa-cloud"></i>' + escHtml(row.author || 'anonyme') + '</div>';
      const ownerBtns = mine
        ? '<button data-rename title="Renommer (ma publication)" class="absolute top-1 right-7 w-5 h-5 rounded bg-black/60 text-secondary opacity-0 group-hover:opacity-100 transition text-[10px] flex items-center justify-center"><i class="fa-solid fa-pen"></i></button>'
        + '<button data-del title="Supprimer du cloud (ma publication)" class="absolute top-1 right-1 w-5 h-5 rounded bg-black/60 text-red-300 opacity-0 group-hover:opacity-100 transition text-[10px] flex items-center justify-center"><i class="fa-solid fa-trash"></i></button>'
        : '';
      card.insertAdjacentHTML('beforeend', badge + ownerBtns);
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-del]')) { e.stopPropagation(); deleteSharedComponent(row); return; }
        if (e.target.closest('[data-rename]')) { e.stopPropagation(); renameSharedComponent(row); return; }
        insertShared(row);
      });
      call('resolvePictos', card);
      g.appendChild(card);
    });
  }

  // --- onglet Prismic (3ᵉ source : slices publiées) -------------------------------------
  const prismicGridEl = () => ctx.prismicGrid || byId('prismic-grid');
  let _prismicMounted = false;

  // Invite affichée quand le token de lecture Prismic manque (pas de grille muette).
  function renderPrismicInvite() {
    const g = prismicGridEl();
    if (!g || !doc) return;
    g.innerHTML = '<div class="text-[11px] text-slate-500 leading-snug p-1">Token de lecture Prismic requis pour parcourir les slices publiées. '
      + '<button data-prismic-config class="text-secondary underline">Configurer</button></div>';
    const b = g.querySelector('[data-prismic-config]');
    if (b) b.addEventListener('click', () => { if (typeof hooks.openPrismicConfig === 'function') hooks.openPrismicConfig(); });
  }

  // Monte/charge le navigateur Prismic injecté (ctx.prismicBrowser) dans la grille du panneau.
  function openPrismicTab() {
    const g = prismicGridEl();
    const hasToken = (typeof hooks.hasReadToken === 'function') ? !!hooks.hasReadToken() : true;
    if (!hasToken) { renderPrismicInvite(); return; }
    const b = ctx.prismicBrowser;
    if (!b) return;
    if (!_prismicMounted && g) { b.mount(g, { filterInput: byId('prismic-grid-search') }); _prismicMounted = true; }
    if (typeof b.hasItems === 'function' && b.hasItems()) b.render();
    else if (typeof b.load === 'function') b.load();
  }

  // Bascule d'onglet local/partagé/prismic (styles, bouton recharger, visibilité des grilles).
  function setLibTab(t) {
    currentLibTab = (t === 'shared') ? 'shared' : (t === 'prismic') ? 'prismic' : 'local';
    const on = 'bg-secondary text-ink-deep', off = 'text-slate-400 hover:text-slate-200';
    const loc = byId('tab-local'), sh = byId('tab-shared'), pr = byId('tab-prismic');
    if (loc) loc.className = 'px-2.5 py-1 rounded-md transition ' + (currentLibTab === 'local' ? on : off);
    if (sh) sh.className = 'px-2.5 py-1 rounded-md transition flex items-center gap-1 ' + (currentLibTab === 'shared' ? on : off);
    if (pr) pr.className = 'px-2.5 py-1 rounded-md transition flex items-center gap-1 ' + (currentLibTab === 'prismic' ? on : off);
    const rl = byId('shared-reload');
    if (rl) { rl.classList.toggle('hidden', currentLibTab !== 'shared'); rl.classList.toggle('flex', currentLibTab === 'shared'); }
    const g = grid(), sg = sharedGridEl(), pg = prismicGridEl();
    if (g) { g.classList.toggle('hidden', currentLibTab !== 'local'); g.classList.toggle('flex', currentLibTab === 'local'); }
    if (sg) { sg.classList.toggle('hidden', currentLibTab !== 'shared'); sg.classList.toggle('flex', currentLibTab === 'shared'); }
    if (pg) { pg.classList.toggle('hidden', currentLibTab !== 'prismic'); pg.classList.toggle('flex', currentLibTab === 'prismic'); }
    const psearch = byId('prismic-grid-search');
    if (psearch) psearch.classList.toggle('hidden', currentLibTab !== 'prismic');
    if (currentLibTab === 'shared') { renderSharedGrid(); if (!SHARED.length) loadShared(); }
    else if (currentLibTab === 'prismic') { openPrismicTab(); }
    else renderGrid();
  }

  // Charge le catalogue cloud et peuple la grille partagée.
  async function loadShared() {
    const a = api();
    if (!a || !a.sharedList) { toast("Bibliothèque partagée dispo seulement dans l'app"); return; }
    await refreshAuthor();
    toast('Chargement de la bibliothèque partagée…');
    const r = await runShared(() => a.sharedList());
    if (!r || r.error === 'CANCELLED') return;
    if (r.error) { toast('Échec : ' + r.error); return; }
    SHARED = r.list || [];
    renderSharedGrid();
    toast(SHARED.length + ' composant(s) en ligne');
  }

  // Publier un composant local en ligne (demande le nom d'auteur une fois si vide).
  async function publish(item) {
    if (!item || !item.html) return;
    const a = api();
    if (!a || !a.sharedPublish) { toast("Publication dispo seulement dans l'app"); return; }
    await refreshAuthor();
    let author = authorName();
    if (!author) {
      author = await askName({ title: 'Ton nom (auteur)', label: 'Affiché sur les composants que tu publies', placeholder: 'Ex : Josquin', pre: '' });
      if (!author) return; // annulé
      await setAuthorName(author);
    }
    toast('Publication en ligne…');
    const r = await runShared(() => a.sharedPublish({ name: item.name, html: item.html, author, ownerKey: ownerKey() }));
    if (!r || r.error === 'CANCELLED') return;
    if (r.error) { toast('Échec publication : ' + r.error); return; }
    // Marque l'item local comme publié (remoteId) → carte « liée au cloud » (bouton MAJ).
    const remoteId = r.row && r.row.id;
    if (remoteId && a.librarySave) {
      try { const res = await a.librarySave(Object.assign({}, item, { remoteId, author })); if (res && res.list) LIB = res.list; } catch (_) { }
    }
    renderGrid();
    toast('Publié en ligne ✓');
  }

  // Mettre à jour la version en ligne d'un item local déjà publié (sinon, publier).
  async function updateShared(item) {
    if (!item || !item.remoteId) return publish(item);
    const a = api();
    if (!a || !a.sharedUpdate) { toast("Dispo seulement dans l'app"); return; }
    const ok = await askConfirm('Mettre à jour « ' + item.name + ' » en ligne avec la version locale actuelle ?');
    if (!ok) return;
    toast('Mise à jour en ligne…');
    const r = await runShared(() => a.sharedUpdate({ id: item.remoteId, ownerKey: ownerKey(), name: item.name, html: item.html }));
    if (!r || r.error === 'CANCELLED') return;
    if (r.error) { toast('Échec MAJ : ' + r.error); return; }
    if (!r.ok) { toast("Refusé : tu n'es pas le propriétaire de cette publication."); return; }
    if (currentLibTab === 'shared') loadShared();
    toast('Mis à jour en ligne ✓');
  }

  // Renommer un composant publié (owner) — name seul, html inchangé.
  async function renameSharedComponent(row) {
    const a = api();
    if (!a || !a.sharedUpdate) { toast("Dispo seulement dans l'app"); return; }
    const raw = await askName({ title: 'Renommer le composant', label: 'Nouveau nom du composant', placeholder: 'Nom du composant', pre: row.name || '' });
    const v = (raw || '').trim();
    if (!v || v === row.name) return;
    toast('Renommage…');
    const r = await runShared(() => a.sharedUpdate({ id: row.id, ownerKey: ownerKey(), name: v }));
    if (!r || r.error === 'CANCELLED') return;
    if (r.error) { toast('Échec : ' + r.error); return; }
    if (!r.ok) { toast("Refusé : tu n'es pas le propriétaire."); return; }
    row.name = v; renderSharedGrid(); toast('Renommé ✓');
  }

  // Supprimer un composant publié (owner) — définitif pour toute l'équipe.
  async function deleteSharedComponent(row) {
    const a = api();
    if (!a || !a.sharedDelete) { toast("Dispo seulement dans l'app"); return; }
    const ok = await askConfirm('Supprimer « ' + row.name + ' » de la bibliothèque partagée ?\n(Définitif, pour toute l\'équipe.)');
    if (!ok) return;
    toast('Suppression en ligne…');
    const r = await runShared(() => a.sharedDelete({ id: row.id, ownerKey: ownerKey() }));
    if (!r || r.error === 'CANCELLED') return;
    if (r.error) { toast('Échec : ' + r.error); return; }
    if (!r.ok) { toast("Refusé : tu n'es pas le propriétaire."); return; }
    SHARED = SHARED.filter((x) => x.id !== row.id);
    // La slice locale liée (ma publication) n'est plus en ligne → on retire le lien remoteId
    // sinon sa carte garde à tort le badge/état « cloud » (bug : délien non propagé).
    const localItem = LIB.find((x) => x.remoteId === row.id);
    if (localItem) {
      if (a.librarySave) {
        try { const res = await a.librarySave(Object.assign({}, localItem, { remoteId: null })); if (res && res.list) LIB = res.list; } catch (_) { }
      } else { localItem.remoteId = null; lsSave(); }
      renderGrid();
    }
    renderSharedGrid();
    toast('Supprimé du cloud ✓');
  }

  // Éditer son nom d'auteur + le propager à toutes ses publications cloud (owner).
  async function editAuthorName() {
    const raw = await askName({ title: 'Ton nom (auteur)', label: 'Affiché sur les composants que tu publies', placeholder: 'Ex : Josquin', pre: authorName() });
    const v = (raw || '').trim();
    if (!v || v === authorName()) return;
    await setAuthorName(v);
    const a = api();
    if (a && a.sharedRenameAuthor) {
      const r = await runShared(() => a.sharedRenameAuthor({ ownerKey: ownerKey(), author: v }));
      if (r && !r.error) {
        if (currentLibTab === 'shared') loadShared(); else renderSharedGrid();
        toast('Nom mis à jour' + (r.count ? ' (' + r.count + ' publication·s)' : ''));
        return;
      }
      if (r && r.error === 'CANCELLED') { renderSharedGrid(); return; }
    }
    renderSharedGrid(); toast('Nom mis à jour');
  }

  return {
    load, saveComponent, confirmSave, closeSaveModal, insert, remove, renderGrid,
    // Bibliothèque partagée.
    loadShared, publish, setLibTab, renderSharedGrid, editAuthorName,
    authorName, ownerKey,
    getItems: () => LIB.slice(),
    getShared: () => SHARED.slice(),
    dispose() { pendingHtml = null; pendingOriginId = null; },
  };
}
