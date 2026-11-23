// Navigateur de slices Prismic réutilisable : liste (cache SWR), vignettes iframe
// (Tailwind + polices via buildThumbDoc) lazy-chargées, filtre, sélection, pont prix
// postMessage scoping aux iframes du conteneur monté. Extrait de modals.js pour être
// monté AUSSI dans le panneau de droite (onglet Prismic) en plus de la modale d'import.
//
// Le store n'est PAS touché ici : l'import réel reste prismic.doImport() ; ce module
// ne fait que présenter la liste et signaler la slice choisie via onPick(selectedId).
//
// initPrismicBrowser(ctx) -> { mount(container,{filterInput}?), load({force,silent})?,
//   render(), getSelectedId(), setSelectedId(id), clearSelection(), getItems(), dispose() }
//   ctx.document / ctx.window / ctx.api ; ctx.buildThumbDoc (défaut: ./preview.js) ;
//   ctx.onPick(selectedId, clickedId) ; ctx.toast ; ctx.beforeLoad() (ex: persiste le token).

import { buildThumbDoc as defaultBuildThumbDoc } from './preview.js';

// Cache mémoire PARTAGÉ entre instances (modale + panneau) : la source est le cloud,
// un seul fetch alimente toutes les vues.
let _prismicLib = [];

