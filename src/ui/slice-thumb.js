// Vignette de slice fidèle, partagée par les 3 onglets de la bibliothèque (Local,
// Partagée, Prismic). Rend la slice dans une iframe (Tailwind + polices via
// buildThumbDoc) — contrairement à l'ancien <div> scalé sans Tailwind qui rendait
// mal les slices locales. Chargement paresseux (IntersectionObserver partagé, repli
// srcdoc direct). Le pont prix est géré au niveau de la grille via attachPriceBridge.

import { buildThumbDoc as defaultBuildThumbDoc } from './preview.js';

let _io = null;
function ensureObserver(win) {
  if (_io) return _io;
  const IO = win && win.IntersectionObserver;
  if (!IO) return null;
  try {
    _io = new IO((entries, obs) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const f = en.target;
        if (f && f._ekwHtml != null && !f.getAttribute('srcdoc') && typeof f._ekwBuild === 'function') {
          f.srcdoc = f._ekwBuild(f._ekwHtml);
        }
        obs.unobserve(f);
      }
    }, { rootMargin: '300px' });
  } catch (_) { _io = null; }
  return _io;
}

// À appeler avant de reconstruire une grille (innerHTML vidé) : libère l'observer
// partagé pour que les iframes détachées de l'ancien rendu ne restent pas observées
// (fuite sinon, car l'IntersectionObserver garde une réf forte sur ses cibles).
// Le prochain mountSliceThumb recrée l'observer à la volée.
export function resetThumbObserver() {
  if (_io) { try { _io.disconnect(); } catch (_) { } _io = null; }
}

// Crée et monte une iframe de vignette dans `container`. Lazy si IntersectionObserver
// est dispo (sinon srcdoc immédiat). Retourne l'iframe.
export function mountSliceThumb(container, html, opts = {}) {
  if (!container) return null;
  const doc = container.ownerDocument || (typeof document !== 'undefined' ? document : null);
  const win = opts.win || (doc && doc.defaultView) || (typeof window !== 'undefined' ? window : null);
  const buildThumbDoc = opts.buildThumbDoc || defaultBuildThumbDoc;
  if (!doc) return null;
  const ifr = doc.createElement('iframe');
  ifr.setAttribute('scrolling', 'no');
  ifr.setAttribute('tabindex', '-1');
  ifr.setAttribute('aria-hidden', 'true');
  ifr.style.cssText = (opts.style
    || 'width:1000px;height:576px;border:0;transform:scale(0.25);transform-origin:top left;pointer-events:none;background:#fff;');
  ifr._ekwHtml = html || '';
  ifr._ekwBuild = buildThumbDoc;
  container.appendChild(ifr);
  const io = ensureObserver(win);
  if (io) io.observe(ifr);
  else ifr.srcdoc = buildThumbDoc(ifr._ekwHtml);
  return ifr;
}

// Un seul écouteur de message par grille : une iframe de la grille demande un devis
// (shim fetch de buildThumbDoc) → relayé à l'API (Referer forcé côté main) → réponse
// renvoyée. `isOurs(source)` dit si l'iframe émettrice appartient à cette grille.
// Retourne une fonction de désabonnement.
export function attachPriceBridge(win, api, isOurs) {
  if (!win || !win.addEventListener) return () => {};
  const handler = async (e) => {
    const d = e.data || {};
    if (!d || d.type !== 'ekw-quotation') return;
    if (typeof isOurs === 'function' && !isOurs(e.source)) return;
    let reply = { type: 'ekw-quotation-reply', id: d.id, ok: false, status: 401, json: null };
    const a = (typeof api === 'function') ? api() : api;
    if (a && a.getQuotation) {
      try { const r = await a.getQuotation(d.body); reply = { type: 'ekw-quotation-reply', id: d.id, ok: !!(r && r.ok), status: (r && r.status) || 0, json: (r && r.json) || null }; }
      catch (_) { }
    }
    try { if (e.source) e.source.postMessage(reply, '*'); } catch (_) { }
  };
  win.addEventListener('message', handler);
  return () => { try { win.removeEventListener('message', handler); } catch (_) { } };
}
