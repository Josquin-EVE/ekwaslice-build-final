// Chat Claude : ciblage (effectiveTarget) + application de la réponse, routés via le
// SliceStore. Porté depuis index.html (l'« éditeur low-code »). Règle d'or : le store
// est la SEULE autorité structurelle sur #canvas — aucune slice n'est ajoutée/remplacée
// hors store. Ferme le bug « doublon » : un 2ᵉ prompt sur une slice présente la MODIFIE
// en place (replaceContent) au lieu d'append un widget en double.
//
// Ciblage — effectiveTarget() (priorité) :
//   forceNewEl armé            → null (on force un nouvel élément)
//   cible explicite (bouton)   → targetEl, si toujours dans le canvas
//   sélection courante (editing)→ sel, si toujours dans le canvas
//   slice Prismic ciblée       → via hook getPrismicTarget (survit au deselect), si présente
//   unique slice du canvas     → store.list().length === 1 → sa racine (modif en place)
//   sinon                      → null (= ajout d'un bloc)
// Garde « sélection obsolète » : toute cible candidate est validée canvas.contains(node)
// ET store.sliceOf(node) non-null avant d'être retenue — après un change/replaceContent/undo,
// `sel` peut pointer un nœud détaché ; on redescend alors la chaîne au lieu de no-op.
//
// Application — applyCandidate(node, html) :
//   racine de slice  → store.replaceContent(id, html) PUIS editing.regenStateStyles()
//                      (replaceContent re-minte les data-eid des descendants → sans régén,
//                       les règles <style id="ekw-live-states"> deviennent orphelines).
//                      L'identité Prismic (meta + data-remote-*) est préservée par le store.
//   nœud imbriqué    → remplacement du nœud DANS slice.root (édition de contenu) + store.touch(id).
//   aucune cible      → store.add(html, 'generated').
//
// -------------------------------------------------------------------------------------
// Contrat `ctx` (fourni par le bootstrap — Task 12). Tout est OPTIONNEL et gardé :
//   document      : Document hôte (défaut globalThis.document).
//   window        : Window hôte (défaut document.defaultView).
//   canvas        : élément #canvas (défaut store.canvas).
//   editing       : instance initEditing — on utilise getSelected(), selectElement(el),
//                   regenStateStyles(), isEditing(), stopEditing(). (ou ctx.getSelected seul.)
//   api           : couche IPC (défaut window.api). Utilise sendChat(payload)→{text,sessionId,
//                   tokens,cost,error} et onChatDelta(cb) pour le streaming.
//   chatInput / chatLog / chatSend / chatImagesBox / chatContext* : refs DOM (sinon by id).
//   genOverlay / genLottie : surimpression d'animation pendant la génération.
//   hooks : collaborateurs HORS périmètre chat, appelés s'ils existent :
//       cleanHTML(html, forExport)   → HTML « propre » envoyé à Claude / joint en contexte.
//       resolvePictos(node)          → monte les <img data-picto> d'un fragment inséré.
//       setMode(mode) / getMode()    → bascule aperçu/édition.
//       checkEmpty()                 → recalcule l'état « canvas vide ».
//       toast(msg) / trackUsage(tokens, cost).
//       getPrismicTarget()           → slice Prismic ciblée courante (défaut null).
//       getPageMaxW()                → largeur max du gabarit (contexte d'affichage).
// -------------------------------------------------------------------------------------

import { serializeSlice } from '../core/slice.js';

