// Aperçu & mise en page du canvas : bascule Édition/Aperçu, largeurs device, gabarit de
// page (dézoom du canvas), iframe srcdoc fidèle + shim fetch prix (API-SO via le parent).
// Porté depuis index.html (setMode, setWidth, setPageWidth, applyCanvasWidth, buildPreviewDoc,
// collectPreviewHTML, renderDevicePreview, pont prix postMessage).
//
// Règle d'or : l'aperçu LIT le store (store.list()) ; le canvas vivant n'est JAMAIS modifié
// (le candidat chat en attente est substitué sur une COPIE).
//
// initPreview(store, ctx) -> { setMode, getMode, setWidth, setPageWidth, getPageMaxW,
//   applyCanvasWidth, renderDevicePreview, dispose }
//   ctx.document / ctx.window : hôtes.
//   ctx.canvas                : #canvas (défaut store.canvas).
//   ctx.api                   : window.api (pont prix getQuotation).
//   ctx.twConfig              : window.EKW_TW (config Tailwind injectée dans l'iframe).
//   ctx.siteBg                : fond du site (défaut '#101c1e').
//   ctx.cleanHTML(html,forExport) : nettoyage HTML (pictos → src local en aperçu).
//   ctx.stateCssForPreview()  : CSS des états hover/focus/active (editing.stateCssForPreview).
//   ctx.getPending()          : candidat chat { el, html } | null (chat.getPending).
//   ctx.beforePreview()       : stopEditing + deselect avant un rebuild (optionnel).

const DEFAULT_DEVICE_W = { desktop: 1080, tablet: 768, mobile: 390 };

