// Prismic : import / envoi (push) / pull / mise à jour (MAJ), PAR SLICE, routés via le
// SliceStore. Porté depuis index.html (injectVerbatimSlice, doPrismicImport, pushToPrismic,
// updateInPrismic, extractVerbatimForExport, refreshPrismicUpdateBtn).
//
// Règles :
//  - Le store est la SEULE autorité sur le canvas ET sur l'identité Prismic. Rien n'est posé
//    à la main sur un nœud : import = store.add(..., 'imported', meta) (la racine reçoit ses
//    data-remote-* via createSliceRoot) ; adoption d'identité après envoi = store.setMeta
//    (meta + data-remote-* + `change`, une seule source de vérité).
//  - 1 slice = 1 document Prismic. Un import crée UNE slice `imported`.
//  - Export : exportSlice(slice) — `imported` → VERBATIM (aucun scope/renommage), sinon
//    compile + scope. Jamais d'extraction DOM maison ici.
//  - Identité (anti-objectif : ne jamais perdre data-remote-*) : une slice qui porte déjà un
//    prismicId la GARDE même si on l'envoie en « nouveau brouillon » ; seule une slice sans
//    identité adopte celle du document qu'elle vient de créer.
//
// -------------------------------------------------------------------------------------
// Contrat `ctx` (fourni par le bootstrap — Task 12). Tout est OPTIONNEL et gardé :
//   document / window : hôtes (défaut globalThis.document / document.defaultView).
//   api               : couche IPC (défaut window.api) : pullPrismic(idOrUrl),
//                       pushPrismic({title,html,css,js,author}), updatePrismic({documentId,
//                       uid,field,html,css,js}), settingsSet(patch), openExternal(url).
//   prismicSlice      : lib/prismic-slice.js (défaut window.PrismicSlice) — buildVerbatimSliceHTML.
//   collectCssRules   : () => règles CSS (défaut export.js, lit document.styleSheets).
//   updateBtn         : bouton « MAJ Prismic » (défaut #prismic-update-btn).
//   getSelected       : () => élément sélectionné (ou ctx.editing.getSelected()).
//   hooks : collaborateurs HORS périmètre Prismic, appelés s'ils existent :
//       toast(msg)
//       showLoading(msg) / hideLoading()
//       askName({title,label,placeholder,pre}) → Promise<string>   (modale de saisie)
//       getSettings() → objet réglages MUTABLE (APP_SETTINGS : prismicWriteToken, …)
//       authorName() → nom d'auteur joint à l'envoi
//       getImportSource() → string : URL/id collé OU id de la slice choisie dans la biblio
//       beforeImport() → Promise : persiste le token de lecture saisi dans la modale
//       closeImportModal() / clearImportInput()
//       showPrismicDone({title,subtitle,url}) → modale de succès (repli : toast)
//       setMode(mode) / getMode()   → bascule en mode édition après un import
//       selectElement(el)           → sélectionne la racine importée
//
// Retourne : { doImport(btn), pull(source), push(btn), update(btn), refreshUpdateBtn(),
//   getPrismicTarget(), noteSelection(el), dispose }.
//   - getPrismicTarget() : racine de la slice Prismic ciblée (hook `getPrismicTarget` du chat).
//   - noteSelection(el)  : à appeler depuis le hook onSelect de l'édition — mémorise la
//     slice Prismic sélectionnée comme cible MAJ (survit au deselect du clic bouton).
// -------------------------------------------------------------------------------------

import { exportSlice, collectCssRules as defaultCollect } from '../core/export.js';

export const PRISMIC_BUILDER_URL = 'https://ekwateur-edito.prismic.io/builder/migration';

// URL d'édition directe d'un document (onglet Migration Release visible dessus).
export function prismicDocUrl(id) {
  return id ? 'https://ekwateur-edito.prismic.io/builder/pages/' + encodeURIComponent(id) + '?s=published' : PRISMIC_BUILDER_URL;
}

