// Export PAR SLICE (1 slice = 1 document Prismic) : { html, css, js }.
//  - origin 'imported'  -> VERBATIM (aucun scope / compile / renommage).
//  - sinon              -> pipeline : alias de classes PARTAGÉ HTML+CSS+JS, scope par uid,
//                          keyframes namespacées, JS en IIFE.
// Les transformations de chaînes viennent de export-transforms.js ; ici : collecte des
// règles à l'exécution (document.styleSheets) et assemblage.
import { serializeSlice } from './slice.js';
import {
  buildAlias,
  rewriteHtmlClasses,
  rewriteSelector,
  rewriteJsClasses,
  namespaceKeyframes,
  scopeRule,
} from './export-transforms.js';

// Dernier export calculé (copie / envoi Prismic le relisent). Live binding ES + getter.
export let lastExport = { html: '', css: '', js: '' };
export function getLastExport() { return lastExport; }

// ---------------------------------------------------------------------------
// Collecte des règles CSS (runtime)
// ---------------------------------------------------------------------------

// Toutes les règles des feuilles du document, avec leur @media : [{ media, selector, body }].
// Les @keyframes sont renvoyées sous la même forme : selector = '@keyframes <nom>',
// body = les images clés (elles ne sont émises que si une règle retenue les référence).
export function collectCssRules(doc = document) {
  const out = [];
  function walk(list, media) {
    for (const rule of list) {
      if (rule.type === 1) out.push({ media, selector: rule.selectorText, body: rule.style.cssText });
      else if (rule.type === 4) walk(rule.cssRules, rule.media.mediaText);
      else if (rule.type === 7) {
        const frames = Array.from(rule.cssRules, (r) => r.cssText).join(' ');
        out.push({ media: '', selector: '@keyframes ' + rule.name, body: frames });
      }
    }
  }
  for (const sheet of doc.styleSheets) {
    let list;
    try { list = sheet.cssRules; } catch (_) { continue; } // feuille cross-origin
    if (list) walk(list, '');
  }
  return out;
}

// ---------------------------------------------------------------------------
// Utilitaires (portés de l'export historique)
// ---------------------------------------------------------------------------

// tokens `.classe` (échappements CSS permis) d'un sélecteur -> noms déséchappés
function classNames(sel) {
  const names = [];
  const re = /\.((?:\\.|[-\w])+)/g;
  let m;
  while ((m = re.exec(sel))) names.push(m[1].replace(/\\(.)/g, '$1'));
  return names;
}

