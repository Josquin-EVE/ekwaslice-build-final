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
//  - Bibliothèque PARTAGÉE cloud (publish/shared) : en standby dans l'app (CLOUD_LIB=false),
//    NON portée ici.
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

  let LIB = [];

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
    const ok = typeof hooks.confirm === 'function' ? await hooks.confirm('Retirer ce composant de la bibliothèque locale ?')
      : (win && typeof win.confirm === 'function' ? win.confirm('Retirer ce composant de la bibliothèque locale ?') : true);
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

  // --- grille locale --------------------------------------------------------------------

  function renderGrid() {
    const g = grid();
    if (!g || !doc) return;
    g.innerHTML = '';
    if (!LIB.length) {
      g.innerHTML = '<p class="text-[10px] text-slate-600 leading-snug">Aucun composant local. Sauvegarde un slice pour le retrouver ici.</p>';
      return;
    }
    LIB.forEach((item) => {
      const card = doc.createElement('div');
      card.title = 'Insérer : ' + item.name;
      card.className = 'relative group w-full rounded-lg border border-slate-700 bg-slate-900 overflow-hidden cursor-pointer hover:border-secondary transition';
      card.innerHTML =
        '<div class="h-24 w-full overflow-hidden bg-night pointer-events-none">'
        + '<div class="origin-top-left" style="transform:scale(0.27);width:370%;">' + (item.html || '') + '</div></div>'
        + '<div class="px-2 py-1.5 text-[11px] text-slate-300 truncate border-t border-slate-800">' + escHtml(item.name) + '</div>'
        + '<button data-del title="Retirer du local" class="absolute top-1 right-1 w-5 h-5 rounded bg-black/60 text-red-300 opacity-0 group-hover:opacity-100 transition text-[10px] flex items-center justify-center"><i class="fa-solid fa-xmark"></i></button>';
      card.addEventListener('click', (e) => {
        if (e.target.closest('[data-del]')) { e.stopPropagation(); remove(item.id); return; }
        insert(item);
      });
      call('resolvePictos', card);
      g.appendChild(card);
    });
  }

  return {
    load, saveComponent, confirmSave, closeSaveModal, insert, remove, renderGrid,
    getItems: () => LIB.slice(),
    dispose() { pendingHtml = null; pendingOriginId = null; },
  };
}