export function initPrismic(store, ctx = {}) {
  const doc = ctx.document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
  const win = ctx.window || (doc && doc.defaultView) || (typeof globalThis !== 'undefined' ? globalThis : null);
  const hooks = ctx.hooks || {};
  const editing = ctx.editing || {};
  const api = () => ctx.api || (win && win.api) || null;
  const collect = ctx.collectCssRules || defaultCollect;

  const call = (name, ...args) => { const fn = hooks[name]; return typeof fn === 'function' ? fn(...args) : undefined; };
  const toast = (m) => call('toast', m);
  const getSelected = () => (typeof editing.getSelected === 'function' ? editing.getSelected()
    : (typeof ctx.getSelected === 'function' ? ctx.getSelected() : null));
  const updateBtn = () => ctx.updateBtn || (doc ? doc.getElementById('prismic-update-btn') : null);

  // Slice « Prismic » = importée OU portant l'identité d'un document.
  const isPrismicSlice = (s) => !!s && (s.origin === 'imported' || !!(s.meta && s.meta.prismicId));
  const prismicSlices = () => store.list().filter(isPrismicSlice);

  let targetId = null; // id de la slice Prismic ciblée (dernière importée / sélectionnée) : MAJ uniquement
  // Dernière slice sélectionnée, toute origine : l'éditeur désélectionne au mousedown hors
  // canvas (bouton d'en-tête « Envoi Prismic »), donc getSelected() est déjà vide au clic.
  let lastSelectedId = null;

  // --- état du bouton MAJ + cible ------------------------------------------------------

  function refreshUpdateBtn() {
    if (targetId && !store.get(targetId)) targetId = null; // cible retirée du canvas
    if (lastSelectedId && !store.get(lastSelectedId)) lastSelectedId = null;
    const b = updateBtn();
    if (!b) return;
    const has = prismicSlices().length > 0;
    b.classList.toggle('hidden', !has);
    b.classList.toggle('flex', has);
  }
  store.on('change', refreshUpdateBtn);

  function getPrismicTarget() {
    const s = targetId ? store.get(targetId) : null;
    return s ? s.root : null;
  }

  function noteSelection(el) {
    const s = el ? store.sliceOf(el) : null;
    if (!s) return;
    lastSelectedId = s.id;
    if (isPrismicSlice(s)) targetId = s.id;
  }

  // Cible de la MAJ : slice mémorisée > slice sélectionnée > unique slice Prismic. null = ambigu.
  function resolveUpdateTarget(candidates) {
    const mem = targetId ? store.get(targetId) : null;
    if (mem && isPrismicSlice(mem)) return mem;
    const sel = getSelected();
    const selSlice = sel ? store.sliceOf(sel) : null;
    if (selSlice && isPrismicSlice(selSlice)) return selSlice;
    return candidates.length === 1 ? candidates[0] : null;
  }

  // Cible de l'ENVOI (1 slice = 1 doc) : sélection vivante > dernière slice sélectionnée >
  // cible Prismic mémorisée > unique slice.
  function resolvePushTarget() {
    const sel = getSelected();
    const selSlice = sel ? store.sliceOf(sel) : null;
    if (selSlice) return selSlice;
    const last = lastSelectedId ? store.get(lastSelectedId) : null;
    if (last) return last;
    const mem = targetId ? store.get(targetId) : null;
    if (mem) return mem;
    const all = store.list();
    return all.length === 1 ? all[0] : null;
  }

  // --- token d'écriture ----------------------------------------------------------------

  async function ensureWriteToken() {
    const settings = call('getSettings') || null;
    if (settings && settings.prismicWriteToken) return settings.prismicWriteToken;
    const ask = hooks.askName;
    if (typeof ask !== 'function') return '';
    const tk = await ask({
      title: "Token d'écriture Prismic",
      label: 'Permanent token — Prismic → Settings → API & Security → Write APIs. Stocké en local, jamais partagé.',
      placeholder: 'colle le token…',
      pre: '',
    });
    if (!tk || !tk.trim()) return '';
    const v = tk.trim();
    if (settings) settings.prismicWriteToken = v;
    const a = api();
    if (a && a.settingsSet) { try { await a.settingsSet({ prismicWriteToken: v }); } catch (_) { /* persistance best-effort */ } }
    return v;
  }
  const forgetWriteToken = () => {
    const settings = call('getSettings');
    if (settings) settings.prismicWriteToken = '';
  };

  const done = (opts) => {
    if (typeof hooks.showPrismicDone === 'function') hooks.showPrismicDone(opts);
    else toast(opts.title);
  };

  // --- PULL + IMPORT -------------------------------------------------------------------

  // Tire un document Prismic via IPC. Retourne le résultat IPC validé, ou null (toast émis).
  async function pull(source) {
    const a = api();
    if (!a || !a.pullPrismic) { toast("Dispo seulement dans l'app"); return null; }
    const id = (source || '').trim();
    if (!id) { toast('Colle une URL ou choisis une slice.'); return null; }
    let r;
    try { r = await a.pullPrismic(id); } catch (e) { r = { error: e.message }; }
    if (!r || r.error || !r.ok) { toast('Échec import : ' + ((r && (r.error || r.raw)) || 'inconnu')); return null; }
    return r;
  }

  // Import VERBATIM : UNE slice `imported` portant l'identité du document.
  function addImported(r) {
    const ps = ctx.prismicSlice || (win && win.PrismicSlice);
    const html = ps.buildVerbatimSliceHTML(r.trio);
    const field = (r.trio && r.trio.html_only && r.trio.html_only.trim()) ? 'html_only' : 'html';
    const slice = store.add(html, 'imported', {
      prismicId: r.documentId || '',
      prismicTitle: r.title || '',
      prismicField: field,
      baseVersion: r.baseVersionId || '',
      prismicUid: r.uid || '',
      name: r.title || '',
    });
    targetId = slice.id; // slice fraîchement importée = cible MAJ par défaut
    lastSelectedId = slice.id; // et cible d'envoi la plus récente (elle vient d'être sélectionnée)
    return slice;
  }

  async function doImport(btn) {
    const a = api();
    if (!a || !a.pullPrismic) { toast("Dispo seulement dans l'app"); return null; }
    const source = (call('getImportSource') || '').trim();
    if (!source) { toast('Colle une URL ou choisis une slice.'); return null; }
    await call('beforeImport'); // token de lecture sauvé avant le pull (chemin rapide API)
    if (btn) btn.disabled = true;
    call('showLoading', 'Import en cours…');
    let r;
    try { r = await pull(source); } finally { call('hideLoading'); }
    if (!r) { if (btn) btn.disabled = false; return null; }
    call('closeImportModal');
    const slice = addImported(r);
    call('clearImportInput');
    if (btn) btn.disabled = false;
    if (typeof hooks.getMode === 'function' && hooks.getMode() !== 'edit') call('setMode', 'edit');
    call('selectElement', slice.root);
    if (slice.root.scrollIntoView) slice.root.scrollIntoView({ block: 'center', behavior: 'smooth' });
    refreshUpdateBtn();
    toast('Slice importée depuis Prismic (verbatim) ✓');
    return slice;
  }

  // --- PUSH (création d'un brouillon, 1 slice = 1 document) ----------------------------

  function suggestedName(slice) {
    const base = ((slice.meta && slice.meta.prismicTitle) || slice.root.getAttribute('data-remote-title') || '')
      .replace(/^\[Custom Slice\]\s*/i, '').trim();
    const h = slice.root.querySelector('h1, h2, h3, [class*="text-2xl"]');
    return base || (h && h.textContent.trim().slice(0, 50)) || 'Composant';
  }

  async function push(btn) {
    const a = api();
    if (!a || !a.pushPrismic) { toast("Dispo seulement dans l'app"); return; }
    if (store.list().length === 0) { toast('Canvas vide — rien à envoyer'); return; }
    const slice = resolvePushTarget();
    if (!slice) { toast("Plusieurs slices — clique celle à envoyer d'abord."); return; }
    const tok = await ensureWriteToken(); // envoi direct via Migration API → token requis
    if (!tok) { toast("Token d'écriture requis pour l'envoi."); return; }
    const out = exportSlice(slice, { collectCssRules: collect });
    if (!out || (!out.html && !out.css && !out.js)) { toast('Rien à envoyer'); return; }
    const ask = hooks.askName;
    if (typeof ask !== 'function') { toast('Saisie du nom indisponible'); return; }
    const name = await ask({
      title: 'Envoyer vers Prismic',
      label: 'Nom de la slice (convention : préfixe [Custom Slice])',
      placeholder: '[Custom Slice] …',
      pre: '[Custom Slice] ' + suggestedName(slice),
    });
    if (!name) return;
    const o = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i>Envoi…'; }
    toast('Envoi vers Prismic…');
    call('showLoading', 'Export en cours…');
    let r;
    try { r = await a.pushPrismic({ title: name, html: out.html, css: out.css, js: out.js, author: call('authorName') || '' }); }
    catch (e) { r = { error: e.message }; }
    call('hideLoading');
    if (btn) { btn.disabled = false; btn.innerHTML = o; }
    if (r && r.error === 'NO_WRITE_TOKEN') { forgetWriteToken(); toast("Token d'écriture manquant — reclique pour le saisir."); return; }
    if (!r || r.error || !r.ok) { toast('Échec envoi : ' + ((r && (r.error || r.raw)) || 'inconnu')); return; }

    // Identité APRÈS envoi : le document créé devient celui de la slice pour que la MAJ
    // suivante vise le bon doc. Via store.setMeta (meta + data-remote-* + change). Une slice
    // qui porte déjà un prismicId garde le sien (l'envoi n'est alors qu'une copie neuve).
    // La slice a pu être retirée pendant les awaits : setMeta renvoie alors null.
    if (r.documentId && !(slice.meta && slice.meta.prismicId)) {
      const patch = { prismicId: r.documentId, prismicTitle: name, prismicField: 'html_only' };
      if (r.baseVersionId) patch.baseVersion = r.baseVersionId;
      if (r.uid) patch.prismicUid = r.uid;
      if (store.setMeta(slice.id, patch)) targetId = slice.id;
    }
    toast('Envoyé vers Prismic ✓');
    done({ title: 'Export terminé', subtitle: 'Ta slice est envoyée dans Prismic (brouillon).', url: prismicDocUrl(r.documentId) });
  }

  // --- UPDATE / MAJ --------------------------------------------------------------------

  async function update(btn) {
    const a = api();
    if (!a || !a.updatePrismic) { toast("Dispo seulement dans l'app"); return; }
    const candidates = prismicSlices();
    if (!candidates.length) { toast('Aucune slice importée de Prismic.'); return; }
    const slice = resolveUpdateTarget(candidates);
    if (!slice) { toast("Plusieurs slices importées — clique celle à mettre à jour d'abord."); return; }
    const documentId = (slice.meta && slice.meta.prismicId) || '';
    if (!documentId) { toast('Document Prismic manquant (réimporte la slice).'); return; }
    const tok = await ensureWriteToken();
    if (!tok) { toast("Token d'écriture requis pour la maj."); return; }
    // La slice a pu disparaître pendant la saisie du token.
    if (!store.get(slice.id)) { toast('La slice a été retirée du canvas.'); return; }
    const out = exportSlice(slice, { collectCssRules: collect }); // imported → verbatim
    const field = (slice.meta && slice.meta.prismicField) || 'html_only';
    const o = btn ? btn.innerHTML : '';
    if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin mr-1.5"></i>MàJ…'; }
    call('showLoading', 'Mise à jour Prismic…');
    let r;
    try {
      r = await a.updatePrismic({ documentId, uid: (slice.meta && slice.meta.prismicUid) || '', field, html: out.html, css: out.css, js: out.js });
    } catch (e) { r = { error: e.message }; }
    call('hideLoading');
    if (btn) { btn.disabled = false; btn.innerHTML = o; }
    if (r && r.error === 'NO_WRITE_TOKEN') { forgetWriteToken(); toast("Token d'écriture manquant — reclique pour le saisir."); return; }
    if (!r || r.error || !r.ok) { toast('Échec MàJ : ' + ((r && (r.error || r.raw)) || 'inconnu')); return; }
    done({ title: 'Mise à jour effectuée', subtitle: 'La slice est mise à jour dans Prismic (brouillon, à revoir/publier).', url: prismicDocUrl(documentId) });
  }

  refreshUpdateBtn();

  return {
    doImport,
    pull,
    push,
    update,
    refreshUpdateBtn,
    getPrismicTarget,
    noteSelection,
    dispose() { store.off('change', refreshUpdateBtn); },
  };
}