// Document d'aperçu pour les vignettes (grille d'import Prismic). Rend la slice
// FIDÈLEMENT comme le vrai aperçu : scripts réactivés (les simulateurs
// construisent leur UI en JS), Tailwind + polices, et shim prix postMessage
// relayé au parent (bridge dans modals.js). Fond BLANC = contexte réel du site
// Ekwateur (les cartes des slices portent leur propre fond sombre).
export function buildThumbDoc(inner, siteBg) {
  inner = (inner || '').replace(/<script\s+type=["']text\/ekw-js["']\s*>/gi, '<script>');
  let assetBase = 'assets/';
  try { assetBase = new URL('assets/', (typeof window !== 'undefined' && window.location ? window.location.href : '')).href; } catch (_) { }
  const fontBase = assetBase + 'fonts/';
  let cfg = '{}';
  try { cfg = JSON.stringify((typeof window !== 'undefined' && window.EKW_TW) || {}); } catch (_) { }
  const bg = siteBg || '#ffffff';
  return '<!DOCTYPE html><html lang="fr"><head>'
    + '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<script>(function(){var _f=window.fetch;window.fetch=function(u,o){try{if(typeof u==="string"&&u.indexOf("api-so.ekwateur.fr/quotations")>=0){return new Promise(function(res){var id=Math.random().toString(36).slice(2);function h(ev){var d=ev.data||{};if(d&&d.type==="ekw-quotation-reply"&&d.id===id){window.removeEventListener("message",h);res(new Response(JSON.stringify(d.json||{}),{status:d.ok?201:(d.status||401),headers:{"content-type":"application/json"}}));}}window.addEventListener("message",h);var b={};try{b=o&&o.body?JSON.parse(o.body):{};}catch(e){}parent.postMessage({type:"ekw-quotation",id:id,body:b},"*");});}}catch(e){}return _f.apply(this,arguments);};})();<\/script>'
    + '<script src="' + assetBase + 'vendor/tailwindcss.js"><\/script>'
    + '<script>tailwind.config=' + cfg + ';<\/script>'
    + '<link rel="stylesheet" href="' + assetBase + 'vendor/fontawesome.css">'
    + '<style>'
    + "@font-face{font-family:'Carnero';src:url('" + fontBase + "carnero-var.ttf') format('truetype');font-weight:300 900;}"
    + "@font-face{font-family:'Gothic A1';src:url('" + fontBase + "gothic-a1-400.otf') format('opentype');font-weight:400;}"
    + "@font-face{font-family:'Gothic A1';src:url('" + fontBase + "gothic-a1-600.otf') format('opentype');font-weight:600;}"
    + "@font-face{font-family:'Gothic A1';src:url('" + fontBase + "gothic-a1-700.otf') format('opentype');font-weight:700;}"
    + 'body{margin:0;padding:16px;}'
    + '</style></head>'
    + '<body class="font-body" style="background-color:' + bg + '">' + inner + '</body></html>';
}

export function initPreview(store, ctx = {}) {
  const doc = ctx.document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
  const win = ctx.window || (doc && doc.defaultView) || (typeof globalThis !== 'undefined' ? globalThis : null);
  const canvas = ctx.canvas || store.canvas;
  const byId = (id) => (doc ? doc.getElementById(id) : null);
  const api = () => ctx.api || (win && win.api) || null;
  const SITE_BG = ctx.siteBg || '#101c1e';
  const twConfig = ctx.twConfig || (win && win.EKW_TW) || {};
  const cleanHTML = (h, f) => (typeof ctx.cleanHTML === 'function' ? ctx.cleanHTML(h, f) : h);
  const stateCssForPreview = () => (typeof ctx.stateCssForPreview === 'function' ? ctx.stateCssForPreview() : '');
  const getPending = () => (typeof ctx.getPending === 'function' ? ctx.getPending() : null);
  const beforePreview = () => { if (typeof ctx.beforePreview === 'function') ctx.beforePreview(); };

  const DEVICE_W = Object.assign({}, DEFAULT_DEVICE_W);
  let currentMode = 'edit';
  let currentWidth = 'desktop';
  let pageMaxW = 1080;
  let canvasZoom = 1;
  const disposers = [];
  const listen = (t, type, h, opts) => { if (t && t.addEventListener) { t.addEventListener(type, h, opts); disposers.push(() => t.removeEventListener(type, h, opts)); } };

  // --- gabarit de page : dézoom (transform:scale) du canvas en édition -----------------
  function applyCanvasWidth() {
    const fit = byId('canvas-fit');
    if (!pageMaxW) {
      canvas.style.width = '100%'; canvas.style.transform = ''; canvasZoom = 1;
      if (fit) { fit.style.width = ''; fit.style.height = ''; }
      return;
    }
    const natural = pageMaxW + 64;
    const sc = byId('canvas-scroll');
    const avail = sc ? sc.clientWidth : natural;
    const z = Math.min(1, avail / natural);
    canvasZoom = z;
    canvas.style.width = natural + 'px';
    canvas.style.transformOrigin = 'top left';
    canvas.style.transform = z < 1 ? 'scale(' + z + ')' : '';
    if (fit) {
      fit.style.width = Math.round(natural * z) + 'px';
      fit.style.height = z < 1 ? Math.round(canvas.offsetHeight * z) + 'px' : '';
    }
  }
  listen(win, 'resize', applyCanvasWidth);
  try {
    if (win && win.ResizeObserver) {
      const ro = new win.ResizeObserver(() => {
        if (canvasZoom < 1) { const fit = byId('canvas-fit'); if (fit) fit.style.height = Math.round(canvas.offsetHeight * canvasZoom) + 'px'; }
      });
      ro.observe(canvas);
      disposers.push(() => { try { ro.disconnect(); } catch (_) { } });
    }
  } catch (_) { }

  function getPageMaxW() { return pageMaxW; }
  function setPageWidth(v) {
    pageMaxW = parseInt(v, 10) || 0;
    DEVICE_W.desktop = pageMaxW || null;
    applyCanvasWidth();
    // Le zoom a changé → laisse l'éditeur recaler son marquee (il écoute 'resize').
    if (win && win.dispatchEvent && win.Event) { try { win.dispatchEvent(new win.Event('resize')); } catch (_) { } }
    if (currentMode === 'preview') applyWidth();
  }

  // --- document d'aperçu (iframe) + shim prix -----------------------------------------
  function buildPreviewDoc(inner) {
    // Les <script type="text/ekw-js"> (inertes dans le studio) sont réactivés pour l'aperçu.
    inner = (inner || '').replace(/<script\s+type=["']text\/ekw-js["']\s*>/gi, '<script>');
    let assetBase = 'assets/';
    try { assetBase = new URL('assets/', (win && win.location ? win.location.href : '')).href; } catch (_) { }
    const fontBase = assetBase + 'fonts/';
    const cfg = JSON.stringify(twConfig);
    return '<!DOCTYPE html><html lang="fr"><head>'
      + '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<script>(function(){var _f=window.fetch;window.fetch=function(u,o){try{if(typeof u==="string"&&u.indexOf("api-so.ekwateur.fr/quotations")>=0){return new Promise(function(res){var id=Math.random().toString(36).slice(2);function h(ev){var d=ev.data||{};if(d&&d.type==="ekw-quotation-reply"&&d.id===id){window.removeEventListener("message",h);res(new Response(JSON.stringify(d.json||{}),{status:d.ok?201:(d.status||401),headers:{"content-type":"application/json"}}));}}window.addEventListener("message",h);var b={};try{b=o&&o.body?JSON.parse(o.body):{};}catch(e){}parent.postMessage({type:"ekw-quotation",id:id,body:b},"*");});}}catch(e){}return _f.apply(this,arguments);};})();<\/script>'
      + '<script src="' + assetBase + 'vendor/tailwindcss.js"><\/script>'
      + '<script>tailwind.config=' + cfg + ';<\/script>'
      + '<link rel="stylesheet" href="' + assetBase + 'vendor/fontawesome.css">'
      + '<style>'
      + "@font-face{font-family:'Carnero';src:url('" + fontBase + "carnero-var.ttf') format('truetype');font-weight:300 900;}"
      + "@font-face{font-family:'Gothic A1';src:url('" + fontBase + "gothic-a1-400.otf') format('opentype');font-weight:400;}"
      + "@font-face{font-family:'Gothic A1';src:url('" + fontBase + "gothic-a1-600.otf') format('opentype');font-weight:600;}"
      + "@font-face{font-family:'Gothic A1';src:url('" + fontBase + "gothic-a1-700.otf') format('opentype');font-weight:700;}"
      + 'body{margin:0;padding:16px;}'
      + stateCssForPreview()
      + '</style></head>'
      + '<body class="font-body text-cloud" style="background-color:' + SITE_BG + '">' + inner + '</body></html>';
  }

  // Pont prix : l'iframe demande un devis → relayé à main.js (Referer forcé) → réponse renvoyée.
  listen(win, 'message', async (e) => {
    const d = e.data || {};
    if (!d || d.type !== 'ekw-quotation') return;
    const frame = byId('device-frame');
    if (!frame || e.source !== frame.contentWindow) return;
    let reply = { type: 'ekw-quotation-reply', id: d.id, ok: false, status: 401, json: null };
    const a = api();
    if (a && a.getQuotation) {
      try { const r = await a.getQuotation(d.body); reply = { type: 'ekw-quotation-reply', id: d.id, ok: !!(r && r.ok), status: (r && r.status) || 0, json: (r && r.json) || null }; }
      catch (_) { }
    }
    try { frame.contentWindow.postMessage(reply, '*'); } catch (_) { }
  });

  // Rassemble le HTML de l'aperçu depuis le STORE ; candidat chat substitué sur une copie.
  function collectPreviewHTML() {
    const pending = getPending();
    const usePending = pending && pending.el && canvas.contains(pending.el);
    if (usePending) pending.el.setAttribute('data-ekw-pending', '1');
    const clones = store.list().map((s) => s.root.cloneNode(true));
    if (usePending) pending.el.removeAttribute('data-ekw-pending');
    let html = '';
    clones.forEach((c) => {
      if (usePending) {
        const mark = c.matches('[data-ekw-pending]') ? c : c.querySelector('[data-ekw-pending]');
        if (mark) {
          const tmp = doc.createElement('div'); tmp.innerHTML = pending.html.trim();
          const cand = tmp.firstElementChild;
          if (cand) { if (mark === c) { html += cand.outerHTML + '\n'; return; } mark.replaceWith(cand); }
          else { mark.removeAttribute('data-ekw-pending'); }
        }
      }
      html += c.outerHTML + '\n';
    });
    return html;
  }

  function renderDevicePreview() {
    beforePreview();
    const clean = cleanHTML(collectPreviewHTML()) || '<div class="text-muted p-8 text-center">Aucun composant. Créez-en un via le chat, puis « Insérer ».</div>';
    const frame = byId('device-frame');
    if (frame) frame.srcdoc = buildPreviewDoc(clean);
  }

  // --- largeur device + mode ----------------------------------------------------------
  function applyWidth() {
    const frame = byId('device-frame');
    if (frame) {
      const w = DEVICE_W[currentWidth];
      frame.style.width = w ? w + 'px' : '100%';
      frame.style.maxWidth = '100%';
    }
    doc && doc.querySelectorAll('.w-btn').forEach((b) => {
      const on = b.dataset.w === currentWidth;
      b.classList.toggle('bg-[#ffc969]', on);
      b.classList.toggle('text-ink-deep', on);
      b.classList.toggle('font-semibold', on);
      b.classList.toggle('text-slate-400', !on);
    });
  }
  function setWidth(w) { currentWidth = w; applyWidth(); }

  function getMode() { return currentMode; }
  function setMode(mode) {
    currentMode = mode;
    doc && doc.querySelectorAll('.mode-btn').forEach((b) => {
      const on = b.dataset.mode === mode;
      b.classList.toggle('bg-[#ffc969]', on);
      b.classList.toggle('text-ink-deep', on);
      b.classList.toggle('font-semibold', on);
      b.classList.toggle('text-slate-400', !on);
    });
    const stage = byId('device-stage');
    const chips = byId('width-chips');
    const canvasScroll = byId('canvas-scroll');
    if (mode === 'edit') {
      beforePreview();
      if (canvasScroll) canvasScroll.classList.remove('hidden');
      applyCanvasWidth();
      if (stage) stage.classList.add('hidden');
      if (chips) { chips.classList.add('hidden'); chips.classList.remove('flex'); }
    } else {
      if (canvasScroll) canvasScroll.classList.add('hidden');
      if (stage) stage.classList.remove('hidden');
      if (chips) { chips.classList.remove('hidden'); chips.classList.add('flex'); }
      renderDevicePreview();
      applyWidth();
    }
  }

  return {
    setMode, getMode, setWidth, setPageWidth, getPageMaxW,
    applyCanvasWidth, renderDevicePreview,
    dispose() { while (disposers.length) { try { disposers.pop()(); } catch (_) { } } },
  };
}