export function initPrismicBrowser(ctx = {}) {
  const doc = ctx.document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
  const win = ctx.window || (doc && doc.defaultView) || (typeof globalThis !== 'undefined' ? globalThis : null);
  const api = () => ctx.api || (win && win.api) || null;
  const buildThumbDoc = ctx.buildThumbDoc || defaultBuildThumbDoc;
  const onPick = typeof ctx.onPick === 'function' ? ctx.onPick : () => {};
  const toast = (m) => { if (typeof ctx.toast === 'function') ctx.toast(m); };
  const beforeLoad = typeof ctx.beforeLoad === 'function' ? ctx.beforeLoad : null;

  let container = null;
  let filterInput = null;
  let selectedId = '';
  let thumbObserver = null;
  let msgHandler = null;
  let clickHandler = null;
  let filterHandler = null;

  function mount(el, opts = {}) {
    container = el || null;
    filterInput = (opts && opts.filterInput) || null;
    if (filterInput && filterInput.addEventListener) {
      filterHandler = () => render();
      filterInput.addEventListener('input', filterHandler);
    }
    if (container && container.addEventListener) {
      clickHandler = (e) => onContainerClick(e);
      container.addEventListener('click', clickHandler);
    }
    // Pont prix : une iframe de CE conteneur demande un devis (shim fetch) → relayé à
    // main.js (Referer forcé) → réponse renvoyée. On ne répond qu'aux iframes du conteneur.
    if (win && win.addEventListener && !msgHandler) {
      msgHandler = async (e) => {
        const d = e.data || {};
        if (!d || d.type !== 'ekw-quotation' || !container) return;
        let mine = false;
        container.querySelectorAll('iframe').forEach((f) => { if (f.contentWindow === e.source) mine = true; });
        if (!mine) return;
        let reply = { type: 'ekw-quotation-reply', id: d.id, ok: false, status: 401, json: null };
        const a = api();
        if (a && a.getQuotation) {
          try { const r = await a.getQuotation(d.body); reply = { type: 'ekw-quotation-reply', id: d.id, ok: !!(r && r.ok), status: (r && r.status) || 0, json: (r && r.json) || null }; }
          catch (_) { }
        }
        try { if (e.source) e.source.postMessage(reply, '*'); } catch (_) { }
      };
      win.addEventListener('message', msgHandler);
    }
  }

  function onContainerClick(e) {
    const card = e.target && e.target.closest ? e.target.closest('[data-slice-id]') : null;
    if (!card || !container || !container.contains(card)) return;
    const id = card.dataset.sliceId;
    selectedId = (selectedId === id) ? '' : id; // re-clic = désélection
    render();
    onPick(selectedId, id);
  }

  async function load(opts = {}) {
    const a = api();
    if (!a || !a.listPrismicSlices) { if (!opts.silent) toast("Dispo seulement dans l'app"); return { error: 'NO_API' }; }
    if (beforeLoad) { try { await beforeLoad(); } catch (_) { } }
    if (!opts.silent && !_prismicLib.length && container) {
      container.innerHTML = '<div class="col-span-4 text-[12px] text-slate-500 py-6 text-center">Chargement…</div>';
    }
    let r;
    try { r = await a.listPrismicSlices({ force: !!opts.force }); } catch (e) { r = { error: e.message }; }
    if (!r || r.error || !r.ok) {
      if (!opts.silent) toast('Biblio Prismic : ' + (r && r.error === 'NO_READ_TOKEN' ? 'token de lecture requis' : ((r && r.error) || 'échec')));
      return r || { error: 'échec' }; // en silencieux (SWR), on garde le cache déjà affiché
    }
    _prismicLib = r.slices || [];
    render();
    return r;
  }

  function render() {
    if (!container || !doc) return;
    const q = ((filterInput && filterInput.value) || '').toLowerCase();
    const items = _prismicLib.filter((s) => !q || (s.name || '').toLowerCase().includes(q) || s.id.toLowerCase().includes(q));
    container.innerHTML = '';
    if (!items.length) {
      const empty = doc.createElement('div');
      empty.className = 'col-span-4 text-[12px] text-slate-500 py-6 text-center';
      empty.textContent = 'Aucune slice';
      container.appendChild(empty);
      return;
    }
    // (Re)crée l'observer de lazy-load : seules les vignettes visibles chargent leur iframe.
    if (thumbObserver) { try { thumbObserver.disconnect(); } catch (_) { } thumbObserver = null; }
    const IO = win && win.IntersectionObserver;
    if (IO) {
      try {
        thumbObserver = new IO((entries, obs) => {
          for (const en of entries) {
            if (!en.isIntersecting) continue;
            const f = en.target;
            if (f && f._ekwHtml != null && !f.getAttribute('srcdoc')) f.srcdoc = buildThumbDoc(f._ekwHtml);
            obs.unobserve(f);
          }
        }, { root: container, rootMargin: '300px' });
      } catch (_) { thumbObserver = null; }
    }

    for (const s of items) {
      const dte = s.date ? new Date(s.date).toLocaleDateString('fr-FR') : '';
      const on = s.id === selectedId;
      const card = doc.createElement('div');
      card.setAttribute('role', 'button');
      card.tabIndex = 0;
      card.dataset.sliceId = s.id;
      card.setAttribute('aria-pressed', String(on));
      card.title = s.name || s.id;
      // shrink-0 : dans un conteneur flex-col (panneau), sans ça les cartes se compriment
      // en fines lignes quand la liste dépasse la hauteur (au lieu de défiler). La grille
      // de la modale (grid) n'en a pas besoin, mais shrink-0 y est inoffensif.
      card.className = 'group shrink-0 cursor-pointer rounded-xl border overflow-hidden transition flex flex-col ' +
        (on ? 'border-secondary ring-2 ring-secondary' : 'border-slate-700 hover:border-secondary');

      const thumb = doc.createElement('div');
      thumb.className = 'relative h-36 w-full overflow-hidden bg-white';
      const ifr = doc.createElement('iframe');
      ifr.setAttribute('scrolling', 'no');
      ifr.setAttribute('tabindex', '-1');
      ifr.setAttribute('aria-hidden', 'true');
      ifr.style.cssText = 'width:1000px;height:576px;border:0;transform:scale(0.25);transform-origin:top left;pointer-events:none;background:#fff;';
      ifr._ekwHtml = s.html || '';
      thumb.appendChild(ifr);
      if (thumbObserver) thumbObserver.observe(ifr);
      else ifr.srcdoc = buildThumbDoc(ifr._ekwHtml); // repli : pas d'observer
      if (on) {
        const chk = doc.createElement('div');
        chk.className = 'absolute top-1.5 right-1.5 text-secondary text-lg drop-shadow z-10';
        chk.innerHTML = '<i class="fa-solid fa-circle-check"></i>';
        thumb.appendChild(chk);
      }

      const meta = doc.createElement('div');
      meta.className = 'px-2.5 py-1.5 border-t ' + (on ? 'border-secondary bg-secondary/15' : 'border-slate-800 bg-slate-950');
      const nm = doc.createElement('div');
      nm.className = 'text-[11px] truncate ' + (on ? 'text-white font-bold' : 'text-slate-100');
      nm.textContent = s.name || s.id;
      const dt = doc.createElement('div');
      dt.className = 'text-[10px] text-slate-500';
      dt.textContent = dte;
      meta.appendChild(nm); meta.appendChild(dt);

      card.appendChild(thumb); card.appendChild(meta);
      container.appendChild(card);
    }
  }

  function getSelectedId() { return selectedId; }
  function setSelectedId(id) { selectedId = id || ''; }
  function clearSelection() { selectedId = ''; }
  function getItems() { return _prismicLib.slice(); }
  function hasItems() { return _prismicLib.length > 0; }

  function dispose() {
    if (thumbObserver) { try { thumbObserver.disconnect(); } catch (_) { } thumbObserver = null; }
    if (win && msgHandler) { try { win.removeEventListener('message', msgHandler); } catch (_) { } msgHandler = null; }
    if (container && clickHandler) { try { container.removeEventListener('click', clickHandler); } catch (_) { } clickHandler = null; }
    if (filterInput && filterHandler) { try { filterInput.removeEventListener('input', filterHandler); } catch (_) { } filterHandler = null; }
  }

  return { mount, load, render, getSelectedId, setSelectedId, clearSelection, getItems, hasItems, dispose };
}