// Découpe une liste de sélecteurs sur les virgules de premier niveau (hors parenthèses).
function splitSelectorList(sel) {
  const parts = [];
  let depth = 0;
  let cur = '';
  for (const ch of sel) {
    if (ch === '(') depth++; else if (ch === ')') depth--;
    if (ch === ',' && depth === 0) { parts.push(cur); cur = ''; } else cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// POLICES : aucune police embarquée (déjà chargées par le site Ekwateur) ; on remappe
// seulement les noms de l'app vers les noms de famille exacts du site.
const GOTHIC = "'GothicA1_regular', 'GothicA1_semiBold', 'Gothic A1', system-ui, sans-serif";
const CARNERO = "'Carnero_bold', 'Carnero_semiBold', Georgia, serif";
const fixFonts = (s) => s
  .replace(/["']?Carnero["']?/g, CARNERO)
  .replace(/["']?Gothic A1["']?/g, GOTHIC);

const minWidth = (m) => { const x = /min-width:\s*(\d+)/.exec(m); return x ? +x[1] : 0; };
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

let uidCounter = 0;
// Id court, unique par export : aléa + compteur de module (jamais deux fois le même).
function mintUid() {
  uidCounter += 1;
  return Math.random().toString(36).slice(2, 6) + uidCounter.toString(36);
}

// Préfixe descendant `html|body|:root ` retiré (`body .card` -> `.card`). Les règles
// `html` / `body` / `:root` SEULES (preflight, CSS du châssis de l'app) sont volontairement
// ignorées, comme avant : elles fuiraient sur chaque slice et écraseraient le reset du wrapper.
const ROOT_PREFIX = /^(?:html|body|:root)\s+/i;

// Une partie de sélecteur -> { selector } (à scoper) ou null (ignorée : élément nu,
// html/body/:root seuls, ou classe absente de cette slice).
function classifyPart(part, alias) {
  let rest = part;
  while (ROOT_PREFIX.test(rest)) rest = rest.replace(ROOT_PREFIX, ''); // `body .x` -> `.x`
  const names = classNames(rest);
  if (!names.length) return null;                    // preflight / élément : ignoré (comme avant)
  if (!names.every((n) => alias.has(n))) return null; // référence une classe absente de la slice
  return { selector: rewriteSelector(rest, alias) };
}

// ---------------------------------------------------------------------------
// Imported : verbatim
// ---------------------------------------------------------------------------

const EDIT_ATTRS = ['data-comp', 'data-remote-id', 'data-base-version', 'data-remote-title', 'data-remote-field', 'draggable', 'contenteditable'];

// Le <div> synthétique (sans attribut) de buildVerbatimSliceHTML est l'enveloppe ; sinon
// c'est la racine elle-même qui porte le contenu. Durcissement volontaire vs l'historique
// `firstElementChild || el` (qui prenait n'importe quel premier enfant).
function verbatimSource(root) {
  const kids = Array.from(root.children);
  const only = kids.length === 1 ? kids[0] : null;
  return only && only.tagName === 'DIV' && only.attributes.length === 0 ? only : root;
}

// Porté tel quel de extractVerbatimForExport (index.html), sur slice.root.
function exportImported(slice) {
  const field = (slice.meta && slice.meta.prismicField) || slice.root.getAttribute('data-remote-field') || 'html_only';
  const clone = verbatimSource(slice.root).cloneNode(true);
  clone.querySelectorAll('[data-comp]').forEach((e) => e.removeAttribute('data-comp'));
  EDIT_ATTRS.forEach((a) => clone.removeAttribute(a));
  clone.querySelectorAll('[draggable],[contenteditable],[data-remote-id],[data-base-version],[data-remote-title],[data-remote-field]')
    .forEach((e) => EDIT_ATTRS.forEach((a) => e.removeAttribute(a)));
  if (field === 'html') {
    const inner = clone.innerHTML.replace(/(<script[^>]*?)\s+type=["']text\/ekw-js["']/gi, '$1');
    return { html: inner.trim(), css: '', js: '' };
  }
  let css = '';
  let js = '';
  clone.querySelectorAll('style').forEach((s) => { css += (css ? '\n' : '') + s.textContent; s.remove(); });
  clone.querySelectorAll('script').forEach((s) => { js += (js ? '\n' : '') + s.textContent; s.remove(); });
  return { html: clone.innerHTML.trim(), css, js };
}

// ---------------------------------------------------------------------------
// Generated / code / library : compile + scope
// ---------------------------------------------------------------------------

function exportCompiled(slice, rules, uidOverride) {
  const uid = uidOverride || mintUid();
  const wrapper = 'eks-' + uid; // classe du wrapper (scope) ; les alias sont eks-<uid>-N

  // 1. HTML canonique de la slice -> DOM jetable, nettoyé pour l'export.
  const box = slice.root.ownerDocument.createElement('div');
  box.innerHTML = serializeSlice(slice);
  box.querySelectorAll('[class*="ekw-force-"]').forEach((e) => {
    e.className = e.className.replace(/\bekw-force-\w+\b/g, '').replace(/\s+/g, ' ').trim();
    if (!e.className) e.removeAttribute('class');
  });
  box.querySelectorAll('img[data-picto-url]').forEach((img) => img.setAttribute('src', img.getAttribute('data-picto-url')));
  box.querySelectorAll('*').forEach((e) => ['data-picto', 'data-picto-url', 'data-picto-missing', 'data-comp', 'data-ekw-pending', 'draggable'].forEach((a) => e.removeAttribute(a)));

  // 2. JS extrait.
  let jsSrc = '';
  box.querySelectorAll('script').forEach((s) => { jsSrc += (s.textContent || '').trim() + '\n\n'; s.remove(); });
  jsSrc = jsSrc.trim();

  // 3. Classes utilisées / connues. Connue = présente dans une règle CSS, OU ciblée par le
  //    JS (une classe sans CSS mais utilisée comme hook JS doit survivre au renommage).
  const used = new Set();
  box.querySelectorAll('*').forEach((e) => e.classList.forEach((c) => used.add(c)));
  const styleRules = rules.filter((r) => typeof r.selector === 'string' && !r.selector.startsWith('@'));
  const keyframes = rules.filter((r) => typeof r.selector === 'string' && /^@(?:-[a-z]+-)?keyframes\s/i.test(r.selector));
  const known = new Set();
  let varDefaults = '';
  for (const r of styleRules) {
    if (!varDefaults && /(^|,)\s*\*/.test(r.selector) && /--tw-/.test(r.body)) varDefaults = r.body;
    for (const n of classNames(r.selector)) if (used.has(n)) known.add(n);
  }
  if (jsSrc) {
    for (const c of used) {
      if (!known.has(c) && new RegExp('(?<![\\w-])' + escapeRe(c) + '(?![\\w-])').test(jsSrc)) known.add(c);
    }
  }
  const alias = buildAlias(used, known, uid);

  // 4. États hover/focus/active -> règles ; attribut retiré du HTML.
  const stateRules = [];
  box.querySelectorAll('[data-ekw-states]').forEach((node) => {
    let st = {};
    try { st = JSON.parse(node.getAttribute('data-ekw-states') || '{}'); } catch (_) { /* états illisibles : ignorés */ }
    const eid = node.getAttribute('data-eid');
    if (eid) {
      for (const state of ['hover', 'focus', 'active']) {
        const o = st[state];
        if (!o) continue;
        const body = Object.keys(o).map((p) => p + ':' + fixFonts(o[p])).join(';');
        if (body) stateRules.push(scopeRule(`[data-eid="${eid}"]:${state}`, body, wrapper));
      }
    }
    node.removeAttribute('data-ekw-states');
  });

  // 5. CSS : reset du wrapper, puis règles (base puis @media mobile-first), scopées par uid.
  const buckets = new Map(); // media -> [règles]
  const push = (media, line) => {
    if (!buckets.has(media)) buckets.set(media, []);
    buckets.get(media).push(line);
  };
  for (const r of styleRules) {
    const scoped = [];
    for (const part of splitSelectorList(r.selector)) {
      const c = classifyPart(part, alias);
      if (!c) continue;
      scoped.push(c.selector);
    }
    const body = fixFonts(r.body);
    if (scoped.length) push(r.media, scopeRule(scoped.join(','), body, wrapper));
  }

  let css = `.${wrapper} { all: initial; box-sizing: border-box; display: block; `
    + `font-family: ${GOTHIC}; font-size: 16px; line-height: 1.5; `
    + 'color: #F8FBFB; text-align: left; }\n';
  css += `.${wrapper} *, .${wrapper} *::before, .${wrapper} *::after { box-sizing: border-box; }\n`;
  if (varDefaults) css += `.${wrapper} *, .${wrapper} *::before, .${wrapper} *::after { ${varDefaults} }\n`;
  if (buckets.has('')) css += buckets.get('').join('\n') + '\n';
  [...buckets.keys()].filter((m) => m).sort((a, b) => minWidth(a) - minWidth(b)).forEach((m) => {
    css += `@media ${m} {\n` + buckets.get(m).map((l) => '  ' + l).join('\n') + '\n}\n';
  });
  if (stateRules.length) css += stateRules.join('\n') + '\n';

  // 6. Keyframes : seulement celles référencées par une déclaration animation retenue,
  //    puis namespacées par uid (références mises à jour).
  // Balaie volontairement tout le CSS assemblé (y compris les corps des règles d'états).
  const animDecls = (css.match(/(?<![\w-])(?:-[a-z]+-)?animation(?:-name)?\s*:[^;}]*/gi) || []).join(' ');
  const seen = new Set();
  for (const k of keyframes) {
    const m = /^@((?:-[a-z]+-)?keyframes)\s+(\S+)/i.exec(k.selector);
    const key = m[1] + ' ' + m[2];
    if (seen.has(key)) continue;
    if (!new RegExp('(?<![\\w-])' + escapeRe(m[2]) + '(?![\\w-])').test(animDecls)) continue;
    seen.add(key);
    css += `@${m[1]} ${m[2]} { ${k.body} }\n`;
  }
  css = namespaceKeyframes(css, uid).css;

  // 7. HTML aliasé dans le wrapper ; JS aliasé (MÊME table) dans une IIFE.
  const aliasedHtml = rewriteHtmlClasses(box.innerHTML, alias);
  const html = `<div class="${wrapper}">\n` + aliasedHtml.replace(/^/gm, '  ').trimEnd() + '\n</div>';
  const js = jsSrc ? '(function () {\n' + rewriteJsClasses(jsSrc, alias) + '\n})();' : '';

  return { html: html.trim(), css: css.trim(), js };
}

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

// `collectCssRules` est injecté (tests : fixtures ; app : lecture de document.styleSheets).
// `uid` optionnel : déterministe pour les tests.
export function exportSlice(slice, { collectCssRules: collect = collectCssRules, uid } = {}) {
  const out = slice.origin === 'imported'
    ? exportImported(slice)
    : exportCompiled(slice, collect(), uid);
  lastExport = out;
  return out;
}