export function initChat(store, ctx = {}) {
  const doc = ctx.document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
  const win = ctx.window || (doc && doc.defaultView) || (typeof globalThis !== 'undefined' ? globalThis : null);
  const canvas = ctx.canvas || store.canvas;
  const editing = ctx.editing || {};
  const hooks = ctx.hooks || {};
  const api = ctx.api || (win && win.api) || null;

  const call = (name, ...args) => { const fn = hooks[name]; if (typeof fn === 'function') return fn(...args); return undefined; };
  const byId = (id) => (doc ? doc.getElementById(id) : null);
  const cleanHTML = (html, forExport) => (typeof hooks.cleanHTML === 'function' ? hooks.cleanHTML(html, forExport) : html);
  const getSelected = () => (typeof editing.getSelected === 'function' ? editing.getSelected() : (typeof ctx.getSelected === 'function' ? ctx.getSelected() : null));
  const getPrismicTarget = () => call('getPrismicTarget') || null;
  const getPageMaxW = () => call('getPageMaxW');
  const toast = (m) => call('toast', m);

  // ---- état de ciblage ----------------------------------------------------------------
  let targetEl = null;        // référence LIVE de l'élément ciblé explicitement (bouton « cibler »)
  let forceNewEl = false;     // force le mode « nouvel élément » même si une sélection existe
  let pending = null;         // candidat en attente : { el, html }
  let pendingDisablePrev = null; // grise la carte du candidat précédent quand un nouveau arrive

  // Une cible est valide seulement si elle est TOUJOURS branchée dans le canvas ET
  // reconnue par le store (pas un nœud détaché/orphelin après change/undo/replaceContent).
  const live = (node) => !!(node && canvas && canvas.contains(node) && store.sliceOf(node));

  // HTML de RÉFÉRENCE envoyé à Claude pour une cible, et base de ce qu'il renvoie.
  // RACINE de slice → contenu INTERNE canonique (serializeSlice), PAS outerHTML : le modèle
  // ré-émet ce contenu, et store.replaceContent le repose comme contenu interne de la racine
  // existante → aucune accumulation de wrapper (root > div > … à chaque édition), et les
  // data-remote-* (portés par la racine, pas par le contenu) ne fuient pas dans un nœud imbriqué.
  // Nœud imbriqué → outerHTML (il est remplacé en place par replaceWith).
  function refHtmlFor(tgt) {
    const slice = store.sliceOf(tgt);
    if (slice && slice.root === tgt) return serializeSlice(slice);
    return cleanHTML(tgt.outerHTML);
  }

  // --- ciblage effectif (cœur du fix « doublon ») --------------------------------------
  function effectiveTarget() {
    if (forceNewEl) return null;
    if (live(targetEl)) return targetEl;
    const sel = getSelected();
    if (live(sel)) return sel;
    const pt = getPrismicTarget();
    if (live(pt)) return pt;
    const list = store.list();
    if (list.length === 1) return list[0].root; // unique slice → modif en place (pas d'ajout doublon)
    return null;
  }

  function setForceNewEl(v) { forceNewEl = !!v; if (forceNewEl) targetEl = null; refreshChatContext(); }
  function setTarget(el) { if (!el) return; targetEl = el; forceNewEl = false; refreshChatContext(); }
  function clearTarget() { targetEl = null; forceNewEl = false; refreshChatContext(); }
  // Bascule modif-en-place <-> nouvel élément (bouton de la puce de contexte).
  function toggleTargetMode() {
    if (effectiveTarget()) { forceNewEl = true; targetEl = null; } else { forceNewEl = false; }
    refreshChatContext();
  }

  // --- puce de contexte au-dessus du champ (refs gardées) ------------------------------
  function elLabel(el) {
    const tag = el.tagName.toLowerCase();
    const raw = (el.textContent || '').trim().replace(/\s+/g, ' ');
    const txt = raw.slice(0, 32);
    return '<' + tag + '>' + (raw ? ' · « ' + txt + (raw.length > 32 ? '…' : '') + ' »' : '');
  }
  function refreshChatContext() {
    const box = ctx.chatContext || byId('chat-context'); if (!box) return;
    const label = ctx.chatContextLabel || byId('chat-context-label');
    const icon = ctx.chatContextIcon || byId('chat-context-icon');
    const act = ctx.chatContextAction || byId('chat-context-action');
    const esc = (s) => s.replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const t = effectiveTarget();
    if (t) {
      if (label) label.innerHTML = '<b>Modifie</b> ' + esc(elLabel(t));
      if (icon) icon.className = 'fa-solid fa-pen shrink-0 text-[#d97757]';
      if (act) { act.innerHTML = '<i class="fa-solid fa-plus"></i>'; act.title = 'Créer un nouvel élément à la place (ne pas modifier la sélection)'; }
      box.classList.remove('hidden'); box.classList.add('flex');
    } else if (forceNewEl && getSelected()) {
      if (label) label.innerHTML = '<b>Nouvel élément</b> — ajouté au canvas';
      if (icon) icon.className = 'fa-solid fa-plus shrink-0 text-[#d97757]';
      if (act) { act.innerHTML = '<i class="fa-solid fa-rotate-left"></i>'; act.title = 'Revenir à modifier la sélection'; }
      box.classList.remove('hidden'); box.classList.add('flex');
    } else {
      box.classList.add('hidden'); box.classList.remove('flex');
    }
  }

  // =====================================================================================
  // APPLICATION DE LA RÉPONSE — tout passe par le store.
  // =====================================================================================
  function parseFragment(html) {
    if (!doc) return null;
    const tmp = doc.createElement('div');
    tmp.innerHTML = String(html).trim();
    return tmp.firstElementChild;
  }

  const ensureEditMode = () => { if (call('getMode') !== 'edit') call('setMode', 'edit'); };

  // Aucune cible → nouvelle slice via le store (autorité structurelle), puis montage.
  function addGenerated(html) {
    const slice = store.add(html, 'generated');
    call('resolvePictos', slice.root);        // store.add ne résout pas les pictos
    if (typeof editing.regenStateStyles === 'function') editing.regenStateStyles();
    call('checkEmpty');
    ensureEditMode();
    if (typeof editing.selectElement === 'function') editing.selectElement(slice.root);
    return slice.root;
  }

  // Remplace la cible par la version renvoyée par Claude. Boucle fermée, routée store.
  // Garde « cible obsolète » : si le nœud n'est plus vivant, on retombe sur un ajout.
  function replaceTargeted(oldEl, html) {
    if (!live(oldEl)) {
      // Cible devenue obsolète (ex. undo a recréé les racines via insertAt → nouveau nœud,
      // même id). On NE retombe PAS directement sur un ajout : on re-résout la chaîne de
      // ciblage — une unique slice présente doit encore être éditée en place (sinon doublon).
      const fallback = effectiveTarget();
      if (live(fallback)) {
        if (toast) toast("L'élément ciblé a changé — modification de la slice en place.");
        return replaceTargeted(fallback, html); // fallback est vivant → pas de ré-entrée dans cette branche
      }
      if (toast) toast("L'élément ciblé n'existe plus — ajout d'un nouvel élément.");
      return addGenerated(html);
    }
    const slice = store.sliceOf(oldEl);
    if (slice.root === oldEl) {
      // RACINE de slice : contenu remplacé DANS la racine existante. Le store conserve
      // meta + data-remote-* + l'id de slice et re-minte les data-eid des descendants.
      store.replaceContent(slice.id, html);
      if (typeof editing.regenStateStyles === 'function') editing.regenStateStyles(); // sinon règles d'états orphelines
      call('resolvePictos', slice.root);       // replaceContent (createSliceRoot) ne monte pas les pictos
      call('checkEmpty');
      ensureEditMode();
      if (typeof editing.selectElement === 'function') editing.selectElement(slice.root);
      return slice.root; // la racine reste le MÊME nœud → prismicTarget et refs restent valides
    }
    // NŒUD IMBRIQUÉ : édition de contenu → on mute le DOM vivant dans slice.root + touch.
    const newEl = parseFragment(html);
    if (!newEl) return null;
    oldEl.replaceWith(newEl);
    // Un fragment imbriqué ne doit pas réinjecter de <script> ni d'artefacts d'édition.
    newEl.querySelectorAll('script').forEach((s) => s.remove());
    newEl.removeAttribute('contenteditable');
    newEl.querySelectorAll('[contenteditable]').forEach((n) => n.removeAttribute('contenteditable'));
    call('resolvePictos', newEl);
    store.touch(slice.id);
    call('checkEmpty');
    ensureEditMode();
    if (typeof editing.selectElement === 'function') editing.selectElement(newEl);
    return newEl;
  }

  // Valide définitivement le candidat prévisualisé.
  function applyCandidate(el, html, btn) {
    const out = replaceTargeted(el, html);
    pending = null; pendingDisablePrev = null;
    clearTarget(); // édition terminée → le message suivant repart sur une nouvelle cible
    if (btn) { btn.disabled = true; btn.classList.add('opacity-60'); btn.innerHTML = '<i class="fa-solid fa-check mr-1.5"></i>Accepté'; }
    return out;
  }
  // Abandonne le candidat, l'original reste intact.
  function rejectCandidate(btn) {
    pending = null; pendingDisablePrev = null;
    if (call('getMode') !== 'edit') call('setMode', 'edit');
    if (btn) { btn.disabled = true; btn.classList.add('opacity-60'); btn.innerHTML = '<i class="fa-solid fa-xmark mr-1.5"></i>Annulé'; }
  }
  // Montre le candidat dans l'aperçu (non destructif).
  function previewPending() { call('setMode', 'preview'); }

  // =====================================================================================
  // RENDU DE LA RÉPONSE : prose markdown + blocs ```code``` (aperçu Accepter/Annuler).
  // =====================================================================================
  // Filet de sécurité : retire les étiquettes de méta-raisonnement qui fuitent parfois
  // des skills ~/.claude (« Bounded path. », « Design court. », …). Toujours en tête.
  function stripLeadMeta(text) {
    const re = /^\s*\**\s*(Bounded|Unbounded|Scoped|Scoping|Classification|Design\s+(court|bref|rapide)|Starting(\s+with)?|Path|Approach|Plan)\b[^\n]*(\n|$)/i;
    let t = String(text);
    for (let i = 0; i < 2; i++) { const n = t.replace(re, ''); if (n === t) break; t = n; }
    return t;
  }
  function mdEscape(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function mdInline(s) {
    return mdEscape(s)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="bg-slate-800 text-emerald-300 rounded px-1 py-0.5 text-[0.9em]">$1</code>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  }
  function renderMd(text) {
    const lines = String(text).replace(/\r/g, '').split('\n');
    let html = '', list = null;
    const closeList = () => { if (list) { html += '</' + list + '>'; list = null; } };
    for (const raw of lines) {
      const line = raw.replace(/\s+$/, '');
      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      const num = line.match(/^\s*\d+\.\s+(.*)$/);
      const head = line.match(/^#{1,6}\s+(.*)$/);
      if (bullet) {
        if (list !== 'ul') { closeList(); html += '<ul class="list-disc pl-5 space-y-0.5 my-1">'; list = 'ul'; }
        html += '<li>' + mdInline(bullet[1]) + '</li>';
      } else if (num) {
        if (list !== 'ol') { closeList(); html += '<ol class="list-decimal pl-5 space-y-0.5 my-1">'; list = 'ol'; }
        html += '<li>' + mdInline(num[1]) + '</li>';
      } else if (head) {
        closeList(); html += '<div class="font-bold mt-1">' + mdInline(head[1]) + '</div>';
      } else if (!line.trim()) {
        closeList(); html += '<div class="h-1.5"></div>';
      } else {
        closeList(); html += '<div>' + mdInline(line) + '</div>';
      }
    }
    closeList();
    return html;
  }

  // Rendu d'une réponse : texte + blocs ```code```.
  // replaceTarget (optionnel) = élément ciblé → le 1er bloc HTML le REMPLACE en place
  // (aperçu non destructif + Accepter/Annuler). Les blocs suivants : insertion manuelle.
  function renderAssistant(text, replaceTarget) {
    const frag = doc.createElement('div');
    frag.className = 'space-y-2';
    let replaceUsed = false;
    let autoInjected = false;
    const parts = stripLeadMeta(text).split('```');
    parts.forEach((part, i) => {
      if (i % 2 === 0) {
        const t = part.trim();
        if (!t) return;
        const p = doc.createElement('div');
        p.className = 'leading-relaxed';
        p.innerHTML = renderMd(t);
        frag.appendChild(p);
      } else {
        const code = part.replace(/^[a-zA-Z0-9]*\n/, '').replace(/\s+$/, '');
        const card = doc.createElement('div');
        card.className = 'border border-slate-700 rounded-xl overflow-hidden';
        const pre = doc.createElement('pre');
        pre.className = 'bg-slate-950 text-emerald-400 text-[11px] p-3 overflow-x-auto max-h-48 whitespace-pre-wrap hidden';
        pre.textContent = code;
        const toggle = doc.createElement('button');
        toggle.className = 'w-full text-left text-[10px] text-slate-400 hover:text-cloud bg-slate-900 px-3 py-1.5 flex items-center gap-1.5';
        toggle.innerHTML = '<i class="fa-solid fa-code text-slate-500"></i><span>Voir le code</span>';
        toggle.onclick = () => { const h = pre.classList.toggle('hidden'); toggle.querySelector('span').textContent = h ? 'Voir le code' : 'Masquer le code'; };
        card.appendChild(toggle);
        card.appendChild(pre);
        if (code.trim().startsWith('<')) {
          const isReplace = replaceTarget && !replaceUsed;
          const bar = doc.createElement('div');
          bar.className = 'flex items-center gap-2 bg-slate-900 p-2';
          if (isReplace) {
            // Édition de code existant : prévisualisation non destructive + validation.
            replaceUsed = true;
            if (pendingDisablePrev) pendingDisablePrev(); // supersede la version précédente
            pending = { el: replaceTarget, html: code };
            bar.className = 'flex items-center justify-end gap-2 bg-slate-900 p-2';
            const reject = doc.createElement('button');
            reject.className = 'text-xs bg-error text-ink-deep font-semibold px-4 py-1.5 rounded-lg hover:brightness-110 transition';
            reject.innerHTML = '<i class="fa-solid fa-xmark mr-1.5"></i>Annuler';
            const apply = doc.createElement('button');
            apply.className = 'text-xs bg-success text-ink-deep font-semibold px-4 py-1.5 rounded-lg hover:brightness-110 transition';
            apply.innerHTML = '<i class="fa-solid fa-check mr-1.5"></i>Accepter';
            apply.onclick = () => applyCandidate(replaceTarget, code, apply);
            reject.onclick = () => rejectCandidate(reject);
            pendingDisablePrev = () => {
              apply.disabled = true; apply.classList.add('opacity-40', 'grayscale');
              apply.innerHTML = '<i class="fa-solid fa-clock-rotate-left mr-1.5"></i>Version remplacée';
              reject.classList.add('hidden');
            };
            bar.append(reject, apply);
          } else if (!autoInjected) {
            // Nouvel élément (pas de cible) : ajout DIRECT via le store, sans vérification.
            autoInjected = true;
            const wrap = addGenerated(code);
            const done = doc.createElement('span');
            done.className = 'text-[11px] text-success flex-1';
            done.innerHTML = '<i class="fa-solid fa-check mr-1.5"></i>Ajouté au canvas';
            const undo = doc.createElement('button');
            undo.className = 'text-xs text-slate-400 hover:text-cloud px-2 py-1.5 rounded-lg hover:bg-slate-800 transition';
            undo.innerHTML = '<i class="fa-solid fa-xmark mr-1"></i>Retirer';
            undo.onclick = () => {
              const slice = wrap && store.sliceOf(wrap);
              if (slice) store.remove(slice.id); // retrait routé store (pas de wrap.remove() hors store)
              call('checkEmpty');
              undo.disabled = true; undo.classList.add('opacity-60');
              done.innerHTML = '<i class="fa-solid fa-xmark mr-1.5"></i>Retiré';
            };
            bar.append(done, undo);
          } else {
            // blocs HTML supplémentaires : insertion manuelle (toujours un nouvel élément).
            const btn = doc.createElement('button');
            btn.className = 'ml-auto text-xs bg-secondary text-ink-deep font-medium px-3 py-1.5 rounded-lg hover:brightness-110 transition';
            btn.innerHTML = '<i class="fa-solid fa-plus mr-1.5"></i>Insérer dans le canvas';
            btn.onclick = () => {
              addGenerated(code);
              btn.innerHTML = '<i class="fa-solid fa-check mr-1.5"></i>Inséré';
              btn.disabled = true; btn.classList.add('opacity-60');
            };
            bar.appendChild(btn);
          }
          card.appendChild(bar);
        }
        frag.appendChild(card);
      }
    });
    if (!frag.childNodes.length) frag.textContent = String(text);
    if (replaceTarget && replaceUsed) previewPending(); // auto-aperçu du candidat
    return frag;
  }

  // =====================================================================================
  // CONSCIENCE DU CANVAS : Claude « voit » la slice qu'il édite (une fois / session).
  // =====================================================================================
  let lastCanvasCtx = { sessionId: null, hash: '' };
  function hashStr(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h); }
  function sliceContextHTML(tgt) {
    let html = '';
    if (tgt) {
      const slice = store.sliceOf(tgt);
      if (slice && slice.root === tgt) {
        html = serializeSlice(slice); // cible = racine → contenu interne (cohérent avec refHtmlFor, pas d'accumulation)
      } else {
        const root = tgt.closest('[data-comp]');
        html = root ? root.outerHTML : tgt.outerHTML;
      }
    } else {
      canvas.querySelectorAll(':scope > [data-comp]').forEach((r) => { html += r.outerHTML + '\n'; });
    }
    if (!html.trim()) return '';
    let clean = cleanHTML(html);
    // Le JS de la slice est inerte (text/ekw-js) → le rendre lisible comme du vrai JS.
    clean = String(clean).replace(/<script\s+type=["']text\/ekw-js["']\s*>/gi, '<script>');
    return clean.trim();
  }

  // =====================================================================================
  // CHAT : overlay, images, streaming, envoi IPC.
  // =====================================================================================
  let chatSessionId = null;
  let chatBusy = false;
  let chatFast = false;
  try { chatFast = win && win.localStorage && win.localStorage.getItem('ekwa_chat_fast') === '1'; } catch (_) { }
  let chatImages = []; // { mime, data(base64), url(dataURL) }
  let streamState = null;

  function chatLogEl() { return ctx.chatLog || byId('chat-log'); }
  function chatInputEl() { return ctx.chatInput || byId('chat-input'); }
  function scrollChat() { const l = chatLogEl(); if (l) l.scrollTop = l.scrollHeight; }

  function addBubble(role, content) {
    const log = chatLogEl(); if (!log) return null;
    const w = doc.getElementById('chat-welcome'); if (w) w.remove();
    const row = doc.createElement('div');
    row.className = 'chat-row flex ' + (role === 'user' ? 'justify-end' : 'justify-start');
    const bubble = doc.createElement('div');
    bubble.className = role === 'user'
      ? 'max-w-[85%] bg-slate-800 border border-slate-700 text-slate-100 rounded-2xl rounded-br-sm px-3.5 py-2.5 whitespace-pre-wrap break-words'
      : 'max-w-[92%] bg-slate-900 border border-slate-700 text-slate-100 rounded-2xl rounded-bl-sm px-3.5 py-2.5 space-y-2 break-words';
    if (typeof content === 'string') bubble.textContent = content;
    else if (content) bubble.appendChild(content);
    row.appendChild(bubble);
    log.appendChild(row);
    scrollChat();
    return row;
  }

  function showGenOverlay(on) { call('showGenOverlay', on); }
  function setChatBusy(b) {
    chatBusy = b;
    const send = ctx.chatSend || byId('chat-send');
    if (send) { send.disabled = b; send.innerHTML = b ? '<i class="fa-solid fa-spinner fa-spin"></i>' : '<i class="fa-solid fa-arrow-up"></i>'; }
    showGenOverlay(b);
  }

  // Images jointes (presse-papier / import).
  function dataUrlParts(u) { const m = /^data:([^;]+);base64,(.*)$/.exec(u || ''); return m ? { mime: m[1], data: m[2], url: u } : null; }
  function addChatImageFromFile(file) {
    if (!file || !/^image\//.test(file.type || '') || !win || !win.FileReader) return;
    const r = new win.FileReader();
    r.onload = () => { const p = dataUrlParts(r.result); if (p) { chatImages.push(p); renderChatImages(); } };
    r.readAsDataURL(file);
  }
  function onChatFiles(files) { [...files].forEach(addChatImageFromFile); }
  function removeChatImage(i) { chatImages.splice(i, 1); renderChatImages(); }
  function renderChatImages() {
    const box = ctx.chatImagesBox || byId('chat-images'); if (!box) return;
    if (!chatImages.length) { box.classList.add('hidden'); box.classList.remove('flex'); box.innerHTML = ''; return; }
    box.classList.remove('hidden'); box.classList.add('flex');
    box.innerHTML = chatImages.map((im, i) =>
      '<div class="relative"><img src="' + im.url + '" class="w-14 h-14 object-cover rounded-lg border border-slate-500">'
      + '<button data-chatimg-remove="' + i + '" title="Retirer" class="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-black text-white text-[10px] flex items-center justify-center border border-slate-500 hover:bg-red-600"><i class="fa-solid fa-xmark"></i></button></div>'
    ).join('');
  }

  // Streaming : on n'affiche que la prose ; le code en cours reste masqué (spinner + état).
  function cleanStreamProse(buf) {
    const parts = String(buf).split('```');
    let out = '';
    parts.forEach((p, i) => { if (i % 2 === 0) out += p; });
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }
  if (api && typeof api.onChatDelta === 'function') {
    api.onChatDelta((t) => {
      if (!streamState || !streamState.prose) return;
      streamState.buf += t;
      const ticks = (streamState.buf.match(/```/g) || []).length;
      const inCode = ticks % 2 === 1;
      const prose = stripLeadMeta(cleanStreamProse(streamState.buf));
      streamState.prose.innerHTML = prose ? renderMd(prose) : '';
      streamState.prose.classList.toggle('hidden', !prose);
      if (streamState.label) {
        streamState.label.textContent = inCode ? 'Claude génère le composant…' : (prose ? 'Claude écrit…' : 'Claude réfléchit…');
      }
      const log = chatLogEl(); if (log) log.scrollTop = log.scrollHeight;
    });
  }

  async function sendChat() {
    if (chatBusy) return;
    if (!api) { if (win && win.alert) win.alert("Lancez l'app via Electron (npm start), pas dans un navigateur."); return; }
    const input = chatInputEl();
    const msg = (input && input.value.trim()) || '';
    if (!msg && !chatImages.length) return;
    const imgsPayload = chatImages.map((im) => ({ mime: im.mime, data: im.data }));
    const imgUrls = chatImages.map((im) => im.url);
    const baseMsg = msg || 'Image(s) de référence jointe(s) — utilise-les comme base/inspiration pour le composant, à la charte Ekwateur.';
    // Cible effective : explicite > sélection > slice présente > rien (ajout).
    let tgt = effectiveTarget();
    if (tgt && !live(tgt)) tgt = null;
    let sendMsg = baseMsg;
    if (tgt) {
      const refHtml = refHtmlFor(tgt); // racine → contenu interne (serializeSlice) ; imbriqué → outerHTML
      sendMsg = 'Voici un élément HTML existant du composant (déjà à la charte Ekwateur). '
        + 'Modifie UNIQUEMENT cet élément en gardant sa nature, et renvoie sa version modifiée '
        + 'dans UN SEUL bloc ```html (le fragment seul, sans texte superflu) :\n\n'
        + '```html\n' + refHtml + '\n```\n\nModification demandée : ' + baseMsg;
    }
    const pageMaxW = getPageMaxW();
    const wctx = pageMaxW
      ? "[Contexte d'affichage] Ce composant sera affiché dans un conteneur de largeur MAX "
        + pageMaxW + 'px (gabarit ' + (pageMaxW === 712 ? 'Blog' : pageMaxW === 1080 ? 'page générale' : 'page') + '). '
        + 'Conçois la mise en page pour cette largeur : mobile-first, mais sur desktop le contenu ne dépasse pas '
        + pageMaxW + 'px (grilles, colonnes, tailles de texte et images pensées pour ~' + pageMaxW + 'px de large max).'
      : "[Contexte d'affichage] Le composant peut occuper toute la largeur de la page (pleine largeur).";
    sendMsg = wctx + '\n\n' + sendMsg;
    // Conscience du canvas : joindre la slice (une fois par session, ou si changée).
    const ctxHtml = sliceContextHTML(tgt);
    let ctxHash = '';
    if (ctxHtml) {
      ctxHash = hashStr(ctxHtml);
      const sameSession = lastCanvasCtx.sessionId && lastCanvasCtx.sessionId === chatSessionId;
      if (!sameSession || lastCanvasCtx.hash !== ctxHash) {
        const label = tgt
          ? "[Contexte : slice complète où vit l'élément ci-dessus — pour comprendre son CSS/JS/frères. Ne renvoie QUE le fragment demandé, PAS toute la slice]"
          : '[État actuel du canvas — la/les slice(s) présentes. Base-toi dessus pour répondre ou éditer]';
        sendMsg = label + '\n\n```html\n' + ctxHtml + '\n```\n\n' + sendMsg;
      }
    }
    // Bulle utilisateur : marqueur de cible + vignettes + texte.
    const userContent = (!tgt && !imgUrls.length) ? msg : (() => {
      const d = doc.createElement('div');
      if (tgt) { const h = doc.createElement('div'); h.className = 'text-[10px] opacity-70 mb-1'; h.innerHTML = '<i class="fa-solid fa-bullseye mr-1"></i>' + elLabel(tgt).replace(/</g, '&lt;').replace(/>/g, '&gt;'); d.appendChild(h); }
      if (imgUrls.length) { const ir = doc.createElement('div'); ir.className = 'flex flex-wrap gap-1.5 mb-1'; ir.innerHTML = imgUrls.map((u) => '<img src="' + u + '" class="w-16 h-16 object-cover rounded-lg border border-white/20">').join(''); d.appendChild(ir); }
      if (msg) { const s = doc.createElement('div'); s.className = 'whitespace-pre-wrap'; s.textContent = msg; d.appendChild(s); }
      return d;
    })();
    addBubble('user', userContent);
    if (input) { input.value = ''; input.style.height = 'auto'; }
    chatImages = []; renderChatImages();
    setChatBusy(true);
    // Bulle de travail : état + spinner persistant + zone de prose (remplie par le stream).
    const thinkWrap = doc.createElement('div');
    thinkWrap.className = 'space-y-1.5';
    const statusRow = doc.createElement('div');
    statusRow.className = 'flex items-center gap-2 text-xs text-[#d97757] font-bold';
    statusRow.innerHTML = '<i class="fa-solid fa-spinner fa-spin text-[#d97757]"></i><span class="chat-status-label">Claude réfléchit…</span>';
    const proseEl = doc.createElement('div');
    proseEl.className = 'leading-relaxed text-slate-100 hidden';
    thinkWrap.append(statusRow, proseEl);
    const thinkingRow = addBubble('assistant', thinkWrap);
    streamState = { label: statusRow.querySelector('.chat-status-label'), prose: proseEl, buf: '' };
    try {
      const res = await api.sendChat({ message: sendMsg, sessionId: chatSessionId, images: imgsPayload, model: chatFast ? 'claude-haiku-4-5' : 'claude-sonnet-5' });
      if (thinkingRow) thinkingRow.remove();
      if (res.error) { addBubble('assistant', 'Erreur : ' + res.error); }
      else {
        if (res.sessionId) chatSessionId = res.sessionId;
        if (ctxHtml) lastCanvasCtx = { sessionId: chatSessionId, hash: ctxHash };
        addBubble('assistant', renderAssistant(res.text || '(réponse vide)', tgt));
        call('trackUsage', res.tokens || 0, res.cost || 0);
      }
    } catch (e) {
      if (thinkingRow) thinkingRow.remove();
      addBubble('assistant', 'Erreur inattendue : ' + e.message);
    } finally {
      streamState = null;
      setChatBusy(false);
      if (input) input.focus();
    }
  }

  function toggleChatFast() {
    chatFast = !chatFast;
    try { if (win && win.localStorage) win.localStorage.setItem('ekwa_chat_fast', chatFast ? '1' : '0'); } catch (_) { }
    toast(chatFast ? 'Réponse rapide activée (haiku)' : 'Qualité maximale (sonnet)');
    return chatFast;
  }

  return {
    effectiveTarget, refHtmlFor,
    setForceNewEl, setTarget, clearTarget, toggleTargetMode, refreshChatContext,
    sendChat, renderAssistant, renderMd, stripLeadMeta,
    applyCandidate, rejectCandidate,
    addChatImageFromFile, onChatFiles, removeChatImage, renderChatImages,
    toggleChatFast,
    isBusy: () => chatBusy,
    getPending: () => pending,
    getSessionId: () => chatSessionId,
  };
}
