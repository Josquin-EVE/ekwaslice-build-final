// Édition intra-slice : sélection + édition de contenu, routée via le SliceStore.
// Porté depuis index.html (l'« éditeur low-code »). Règle d'or : le store est la
// SEULE autorité structurelle sur #canvas.
//   - Suppression/duplication/déplacement d'une RACINE de slice → store.remove /
//     store.duplicate / store.move.
//   - Toute édition de CONTENU (texte inline, style inline, états hover/focus/active,
//     picto, textes dynamiques JS) mute le DOM vivant DANS slice.root puis appelle
//     store.touch(sliceId) → l'historique et l'UI se mettent à jour.
// Aucun second chemin de mutation du canvas hors store pour les opérations structurelles.
//
// -------------------------------------------------------------------------------------
// Contrat `ctx` (fourni par le bootstrap — Task 12). Tout est OPTIONNEL et gardé :
//   document      : Document hôte (défaut globalThis.document).
//   window        : Window hôte (défaut document.defaultView).
//   canvas        : élément #canvas (défaut store.canvas).
//   toolbar       : conteneur des actions élément (#editor-actions).
//   formatbar     : barre de format riche inline (#editor-format).
//   styleBox      : panneau de style (#editor-style).
//   statesBox     : onglets d'états hover/focus/active (#editor-states).
//   stateHint     : ligne d'aide d'édition d'état (#editor-state-hint).
//   nav           : conteneur de navigation (#editor-nav).
//   crumbs        : fil d'ariane (#editor-crumbs).
//   elctx         : en-tête de contexte d'élément (#editor-elctx).
//   canvasScroll  : conteneur scrollable du canvas (#canvas-scroll).
//   emptyState    : panneau « vide » (#empty-state).
//   editorPanel / libraryPanel : panneaux bascule (#editor-panel / #library-panel).
//   pictoMap      : { slug -> { slug, file, url, name } } (catalogue pictos).
//   pictoAssetBase: () => base d'URL des assets pictos.
//   hooks         : collaborateurs HORS périmètre édition, appelés s'ils existent :
//       showEditor(), showLibrary(), showActions(on), checkEmpty(), toast(msg),
//       resolvePictos(node), saveComponent(root), setTarget(el),
//       onSelect(el), onDeselect(), undo(), redo(),
//       suspendHistory(), resumeHistory()  // bracketing autour d'un état (aperçu forcé).
//
// Expose (retour d'initEditing) : selectElement, deselect, startEditing, stopEditing,
//   setEditState, commitStateEdits (_commitStateEdits), regenStateStyles,
//   stateCssForPreview, insertPicto, renderPictoGrid, deleteSelection, duplicateSelection,
//   moveSelection, spSync, getSelected, isEditing, dispose.
// -------------------------------------------------------------------------------------

import { newEid } from '../core/slice.js';

// Palettes de la charte (portées verbatim depuis index.html).
const EKW_COLORS = [
  ['#F8FBFB', 'Base'], ['#17E7D0', 'Turquoise'], ['#FFFFFF', 'Blanc'], ['#0F1A1C', 'Noir'], ['#FFC969', 'Jaune'],
];
const FULL_PALETTE = [
  ['Turquoise (primaire)', [['#73F1E3', '300'], ['#17E7D0', '500'], ['#12B5A3', '600'], ['#0A665B', '700'], ['#074E47', '800'], ['#053832', '900']]],
  ['Or (secondaire)', [['#FEDC5D', 'accent'], ['#FFC969', '300'], ['#E6A22A', '500'], ['#996500', '600'], ['#7A5000', '900']]],
  ['Neutres', [['#F8FBFB', '100'], ['#EEF5F6', '200'], ['#DEEBED', '300'], ['#C0DDE2', '400'], ['#A0B8BC', '450'], ['#2C5359', '500'], ['#1D383C', '600'], ['#132D30', '700'], ['#132527', '800'], ['#0F1A1C', '900']]],
  ['Gris', [['#E6E6E6', '100'], ['#D9D9D9', '200'], ['#BFBFBF', '300'], ['#7F7F7F', '600'], ['#353535', '900']]],
  ['Gaz (bleu)', [['#79C4FA', '300'], ['#52B6FE', '400'], ['#2F80DE', '500'], ['#1462BF', '600'], ['#002A74', '900']]],
  ['Élec française (vert)', [['#68DEB3', '300'], ['#4AD6A4', '400'], ['#009A59', '500'], ['#007544', '600'], ['#064F35', '900']]],
  ['Élec mobilité (violet)', [['#E0C4FF', '300'], ['#C49AF1', '400'], ['#9A55E1', '500'], ['#8243C4', '600'], ['#601FA3', '900']]],
  ['Autoconso (jaune)', [['#FFEB87', '300'], ['#FFE55D', '400'], ['#A98E01', '500'], ['#846F00', '600'], ['#685100', '900']]],
  ['Succès', [['#7BE87F', '300'], ['#167516', '600'], ['#165116', '900']]],
  ['Alerte', [['#FBAA6E', '300'], ['#B15500', '600'], ['#502700', '900']]],
  ['Erreur', [['#FFA3A3', '300'], ['#C63434', '600'], ['#610500', '900']]],
  ['Info', [['#82DCEF', '300'], ['#026D9B', '600'], ['#004A74', '900']]],
];
const SP_STEP = 2; // pas des boutons − / +

// Constantes de l'appel API (jamais du texte d'affichage) → hors « Textes dynamiques ».
const API_STOP = new Set(['PRIVATE', 'PROFESSIONAL', 'GAS', 'ELECTRICITY', 'FIXED', 'BASE', 'HIGH_LOW',
  'POST', 'GET', 'PUT', 'PATCH', 'DELETE', 'PSFO', 'EKWATEUR', 'GGO', 'LINKY', 'CHF', 'BI',
  'application/json', 'application/json; charset=utf-8']);

