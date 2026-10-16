// Import de code collé (HTML / CSS / JS) -> UNE slice `code` via le SliceStore.
// Porté depuis index.html (flattenCssToInline, importCode). Conversion locale, sans IA :
// le CSS « inline-able » est aplati en style inline sur les éléments ; le résiduel (@media,
// :hover, ::x, keyframes, font-face…) est gardé dans un <style> SCOPÉ sous une classe
// unique et forcé en !important ; le JS va dans un <script type="text/ekw-js">.
//
// Règle : le store est la SEULE autorité sur le canvas — import = store.add(html, 'code').
//
// -------------------------------------------------------------------------------------
// Contrat `ctx` (fourni par le bootstrap — Task 12). Tout est OPTIONNEL et gardé :
//   document / window : hôtes (défaut globalThis.document / document.defaultView).
//   fields            : { html, css, js } → éléments <textarea> (défaut #imp-html/#imp-css/#imp-js).
//   getInput          : () => { html, css, js } (surcharge `fields`, ex. tests / autre UI).
//   editing           : { deselect, selectElement } (instance de features/editing.js).
//   hooks : collaborateurs HORS périmètre import, appelés s'ils existent :
//       toast(msg)
//       closeImportModal()        (repli : ajoute `hidden` sur #importModal)
//       deselect() / selectElement(el)   (surchargent ctx.editing)
//
// Retourne : { doImport(), dispose }.
//   - doImport() : lit les champs, construit le html aplati, store.add(html,'code'), sélectionne
//     la nouvelle racine, vide les champs, ferme la modale. Retourne la slice (ou null si rien
//     à importer). Câblage UI (Task 12) : bouton « Importer dans le canvas » -> doImport().
//
// Exports purs (testables) : flattenCssToInline(cssText, root, scopeClass, doc),
//   buildImportHtml({html,css,js}, doc, scope?) -> { html } | { error }.
// -------------------------------------------------------------------------------------

// Applique les règles CSS « inline-ables » en style inline sur les éléments de `root`,
// et renvoie le CSS résiduel (@media, :hover, ::x, keyframes…) SCOPÉ sous .scopeClass et
// forcé en !important (pour battre l'inline). Mute `root`. Zéro dépendance / zéro IA.
// `doc` : document hôte (le CSS est parsé dans une <style media="not all"> temporaire).
export function flattenCssToInline(cssText, root, scopeClass, doc = globalThis.document) {
  if (!cssText || !cssText.trim()) return '';
  const styleEl = doc.createElement('style');
  styleEl.setAttribute('media', 'not all'); // parsé mais n'affecte pas le document
  styleEl.textContent = cssText;
  doc.head.appendChild(styleEl);
  const residual = [];
  const declsImportant = (st) => { let o = ''; for (let i = 0; i < st.length; i++) { const p = st[i]; o += p + ':' + st.getPropertyValue(p) + ' !important;'; } return o; };
  const scopeSel = (sel) => sel.split(',').map((s) => '.' + scopeClass + ' ' + s.trim()).join(', ');
  const orig = [];
  root.querySelectorAll('[style]').forEach((el) => orig.push([el, el.getAttribute('style')]));
  try {
    const rules = styleEl.sheet ? styleEl.sheet.cssRules : [];
    for (let i = 0; i < rules.length; i++) {
      const r = rules[i];
      if (r.type === 1) { // CSSStyleRule
        const parts = r.selectorText.split(',').map((s) => s.trim());
        parts.filter((s) => s.indexOf(':') < 0).forEach((sel) => {
          let els; try { els = root.querySelectorAll(sel); } catch (_) { return; }
          els.forEach((el) => { for (let k = 0; k < r.style.length; k++) { const p = r.style[k]; el.style.setProperty(p, r.style.getPropertyValue(p), r.style.getPropertyPriority(p)); } });
        });
        const pseudo = parts.filter((s) => s.indexOf(':') >= 0);
        if (pseudo.length) residual.push(scopeSel(pseudo.join(', ')) + '{' + declsImportant(r.style) + '}');
      } else if (r.type === 4) { // @media
        const inner = [];
        for (let k = 0; k < r.cssRules.length; k++) { const mr = r.cssRules[k]; if (mr.type === 1) inner.push(scopeSel(mr.selectorText) + '{' + declsImportant(mr.style) + '}'); }
        if (inner.length) residual.push('@media ' + r.media.mediaText + '{' + inner.join('') + '}');
      } else if (r.cssText) { residual.push(r.cssText); } // keyframes, font-face…
    }
  } catch (_) { /* CSS illisible : on garde ce qui a été appliqué */ }
  doc.head.removeChild(styleEl);
  // Les styles inline d'origine gagnent sur les règles aplaties (spécificité inline).
  orig.forEach(([el, txt]) => {
    const tmp = doc.createElement('div');
    tmp.setAttribute('style', txt || '');
    for (let i = 0; i < tmp.style.length; i++) { const p = tmp.style[i]; el.style.setProperty(p, tmp.style.getPropertyValue(p), tmp.style.getPropertyPriority(p)); }
  });
  return residual.join('\n');
}

