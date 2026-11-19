// Modales du châssis : saisie de nom (askName), export du code, import de code (HTML/CSS/JS),
// import Prismic (URL ou bibliothèque de slices publiées), réglages Prismic (2 tokens),
// et modale de succès Prismic. Portées depuis index.html.
//
// Le store est la SEULE autorité sur le canvas : l'export LIT store.list() et compose
// exportSlice par slice ; l'import Prismic délègue tout le flux à prismic.doImport() (ce
// module ne fournit que la source/le token via des getters) ; l'import de code à
// importCode.doImport().
//
// initModals(store, ctx) -> {
//   askName, showPrismicDone,
//   openExport, closeExport,
//   openImportCode, closeImportCode,
//   openPrismicImport, closePrismicImport, getImportSource, saveReadToken, clearPrismicImportInput,
//   openSettings, closeSettings,
//   dispose }
//   ctx.document / ctx.window ; ctx.api ; ctx.exportSlice ; ctx.collectCssRules ;
//   ctx.prismic ; ctx.importCode ; ctx.getSettings() ; ctx.authorName() ;
//   ctx.toast ; ctx.showLoading ; ctx.hideLoading.

import { buildThumbDoc } from './preview.js';

export function initModals(store, ctx = {}) {
  const doc = ctx.document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
  const win = ctx.window || (doc && doc.defaultView) || (typeof globalThis !== 'undefined' ? globalThis : null);
  const byId = (id) => (doc ? doc.getElementById(id) : null);
  const api = () => ctx.api || (win && win.api) || null;
  const toast = (m) => { if (typeof ctx.toast === 'function') ctx.toast(m); };
  const getSettings = () => (typeof ctx.getSettings === 'function' ? ctx.getSettings() : {}) || {};
  const exportSlice = ctx.exportSlice;
  const collectCssRules = ctx.collectCssRules;
  const prismic = () => ctx.prismic || {};
  const importCode = () => ctx.importCode || {};
  const disposers = [];
  const listen = (t, type, h, opts) => { if (t && t.addEventListener) { t.addEventListener(type, h, opts); disposers.push(() => t.removeEventListener(type, h, opts)); } };
  const show = (m) => { if (m) { m.classList.remove('hidden'); m.classList.add('flex'); } };
  const hide = (m) => { if (m) { m.classList.add('hidden'); m.classList.remove('flex'); } };
  const PRISMIC_BUILDER_URL = 'https://ekwateur-edito.prismic.io/builder/migration';

  // =====================================================================================
  // askName — modale générique de saisie (réutilise #authorModal).
  // =====================================================================================
  let _askResolve = null;
  function askName(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      _askResolve = resolve;
      const title = byId('author-modal-title'); if (title) title.textContent = opts.title || 'Ton nom (auteur)';
      const label = byId('author-modal-label'); if (label) label.textContent = opts.label || 'Affiché sur les composants que tu publies';
      const inp = byId('author-name-input');
      if (inp) { inp.placeholder = opts.placeholder || 'Ex : Josquin'; inp.value = opts.pre || ''; }
      show(byId('authorModal'));
      if (inp && win && win.setTimeout) win.setTimeout(() => { inp.focus(); inp.select(); }, 30);
    });
  }
  function closeAuthorModal(value) {
    hide(byId('authorModal'));
    if (_askResolve) { _askResolve(value || null); _askResolve = null; }
  }
  listen(byId('author-cancel'), 'click', () => closeAuthorModal(null));
  listen(byId('author-close'), 'click', () => closeAuthorModal(null));
  listen(byId('author-confirm'), 'click', () => {
    const inp = byId('author-name-input');
    closeAuthorModal(((inp && inp.value) || '').trim() || null);
  });
  listen(byId('author-name-input'), 'keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); const inp = byId('author-name-input'); closeAuthorModal(((inp && inp.value) || '').trim() || null); }
    else if (e.key === 'Escape') { e.preventDefault(); closeAuthorModal(null); }
  });

  // =====================================================================================
  // Export du code — LIT store.list(), compose exportSlice par slice.
  // =====================================================================================
  let lastExport = { html: '', css: '', js: '' };
  function computeExport() {
    const rules = typeof collectCssRules === 'function' ? collectCssRules() : null;
    let html = '', css = '', js = '';
    store.list().forEach((slice) => {
      const out = exportSlice(slice, rules ? { collectCssRules: () => rules } : {});
      if (out.html) html += (html ? '\n' : '') + out.html;
      if (out.css) css += (css ? '\n' : '') + out.css;
      if (out.js) js += (js ? '\n' : '') + out.js;
    });
    return { html, css, js };
  }
  function openExport() {
    if (store.list().length === 0) { if (win && win.alert) win.alert("Votre canvas est vide. Générez ou ajoutez d'abord un composant !"); return; }
    lastExport = computeExport();
    const h = byId('out-html'); if (h) h.textContent = lastExport.html;
    const c = byId('out-css'); if (c) c.textContent = lastExport.css || '/* aucun style */';
    const j = byId('out-js'); if (j) j.textContent = lastExport.js || '/* aucun JS */';
    show(byId('codeModal'));
  }
  function closeExport() { hide(byId('codeModal')); }
  function copyOut(which, btn) {
    const css = lastExport.css || '';
    const js = lastExport.js || '';
    let txt = '';
    if (which === 'all') txt = 'HTML (html_only):\n' + lastExport.html + '\n\nCSS (css):\n' + css + '\n\nJS (js):\n' + js;
    else if (which === 'css-tag') txt = '<style>\n' + css + '\n</style>';
    else if (which === 'js-tag') txt = '<script>\n' + js + '\n<\/script>';
    else if (which === 'all-tags') {
      txt = lastExport.html || '';
      if (css.trim()) txt += '\n\n<style>\n' + css + '\n</style>';
      if (js.trim()) txt += '\n\n<script>\n' + js + '\n<\/script>';
    } else txt = lastExport[which] || '';
    const nav = win && win.navigator;
    if (nav && nav.clipboard) nav.clipboard.writeText(txt).then(() => {
      if (btn) { const o = btn.innerHTML; btn.innerHTML = '<i class="fa-solid fa-check mr-1"></i>Copié'; (win.setTimeout || setTimeout)(() => { btn.innerHTML = o; }, 1200); }
    }).catch(() => { });
  }
  listen(byId('codeModal'), 'click', (e) => {
    const c = e.target.closest('[data-copy]'); if (c) { copyOut(c.dataset.copy, c); return; }
    if (e.target.closest('[data-close-export]')) { closeExport(); return; }
    if (e.target.closest('[data-push-prismic]')) { const p = prismic(); if (typeof p.push === 'function') p.push(e.target.closest('[data-push-prismic]')); return; }
  });

  // =====================================================================================
  // Import de code (HTML/CSS/JS) — délègue à importCode.doImport().
  // =====================================================================================
  function openImportCode() { show(byId('importModal')); const h = byId('imp-html'); if (h) h.focus(); }
  function closeImportCode() { hide(byId('importModal')); }
  listen(byId('importModal'), 'click', (e) => {
    if (e.target.closest('[data-close-import]')) { closeImportCode(); return; }
    if (e.target.closest('[data-do-import]')) { const ic = importCode(); if (typeof ic.doImport === 'function') ic.doImport(); return; }
  });

  // =====================================================================================
  // Import Prismic — la modale fournit la SOURCE (URL ou slice choisie) + le token de
  // lecture ; prismic.doImport() fait le pull + l'ajout au store.
  // =====================================================================================
  let _prismicLib = [];
  let _selectedSliceId = '';
  let _thumbObserver = null; // lazy-load des vignettes iframe (grille d'import)

  function getImportSource() {
    const inp = byId('prismic-import-input');
    const raw = inp ? (inp.value || '').trim() : '';
    return raw || _selectedSliceId;
  }
  function clearPrismicImportInput() {
    const inp = byId('prismic-import-input'); if (inp) inp.value = '';
    _selectedSliceId = '';
  }
  // Persiste le token de lecture saisi AVANT le pull (chemin rapide API). hook beforeImport.
  async function saveReadToken() {
    const tk = (byId('prismic-token-input') || {}).value;
    const v = (tk || '').trim();
    const settings = getSettings();
    if (v && v !== settings.prismicToken) {
      settings.prismicToken = v;
      const a = api();
      if (a && a.settingsSet) { try { await a.settingsSet({ prismicToken: v }); } catch (_) { } }
    }
  }
  function openPrismicImport() {
    show(byId('prismicImportModal'));
    const settings = getSettings();
    const saved = !!settings.prismicToken;
    const tk = byId('prismic-token-input'); if (tk) tk.value = '';
    const wrap = byId('prismic-token-wrap'); if (wrap) wrap.classList.toggle('hidden', saved);
    const savedRow = byId('prismic-token-saved'); if (savedRow) { savedRow.classList.toggle('hidden', !saved); savedRow.classList.toggle('flex', saved); }
    _prismicLib = []; _selectedSliceId = '';
    const list = byId('prismic-lib-list'); if (list) list.innerHTML = '';
    const search = byId('prismic-lib-search'); if (search) { search.value = ''; search.classList.add('hidden'); }
    const inp = byId('prismic-import-input'); if (inp) inp.value = '';
    updateImportBtnState();
    if (saved) loadPrismicLibrary();
    if (inp) inp.focus();
  }
  function closePrismicImport() { hide(byId('prismicImportModal')); }
  function editReadToken() {
    const wrap = byId('prismic-token-wrap'); if (wrap) wrap.classList.remove('hidden');
    const savedRow = byId('prismic-token-saved'); if (savedRow) { savedRow.classList.add('hidden'); savedRow.classList.remove('flex'); }
    const tk = byId('prismic-token-input'); if (tk) tk.focus();
  }
  function updateImportBtnState() {
    const inp = byId('prismic-import-input');
    const url = inp ? (inp.value || '').trim() : '';
    if (url && _selectedSliceId) { _selectedSliceId = ''; renderPrismicLib(); } // URL et slice exclusifs
    const btn = byId('prismic-import-go');
    if (btn) btn.disabled = !(url || _selectedSliceId);
  }
  async function loadPrismicLibrary(btn) {
    const a = api();
    if (!a || !a.listPrismicSlices) { toast("Dispo seulement dans l'app"); return; }
    await saveReadToken();
    if (btn) { btn.disabled = true; btn.textContent = 'Chargement…'; }
    let r; try { r = await a.listPrismicSlices(); } catch (e) { r = { error: e.message }; }
    if (btn) { btn.disabled = false; btn.textContent = 'Recharger'; }
    if (!r || r.error || !r.ok) { toast('Biblio Prismic : ' + (r && r.error === 'NO_READ_TOKEN' ? 'token de lecture requis' : ((r && r.error) || 'échec'))); return; }
    _prismicLib = r.slices || [];
    const search = byId('prismic-lib-search'); if (search) search.classList.remove('hidden');
    renderPrismicLib();
  }
  function renderPrismicLib() {
    const list = byId('prismic-lib-list'); if (!list) return;
    const search = byId('prismic-lib-search');
    const q = ((search && search.value) || '').toLowerCase();
    const items = _prismicLib.filter((s) => !q || (s.name || '').toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
    list.innerHTML = '';
    if (!items.length) {
      const empty = document.createElement('div');
      empty.className = 'col-span-4 text-[12px] text-slate-500 py-6 text-center';
      empty.textContent = 'Aucune slice';
      list.appendChild(empty);
      return;
    }
    // (Re)crée l'observer de lazy-load : seules les vignettes visibles chargent
    // leur iframe (Tailwind) — évite d'instancier N iframes d'un coup.
    if (_thumbObserver) { try { _thumbObserver.disconnect(); } catch (_) { } _thumbObserver = null; }
    try {
      _thumbObserver = new IntersectionObserver((entries, obs) => {
        for (const en of entries) {
          if (!en.isIntersecting) continue;
          const f = en.target;
          if (f && f._ekwHtml != null && !f.getAttribute('srcdoc')) {
            f.srcdoc = buildThumbDoc(f._ekwHtml);
          }
          obs.unobserve(f);
        }
      }, { root: list, rootMargin: '300px' });
    } catch (_) { _thumbObserver = null; }

    for (const s of items) {
      const d = s.date ? new Date(s.date).toLocaleDateString('fr-FR') : '';
      const on = s.id === _selectedSliceId;
      const card = document.createElement('div');
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.dataset.sliceId = s.id;
      card.setAttribute('aria-pressed', String(on));
      card.title = s.name || s.id;
      card.className = 'group cursor-pointer rounded-xl border overflow-hidden transition flex flex-col ' +
        (on ? 'border-secondary ring-2 ring-secondary' : 'border-slate-700 hover:border-secondary');

      // Vignette : HTML de la slice rendu en iframe (Tailwind + polices, scripts
      // inertes => statique). Lazy via IntersectionObserver.
      const thumb = document.createElement('div');
      thumb.className = 'relative h-36 w-full overflow-hidden bg-white';
      const ifr = document.createElement('iframe');
      ifr.setAttribute('scrolling', 'no');
      ifr.setAttribute('tabindex', '-1');
      ifr.setAttribute('aria-hidden', 'true');
      ifr.style.cssText = 'width:1000px;height:576px;border:0;transform:scale(0.25);transform-origin:top left;pointer-events:none;background:#fff;';
      ifr._ekwHtml = s.html || '';
      thumb.appendChild(ifr);
      if (_thumbObserver) _thumbObserver.observe(ifr);
      else ifr.srcdoc = buildThumbDoc(ifr._ekwHtml); // repli : pas d'observer
      if (on) {
        const chk = document.createElement('div');
        chk.className = 'absolute top-1.5 right-1.5 text-secondary text-lg drop-shadow z-10';
        chk.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
        thumb.appendChild(chk);
      }

      const meta = document.createElement('div');
      meta.className = 'px-2.5 py-1.5 border-t ' + (on ? 'border-secondary bg-secondary/15' : 'border-slate-800 bg-slate-950');
      const nm = document.createElement('div');
      nm.className = 'text-[11px] truncate ' + (on ? 'text-white font-bold' : 'text-slate-100');
      nm.textContent = s.name || s.id;
      const dt = document.createElement('div');
      dt.className = 'text-[10px] text-slate-500';
      dt.textContent = d;
      meta.appendChild(nm); meta.appendChild(dt);

      card.appendChild(thumb); card.appendChild(meta);
      list.appendChild(card);
    }
  }
  listen(byId('prismicImportModal'), 'click', (e) => {
    const slice = e.target.closest('#prismic-lib-list [data-slice-id]');
    if (slice) {
      _selectedSliceId = (_selectedSliceId === slice.dataset.sliceId) ? '' : slice.dataset.sliceId;
      if (_selectedSliceId) { const inp = byId('prismic-import-input'); if (inp) inp.value = ''; }
      renderPrismicLib(); updateImportBtnState(); return;
    }
    if (e.target.closest('[data-close-prismic-import]')) { closePrismicImport(); return; }
    if (e.target.closest('[data-edit-read-token]')) { editReadToken(); return; }
    if (e.target.closest('[data-load-prismic-lib]')) { loadPrismicLibrary(e.target.closest('[data-load-prismic-lib]')); return; }
    if (e.target.closest('[data-open-prismic-builder]')) { const a = api(); if (a && a.openExternal) a.openExternal('https://ekwateur-edito.prismic.io/builder/working?customTypes=custom_slice'); return; }
    const go = e.target.closest('[data-do-prismic-import]');
    if (go) { const p = prismic(); if (typeof p.doImport === 'function') p.doImport(go); return; }
  });
  listen(byId('prismic-import-input'), 'input', updateImportBtnState);
  listen(byId('prismic-lib-search'), 'input', renderPrismicLib);

  // Pont prix pour les vignettes : une iframe de la grille demande un devis
  // (shim fetch) → relayé à main.js (Referer forcé) → réponse renvoyée. On ne
  // répond qu'aux iframes de notre grille (pas à l'aperçu device, géré ailleurs).
  listen(win, 'message', async (e) => {
    const d = e.data || {};
    if (!d || d.type !== 'ekw-quotation') return;
    const list = byId('prismic-lib-list'); if (!list) return;
    let mine = false;
    list.querySelectorAll('iframe').forEach((f) => { if (f.contentWindow === e.source) mine = true; });
    if (!mine) return;
    let reply = { type: 'ekw-quotation-reply', id: d.id, ok: false, status: 401, json: null };
    const a = api();
    if (a && a.getQuotation) {
      try { const r = await a.getQuotation(d.body); reply = { type: 'ekw-quotation-reply', id: d.id, ok: !!(r && r.ok), status: (r && r.status) || 0, json: (r && r.json) || null }; }
      catch (_) { }
    }
    try { if (e.source) e.source.postMessage(reply, '*'); } catch (_) { }
  });

  // =====================================================================================
  // Réglages Prismic — 2 tokens (lecture / écriture).
  // =====================================================================================
  const PS_KEY = { read: 'prismicToken', write: 'prismicWriteToken' };
  function psRenderRow(kind) {
    const has = !!getSettings()[PS_KEY[kind]];
    const wrap = byId('ps-' + kind + '-wrap');
    const saved = byId('ps-' + kind + '-saved');
    const inp = byId('ps-' + kind + '-input'); if (inp) inp.value = '';
    if (wrap) wrap.classList.toggle('hidden', has);
    if (saved) { saved.classList.toggle('hidden', !has); saved.classList.toggle('flex', has); }
  }
  function openSettings() { show(byId('prismicSettingsModal')); psRenderRow('read'); psRenderRow('write'); }
  function closeSettings() { hide(byId('prismicSettingsModal')); }
  function editPsToken(kind) {
    const wrap = byId('ps-' + kind + '-wrap'); if (wrap) wrap.classList.remove('hidden');
    const saved = byId('ps-' + kind + '-saved'); if (saved) { saved.classList.add('hidden'); saved.classList.remove('flex'); }
    const inp = byId('ps-' + kind + '-input'); if (inp) inp.focus();
  }
  async function savePsToken(kind) {
    const inp = byId('ps-' + kind + '-input');
    const v = ((inp && inp.value) || '').trim();
    if (!v) { toast('Colle un token.'); return; }
    getSettings()[PS_KEY[kind]] = v;
    const a = api();
    if (a && a.settingsSet) { try { await a.settingsSet({ [PS_KEY[kind]]: v }); } catch (_) { } }
    toast('Token enregistré ✓'); psRenderRow(kind);
  }
  async function clearPsToken(kind) {
    getSettings()[PS_KEY[kind]] = '';
    const a = api();
    if (a && a.settingsSet) { try { await a.settingsSet({ [PS_KEY[kind]]: '' }); } catch (_) { } }
    toast('Token effacé'); psRenderRow(kind);
  }
  listen(byId('prismicSettingsModal'), 'click', (e) => {
    const save = e.target.closest('[data-ps-save]'); if (save) { savePsToken(save.dataset.psSave); return; }
    const edit = e.target.closest('[data-ps-edit]'); if (edit) { editPsToken(edit.dataset.psEdit); return; }
    const clr = e.target.closest('[data-ps-clear]'); if (clr) { clearPsToken(clr.dataset.psClear); return; }
    if (e.target.closest('[data-close-settings]')) { closeSettings(); return; }
  });

  // =====================================================================================
  // Modale de succès Prismic (créée à la demande).
  // =====================================================================================
  function showPrismicDone(opts) {
    opts = opts || {};
    let m = byId('export-done');
    if (!m) {
      m = doc.createElement('div');
      m.id = 'export-done';
      m.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm z-[70] hidden items-center justify-center p-6';
      m.innerHTML = '<div class="bg-white border border-[#e5e7eb] rounded-2xl w-full max-w-sm p-6 text-center shadow-2xl">'
        + '<div class="w-12 h-12 mx-auto rounded-full bg-secondary/25 flex items-center justify-center text-[#132527] mb-3"><i class="fa-solid fa-check text-xl"></i></div>'
        + '<h3 id="prismic-done-title" class="font-display text-lg font-bold text-[#132527] mb-1"></h3>'
        + '<p id="prismic-done-sub" class="text-sm text-slate-500 mb-4"></p>'
        + '<div class="flex gap-2">'
        + '<button data-ed-close class="flex-1 px-3 py-2 rounded-lg border border-[#e5e7eb] text-sm text-[#132527] hover:bg-[#eef2f6] transition">Fermer</button>'
        + '<button data-ed-open class="flex-1 px-3 py-2 rounded-lg bg-secondary text-ink-deep text-sm font-semibold hover:brightness-110 transition">Voir sur Prismic</button>'
        + '</div></div>';
      doc.body.appendChild(m);
      const hideDone = () => { m.classList.add('hidden'); m.classList.remove('flex'); };
      m.addEventListener('click', (e) => {
        if (e.target === m || e.target.closest('[data-ed-close]')) { hideDone(); return; }
        if (e.target.closest('[data-ed-open]')) { const a = api(); if (a && a.openExternal) a.openExternal(m.dataset.url || PRISMIC_BUILDER_URL); hideDone(); }
      });
    }
    const t = m.querySelector('#prismic-done-title'); if (t) t.textContent = opts.title || 'Terminé';
    const s = m.querySelector('#prismic-done-sub'); if (s) s.textContent = opts.subtitle || '';
    m.dataset.url = opts.url || PRISMIC_BUILDER_URL;
    m.classList.remove('hidden'); m.classList.add('flex');
  }

  return {
    askName, showPrismicDone,
    openExport, closeExport,
    openImportCode, closeImportCode,
    openPrismicImport, closePrismicImport, getImportSource, saveReadToken, clearPrismicImportInput,
    openSettings, closeSettings,
    dispose() { while (disposers.length) { try { disposers.pop()(); } catch (_) { } } },
  };
}