const escHtml = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const escAttr = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export function initEditing(store, ctx = {}) {
  const doc = ctx.document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
  const win = ctx.window || (doc && doc.defaultView) || (typeof globalThis !== 'undefined' ? globalThis : null);
  const canvas = ctx.canvas || store.canvas;
  const hooks = ctx.hooks || {};
  const call = (name, ...args) => { const fn = hooks[name]; if (typeof fn === 'function') return fn(...args); return undefined; };
  const byId = (id) => (doc ? doc.getElementById(id) : null);
  const raf = (cb) => { if (win && typeof win.requestAnimationFrame === 'function') win.requestAnimationFrame(cb); else cb(); };

  // Conteneurs de chrome (overridables ; sinon résolus par id ; sinon null → gardés).
  const toolbar = ctx.toolbar || byId('editor-actions');
  const formatbar = ctx.formatbar || byId('editor-format');
  const styleBox = ctx.styleBox || byId('editor-style');
  const statesBox = ctx.statesBox || byId('editor-states');
  const stateHint = ctx.stateHint || byId('editor-state-hint');
  const navBox = ctx.nav || byId('editor-nav');
  const crumbs = ctx.crumbs || byId('editor-crumbs');
  const elctxBox = ctx.elctx || byId('editor-elctx');
  const canvasScroll = ctx.canvasScroll || byId('canvas-scroll');
  const emptyState = ctx.emptyState || byId('empty-state');
  const editorPanel = ctx.editorPanel || byId('editor-panel');
  const libraryPanel = ctx.libraryPanel || byId('library-panel');

  const pictoMap = ctx.pictoMap || {};
  const pictoAssetBase = ctx.pictoAssetBase || (() => 'assets/pictos/');
  const getPictos = () => Object.keys(pictoMap).map((k) => pictoMap[k]);

  // ---- état local ---------------------------------------------------------------------
  let sel = null;            // élément sélectionné (racine de slice OU nœud interne)
  let editing = false;       // édition de texte inline en cours ?
  let editState = 'normal';  // onglet d'état courant (normal/hover/focus/active)
  let _stateBaseline = null; // {css, map} du style normal capturé en entrant dans un état
  const linkState = { margin: true, padding: true, border: true };
  const dimUnit = { width: 'px', height: 'px' };
  const disposers = [];

  // Écoute un évènement et mémorise le retrait pour dispose().
  const listen = (target, type, handler, opts) => {
    if (!target || !target.addEventListener) return;
    target.addEventListener(type, handler, opts);
    disposers.push(() => target.removeEventListener(type, handler, opts));
  };

  // ---- store : routage structurel + touch ---------------------------------------------
  const sliceOf = (node) => store.sliceOf(node);
  const isRoot = (node) => { const s = sliceOf(node); return !!(s && s.root === node); };
  const touchOf = (node) => { const s = sliceOf(node); if (s) store.touch(s.id); };
  const touchSel = () => { if (sel) touchOf(sel); };

  // ---- helpers DOM (portés) -----------------------------------------------------------
  function sliceRootOf(el) {
    let n = el, root = el;
    while (n && n !== canvas) { if (n.nodeType === 1 && n.hasAttribute && n.hasAttribute('data-comp')) root = n; n = n.parentElement; }
    return root;
  }
  function toast(msg) { if (typeof hooks.toast === 'function') return hooks.toast(msg); }

  // =====================================================================================
  // ÉTATS hover/focus/active : store data-ekw-states + <style id="ekw-live-states"> live.
  // =====================================================================================
  function _eidOf(el) { if (!el.getAttribute('data-eid')) el.setAttribute('data-eid', newEid()); return el.getAttribute('data-eid'); }
  function _getStates(el) { try { return JSON.parse(el.getAttribute('data-ekw-states') || '{}'); } catch (_) { return {}; } }
  function _saveStates(el, st) {
    const clean = {};['hover', 'focus', 'active'].forEach((k) => { if (st[k] && Object.keys(st[k]).length) clean[k] = st[k]; });
    if (Object.keys(clean).length) el.setAttribute('data-ekw-states', JSON.stringify(clean)); else el.removeAttribute('data-ekw-states');
  }
  function _styleMap(el) { const m = {}; for (let i = 0; i < el.style.length; i++) { const p = el.style[i]; m[p] = el.style.getPropertyValue(p); } return m; }

  // Régénère TOUT le <style> des états depuis les data-eid VIVANTS du DOM. createSliceRoot /
  // store.replaceContent re-mintent les data-eid des descendants [data-ekw-states] : comme on
  // repart ici des eids courants et qu'on réécrit le style en entier, aucune règle ne référence
  // un eid orphelin après un re-mint (import / replaceContent / undo).
  function regenStateStyles() {
    if (!doc) return;
    let s = doc.getElementById('ekw-live-states');
    if (!s) { s = doc.createElement('style'); s.id = 'ekw-live-states'; (doc.head || doc.body || doc.documentElement).appendChild(s); }
    let css = '';
    canvas.querySelectorAll('[data-ekw-states]').forEach((node) => {
      const eid = node.getAttribute('data-eid'); if (!eid) return;
      const st = _getStates(node);
      ['hover', 'focus', 'active'].forEach((state) => {
        const o = st[state]; if (!o || !Object.keys(o).length) return;
        const body = Object.keys(o).map((p) => p + ':' + o[p] + ' !important').join(';');
        css += '#canvas [data-eid="' + eid + '"]:' + state + ',#canvas [data-eid="' + eid + '"].ekw-force-' + state + '{' + body + '}\n';
      });
    });
    s.textContent = css;
  }
  // CSS des états pour l'aperçu (iframe) : racine = body, pas de préfixe #canvas.
  function stateCssForPreview() {
    let css = '';
    canvas.querySelectorAll('[data-ekw-states]').forEach((node) => {
      const eid = node.getAttribute('data-eid'); if (!eid) return;
      const st = _getStates(node);
      ['hover', 'focus', 'active'].forEach((state) => {
        const o = st[state]; if (!o || !Object.keys(o).length) return;
        const body = Object.keys(o).map((p) => p + ':' + o[p] + ' !important').join(';');
        css += '[data-eid="' + eid + '"]:' + state + '{' + body + '}\n';
      });
    });
    return css;
  }
  // Commit des différences de style de l'état courant → data-ekw-states, puis régénération.
  function _commitStateEdits() {
    if (!sel || editState === 'normal' || !_stateBaseline) return;
    const cur = _styleMap(sel), base = _stateBaseline.map, diff = {};
    Object.keys(cur).forEach((p) => { if (cur[p] !== base[p]) diff[p] = cur[p]; });
    const st = _getStates(sel);
    if (Object.keys(diff).length) { _eidOf(sel); st[editState] = diff; } else { delete st[editState]; }
    _saveStates(sel, st);
    sel.style.cssText = _stateBaseline.css; // restaure le style normal
    _stateBaseline = null;
    regenStateStyles();
    touchSel();                 // persistance du contenu → historique + UI
    call('resumeHistory');      // fin de la rafale « aperçu forcé »
  }

  function setEditState(n) {
    n = n || 'normal';
    if (sel && editState !== 'normal') _commitStateEdits(); // commit l'état courant avant de changer
    if (sel) ['hover', 'focus', 'active'].forEach((s) => sel.classList.remove('ekw-force-' + s));
    editState = n;
    if (statesBox) statesBox.querySelectorAll('[data-estate]').forEach((b) => {
      const on = b.dataset.estate === editState;
      b.classList.toggle('bg-secondary', on);
      b.classList.toggle('text-ink-deep', on);
      b.classList.toggle('font-semibold', on);
      b.classList.toggle('text-slate-400', !on);
      b.classList.toggle('hover:bg-slate-700', !on);
    });
    if (n !== 'normal' && sel) {
      call('suspendHistory');   // aucun snapshot pendant l'édition d'un état (aperçu forcé)
      _stateBaseline = { css: sel.style.cssText, map: _styleMap(sel) };
      const ov = _getStates(sel)[n] || {};
      Object.keys(ov).forEach((p) => sel.style.setProperty(p, ov[p])); // superpose l'état sur l'inline
      sel.classList.add('ekw-force-' + n); // aperçu forcé
    } else {
      _stateBaseline = null;
    }
    if (stateHint) {
      if (editState === 'normal') { stateHint.classList.add('hidden'); stateHint.textContent = ''; }
      else {
        const lbl = { hover: 'Survol', focus: 'Focus', active: 'Actif' }[editState] || editState;
        stateHint.textContent = 'Vous éditez l’état « ' + lbl + ' » — aperçu forcé sur l’élément.';
        stateHint.classList.remove('hidden');
      }
    }
    if (sel) spSync(); // reflète les valeurs de l'état dans les contrôles
  }

  // =====================================================================================
  // PANNEAU DE STYLE (marge/padding/bordure/arrondi/police/couleurs/dimensions/CSS/JS).
  // =====================================================================================
  function spCap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }
  function spProp(group, side) {
    if (group === 'font') return 'fontSize';
    if (group === 'radius') return 'borderRadius';
    if (group === 'border') return side === 'all' ? 'borderWidth' : 'border' + spCap(side) + 'Width';
    return group + (side === 'all' ? '' : spCap(side)); // margin / padding
  }
  function spRead(el, group, side) {
    if (group === 'width' || group === 'height') {
      const raw = (el.style[group] || '').trim();
      if (raw) { const nn = parseFloat(raw); if (!isNaN(nn)) { dimUnit[group] = raw.endsWith('%') ? '%' : 'px'; return Math.round(nn); } }
      const cc = parseFloat(win.getComputedStyle(el)[group]); return isNaN(cc) ? 0 : Math.round(cc);
    }
    const p = spProp(group, side);
    const v = el.style[p];
    if (v && v.endsWith('px')) return Math.round(parseFloat(v)) || 0;
    const c = win.getComputedStyle(el)[p];
    const n = parseFloat(c); return isNaN(n) ? 0 : Math.round(n);
  }
  function spWriteSide(el, group, side, val) {
    val = Math.max(0, val | 0);
    if (group === 'font') { el.style.fontSize = val ? val + 'px' : ''; return; }
    if (group === 'radius') { el.style.borderRadius = val + 'px'; return; }
    if (['width', 'height', 'minWidth', 'maxWidth', 'minHeight', 'maxHeight'].includes(group)) {
      const unit = (group === 'width' || group === 'height') ? (dimUnit[group] || 'px') : 'px';
      el.style[group] = val ? val + unit : '';
      return;
    }
    if (group === 'border') {
      const S = spCap(side);
      el.style['border' + S + 'Width'] = val + 'px';
      el.style['border' + S + 'Style'] = val > 0 ? 'solid' : '';
      if (val > 0 && !el.style.borderColor && !el.style['border' + S + 'Color']) el.style.borderColor = '#2C5359';
      return;
    }
    el.style[spProp(group, side)] = val + 'px'; // margin / padding
  }
  function spApply(group, side, val) {
    if (!sel) return;
    if (linkState[group] && group !== 'font' && group !== 'radius') {
      ['top', 'right', 'bottom', 'left'].forEach((s) => spWriteSide(sel, group, s, val));
    } else {
      spWriteSide(sel, group, side, val);
    }
    touchSel();
  }
  function spSetLinkedUI(group) {
    const wrap = styleBox && styleBox.querySelector('[data-sp-group="' + group + '"]'); if (!wrap) return;
    const linked = linkState[group];
    const center = wrap.querySelector('[data-sp-center]');
    if (center) center.disabled = !linked;
    wrap.querySelectorAll('.sp-side').forEach((i) => { i.disabled = linked; });
  }
  function spSetBorderColor(c) {
    if (!sel) return;
    if (c === 'none') {
      ['Top', 'Right', 'Bottom', 'Left'].forEach((S) => { sel.style['border' + S + 'Width'] = '0px'; sel.style['border' + S + 'Style'] = ''; });
      sel.style.borderColor = '';
    } else {
      sel.style.borderColor = c;
      const anyW = ['top', 'right', 'bottom', 'left'].some((s) => spRead(sel, 'border', s) > 0);
      if (!anyW) { ['top', 'right', 'bottom', 'left'].forEach((s) => spWriteSide(sel, 'border', s, 1)); }
      else { ['top', 'right', 'bottom', 'left'].forEach((s) => { if (spRead(sel, 'border', s) > 0) sel.style['border' + spCap(s) + 'Style'] = 'solid'; }); }
    }
    spSync();
    touchSel();
  }
  function spSetBgColor(c) {
    if (!sel) return;
    sel.style.backgroundColor = (c === 'none') ? '' : c;
    spSync();
    touchSel();
  }
  function rgb2hex(s) {
    if (!s) return '';
    const m = s.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/);
    if (!m) return '';
    if (m[4] !== undefined && parseFloat(m[4]) === 0) return '';
    const h = (n) => ('0' + parseInt(n, 10).toString(16)).slice(-2);
    return '#' + h(m[1]) + h(m[2]) + h(m[3]);
  }
  function spSyncColorPickers() {
    if (!sel || !styleBox) return;
    const cs = win.getComputedStyle(sel);
    [['border', cs.borderTopColor], ['bg', cs.backgroundColor]].forEach(([g, col]) => {
      const hex = rgb2hex(col);
      const chip = styleBox.querySelector('[data-cchip="' + g + '"]');
      const h = styleBox.querySelector('[data-chex="' + g + '"]');
      if (chip) chip.style.background = hex || 'transparent';
      if (h && doc.activeElement !== h) h.value = hex || '';
      if (g === 'bg') {
        const op = styleBox.querySelector('[data-copacity]');
        if (op && doc.activeElement !== op) {
          const m = (col || '').match(/rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/i);
          const a = m ? parseFloat(m[1]) : 1;
          op.value = Math.round((isNaN(a) ? 1 : a) * 100);
        }
      }
    });
  }

  // --- Panneau de style : markup (porté) ---
  function spStepper(group, side, label) {
    return '<div class="flex items-center gap-1">'
      + (label ? '<span class="w-4 text-[10px] text-slate-500 text-center">' + label + '</span>' : '')
      + '<button data-sp-step="-1" data-sp-g="' + group + '" data-sp-s="' + side + '" class="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm leading-none">−</button>'
      + '<input data-sp-in="1" data-sp-g="' + group + '" data-sp-s="' + side + '" type="number" min="0" class="w-11 h-6 bg-slate-900 border border-slate-700 rounded text-center text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-secondary">'
      + '<button data-sp-step="1" data-sp-g="' + group + '" data-sp-s="' + side + '" class="w-6 h-6 rounded bg-slate-700 hover:bg-slate-600 text-slate-200 text-sm leading-none">+</button>'
      + '</div>';
  }
  function spSpacingGroup(group, title, center) {
    const cell = (s, name) => '<input data-sp-in="1" data-sp-g="' + group + '" data-sp-s="' + s + '" type="number" min="0" title="' + name + '" class="sp-side w-full h-7 bg-slate-900 border border-slate-700 rounded text-center text-[11px] text-slate-100 focus:outline-none focus:ring-1 focus:ring-secondary disabled:opacity-40 disabled:cursor-not-allowed">';
    const gap = '<span></span>';
    const centerCell = '<div class="relative">'
      + '<input data-sp-in="1" data-sp-center data-sp-g="' + group + '" data-sp-s="all" type="number" min="0" title="' + title + ' — tous les côtés" class="sp-center w-full h-7 bg-slate-800 border border-slate-700 rounded text-center text-[11px] font-semibold text-slate-100 focus:outline-none focus:ring-1 focus:ring-secondary disabled:opacity-40 disabled:cursor-not-allowed">'
      + '<span class="absolute left-1 top-0.5 text-[9px] font-semibold text-slate-500 pointer-events-none">' + center + '</span>'
      + '</div>';
    return '<div class="space-y-1.5" data-sp-group="' + group + '">'
      + '<div class="flex items-center justify-between">'
      + '<span class="text-[11px] font-medium text-slate-300">' + title + '</span>'
      + '<button data-sp-link="' + group + '" title="Lier / délier les 4 côtés" class="w-6 h-6 rounded text-secondary hover:bg-slate-700 text-xs"><i class="fa-solid fa-link"></i></button>'
      + '</div>'
      + '<div class="grid grid-cols-3 gap-1 items-center max-w-[176px] mx-auto">'
      + gap + cell('top', 'Haut') + gap
      + cell('left', 'Gauche') + centerCell + cell('right', 'Droite')
      + gap + cell('bottom', 'Bas') + gap
      + '</div></div>';
  }
  function accRow(id, icon, title, body, open) {
    return '<div class="ekw-row border-b border-slate-700/70" data-acc="' + id + '">'
      + '<button type="button" data-acc-head="' + id + '" class="w-full flex items-center gap-2 py-2.5 text-left text-[12px] font-medium text-slate-300 hover:text-slate-100">'
      + '<i class="fa-solid ' + icon + ' text-slate-500 w-4 text-center text-[11px]"></i>'
      + '<span class="flex-1">' + title + '</span>'
      + '<i class="fa-solid fa-chevron-down text-[10px] text-slate-500 transition-transform ' + (open ? '' : '-rotate-90') + '" data-acc-chev></i>'
      + '</button>'
      + '<div data-acc-body class="pb-3 space-y-2.5 ' + (open ? '' : 'hidden') + '">' + body + '</div>'
      + '</div>';
  }
  function groupHeader(title) { return '<div class="pt-3 pb-1 text-[10px] font-semibold tracking-wide text-slate-500">' + title + '</div>'; }

  function buildStylePanel() {
    if (!styleBox) return;
    const _div = '<div class="h-px bg-slate-700/70"></div>';
    const _colorRow = (attr) => {
      const g = attr === 'bcolor' ? 'border' : 'bg';
      const opac = (attr === 'bgcolor')
        ? '<div class="flex items-center gap-1 shrink-0"><input type="number" min="0" max="100" data-copacity title="Opacité du fond (%)" class="w-12 h-7 bg-slate-950 border border-slate-600 rounded text-center text-[11px] text-slate-100 focus:outline-none focus:ring-1 focus:ring-secondary"><span class="text-[10px] text-slate-500">%</span></div>'
        : '';
      return '<div class="flex items-center gap-1.5">'
        + '<button type="button" data-coloropen="' + g + '" title="Choisir une couleur" class="flex items-center gap-1.5 shrink-0 h-7 px-1.5 bg-slate-950 border border-slate-600 rounded hover:border-slate-500 transition">'
        + '<span data-cchip="' + g + '" class="w-4 h-4 rounded border border-white/20" style="background:transparent"></span>'
        + '<i class="fa-solid fa-chevron-down text-[9px] text-slate-500"></i></button>'
        + '<input type="text" data-chex="' + g + '" placeholder="#RRGGBB" spellcheck="false" class="flex-1 min-w-0 bg-slate-950 border border-slate-600 rounded px-2 py-1 text-[11px] font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-secondary">'
        + opac + '</div>';
    };
    const fEspacement = spSpacingGroup('margin', 'Marge', 'M') + _div + spSpacingGroup('padding', 'Padding', 'P');
    const fBordure = spSpacingGroup('border', 'Épaisseur', '<i class="fa-solid fa-border-top-left"></i>') + _div
      + '<span class="text-[10px] text-slate-500 block mb-0.5">Couleur</span>' + _colorRow('bcolor') + _div
      + '<div class="space-y-1"><span class="text-[11px] font-medium text-slate-300">Arrondi des coins</span>'
      + '<div>' + spStepper('radius', 'all', '<i class="fa-solid fa-border-top-left" title="Rayon"></i>') + '<span class="ml-1 text-[10px] text-slate-500">px</span></div></div>';
    const fFond = _colorRow('bgcolor');
    const fTexte = '<div class="mb-2"><span class="text-[11px] font-medium text-slate-300">Police</span>'
      + '<select data-fontfam class="w-full mt-1 bg-slate-950 border border-slate-600 rounded px-1.5 py-1 text-[11px] text-slate-100 focus:outline-none focus:ring-1 focus:ring-secondary">'
      + '<option value="">Par défaut (hérité)</option>'
      + '<option value="&#39;Carnero&#39;, Georgia, serif">Carnero</option></select></div>'
      + '<div><span class="text-[11px] font-medium text-slate-300">Taille de police</span>'
      + '<div>' + spStepper('font', 'all', '') + '<span class="ml-1 text-[10px] text-slate-500">px</span></div></div>'
      + '<div class="mt-2"><span class="text-[11px] font-medium text-slate-300">Alignement</span>'
      + '<div class="flex gap-1 mt-1">'
      + [['left', 'fa-align-left', 'Gauche'], ['center', 'fa-align-center', 'Centre'], ['right', 'fa-align-right', 'Droite'], ['justify', 'fa-align-justify', 'Justifié']].map((a) => '<button data-styleset="textAlign:' + a[0] + '" title="' + a[2] + '" class="flex-1 h-7 rounded bg-slate-950 border border-slate-600 text-slate-300 hover:border-slate-500 text-xs"><i class="fa-solid ' + a[1] + '"></i></button>').join('')
      + '</div></div>';
    const _dimUnitSel = (g) => '<select data-dimunit="' + g + '" title="Unité" class="h-6 bg-slate-900 border border-slate-700 rounded text-[10px] text-slate-100 px-1 focus:outline-none focus:ring-1 focus:ring-secondary"><option value="px">px</option><option value="%">%</option></select>';
    const fTaille = '<div class="space-y-1.5">'
      + '<div class="flex items-center gap-1">' + spStepper('width', 'all', '<i class="fa-solid fa-arrows-left-right" title="Largeur"></i>') + _dimUnitSel('width') + '</div>'
      + '<div class="flex items-center gap-1">' + spStepper('height', 'all', '<i class="fa-solid fa-arrows-up-down" title="Hauteur"></i>') + _dimUnitSel('height') + '</div>'
      + '<div class="grid grid-cols-2 gap-x-2 gap-y-1 pt-1.5 mt-1 border-t border-slate-700/50">'
      + '<div class="flex items-center gap-1"><span class="w-9 text-[10px] text-slate-500 shrink-0">min L</span>' + spStepper('minWidth', 'all', '') + '</div>'
      + '<div class="flex items-center gap-1"><span class="w-9 text-[10px] text-slate-500 shrink-0">max L</span>' + spStepper('maxWidth', 'all', '') + '</div>'
      + '<div class="flex items-center gap-1"><span class="w-9 text-[10px] text-slate-500 shrink-0">min H</span>' + spStepper('minHeight', 'all', '') + '</div>'
      + '<div class="flex items-center gap-1"><span class="w-9 text-[10px] text-slate-500 shrink-0">max H</span>' + spStepper('maxHeight', 'all', '') + '</div>'
      + '</div></div>';
    const fOmbre = '<select data-stylesel="boxShadow" class="w-full bg-slate-950 border border-slate-600 rounded px-1.5 py-1 text-[11px] text-slate-100 focus:outline-none focus:ring-1 focus:ring-secondary">'
      + '<option value="">Aucune</option><option value="0 1px 3px rgba(0,0,0,.12)">Douce</option>'
      + '<option value="0 4px 12px rgba(0,0,0,.15)">Moyenne</option><option value="0 12px 32px rgba(0,0,0,.25)">Forte</option></select>';
    const _cssSel = (prop, opts) => '<select data-stylesel="' + prop + '" class="w-full bg-slate-950 border border-slate-600 rounded px-1.5 py-1 text-[11px] text-slate-100 focus:outline-none focus:ring-1 focus:ring-secondary">' + opts.map((o) => '<option value="' + o[0] + '">' + o[1] + '</option>').join('') + '</select>';
    const fDispo = '<div class="space-y-1.5">'
      + '<div><span class="text-[11px] font-medium text-slate-300">Affichage</span>' + _cssSel('display', [['', 'Bloc'], ['flex', 'Flex'], ['inline-block', 'En ligne'], ['grid', 'Grille']]) + '</div>'
      + '<div data-flexsub class="space-y-1.5 hidden">'
      + '<div><span class="text-[11px] font-medium text-slate-300">Direction</span>' + _cssSel('flexDirection', [['row', 'Ligne'], ['column', 'Colonne']]) + '</div>'
      + '<div><span class="text-[11px] font-medium text-slate-300">Justifier</span>' + _cssSel('justifyContent', [['flex-start', 'Début'], ['center', 'Centre'], ['flex-end', 'Fin'], ['space-between', 'Espacé']]) + '</div>'
      + '<div><span class="text-[11px] font-medium text-slate-300">Aligner</span>' + _cssSel('alignItems', [['stretch', 'Étiré'], ['flex-start', 'Début'], ['center', 'Centre'], ['flex-end', 'Fin']]) + '</div>'
      + '<div><span class="text-[11px] font-medium text-slate-300">Espace (gap)</span><div>' + spStepper('gap', 'all', '') + '<span class="ml-1 text-[10px] text-slate-500">px</span></div></div>'
      + '</div></div>';
    const fCss = '<textarea id="css-editor" rows="4" spellcheck="false" placeholder="border: 2px solid #17E7D0;" '
      + 'class="w-full bg-slate-900 border border-slate-700 rounded-lg px-2.5 py-2 text-[11px] font-mono leading-relaxed text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-secondary resize-y"></textarea>'
      + '<span class="text-[10px] text-slate-500 leading-snug block mt-1">Style inline de l\'élément — édite librement. Appliqué en direct, synchro avec les contrôles.</span>';
    const fJs = '<div id="js-texts" class="space-y-2"></div>';
    styleBox.innerHTML =
      groupHeader('Apparence')
      + accRow('texte', 'fa-font', 'Texte', fTexte, false)
      + accRow('fond', 'fa-fill-drip', 'Couleur de fond', fFond, false)
      + accRow('bordure', 'fa-border-top-left', 'Bordure & coins', fBordure, false)
      + accRow('ombre', 'fa-clone', 'Ombre', fOmbre, false)
      + groupHeader('Mise en page')
      + accRow('dispo', 'fa-table-cells', 'Disposition', fDispo, false)
      + accRow('taille', 'fa-ruler-combined', 'Dimensions', fTaille, false)
      + accRow('espacement', 'fa-up-down-left-right', 'Marge & Padding', fEspacement, false)
      + groupHeader('Avancé')
      + accRow('css', 'fa-code', 'CSS avancé', fCss, false)
      + accRow('jscomp', 'fa-i-cursor', 'Texte Javascript', fJs, false);
  }

  function setSectionVisible(id, vis) { const s = styleBox && styleBox.querySelector('[data-acc="' + id + '"]'); if (s) s.classList.toggle('hidden', !vis); }
  function setRowOpen(id, open) {
    const sec = styleBox && styleBox.querySelector('[data-acc="' + id + '"]'); if (!sec) return;
    const body = sec.querySelector('[data-acc-body]'); const chev = sec.querySelector('[data-acc-chev]');
    if (body) body.classList.toggle('hidden', !open);
    if (chev) chev.classList.toggle('-rotate-90', !open);
  }
  function toggleRow(id) {
    if (!styleBox) return;
    const sec = styleBox.querySelector('[data-acc="' + id + '"]'); if (!sec) return;
    const body = sec.querySelector('[data-acc-body]');
    const willOpen = body.classList.contains('hidden');
    styleBox.querySelectorAll('[data-acc]').forEach((s) => setRowOpen(s.getAttribute('data-acc'), willOpen && s.getAttribute('data-acc') === id));
  }
  function applyContextualSections() {
    if (!sel || !styleBox) return;
    const tag = sel.tagName.toLowerCase();
    const textish = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'span', 'a', 'button', 'li', 'strong', 'em', 'small', 'label', 'th', 'td', 'figcaption']);
    const hasOwnText = sel.children.length === 0 && !!(sel.textContent || '').trim();
    const showTexte = textish.has(tag) || hasOwnText;
    setSectionVisible('texte', showTexte);
  }

  function spSetInput(g, s, v) {
    const i = styleBox && styleBox.querySelector('input[data-sp-in][data-sp-g="' + g + '"][data-sp-s="' + s + '"]');
    if (i) i.value = v;
  }
  function spSync() {
    if (!sel || !styleBox) return;
    ['margin', 'padding', 'border'].forEach((g) => {
      const linked = linkState[g];
      const lb = styleBox.querySelector('[data-sp-link="' + g + '"]');
      if (lb) {
        lb.classList.toggle('text-secondary', linked);
        lb.classList.toggle('text-slate-400', !linked);
        lb.title = linked ? '4 côtés liés — cliquer pour délier' : '4 côtés indépendants — cliquer pour lier';
        const li = lb.querySelector('i'); if (li) li.className = 'fa-solid ' + (linked ? 'fa-link' : 'fa-link-slash');
      }
      ['top', 'right', 'bottom', 'left'].forEach((s) => spSetInput(g, s, spRead(sel, g, s)));
      spSetInput(g, 'all', spRead(sel, g, 'top'));
      spSetLinkedUI(g);
    });
    spSetInput('radius', 'all', spRead(sel, 'radius', 'all'));
    spSetInput('font', 'all', spRead(sel, 'font', 'all'));
    const ff = styleBox.querySelector('[data-fontfam]');
    if (ff) {
      const norm = (s) => (s || '').replace(/["']/g, '').replace(/\s+/g, '').toLowerCase();
      const cur = norm(sel.style.fontFamily); let matched = '';
      Array.from(ff.options).forEach((o) => { if (o.value && norm(o.value) === cur) matched = o.value; });
      ff.value = matched;
    }
    spSetInput('width', 'all', spRead(sel, 'width', 'all'));
    spSetInput('height', 'all', spRead(sel, 'height', 'all'));
    ['width', 'height'].forEach((g) => { const u = styleBox.querySelector('[data-dimunit="' + g + '"]'); if (u && doc.activeElement !== u) u.value = dimUnit[g] || 'px'; });
    ['minWidth', 'maxWidth', 'minHeight', 'maxHeight', 'gap'].forEach((g) => spSetInput(g, 'all', spRead(sel, g, 'all')));
    styleBox.querySelectorAll('[data-stylesel]').forEach((s2) => { if (doc.activeElement !== s2) s2.value = sel.style[s2.dataset.stylesel] || ''; });
    { const fx = styleBox.querySelector('[data-flexsub]'); if (fx) { const d = sel.style.display; fx.classList.toggle('hidden', !(d === 'flex' || d === 'inline-flex' || d === 'grid' || d === 'inline-grid')); } }
    styleBox.querySelectorAll('[data-styleset]').forEach((btn) => { const p = btn.dataset.styleset.split(':'); const on = sel.style[p[0]] === p[1]; btn.classList.toggle('border-secondary', on); btn.classList.toggle('text-secondary', on); btn.classList.toggle('text-slate-300', !on); });
    spSyncColorPickers();
    cssEditorSync();
    jsEditorSync();
    positionMarquee();
  }
  function cssEditorSync() {
    const t = styleBox && styleBox.querySelector('#css-editor');
    if (t && sel && doc.activeElement !== t) t.value = sel.style.cssText;
  }

  // =====================================================================================
  // TEXTES DYNAMIQUES JS (littéraux de chaîne du <script> de la slice, patch par offset).
  // =====================================================================================
  function sliceScriptNode(create) {
    if (!sel) return null;
    const root = sliceRootOf(sel);
    let s = root.querySelector('script');
    if (!s && create) { s = doc.createElement('script'); s.type = 'text/ekw-js'; root.appendChild(s); }
    return s;
  }
  function extractJsTextLiterals(src) {
    const out = []; let i = 0; const n = src.length;
    while (i < n) {
      const c = src[i];
      if (c === '/' && src[i + 1] === '/') { i += 2; while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
      if (c === '"' || c === "'") {
        const q = c, start = i; i++; let val = '';
        while (i < n) { const d = src[i]; if (d === '\\') { val += (src[i + 1] || ''); i += 2; continue; } if (d === q) { i++; break; } val += d; i++; }
        out.push({ value: val, quote: q, start, end: i }); continue;
      }
      if (c === '`') { i++; while (i < n) { const d = src[i]; if (d === '\\') { i += 2; continue; } if (d === '`') { i++; break; } i++; } continue; }
      i++;
    }
    return out;
  }
  function isDisplayText(v) {
    const s = (v || '').trim();
    if (s.length < 2) return false;
    if (API_STOP.has(s)) return false;
    if (/^[A-Z0-9_]{2,12}$/.test(s) && /\d/.test(s)) return false;
    if (/^[a-z]{2}[-_][a-z]{2,4}$/i.test(s)) return false;
    if (/^[a-z]{2}$/.test(s)) return false;
    if (!/[A-Za-zÀ-ÿ]/.test(s)) return false;
    if (/^https?:|^\/\//i.test(s) || /\.(svg|png|jpe?g|webp|gif|css|js|ttf|otf|woff2?)(\?|#|$)/i.test(s)) return false;
    if (/^#[0-9a-f]{3,8}$/i.test(s)) return false;
    if (/^[.#\[]/.test(s)) return false;
    if (/<[a-z!\/]/i.test(s)) return false;
    if (/^[a-z][a-z0-9-]*$/.test(s) && /-/.test(s)) return false;
    if (/^[a-z0-9_]+$/.test(s) && s === s.toLowerCase()) return false;
    return true;
  }
  function escForQuote(v, q) { return String(v).replace(/\\/g, '\\\\').replace(new RegExp(q, 'g'), '\\' + q).replace(/\r?\n/g, '\\n'); }
  function buildTextGroups(src) {
    const lits = extractJsTextLiterals(src).filter((l) => isDisplayText(l.value));
    const map = new Map();
    lits.forEach((l) => { if (!map.has(l.value)) map.set(l.value, { value: l.value, newValue: l.value, quote: l.quote, spans: [] }); map.get(l.value).spans.push({ start: l.start, end: l.end }); });
    return Array.from(map.values());
  }
  let editSnapshot = null;
  function applyDynamicEdits() {
    const s = sliceScriptNode(true); if (!s || !editSnapshot) return;
    const edits = [];
    editSnapshot.textGroups.forEach((g) => { if (g.newValue !== g.value) g.spans.forEach((sp) => edits.push({ start: sp.start, end: sp.end, text: g.quote + escForQuote(g.newValue, g.quote) + g.quote })); });
    edits.sort((a, b) => a.start - b.start);
    let out = '', last = 0; edits.forEach((e) => { out += editSnapshot.src.slice(last, e.start) + e.text; last = e.end; });
    out += editSnapshot.src.slice(last);
    try { new Function(out); } catch (_) { toast('Modif ignorée (JS invalide)'); return; } // garde-fou
    s.textContent = out;
    touchSel();
  }
  function renderTextPanel() {
    const box = styleBox && styleBox.querySelector('#js-texts'); if (!box) return;
    const groups = (editSnapshot && editSnapshot.src.trim()) ? editSnapshot.textGroups : [];
    setSectionVisible('jscomp', groups.length > 0);
    if (!groups.length) { box.innerHTML = ''; return; }
    box.innerHTML = groups.map((g, i) =>
      '<div><input data-jstext="' + i + '" value="' + escAttr(g.value) + '" '
      + 'class="w-full bg-slate-950 border border-slate-600 rounded px-2 py-1.5 text-[11px] text-slate-100 focus:outline-none focus:ring-1 focus:ring-secondary">'
      + (g.spans.length > 1 ? '<span class="text-[9px] text-slate-500 block mt-0.5">× ' + g.spans.length + ' occurrences</span>' : '')
      + '</div>').join('');
  }
  function jsEditorSync() {
    const s = sliceScriptNode(false);
    const src = s ? (s.textContent || '') : '';
    editSnapshot = sel ? { src, textGroups: buildTextGroups(src) } : null;
    renderTextPanel();
  }

  // =====================================================================================
  // POPOVER DE COULEURS (texte foreColor + fond/bordure de l'inspecteur).
  // =====================================================================================
  let _colorPickCb = null;
  let colorPop = null, _colorPickGrid = null;
  function renderColorCircles() {
    return FULL_PALETTE.map((fam) =>
      '<div class="flex flex-wrap gap-1.5">'
      + fam[1].map((c) => '<button data-colorpick="' + c[0] + '" title="' + fam[0] + ' ' + c[1] + ' · ' + c[0] + '" class="w-7 h-7 rounded-full border border-black/10 hover:scale-110 hover:ring-2 hover:ring-black/25 transition" style="background:' + c[0] + '"></button>').join('')
      + '</div>').join('');
  }
  function ensureColorPop() {
    if (colorPop || !doc || !doc.body) return;
    colorPop = doc.createElement('div');
    colorPop.id = 'ekw-colorpop';
    colorPop.className = 'fixed z-[98] hidden flex flex-col bg-white/80 backdrop-blur-xl border border-black/10 rounded-2xl shadow-2xl p-3 w-[300px] max-h-[360px]';
    colorPop.innerHTML = '<div data-colorpickgrid class="space-y-1.5 overflow-y-auto pr-1 flex-1"></div>';
    doc.body.appendChild(colorPop);
    _colorPickGrid = colorPop.querySelector('[data-colorpickgrid]');
    listen(colorPop, 'mousedown', (e) => {
      e.preventDefault(); e.stopPropagation();
      const t = e.target.closest('[data-colorpick]');
      if (t && _colorPickCb) { _colorPickCb(t.dataset.colorpick); closeColorPopover(); }
    });
  }
  function closeColorPopover() { if (colorPop) { colorPop.classList.add('hidden'); _colorPickCb = null; colorPop._anchor = null; } }
  function openColorPopover(anchor, cb) {
    ensureColorPop(); if (!colorPop) return;
    if (!colorPop.dataset.built) { _colorPickGrid.innerHTML = renderColorCircles(); colorPop.dataset.built = '1'; }
    if (!colorPop.classList.contains('hidden') && colorPop._anchor === anchor) { closeColorPopover(); return; }
    _colorPickCb = cb; colorPop._anchor = anchor;
    colorPop.classList.remove('hidden');
    const r = anchor.getBoundingClientRect();
    const pw = colorPop.offsetWidth || 300;
    colorPop.style.left = Math.min((win.innerWidth || 1200) - pw - 8, Math.max(8, r.left)) + 'px';
    colorPop.style.top = (r.bottom + 6) + 'px';
  }

  // =====================================================================================
  // BARRE DE FORMAT (édition de texte riche) + bulle de lien.
  // =====================================================================================
  let linkBubble = null, linkOpen = false, linkMode = 'text', savedRange = null;
  function fmtBtn(act, icon, title) {
    return '<button data-fmt="' + act + '" title="' + title + '" class="w-8 h-8 rounded-md text-slate-300 hover:bg-slate-700 hover:text-cloud transition text-xs"><i class="fa-solid ' + icon + '"></i></button>';
  }
  function buildFormatbar() {
    if (!formatbar) return;
    formatbar.innerHTML =
      fmtBtn('bold', 'fa-bold', 'Gras') + fmtBtn('italic', 'fa-italic', 'Italique') + fmtBtn('underline', 'fa-underline', 'Souligné')
      + '<span class="w-px h-5 bg-slate-600 mx-0.5"></span>'
      + EKW_COLORS.map(([hex, name]) => '<button data-color="' + hex + '" title="' + name + '" class="w-5 h-5 rounded-full border border-slate-500 mx-0.5 hover:scale-110 transition" style="background:' + hex + '"></button>').join('')
      + '<button data-textpalette title="Bibliothèque de couleurs" class="w-5 h-5 rounded-full mx-0.5 border border-slate-500 hover:scale-110 transition" style="background:conic-gradient(#17E7D0,#FFC969,#FF931E,#e5484d,#2F80DE,#009A59,#17E7D0)"></button>'
      + '<input type="color" data-fcolor-wheel title="Roue de couleur" class="w-6 h-6 p-0 rounded cursor-pointer bg-transparent border border-slate-500 mx-0.5 align-middle">'
      + '<input type="text" data-fcolor-hex placeholder="#RRGGBB" spellcheck="false" class="w-[70px] bg-slate-950 border border-slate-600 rounded px-1.5 py-1 text-[11px] font-mono text-slate-100 placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-secondary">'
      + '<span class="w-px h-5 bg-slate-600 mx-0.5"></span>'
      + fmtBtn('link', 'fa-link', 'Lien hypertexte') + fmtBtn('nbsp', 'fa-link-slash', 'Espace insécable (mot lié)');
  }
  function saveRange() { const s = win.getSelection && win.getSelection(); if (s && s.rangeCount) savedRange = s.getRangeAt(0).cloneRange(); }
  function restoreRange() { if (!savedRange) return; const s = win.getSelection(); s.removeAllRanges(); s.addRange(savedRange); }
  function anchorLink() {
    let n = savedRange ? savedRange.startContainer : null;
    while (n && n !== canvas) { if (n.nodeType === 1 && n.tagName === 'A') return n; n = n.parentNode; }
    return null;
  }
  function elementLinkAnchor() {
    if (sel && sel.tagName === 'A') return sel;
    const p = sel && sel.parentElement;
    if (p && p.tagName === 'A' && p.childElementCount === 1 && !p.textContent.replace(sel.textContent, '').trim()) return p;
    return null;
  }
  function ensureLinkBubble() {
    if (linkBubble || !doc || !doc.body) return;
    linkBubble = doc.createElement('div');
    linkBubble.id = 'ekw-link';
    linkBubble.className = 'fixed z-[96] hidden flex-col gap-2 bg-ink-deep border border-slate-600 rounded-lg shadow-2xl p-2 w-64';
    linkBubble.innerHTML =
      '<input id="ekw-link-input" type="text" placeholder="https://ekwateur.fr/…" class="bg-slate-900 border border-slate-700 rounded-md px-2 py-1.5 text-xs text-slate-100 focus:outline-none focus:ring-1 focus:ring-secondary">'
      + '<div class="flex items-center justify-between">'
      + '<button data-link="remove" class="text-xs text-red-400 hover:text-red-300 px-1 py-1">Retirer le lien</button>'
      + '<div class="flex gap-1">'
      + '<button data-link="cancel" class="text-xs text-slate-400 hover:text-cloud px-2 py-1">Annuler</button>'
      + '<button data-link="apply" class="text-xs bg-secondary text-ink-deep font-semibold px-3 py-1 rounded-md hover:brightness-110">Appliquer</button>'
      + '</div></div>';
    doc.body.appendChild(linkBubble);
    listen(linkBubble, 'mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
    listen(linkBubble, 'click', (e) => {
      const b = e.target.closest('[data-link]'); if (!b) return;
      const act = b.dataset.link;
      if (act === 'cancel') { closeLinkBubble(); return; }
      const url = (doc.getElementById('ekw-link-input').value || '').trim();
      if (linkMode === 'element') {
        if (!sel) { closeLinkBubble(); return; }
        const a = elementLinkAnchor();
        if (act === 'apply' && url) {
          if (a) { a.setAttribute('href', url); }
          else {
            const link = doc.createElement('a'); link.setAttribute('href', url); link.style.display = 'contents';
            sel.parentNode.insertBefore(link, sel); link.appendChild(sel);
          }
        } else if (act === 'remove' && a) {
          while (a.firstChild) a.parentNode.insertBefore(a.firstChild, a); a.remove();
        }
        closeLinkBubble(); touchSel(); positionMarquee(); return;
      }
      if (sel) sel.focus();
      restoreRange();
      if (act === 'apply' && url) {
        if (savedRange && !savedRange.collapsed) doc.execCommand('createLink', false, url);
        else doc.execCommand('insertHTML', false, '<a href="' + url + '" class="underline text-secondary">' + url + '</a>');
      } else if (act === 'remove') { doc.execCommand('unlink'); }
      closeLinkBubble(); touchSel();
    });
    const input = doc.getElementById('ekw-link-input');
    listen(input, 'keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); linkBubble.querySelector('[data-link="apply"]').click(); }
      else if (e.key === 'Escape') { e.preventDefault(); closeLinkBubble(); if (sel) sel.focus(); }
    });
  }
  function openLinkBubble() {
    ensureLinkBubble(); if (!linkBubble) return;
    saveRange(); linkMode = 'text'; linkOpen = true;
    const a = anchorLink(); const input = doc.getElementById('ekw-link-input');
    input.value = a ? (a.getAttribute('href') || '') : '';
    linkBubble.classList.remove('hidden'); linkBubble.classList.add('flex');
    if (sel) {
      const r = sel.getBoundingClientRect();
      linkBubble.style.top = Math.max(8, r.top + 6) + 'px';
      linkBubble.style.left = Math.min((win.innerWidth || 1200) - 270, Math.max(8, r.left)) + 'px';
    }
    input.focus(); input.select();
  }
  function openElementLink() {
    ensureLinkBubble(); if (!linkBubble || !sel) return;
    linkMode = 'element'; linkOpen = true;
    const a = elementLinkAnchor(); const input = doc.getElementById('ekw-link-input');
    input.value = a ? (a.getAttribute('href') || '') : '';
    linkBubble.classList.remove('hidden'); linkBubble.classList.add('flex');
    const r = sel.getBoundingClientRect();
    linkBubble.style.top = Math.max(8, r.top + 6) + 'px';
    linkBubble.style.left = Math.min((win.innerWidth || 1200) - 270, Math.max(8, r.left)) + 'px';
    input.focus(); input.select();
  }
  function closeLinkBubble() { linkOpen = false; if (linkBubble) { linkBubble.classList.add('hidden'); linkBubble.classList.remove('flex'); } }

  function applyTextColor(v) {
    if (!formatbar) return;
    const wh = formatbar.querySelector('[data-fcolor-wheel]'), hx = formatbar.querySelector('[data-fcolor-hex]');
    if (wh) wh.value = v; if (hx) hx.value = v;
    if (sel) sel.focus();
    restoreRange();
    doc.execCommand('foreColor', false, v);
    touchSel();
  }
  function wireFormatbar() {
    if (!formatbar) return;
    listen(formatbar, 'mousedown', (e) => { saveRange(); if (e.target.tagName !== 'INPUT') e.preventDefault(); });
    listen(formatbar, 'change', (e) => {
      const w = e.target.matches('[data-fcolor-wheel]'), h = e.target.matches('[data-fcolor-hex]');
      if (!w && !h) return;
      let v = (e.target.value || '').trim();
      if (h && !/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) return;
      applyTextColor(v);
    });
    listen(formatbar, 'click', (e) => {
      const col = e.target.closest('[data-color]');
      if (col) { doc.execCommand('foreColor', false, col.dataset.color); touchSel(); return; }
      const tp = e.target.closest('[data-textpalette]');
      if (tp) { openColorPopover(tp, (hex) => { doc.execCommand('foreColor', false, hex); touchSel(); }); return; }
      const b = e.target.closest('[data-fmt]'); if (!b) return;
      const f = b.dataset.fmt;
      if (f === 'bold') doc.execCommand('bold');
      else if (f === 'italic') doc.execCommand('italic');
      else if (f === 'underline') doc.execCommand('underline');
      else if (f === 'nbsp') doc.execCommand('insertHTML', false, '&nbsp;');
      else if (f === 'link') { openLinkBubble(); return; }
      touchSel();
    });
  }

  // =====================================================================================
  // OVERLAYS flottants : marquee de sélection + survol.
  // =====================================================================================
  let marquee = null, hoverBox = null, hoverLabel = null;
  function ensureOverlays() {
    if (!doc || !doc.body) return;
    if (!marquee) { marquee = doc.createElement('div'); marquee.id = 'ekw-marquee'; doc.body.appendChild(marquee); }
    if (!hoverBox) { hoverBox = doc.createElement('div'); hoverBox.id = 'ekw-hover'; doc.body.appendChild(hoverBox); }
    if (!hoverLabel) { hoverLabel = doc.createElement('div'); hoverLabel.id = 'ekw-hover-label'; doc.body.appendChild(hoverLabel); }
  }
  function friendlyName(el) {
    if (!el || el.nodeType !== 1) return 'Bloc';
    if (el.hasAttribute && el.hasAttribute('data-comp')) return 'Widget';
    const map = {
      h1: 'Titre', h2: 'Titre', h3: 'Titre', h4: 'Titre', h5: 'Titre', h6: 'Titre',
      p: 'Texte', span: 'Texte', strong: 'Texte', em: 'Texte', small: 'Texte',
      a: 'Lien', button: 'Bouton', img: 'Image', svg: 'Icône', i: 'Icône',
      ul: 'Liste', ol: 'Liste', li: 'Élément', section: 'Section', article: 'Section',
      header: 'En-tête', footer: 'Pied', nav: 'Nav', table: 'Tableau', tr: 'Ligne',
      td: 'Cellule', th: 'Cellule', input: 'Champ', select: 'Champ', textarea: 'Champ',
      label: 'Label', form: 'Formulaire', figure: 'Figure',
    };
    return map[el.tagName.toLowerCase()] || 'Bloc';
  }
  function labelFor(el) {
    let s = friendlyName(el);
    const txt = (el.textContent || '').trim().replace(/\s+/g, ' ');
    if (txt && el.children.length === 0) s += ' · ' + (txt.length > 16 ? txt.slice(0, 16) + '…' : txt);
    return s;
  }
  function showHover(el) {
    ensureOverlays(); if (!hoverBox) return;
    if (!el || el === sel || editing) { hideHover(); return; }
    const r = el.getBoundingClientRect(); const p = 2;
    hoverBox.style.left = (r.left - p) + 'px'; hoverBox.style.top = (r.top - p) + 'px';
    hoverBox.style.width = (r.width + p * 2) + 'px'; hoverBox.style.height = (r.height + p * 2) + 'px';
    hoverBox.style.display = 'block';
    hoverLabel.textContent = labelFor(el);
    hoverLabel.style.left = r.left + 'px'; hoverLabel.style.top = Math.max(2, r.top - 18) + 'px';
    hoverLabel.style.display = 'block';
  }
  function hideHover() { if (hoverBox) hoverBox.style.display = 'none'; if (hoverLabel) hoverLabel.style.display = 'none'; }
  function hoverTargetFor(t) {
    if (!t || !t.closest || !t.closest('[data-comp]') || t.closest('#empty-state')) return null;
    if (t.tagName === 'SCRIPT' || t.tagName === 'STYLE') return null;
    return t;
  }
  function positionMarquee() {
    ensureOverlays(); if (!marquee) return;
    if (!sel || editing || !canvas.contains(sel)) { marquee.style.display = 'none'; return; }
    const r = sel.getBoundingClientRect(); const p = 3;
    marquee.style.left = (r.left - p) + 'px'; marquee.style.top = (r.top - p) + 'px';
    marquee.style.width = (r.width + p * 2) + 'px'; marquee.style.height = (r.height + p * 2) + 'px';
    marquee.style.display = 'block';
  }

  // =====================================================================================
  // NAVIGATION (breadcrumb + contexte d'élément).
  // =====================================================================================
  function navTarget(dir) {
    if (!sel) return null;
    const skip = (e) => e && (e.tagName === 'SCRIPT' || e.tagName === 'STYLE' || e.id === 'empty-state');
    if (dir === 'parent') { const p = sel.parentElement; return (p && p !== canvas && p.closest && p.closest('[data-comp]')) ? p : null; }
    if (dir === 'child') { let c = sel.firstElementChild; while (skip(c)) c = c.nextElementSibling; return c || null; }
    if (dir === 'prev') { let s = sel.previousElementSibling; while (skip(s)) s = s.previousElementSibling; return s || null; }
    if (dir === 'next') { let s = sel.nextElementSibling; while (skip(s)) s = s.nextElementSibling; return s || null; }
    return null;
  }
  function typeIcon(el) {
    const t = el.tagName.toLowerCase();
    if (el.hasAttribute && el.hasAttribute('data-comp')) return 'fa-cube';
    if (['h1', 'h2', 'h3', 'h4', 'h5', 'h6'].includes(t)) return 'fa-heading';
    if (t === 'a') return 'fa-link';
    if (t === 'button') return 'fa-hand-pointer';
    if (['img', 'figure', 'picture'].includes(t) || (el.hasAttribute && el.hasAttribute('data-picto'))) return 'fa-image';
    if (['svg', 'i'].includes(t)) return 'fa-icons';
    if (['ul', 'ol'].includes(t)) return 'fa-list';
    if (['input', 'select', 'textarea'].includes(t)) return 'fa-i-cursor';
    if (['p', 'span', 'strong', 'em', 'small', 'label', 'li'].includes(t)) return 'fa-font';
    return 'fa-square';
  }
  function elRole(el) {
    const t = el.tagName.toLowerCase();
    const hasText = el.children.length === 0 && !!(el.textContent || '').trim();
    if (el.hasAttribute && el.hasAttribute('data-comp')) return 'Widget';
    if (['img', 'svg', 'i'].includes(t) || (el.hasAttribute && el.hasAttribute('data-picto'))) return 'Média';
    if (el.children.length > 0 && !hasText) return 'Conteneur';
    return 'Texte';
  }
  function renderElementContext() {
    if (!elctxBox) return;
    if (!sel) { elctxBox.innerHTML = ''; return; }
    const tag = sel.tagName.toLowerCase();
    elctxBox.innerHTML =
      '<span class="w-7 h-7 shrink-0 rounded-lg bg-slate-700/50 text-slate-400 flex items-center justify-center"><i class="fa-solid ' + typeIcon(sel) + ' text-[12px]"></i></span>'
      + '<span class="min-w-0"><span class="block text-[13px] font-semibold text-slate-200 truncate">' + escHtml(friendlyName(sel)) + '</span>'
      + '<span class="block text-[10px] text-slate-500 truncate">' + elRole(sel) + ' · &lt;' + tag + '&gt;</span></span>';
  }
  function renderNav() {
    renderElementContext();
    if (!crumbs) return;
    if (!sel) { crumbs.innerHTML = ''; crumbs._path = null; return; }
    const root = sliceRootOf(sel);
    const path = []; let n = sel;
    while (n) { path.unshift(n); if (n === root) break; const p = n.parentElement; if (!p || p === canvas) break; n = p; }
    crumbs.innerHTML = path.map((el, i) => {
      const cur = el === sel;
      return (i ? '<span class="text-slate-600 px-0.5">›</span>' : '')
        + '<button data-crumb="' + i + '" title="' + el.tagName.toLowerCase() + '" class="px-1.5 py-0.5 rounded whitespace-nowrap ' + (cur ? 'bg-secondary text-ink-deep font-semibold' : 'text-slate-300 hover:bg-slate-700') + '">' + escHtml(friendlyName(el)) + '</button>';
    }).join('');
    crumbs._path = path;
  }

  // =====================================================================================
  // BASCULE DE PANNEAUX + barre d'actions.
  // =====================================================================================
  function showEditor() {
    if (typeof hooks.showEditor === 'function') return hooks.showEditor();
    if (libraryPanel) { libraryPanel.classList.add('hidden'); libraryPanel.classList.remove('flex'); }
    if (editorPanel) { editorPanel.classList.remove('hidden'); editorPanel.classList.add('flex'); }
  }
  function showLibrary() {
    if (typeof hooks.showLibrary === 'function') return hooks.showLibrary();
    if (editorPanel) { editorPanel.classList.add('hidden'); editorPanel.classList.remove('flex'); }
    if (libraryPanel) { libraryPanel.classList.remove('hidden'); libraryPanel.classList.add('flex'); }
  }
  function showActions(on) {
    if (typeof hooks.showActions === 'function') return hooks.showActions(on);
    if (toolbar) { toolbar.classList.toggle('hidden', !on); toolbar.classList.toggle('flex', on); }
  }
  function markEditBtn(on) {
    const b = toolbar && toolbar.querySelector('button[data-act="edit"]');
    if (!b) return;
    b.classList.toggle('bg-secondary', on); b.classList.toggle('text-ink-deep', on);
  }
  function buildToolbar() {
    if (!toolbar) return;
    toolbar.innerHTML = [
      ['up', 'fa-arrow-up', 'Monter parmi les voisins'],
      ['down', 'fa-arrow-down', 'Descendre parmi les voisins'],
      ['edit', 'fa-keyboard', 'Éditer le texte'],
      ['link', 'fa-link', 'Rendre cet élément cliquable (lien)'],
      ['dup', 'fa-clone', 'Dupliquer'],
      ['save', 'fa-floppy-disk', 'Sauvegarder dans ma bibliothèque'],
      ['del', 'fa-trash', 'Supprimer'],
      ['target', 'claude-logo', 'Cibler dans le chat Claude'],
    ].map(([act, icon, title]) => {
      const iconHtml = icon === 'claude-logo'
        ? '<img src="https://thesvg.org/icons/claude-code/color.svg" alt="Claude" class="w-4 h-4">'
        : '<i class="fa-solid ' + icon + '"></i>';
      return '<button data-act="' + act + '" title="' + title + '" class="w-8 h-8 rounded-md bg-slate-700/50 text-slate-300 hover:bg-slate-700 hover:text-cloud transition text-xs flex items-center justify-center">' + iconHtml + '</button>';
    }).join('');
  }

  // =====================================================================================
  // SÉLECTION / ÉDITION DE TEXTE.
  // =====================================================================================
  function selectElement(el) {
    if (!el || el === canvas || !el.closest || !el.closest('[data-comp]') || el.closest('#empty-state')) { deselect(); return; }
    hideHover();
    if (editing) stopEditing();
    if (sel && editState !== 'normal') setEditState('normal');
    if (sel) sel.classList.remove('ekw-selected');
    sel = el;
    sel.classList.add('ekw-selected');
    spSync();
    showEditor();
    showActions(true);
    positionMarquee();
    raf(positionMarquee);
    renderNav();
    setEditState('normal');
    applyContextualSections();
    call('onSelect', sel);
  }
  function deselect() {
    if (editing) stopEditing();
    if (sel && editState !== 'normal') setEditState('normal');
    if (sel) sel.classList.remove('ekw-selected');
    sel = null;
    showLibrary();
    showActions(false);
    positionMarquee();
    renderNav();
    call('onDeselect');
  }
  function placeCaretEnd(el) {
    try {
      const range = doc.createRange(); range.selectNodeContents(el); range.collapse(false);
      const s = win.getSelection(); s.removeAllRanges(); s.addRange(range);
    } catch (_) { }
  }
  function positionTextBubble() {
    if (!editing || !formatbar) return;
    formatbar.classList.remove('hidden'); formatbar.classList.add('flex');
    const s = win.getSelection && win.getSelection();
    let r = null;
    if (s && s.rangeCount) {
      const rg = s.getRangeAt(0); const rects = rg.getClientRects();
      r = rects.length ? rects[0] : rg.getBoundingClientRect();
    }
    if (!r || (!r.width && !r.height)) r = sel ? sel.getBoundingClientRect() : null;
    if (!r) return;
    const bw = formatbar.offsetWidth || 300, bh = formatbar.offsetHeight || 42;
    let top = r.top - bh - 14;
    if (top < 8) top = r.bottom + 12;
    let left = Math.min((win.innerWidth || 1200) - bw - 8, Math.max(8, r.left));
    formatbar.style.top = Math.max(8, top) + 'px';
    formatbar.style.left = left + 'px';
  }
  function startEditing() {
    if (!sel) return;
    editing = true;
    sel.setAttribute('contenteditable', 'true');
    sel.classList.add('ekw-editing');
    sel.focus();
    placeCaretEnd(sel);
    markEditBtn(true);
    positionTextBubble();
    positionMarquee();
  }
  function stopEditing() {
    const wasEditing = editing;
    editing = false;
    if (sel) { sel.removeAttribute('contenteditable'); sel.classList.remove('ekw-editing'); }
    markEditBtn(false);
    if (formatbar) { formatbar.classList.add('hidden'); formatbar.classList.remove('flex'); }
    closeColorPopover();
    positionMarquee();
    if (wasEditing) touchSel(); // capture l'état final du texte édité
  }

  // =====================================================================================
  // OPÉRATIONS STRUCTURELLES — routées via le store.
  // =====================================================================================
  // Suppression : racine de slice → store.remove(id) ; nœud interne → retrait DOM + touch.
  // Jamais de racine vidée laissée en place (« zéro coquille »).
  function deleteSelection() {
    if (!sel) return;
    const el = sel;
    const slice = sliceOf(el);
    if (slice && slice.root === el) {
      const id = slice.id;
      deselect();
      store.remove(id);                 // retire la racine entière du DOM + de la liste
    } else if (slice) {
      const id = slice.id;
      deselect();
      el.remove();                      // retire le nœud interne du DOM vivant
      store.touch(id);                  // historique + UI (la racine survit)
    } else {
      deselect();
      el.remove();                      // hors slice (ne devrait pas arriver)
    }
    call('checkEmpty');
  }
  // Duplication : racine → store.duplicate(id) ; nœud interne → clone DOM + touch.
  function duplicateSelection() {
    if (!sel) return;
    const el = sel;
    const slice = sliceOf(el);
    if (slice && slice.root === el) {
      const d = store.duplicate(slice.id);
      if (d) selectElement(d.root);
    } else if (slice) {
      const clone = el.cloneNode(true);
      clone.classList.remove('ekw-selected', 'ekw-editing');
      el.parentNode.insertBefore(clone, el.nextSibling);
      store.touch(slice.id);
      selectElement(clone);
    }
    call('checkEmpty');
  }
  // Déplacement : racine → store.move(id, dir) ; nœud interne → échange de voisins + touch.
  function moveSelection(dir) {
    if (!sel) return;
    const el = sel;
    const slice = sliceOf(el);
    if (slice && slice.root === el) {
      store.move(slice.id, dir);
      positionMarquee(); renderNav();
    } else if (slice) {
      if (dir === 'up') { const prev = el.previousElementSibling; if (prev) el.parentNode.insertBefore(el, prev); }
      else { const next = el.nextElementSibling; if (next) el.parentNode.insertBefore(next, el); }
      store.touch(slice.id);
      positionMarquee(); renderNav();
    }
  }

  // =====================================================================================
  // PICTOS (remplacer / insérer).
  // =====================================================================================
  function pictoImgHTML(p) {
    return '<img src="' + pictoAssetBase() + p.file + '" data-picto="' + p.slug + '" data-picto-url="' + p.url + '" alt="' + p.name + '" class="inline-block w-10 h-10 align-middle">';
  }
  function renderPictoGrid(filter) {
    if (!doc) return;
    const grids = doc.querySelectorAll('[data-picto-grid]');
    if (!grids.length) return;
    const f = (filter || '').trim().toLowerCase();
    const all = getPictos();
    const list = f ? all.filter((p) => p.slug.includes(f) || (p.name || '').toLowerCase().includes(f)) : all;
    const html = list.map((p) =>
      '<button type="button" data-picto-insert="' + p.slug + '" title="' + p.name + '" class="aspect-square flex items-center justify-center bg-slate-700/40 hover:bg-slate-700 border border-slate-600/40 rounded-lg p-1.5 transition">'
      + '<img src="' + pictoAssetBase() + p.file + '" alt="' + p.name + '" class="max-w-full max-h-full" loading="lazy"></button>'
    ).join('') || '<p class="col-span-full text-[10px] text-slate-500">Aucun picto</p>';
    grids.forEach((g) => { g.innerHTML = html; });
  }
  function insertPicto(slug) {
    const p = pictoMap[slug]; if (!p) return;
    // Un picto est déjà sélectionné → on le REMPLACE (garde sa taille/classes).
    if (sel && sel.matches && sel.matches('img[data-picto]')) {
      sel.setAttribute('src', pictoAssetBase() + p.file);
      sel.setAttribute('data-picto', p.slug);
      sel.setAttribute('data-picto-url', p.url);
      sel.setAttribute('alt', p.name);
      touchSel();
      selectElement(sel);
      return;
    }
    const html = pictoImgHTML(p);
    if (editing) { doc.execCommand('insertHTML', false, html); touchSel(); return; }
    if (sel) {
      sel.insertAdjacentHTML('beforeend', html);
      const added = sel.lastElementChild;
      touchSel();
      if (added) selectElement(added);
      return;
    }
    // Rien de sélectionné → nouvelle slice via le store (autorité structurelle).
    const slice = store.add('<div class="flex justify-center p-4">' + html + '</div>');
    call('resolvePictos', slice.root);
    const img = slice.root.querySelector('img[data-picto]');
    if (img) selectElement(img);
  }

  // =====================================================================================
  // WIRING DES ÉVÈNEMENTS.
  // =====================================================================================
  function wireStyleBox() {
    if (!styleBox) return;
    listen(styleBox, 'mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
    listen(styleBox, 'click', (e) => {
      const head = e.target.closest('[data-acc-head]');
      if (head) { toggleRow(head.dataset.accHead); return; }
      const link = e.target.closest('[data-sp-link]');
      if (link && sel) {
        const g = link.dataset.spLink;
        linkState[g] = !linkState[g];
        if (linkState[g]) { const v = spRead(sel, g, 'top'); ['top', 'right', 'bottom', 'left'].forEach((s) => spWriteSide(sel, g, s, v)); }
        spSync(); touchSel(); return;
      }
      const step = e.target.closest('[data-sp-step]');
      if (step && sel) {
        const g = step.dataset.spG, s = step.dataset.spS, d = parseInt(step.dataset.spStep, 10);
        spApply(g, s, Math.max(0, spRead(sel, g, s) + d * SP_STEP));
        spSync(); return;
      }
      const co = e.target.closest('[data-coloropen]');
      if (co && sel) { const g = co.dataset.coloropen; openColorPopover(co, (hex) => (g === 'border' ? spSetBorderColor : spSetBgColor)(hex)); return; }
      const ss = e.target.closest('[data-styleset]');
      if (ss && sel) { const p = ss.dataset.styleset.split(':'); sel.style[p[0]] = (sel.style[p[0]] === p[1] ? '' : p[1]); spSync(); touchSel(); return; }
    });
    listen(styleBox, 'input', (e) => {
      if (e.target.id === 'css-editor') { if (sel) { sel.style.cssText = e.target.value; spSync(); touchSel(); } return; }
      if (e.target.matches('[data-jstext]') && sel && editSnapshot) {
        const g = editSnapshot.textGroups[parseInt(e.target.dataset.jstext, 10)];
        if (g) { g.newValue = e.target.value; applyDynamicEdits(); }
        return;
      }
      if (e.target.matches('[data-fontfam]') && sel) { sel.style.fontFamily = e.target.value || ''; touchSel(); return; }
      if (e.target.matches('[data-dimunit]') && sel) {
        const g = e.target.dataset.dimunit; const cur = spRead(sel, g, 'all');
        dimUnit[g] = e.target.value === '%' ? '%' : 'px';
        spApply(g, 'all', cur); spSync(); return;
      }
      if (e.target.matches('[data-stylesel]') && sel) { sel.style[e.target.dataset.stylesel] = e.target.value || ''; spSync(); touchSel(); return; }
      if (e.target.matches('[data-chex]') && sel) {
        const v = e.target.value.trim();
        if (/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v)) { const g = e.target.dataset.chex; (g === 'border' ? spSetBorderColor : spSetBgColor)(v); }
        return;
      }
      if (e.target.matches('[data-copacity]') && sel) {
        let p = parseFloat(e.target.value); if (isNaN(p)) return;
        p = Math.max(0, Math.min(100, p));
        const m = win.getComputedStyle(sel).backgroundColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
        const rgb = m ? (m[1] + ',' + m[2] + ',' + m[3]) : '0,0,0';
        sel.style.backgroundColor = 'rgba(' + rgb + ',' + (p / 100) + ')';
        spSync(); touchSel(); return;
      }
      const i = e.target.closest('input[data-sp-in]'); if (!i || !sel) return;
      let v = parseInt(i.value, 10); if (isNaN(v) || v < 0) v = 0;
      spApply(i.dataset.spG, i.dataset.spS, v);
    });
  }
  function wireToolbar() {
    if (!toolbar) return;
    listen(toolbar, 'click', (e) => {
      const btn = e.target.closest('button'); if (!btn || !sel) return;
      const act = btn.dataset.act;
      if (act === 'parent') { const p = sel.parentElement; if (p && p !== canvas && p.closest('[data-comp]')) selectElement(p); }
      else if (act === 'up') moveSelection('up');
      else if (act === 'down') moveSelection('down');
      else if (act === 'edit') { editing ? stopEditing() : startEditing(); }
      else if (act === 'link') openElementLink();
      else if (act === 'target') call('setTarget', sel);
      else if (act === 'dup') duplicateSelection();
      else if (act === 'save') call('saveComponent', sliceRootOf(sel));
      else if (act === 'del') deleteSelection();
    });
  }
  function wireStates() {
    if (!statesBox) return;
    listen(statesBox, 'click', (e) => { const b = e.target.closest('[data-estate]'); if (b) setEditState(b.dataset.estate); });
  }
  function wireNav() {
    if (!navBox) return;
    listen(navBox, 'click', (e) => {
      const crumb = e.target.closest('[data-crumb]');
      if (crumb && crumbs) { const p = crumbs._path; const el = p && p[+crumb.dataset.crumb]; if (el) selectElement(el); }
    });
    listen(navBox, 'mouseover', (e) => {
      const crumb = e.target.closest('[data-crumb]'); if (!crumb || !crumbs) return;
      const p = crumbs._path; const el = p && p[+crumb.dataset.crumb];
      if (el && el !== sel) showHover(el);
    });
    listen(navBox, 'mouseout', (e) => { if (e.target.closest('[data-crumb]')) hideHover(); });
  }
  function wireCanvas() {
    if (!canvas) return;
    let hoverRaf = 0, lastMove = null;
    listen(canvas, 'mousemove', (e) => {
      if (editing) { hideHover(); return; }
      lastMove = { target: e.target, alt: e.altKey };
      if (hoverRaf) return;
      hoverRaf = 1;
      raf(() => {
        hoverRaf = 0;
        const base = lastMove && hoverTargetFor(lastMove.target);
        const t = base ? (lastMove.alt ? sliceRootOf(base) : base) : null;
        if (t) showHover(t); else hideHover();
      });
    });
    listen(canvas, 'mouseleave', hideHover);
    listen(canvas, 'click', (e) => {
      if (editing) return;
      if (!e.target.closest('[data-comp]')) { deselect(); return; }
      e.stopPropagation();
      const base = hoverTargetFor(e.target);
      if (base) selectElement(e.altKey ? sliceRootOf(base) : base);
    });
    listen(canvas, 'dblclick', (e) => {
      if (!e.target.closest('[data-comp]')) return;
      if (editing && sel && sel.contains(e.target)) return;
      e.preventDefault();
      if (editing) stopEditing();
      selectElement(e.target);
      startEditing();
    });
    // Toute frappe dans l'élément en cours d'édition = édition de contenu → touch.
    listen(canvas, 'input', () => { if (editing) touchSel(); });
  }
  function wireDocument() {
    if (!doc) return;
    listen(doc, 'mousedown', (e) => {
      if (e.target.closest('#editor-panel') || e.target.closest('#editor-actions') || e.target.closest('#ekw-link') || e.target.closest('#chat-panel')) return;
      if (editing) { if (sel && sel.contains(e.target)) return; stopEditing(); }
      if (e.target.closest('#canvas')) return;
      deselect();
    });
    // Fermeture du popover de couleurs au clic extérieur.
    listen(doc, 'mousedown', (e) => {
      if (!colorPop || colorPop.classList.contains('hidden')) return;
      if (e.target.closest('#ekw-colorpop') || e.target.closest('[data-textpalette]') || e.target.closest('[data-coloropen]')) return;
      closeColorPopover();
    });
    // Insertion de picto depuis une grille (délégation — remplace onclick inline legacy).
    listen(doc, 'click', (e) => {
      const b = e.target.closest('[data-picto-insert]'); if (!b) return;
      e.preventDefault(); insertPicto(b.dataset.pictoInsert);
    });
    listen(doc, 'keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')) {
        const ae = doc.activeElement;
        if (editing || (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable))) return;
        e.preventDefault(); e.shiftKey ? call('redo') : call('undo'); return;
      }
      if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || e.key === 'Y')) { e.preventDefault(); call('redo'); return; }
      if (e.key === 'Escape') {
        if (linkOpen) { closeLinkBubble(); if (sel) sel.focus(); return; }
        if (editing) { stopEditing(); return; }
        if (sel) { const p = navTarget('parent'); if (p) selectElement(p); else deselect(); return; }
        return;
      }
      if (e.key === 'Enter' && sel && !editing) {
        const ae = doc.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        const c = navTarget('child'); if (c) { e.preventDefault(); selectElement(c); }
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel && !editing) {
        const ae = doc.activeElement;
        if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
        e.preventDefault();
        deleteSelection();
      }
    });
    listen(doc, 'selectionchange', () => { if (editing) raf(positionTextBubble); });
  }
  function wireWindow() {
    listen(win, 'resize', () => { positionMarquee(); if (editing) positionTextBubble(); });
    listen(win, 'scroll', positionMarquee, true);
    if (canvasScroll) listen(canvasScroll, 'scroll', () => { if (editing) positionTextBubble(); }, { passive: true });
  }

  // ---- montage ------------------------------------------------------------------------
  buildToolbar();
  buildFormatbar();
  buildStylePanel();
  ensureOverlays();
  wireFormatbar();
  wireStyleBox();
  wireToolbar();
  wireStates();
  wireNav();
  wireCanvas();
  wireDocument();
  wireWindow();
  setEditState('normal');
  renderPictoGrid('');

  function dispose() {
    while (disposers.length) { try { disposers.pop()(); } catch (_) { } }
    [marquee, hoverBox, hoverLabel, linkBubble, colorPop].forEach((n) => { if (n && n.remove) n.remove(); });
  }

  return {
    selectElement, deselect,
    startEditing, stopEditing,
    setEditState, commitStateEdits: _commitStateEdits, _commitStateEdits,
    regenStateStyles, stateCssForPreview,
    insertPicto, renderPictoGrid,
    deleteSelection, duplicateSelection, moveSelection,
    spSync,
    getSelected: () => sel,
    isEditing: () => editing,
    dispose,
  };
}