// html + css + js collés -> html de slice (enveloppe .scope : <style> résiduel, contenu aplati,
// <script type="text/ekw-js">). Retourne { html } ou { error: 'vide' | 'html-vide' }.
// Un <style>/<script> collé dans le HTML est réparti vers css/js.
export function buildImportHtml({ html = '', css = '', js = '' } = {}, doc = globalThis.document, scope) {
  html = (html || '').trim(); css = (css || '').trim(); js = (js || '').trim();
  if (!html && !css && !js) return { error: 'vide' };
  const holder = doc.createElement('div');
  holder.innerHTML = html;
  holder.querySelectorAll('style').forEach((s) => { css += '\n' + s.textContent; s.remove(); });
  holder.querySelectorAll('script').forEach((s) => { js += '\n' + s.textContent; s.remove(); });
  if (!holder.children.length && !holder.textContent.trim()) return { error: 'html-vide' };
  scope = scope || 'eks-imp-' + Math.random().toString(36).slice(2, 8);
  const residual = flattenCssToInline(css, holder, scope, doc);
  const wrap = doc.createElement('div');
  wrap.className = scope;
  if (residual.trim()) { const st = doc.createElement('style'); st.textContent = residual; wrap.appendChild(st); }
  while (holder.firstChild) wrap.appendChild(holder.firstChild);
  if (js.trim()) { const sc = doc.createElement('script'); sc.type = 'text/ekw-js'; sc.textContent = js.trim(); wrap.appendChild(sc); }
  return { html: wrap.outerHTML };
}

export function initImportCode(store, ctx = {}) {
  const doc = ctx.document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
  const hooks = ctx.hooks || {};
  const editing = ctx.editing || {};
  const byId = (id) => (doc ? doc.getElementById(id) : null);
  const call = (name, ...args) => { const fn = hooks[name]; return typeof fn === 'function' ? fn(...args) : undefined; };
  const toast = (m) => call('toast', m);
  const field = (k) => (ctx.fields && ctx.fields[k]) || byId('imp-' + k);
  const readInput = () => {
    if (typeof ctx.getInput === 'function') return ctx.getInput() || {};
    const v = (k) => { const el = field(k); return (el && el.value) || ''; };
    return { html: v('html'), css: v('css'), js: v('js') };
  };
  const clearInput = () => { ['html', 'css', 'js'].forEach((k) => { const el = field(k); if (el) el.value = ''; }); };
  const closeModal = () => {
    if (typeof hooks.closeImportModal === 'function') return hooks.closeImportModal();
    const m = byId('importModal');
    if (m) m.classList.add('hidden');
  };
  const deselect = () => {
    if (typeof hooks.deselect === 'function') hooks.deselect();
    else if (typeof editing.deselect === 'function') editing.deselect();
  };
  const selectElement = (el) => {
    if (typeof hooks.selectElement === 'function') hooks.selectElement(el);
    else if (typeof editing.selectElement === 'function') editing.selectElement(el);
  };

  function doImport() {
    const r = buildImportHtml(readInput(), doc);
    if (r.error === 'vide') { toast('Colle au moins du HTML.'); return null; }
    if (r.error) { toast('HTML vide.'); return null; }
    closeModal();
    deselect();
    const slice = store.add(r.html, 'code');
    selectElement(slice.root);
    if (typeof slice.root.scrollIntoView === 'function') slice.root.scrollIntoView({ block: 'center', behavior: 'smooth' });
    clearInput();
    toast('Composant importé (CSS aplati en inline)');
    return slice;
  }

  return { doImport, dispose() {} };
}
