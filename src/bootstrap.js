// Point d'entrée de la refonte (chargé par index2.html en <script type="module">).
// boot() instancie le cœur (SliceStore + History), les features (editing/chat/prismic/
// library/importCode) et l'UI (overlay/preview/modals/toolbar), construit le `ctx` partagé
// de chaque module et câble le chrome (en-tête, chat, accordéons, bibliothèque, gate).
//
// Règle d'or : le store est la SEULE autorité structurelle sur #canvas. boot() est DÉFENSIF
// (chaque nœud DOM manquant est toléré) pour qu'un élément absent ne fasse pas tomber l'app.

import { SliceStore } from './core/store.js';
import { History } from './core/history.js';
import { exportSlice, collectCssRules } from './core/export.js';
import { initEditing } from './features/editing.js';
import { initChat } from './features/chat.js';
import { initPrismic } from './features/prismic.js';
import { initLibrary } from './features/library.js';
import { initImportCode } from './features/importCode.js';
import { initOverlay } from './ui/overlay.js';
import { initPreview } from './ui/preview.js';
import { initModals } from './ui/modals.js';
import { initPrismicBrowser } from './ui/prismic-browser.js';
import { initToolbar } from './ui/toolbar.js';

const SITE_BG = '#101c1e';

export function boot(opts = {}) {
  const doc = opts.document || document;
  const win = opts.window || doc.defaultView || window;
  const byId = (id) => doc.getElementById(id);
  const canvas = byId('canvas');
  if (!canvas) { console.error('[bootstrap] #canvas introuvable — abandon.'); return null; }

  // Fond du canvas = fond du site.
  canvas.style.backgroundColor = SITE_BG;
  { const f = byId('device-frame'); if (f) f.style.backgroundColor = SITE_BG; }

  // --- réglages persistés (userData) --------------------------------------------------
  let APP_SETTINGS = {};
  const getSettings = () => APP_SETTINGS;
  const api = () => win.api || null;
  async function loadSettings() {
    const a = api();
    if (a && a.settingsGet) { try { APP_SETTINGS = (await a.settingsGet()) || {}; } catch (_) { APP_SETTINGS = {}; } }
    if (!APP_SETTINGS.author) {
      try { const ls = win.localStorage && win.localStorage.getItem('ekwa_author'); if (ls) { APP_SETTINGS.author = ls; if (a && a.settingsSet) a.settingsSet({ author: ls }); } } catch (_) { }
    }
  }
  function authorName() {
    if (APP_SETTINGS && APP_SETTINGS.author) return APP_SETTINGS.author;
    try { return (win.localStorage && win.localStorage.getItem('ekwa_author')) || ''; } catch (_) { return ''; }
  }
  async function setAuthorName(v) {
    APP_SETTINGS.author = v;
    try { if (win.localStorage) win.localStorage.setItem('ekwa_author', v); } catch (_) { }
    const a = api();
    if (a && a.settingsSet) { try { await a.settingsSet({ author: v }); } catch (_) { } }
  }

  // --- pictogrammes -------------------------------------------------------------------
  const PICTO_MAP = {};
  function pictoAssetBase() { try { return new URL('assets/pictos/', win.location.href).href; } catch (_) { return 'assets/pictos/'; } }
  function resolvePictos(root) {
    if (!root || !root.querySelectorAll) return;
    const base = pictoAssetBase();
    root.querySelectorAll('img[data-picto]').forEach((img) => {
      const p = PICTO_MAP[img.getAttribute('data-picto')];
      if (p) {
        if (!img.getAttribute('src')) img.setAttribute('src', base + p.file);
        if (!img.getAttribute('data-picto-url')) img.setAttribute('data-picto-url', p.url);
        if (!img.getAttribute('alt')) img.setAttribute('alt', p.name);
      } else {
        img.setAttribute('data-picto-missing', '1');
      }
    });
  }
  function loadPictos() {
    if (!win.fetch) return;
    win.fetch('assets/pictos.json').then((r) => r.json()).then((list) => {
      (list || []).forEach((p) => { PICTO_MAP[p.slug] = p; });
      if (editing && typeof editing.renderPictoGrid === 'function') editing.renderPictoGrid('');
    }).catch(() => {
      const g = doc.querySelector('[data-picto-grid]');
      if (g) g.innerHTML = '<p class="col-span-4 text-[10px] text-error">pictos.json introuvable</p>';
    });
  }

  // --- nettoyage HTML (export / aperçu / contexte chat) -------------------------------
  function cleanHTML(html, forExport) {
    const div = doc.createElement('div');
    div.innerHTML = html;
    div.querySelectorAll('button[onclick*="remove"]').forEach((b) => b.remove());
    if (forExport) {
      div.querySelectorAll('img[data-picto-url]').forEach((img) => img.setAttribute('src', img.getAttribute('data-picto-url')));
    } else {
      const base = pictoAssetBase();
      div.querySelectorAll('img[data-picto]').forEach((img) => { const p = PICTO_MAP[img.getAttribute('data-picto')]; if (p) img.setAttribute('src', base + p.file); });
    }
    div.querySelectorAll('img[data-picto], img[data-picto-url]').forEach((img) => {
      img.removeAttribute('data-picto'); img.removeAttribute('data-picto-url'); img.removeAttribute('data-picto-missing');
    });
    div.querySelectorAll('.drag-handle').forEach((el) => el.remove());
    div.querySelectorAll('.ekw-selected').forEach((el) => el.classList.remove('ekw-selected'));
    div.querySelectorAll('.ekw-editing').forEach((el) => el.classList.remove('ekw-editing'));
    div.querySelectorAll('[data-comp]').forEach((el) => { el.removeAttribute('data-comp'); el.removeAttribute('draggable'); el.classList.remove('opacity-40', 'relative'); });
    div.querySelectorAll('[contenteditable]').forEach((el) => el.removeAttribute('contenteditable'));
    div.querySelectorAll('[data-ekw-pending]').forEach((el) => el.removeAttribute('data-ekw-pending'));
    div.querySelectorAll('.group').forEach((el) => el.classList.remove('group'));
    return div.innerHTML.replace(/^\s*[\r\n]/gm, '').trim();
  }

  // --- état « canvas vide » (idempotent) ----------------------------------------------
  function checkEmpty() {
    const es = byId('empty-state');
    if (!es) return;
    const real = canvas.querySelectorAll(':scope > [data-comp]');
    es.style.display = real.length ? 'none' : 'flex';
  }

  // --- usage cumulé (optionnel : #usage-text) ----------------------------------------
  const usageStats = { gen: 0, tokens: 0, cost: 0 };
  function trackUsage(tokens, cost) {
    usageStats.gen += 1; usageStats.tokens += tokens || 0; usageStats.cost += cost || 0;
    const el = byId('usage-text');
    if (el) { const k = usageStats.tokens >= 1000 ? (usageStats.tokens / 1000).toFixed(1) + 'k' : usageStats.tokens; el.textContent = `${usageStats.gen} gén · ${k} tokens · ~$${usageStats.cost.toFixed(2)}`; }
  }

  // =====================================================================================
  // CŒUR + FEATURES + UI (déclarés en premier pour liaison tardive des hooks).
  // =====================================================================================
  let editing, chat, prismic, library, importCode, preview, modals, toolbar;

  const overlay = initOverlay({ document: doc, window: win });
  const toast = overlay.toast;

  const store = new SliceStore(canvas);
  const history = new History(store);

  function doUndo() { history.undo(); }
  function doRedo() { history.redo(); }

  // --- editing ------------------------------------------------------------------------
  editing = initEditing(store, {
    document: doc,
    window: win,
    canvas,
    pictoMap: PICTO_MAP,
    pictoAssetBase,
    hooks: {
      checkEmpty,
      toast,
      resolvePictos,
      saveComponent: (root) => { if (library) library.saveComponent(root); },
      setTarget: (el) => { if (chat) chat.setTarget(el); },
      onSelect: (el) => { if (prismic) prismic.noteSelection(el); if (chat) chat.refreshChatContext(); },
      onDeselect: () => { if (chat) chat.refreshChatContext(); },
      undo: doUndo,
      redo: doRedo,
      suspendHistory: () => history.suspend(),
      resumeHistory: () => history.resume(),
    },
  });

  // --- chat ---------------------------------------------------------------------------
  chat = initChat(store, {
    document: doc,
    window: win,
    canvas,
    editing,
    api: api(),
    hooks: {
      cleanHTML,
      resolvePictos,
      setMode: (m) => { if (preview) preview.setMode(m); },
      getMode: () => (preview ? preview.getMode() : 'edit'),
      checkEmpty,
      toast,
      trackUsage,
      getPrismicTarget: () => (prismic ? prismic.getPrismicTarget() : null),
      getPageMaxW: () => (preview ? preview.getPageMaxW() : 0),
      showGenOverlay: overlay.showGenOverlay,
    },
  });

  // --- prismic ------------------------------------------------------------------------
  // Source d'import Prismic venant de l'onglet du panneau (prioritaire sur la modale).
  let _panelPrismicId = '';
  prismic = initPrismic(store, {
    document: doc,
    window: win,
    api: api(),
    prismicSlice: win.PrismicSlice,
    collectCssRules,
    editing,
    hooks: {
      toast,
      showLoading: overlay.showLoading,
      hideLoading: overlay.hideLoading,
      askName: (o) => modals.askName(o),
      getSettings,
      authorName,
      getImportSource: () => _panelPrismicId || (modals ? modals.getImportSource() : ''),
      beforeImport: () => (modals ? modals.saveReadToken() : undefined),
      closeImportModal: () => { if (modals) modals.closePrismicImport(); },
      clearImportInput: () => { if (modals) modals.clearPrismicImportInput(); },
      showPrismicDone: (o) => { if (modals) modals.showPrismicDone(o); },
      setMode: (m) => { if (preview) preview.setMode(m); },
      getMode: () => (preview ? preview.getMode() : 'edit'),
      selectElement: (el) => editing.selectElement(el),
    },
  });

  // Navigateur Prismic du panneau (onglet « Prismic ») : liste + import de la slice choisie.
  const panelPrismicBrowser = initPrismicBrowser({
    document: doc, window: win, api: api(), toast,
    beforeLoad: () => (modals ? modals.saveReadToken() : undefined),
    onPick: (id) => { if (id) importPrismicFromPanel(id); },
  });
  async function importPrismicFromPanel(id) {
    _panelPrismicId = id;
    try { await prismic.doImport(); }
    finally { _panelPrismicId = ''; panelPrismicBrowser.clearSelection(); panelPrismicBrowser.render(); }
  }

  // --- library ------------------------------------------------------------------------
  library = initLibrary(store, {
    document: doc,
    window: win,
    api: api(),
    editing,
    prismicBrowser: panelPrismicBrowser,
    hooks: {
      toast,
      resolvePictos,
      // Identité auteur unifiée avec le châssis (gate/prismic) : une seule source.
      authorName,
      setAuthorName,
      // Modale de saisie générique (réutilise #authorModal via modals.askName).
      askName: (o) => (modals ? modals.askName(o) : null),
      // Onglet Prismic : token de lecture requis ; sinon invite -> config via la modale.
      hasReadToken: () => !!getSettings().prismicToken,
      openPrismicConfig: () => { if (modals) modals.openPrismicImport(); },
    },
  });

  // --- importCode ---------------------------------------------------------------------
  importCode = initImportCode(store, {
    document: doc,
    editing,
    hooks: { toast, closeImportModal: () => { if (modals) modals.closeImportCode(); } },
  });

  // --- preview ------------------------------------------------------------------------
  preview = initPreview(store, {
    document: doc,
    window: win,
    canvas,
    api: api(),
    twConfig: win.EKW_TW,
    siteBg: SITE_BG,
    cleanHTML,
    stateCssForPreview: () => editing.stateCssForPreview(),
    getPending: () => chat.getPending(),
    beforePreview: () => { editing.stopEditing(); editing.deselect(); },
  });

  // --- modals -------------------------------------------------------------------------
  modals = initModals(store, {
    document: doc,
    window: win,
    api: api(),
    exportSlice,
    collectCssRules,
    prismic,
    importCode,
    getSettings,
    authorName,
    toast,
    showLoading: overlay.showLoading,
    hideLoading: overlay.hideLoading,
  });

  // --- toolbar (en-tête + barre d'espace de travail) ----------------------------------
  toolbar = initToolbar(store, history, {
    document: doc,
    undo: doUndo,
    redo: doRedo,
    setMode: (m) => preview.setMode(m),
    setWidth: (w) => preview.setWidth(w),
    setPageWidth: (v) => preview.setPageWidth(v),
    openPrismicImport: () => library.setLibTab('prismic'),
    pushPrismic: (btn) => prismic.push(btn),
    updatePrismic: (btn) => prismic.update(btn),
    openExport: () => { editing.stopEditing(); editing.deselect(); modals.openExport(); },
    openSettings: () => modals.openSettings(),
    newChat: () => newChat(),
  });

  // =====================================================================================
  // GLUE : écouteurs de store, chat, accordéons, bibliothèque, gate.
  // =====================================================================================

  // Forward-note 1 & 2 : restore émet plusieurs `change` → écouteurs idempotents ; après un
  // restore/replaceContent la sélection peut être détachée → on désélectionne.
  store.on('change', () => {
    checkEmpty();
    const sel = editing.getSelected();
    if (sel && !canvas.contains(sel)) editing.deselect();
  });

  // --- chat : envoi, images, raccourcis -----------------------------------------------
  const chatSend = byId('chat-send');
  if (chatSend) chatSend.addEventListener('click', () => chat.sendChat());
  const chatInput = byId('chat-input');
  if (chatInput) {
    chatInput.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); chat.sendChat(); } });
    chatInput.addEventListener('input', () => { chatInput.style.height = 'auto'; chatInput.style.height = Math.min(chatInput.scrollHeight, 160) + 'px'; });
    chatInput.addEventListener('paste', (e) => {
      const items = (e.clipboardData && e.clipboardData.items) || [];
      let got = false;
      for (const it of items) { if (it.type && it.type.indexOf('image') === 0) { const f = it.getAsFile(); if (f) { chat.addChatImageFromFile(f); got = true; } } }
      if (got) e.preventDefault();
    });
  }
  const chatFile = byId('chat-file');
  if (chatFile) chatFile.addEventListener('change', () => { chat.onChatFiles(chatFile.files); chatFile.value = ''; });
  const chatAttach = byId('chat-attach');
  if (chatAttach && chatFile) chatAttach.addEventListener('click', () => chatFile.click());
  const chatFast = byId('chat-fast');
  if (chatFast) chatFast.addEventListener('click', () => { const on = chat.toggleChatFast(); chatFast.classList.toggle('text-[#d97757]', on); chatFast.classList.toggle('bg-[#d97757]/10', on); });
  const chatCtxAction = byId('chat-context-action');
  if (chatCtxAction) chatCtxAction.addEventListener('click', () => chat.toggleTargetMode());
  const chatImages = byId('chat-images');
  if (chatImages) chatImages.addEventListener('click', (e) => { const b = e.target.closest('[data-chatimg-remove]'); if (b) chat.removeChatImage(parseInt(b.dataset.chatimgRemove, 10)); });

  function newChat() {
    chat.resetSession(); // session CLI vierge : prochain sendChat sans --resume, contexte/pending oubliés
    chat.clearTarget();
    const log = byId('chat-log');
    if (log) log.innerHTML = '<div id="chat-welcome" class="text-slate-500 text-xs leading-relaxed"></div>';
    // Canvas intact (reset du chat uniquement).
  }

  // --- bibliothèque : onglets Local / Partagée + rechargement cloud -------------------
  const tabLocal = byId('tab-local');
  if (tabLocal) tabLocal.addEventListener('click', () => library.setLibTab('local'));
  const tabShared = byId('tab-shared');
  if (tabShared) tabShared.addEventListener('click', () => library.setLibTab('shared'));
  const tabPrismic = byId('tab-prismic');
  if (tabPrismic) tabPrismic.addEventListener('click', () => library.setLibTab('prismic'));
  const sharedReload = byId('shared-reload');
  if (sharedReload) sharedReload.addEventListener('click', () => library.loadShared());

  // --- bibliothèque : bouton sauvegarde modale ----------------------------------------
  const saveConfirm = byId('save-confirm');
  if (saveConfirm) saveConfirm.addEventListener('click', () => library.confirmSave());
  byId('saveModal') && byId('saveModal').addEventListener('click', (e) => {
    if (e.target.closest('[data-close-save]')) library.closeSaveModal();
  });
  const saveNameInput = byId('save-name-input');
  if (saveNameInput) saveNameInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); library.confirmSave(); }
    else if (e.key === 'Escape') { library.closeSaveModal(); }
  });

  // --- Échap ferme le modal visible du dessus -----------------------------------------
  // (le champ nom et la modale de sauvegarde gèrent déjà Échap quand ils ont le focus ;
  // ce handler global couvre export, import code, import Prismic, réglages Prismic.)
  doc.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const vis = (id) => { const m = byId(id); return m && !m.classList.contains('hidden'); };
    if (vis('prismicSettingsModal')) modals.closeSettings();
    else if (vis('prismicImportModal')) modals.closePrismicImport();
    else if (vis('importModal')) modals.closeImportCode();
    else if (vis('codeModal')) modals.closeExport();
    else if (vis('saveModal')) library.closeSaveModal();
    else return;
    e.preventDefault();
  });

  // --- accordéons pictos + recherche --------------------------------------------------
  function toggleAcc(bodyId, chevSel, lsKey, defOpen) {
    const b = byId(bodyId); if (!b) return;
    const chev = doc.querySelector(chevSel);
    const open = b.classList.contains('hidden');
    b.classList.toggle('hidden', !open);
    if (chev) chev.classList.toggle('-rotate-90', !open);
    try { if (win.localStorage) win.localStorage.setItem(lsKey, open ? '1' : '0'); } catch (_) { }
  }
  const editorClose = byId('editor-close');
  if (editorClose) editorClose.addEventListener('click', () => editing.deselect());
  const tp = byId('toggle-pictos');
  if (tp) tp.addEventListener('click', () => toggleAcc('picto-body', '[data-picto-chev]', 'ekwa_pictos_open'));
  const tep = byId('toggle-editor-pictos');
  if (tep) tep.addEventListener('click', () => toggleAcc('editor-picto-body', '[data-epicto-chev]', 'ekwa_editor_pictos_open'));
  doc.querySelectorAll('[data-picto-search]').forEach((inp) => inp.addEventListener('input', () => editing.renderPictoGrid(inp.value)));
  // Import de code (modale dormante) : ouverture optionnelle via #btn-import-code.
  const bic = byId('btn-import-code');
  if (bic) bic.addEventListener('click', () => modals.openImportCode());

  // --- thème de l'APPLICATION (clair par défaut | neon optionnel) ---------------------
  // Ne touche QUE le châssis de l'app (variables --app-*), jamais la charte du canvas.
  function applyAppTheme(t) {
    const v = (t === 'neon') ? 'neon' : 'light';
    doc.documentElement.setAttribute('data-app-theme', v);
    try { if (win.localStorage) win.localStorage.setItem('ekwa_app_theme', v); } catch (_) { }
    const btn = byId('btn-theme');
    if (btn) {
      const ic = btn.querySelector('i');
      if (ic) ic.className = 'fa-solid ' + (v === 'neon' ? 'fa-sun' : 'fa-palette');
      btn.title = (v === 'neon') ? 'Thème : Neon Coast — cliquer pour revenir au thème clair' : 'Thème : clair — cliquer pour Neon Coast';
    }
  }
  function storedAppTheme() {
    try { return (win.localStorage && win.localStorage.getItem('ekwa_app_theme')) || ''; } catch (_) { return ''; }
  }
  // Application immédiate (synchrone, évite le flash) ; réconciliée après loadSettings.
  applyAppTheme(storedAppTheme() || 'light');

  // --- gate (connexion Claude) --------------------------------------------------------
  function setGate({ icon, iconClass, title, msg, cmd, btn, login }) {
    const loading = /fa-spinner/.test(icon || '');
    const iw = byId('gate-iconwrap'), gg = byId('gate-gif');
    if (iw) iw.classList.toggle('hidden', loading);
    if (gg) gg.classList.toggle('hidden', !loading);
    const gi = byId('gate-icon'); if (gi) gi.className = 'fa-solid ' + icon + ' text-2xl ' + (iconClass || '');
    const gt = byId('gate-title'); if (gt) gt.textContent = title;
    const gm = byId('gate-msg'); if (gm) gm.textContent = msg;
    const cmdEl = byId('gate-cmd');
    if (cmdEl) { if (cmd) { cmdEl.textContent = cmd; cmdEl.classList.remove('hidden'); } else cmdEl.classList.add('hidden'); }
    const gb = byId('gate-btn'); if (gb) gb.classList.toggle('hidden', !btn);
    const gl = byId('gate-login'); if (gl) gl.classList.toggle('hidden', !login);
  }
  let loginPoll = null;
  function stopLoginPoll() { if (loginPoll) { clearInterval(loginPoll); loginPoll = null; } }
  function startLoginPoll() {
    stopLoginPoll();
    let tries = 0;
    loginPoll = setInterval(async () => {
      tries++;
      const a = api(); if (!a) return;
      let s; try { s = await a.checkClaude(); } catch (_) { s = {}; }
      if (s && s.loggedIn) { stopLoginPoll(); runGate(); }
      else if (tries >= 60) { stopLoginPoll(); runGate(); } // ~3 min puis on réaffiche l'écran
    }, 3000);
  }
  async function runGate() {
    const gate = byId('gate');
    const a = api();
    stopLoginPoll();
    setGate({ icon: 'fa-spinner fa-spin', title: 'Vérification de la connexion…', msg: 'Contrôle de votre compte Claude.' });
    if (!a) { setGate({ icon: 'fa-triangle-exclamation', iconClass: 'text-amber-400', title: 'Lancez via Electron', msg: "Ouvrez l'app avec « npm start », pas dans un navigateur." }); return; }
    let s; try { s = await a.checkClaude(); } catch (_) { s = {}; }
    if (!s.installed) { setGate({ icon: 'fa-download', iconClass: 'text-amber-400', title: 'Claude Code non installé', msg: 'Installez le CLI Claude, puis cliquez sur Réessayer.', cmd: 'curl -fsSL https://claude.ai/install.sh | bash', btn: true }); return; }
    if (!s.loggedIn) {
      const canAuto = !!(a && a.claudeLogin);
      setGate({
        icon: 'fa-right-to-bracket', iconClass: 'text-amber-400', title: 'Connexion requise',
        msg: canAuto
          ? 'Cliquez sur « Se connecter » : un terminal s’ouvre pour vous connecter avec votre compte Ekwateur. Cette fenêtre se mettra à jour automatiquement.'
          : 'Ouvrez un terminal, lancez la commande ci-dessous et connectez-vous avec votre compte Ekwateur, puis cliquez sur Réessayer.',
        cmd: 'claude login', btn: true, login: canAuto,
      });
      return;
    }
    if (gate) gate.style.display = 'none';
    { const gg = byId('gate-gif'); if (gg) gg.removeAttribute('src'); }
    if (!authorName() && s.email) {
      const suggest = (s.email.indexOf('@') > 0) ? s.email.split('@')[0] : '';
      const v = await modals.askName({ title: 'Ton nom (auteur)', label: 'Affiché sur les composants que tu publies', placeholder: 'Ex : Josquin', pre: suggest });
      if (v) await setAuthorName(v);
    }
  }
  // Bascule du thème de l'app (clair <-> neon), persistée (localStorage + settings).
  const themeBtn = byId('btn-theme');
  if (themeBtn) themeBtn.addEventListener('click', () => {
    const cur = doc.documentElement.getAttribute('data-app-theme');
    const next = (cur === 'neon') ? 'light' : 'neon';
    applyAppTheme(next);
    const a = api();
    if (a && a.settingsSet) { try { a.settingsSet({ appTheme: next }); } catch (_) { } }
  });

  const gateBtn = byId('gate-btn');
  if (gateBtn) gateBtn.addEventListener('click', () => runGate());
  const gateLogin = byId('gate-login');
  if (gateLogin) gateLogin.addEventListener('click', async () => {
    const a = api(); if (!a || !a.claudeLogin) return;
    setGate({
      icon: 'fa-spinner fa-spin', title: 'Connexion en cours…',
      msg: 'Un terminal s’est ouvert : connectez-vous avec votre compte Ekwateur (une page web peut s’ouvrir). Cette fenêtre se mettra à jour automatiquement.',
    });
    let r; try { r = await a.claudeLogin(); } catch (_) { r = null; }
    if (r && r.ok === false) {
      setGate({
        icon: 'fa-triangle-exclamation', iconClass: 'text-amber-400', title: 'Terminal introuvable',
        msg: 'Impossible d’ouvrir un terminal automatiquement. Lancez la commande ci-dessous à la main, puis cliquez sur Réessayer.',
        cmd: 'claude login', btn: true,
      });
      return;
    }
    startLoginPoll();
  });

  // =====================================================================================
  // DÉMARRAGE.
  // =====================================================================================
  (async () => {
    await loadSettings();
    // Réconcilie le thème depuis les réglages durables (cross-machine) si défini.
    if (APP_SETTINGS && APP_SETTINGS.appTheme && !storedAppTheme()) applyAppTheme(APP_SETTINGS.appTheme);
    runGate();
    preview.setMode('edit');
    preview.setWidth('desktop');
    preview.applyCanvasWidth();
    library.load();
    // Préchargement Prismic : chauffe le cache + la liste dès le lancement (sans attendre
    // l'ouverture de l'onglet) → affichage instantané. Silencieux, seulement si token présent.
    try { if (getSettings().prismicToken) panelPrismicBrowser.load({ silent: true }); } catch (_) { }
    loadPictos();
    checkEmpty();
    // Accordéons : état initial (pictos ouverts, pictos éditeur fermés).
    try {
      const pOpen = !(win.localStorage && win.localStorage.getItem('ekwa_pictos_open') === '0');
      const pb = byId('picto-body'); const pc = doc.querySelector('[data-picto-chev]');
      if (pb) pb.classList.toggle('hidden', !pOpen); if (pc) pc.classList.toggle('-rotate-90', !pOpen);
      const eOpen = win.localStorage && win.localStorage.getItem('ekwa_editor_pictos_open') === '1';
      const eb = byId('editor-picto-body'); const ec = doc.querySelector('[data-epicto-chev]');
      if (eb) eb.classList.toggle('hidden', !eOpen); if (ec) ec.classList.toggle('-rotate-90', !eOpen);
    } catch (_) { }
    const a = api();
    if (a && a.checkUpdate) { try { const r = await a.checkUpdate(); if (r && r.ok && r.update) showUpdateBanner(r); } catch (_) { } }
  })();

  function showUpdateBanner(r) {
    let b = byId('ekw-update');
    if (!b) { b = doc.createElement('div'); b.id = 'ekw-update'; doc.body.appendChild(b); }
    b.className = 'fixed top-3 left-1/2 -translate-x-1/2 z-[130] flex items-center gap-3 px-4 py-2.5 rounded-xl bg-ink-deep border border-secondary shadow-2xl text-sm';
    b.innerHTML = '<i class="fa-solid fa-arrow-up-right-dots text-secondary"></i>'
      + '<span class="text-cloud">Nouvelle version <b>v' + r.version + '</b> disponible <span class="text-slate-500">(actuelle v' + r.current + ')</span></span>'
      + '<button id="ekw-update-dl" class="text-xs bg-secondary text-ink-deep font-semibold px-3 py-1 rounded-lg hover:brightness-110"><i class="fa-solid fa-download mr-1"></i>Télécharger</button>'
      + '<button id="ekw-update-x" class="text-slate-400 hover:text-cloud px-1" title="Plus tard"><i class="fa-solid fa-xmark"></i></button>';
    const a = api();
    b.querySelector('#ekw-update-dl').onclick = () => { if (a && a.openExternal) a.openExternal(r.download || r.url); };
    b.querySelector('#ekw-update-x').onclick = () => b.remove();
  }

  // Exposé pour debug/tests.
  const app = { store, history, editing, chat, prismic, library, importCode, preview, modals, toolbar, overlay };
  win.__ekw = app;
  return app;
}

// Auto-boot quand le DOM est prêt (sauf si l'hôte demande un boot manuel).
if (typeof document !== 'undefined' && !(typeof globalThis !== 'undefined' && globalThis.__EKW_NO_AUTOBOOT)) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => boot());
  else boot();
}
