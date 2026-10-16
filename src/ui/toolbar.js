// Barre d'outils de l'espace de travail + boutons d'en-tête (chrome statique).
// Câble les contrôles globaux (mode Édition/Aperçu, Annuler/Rétablir, largeurs device,
// gabarit de page) et les actions d'en-tête (Import/Envoi/MAJ Prismic, Export, Réglages).
// Les actions élément (monter/descendre/dupliquer/supprimer/cibler/sauver) sont câblées
// PAR editing.js sur #editor-actions ; ce module ne les touche pas.
//
// Toutes les actions passent par des callbacks de `ctx` → aucune dépendance directe aux
// features. L'état des boutons Annuler/Rétablir suit le store via un écouteur idempotent.
//
// initToolbar(store, history, ctx) -> { updateUndoButtons, dispose }
//   ctx.document ; callbacks : undo, redo, setMode, setWidth, setPageWidth,
//     openPrismicImport, pushPrismic, updatePrismic, openExport, openSettings, newChat.

export function initToolbar(store, history, ctx = {}) {
  const doc = ctx.document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
  const byId = (id) => (doc ? doc.getElementById(id) : null);
  const disposers = [];
  const listen = (t, type, h, opts) => { if (t && t.addEventListener) { t.addEventListener(type, h, opts); disposers.push(() => t.removeEventListener(type, h, opts)); } };
  const cb = (name, ...args) => { const fn = ctx[name]; if (typeof fn === 'function') return fn(...args); };

  // --- Annuler / Rétablir : état idempotent sur `change` -------------------------------
  function updateUndoButtons() {
    const u = byId('btn-undo');
    const r = byId('btn-redo');
    if (u) u.disabled = !history.canUndo();
    if (r) r.disabled = !history.canRedo();
  }
  const u = byId('btn-undo');
  const r = byId('btn-redo');
  if (u) listen(u, 'click', () => cb('undo'));
  if (r) listen(r, 'click', () => cb('redo'));
  store.on('change', updateUndoButtons);
  disposers.push(() => store.off('change', updateUndoButtons));

  // --- Mode Édition / Aperçu ----------------------------------------------------------
  doc && doc.querySelectorAll('.mode-btn').forEach((b) => listen(b, 'click', () => cb('setMode', b.dataset.mode)));
  // --- Largeurs device ----------------------------------------------------------------
  doc && doc.querySelectorAll('.w-btn').forEach((b) => listen(b, 'click', () => cb('setWidth', b.dataset.w)));
  // --- Gabarit de page ----------------------------------------------------------------
  const pw = byId('page-width');
  if (pw) listen(pw, 'change', () => cb('setPageWidth', pw.value));

  // --- Boutons d'en-tête (actions globales) -------------------------------------------
  const header = [
    ['btn-import-prismic', 'openPrismicImport'],
    ['btn-push-prismic', 'pushPrismic'],
    ['prismic-update-btn', 'updatePrismic'],
    ['btn-export', 'openExport'],
    ['btn-settings', 'openSettings'],
    ['btn-new-chat', 'newChat'],
  ];
  header.forEach(([id, name]) => {
    const el = byId(id);
    if (el) listen(el, 'click', () => cb(name, el));
  });

  updateUndoButtons();

  return {
    updateUndoButtons,
    dispose() { while (disposers.length) { try { disposers.pop()(); } catch (_) { } } },
  };
}
