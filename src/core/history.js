// Historique undo/redo par snapshots du store (remplace l'ancien undo destructif
// `canvas.innerHTML = snapshot`, qui invalidait toutes les références vivantes).
// Un snapshot = store.serialize() : [{ id, html, origin, meta, order }].
// restore() réconcilie le store par diff sur l'id + html : seules les slices
// absentes/nouvelles/changées sont touchées, les inchangées gardent leur objet
// Slice et leur racine (sélection, édition en cours restent valides).

import { serializeSlice } from './slice.js';

const DEFAULT_DELAY = 400;
const DEFAULT_LIMIT = 100;

// data-eid est re-minté à chaque construction de racine (createSliceRoot) : il ne
// constitue pas une différence de contenu, sinon toute slice reconstruite
// apparaîtrait « changée » à l'undo/redo suivant.
function normalizeHtml(html) {
  return html.replace(/data-eid="[^"]*"/g, 'data-eid=""');
}

function key(snap) {
  return JSON.stringify(snap.map((e) => [e.id, normalizeHtml(e.html), e.origin, e.meta]));
}

function sameMeta(a, b) {
  return JSON.stringify(a || {}) === JSON.stringify(b || {});
}

export class History {
  constructor(store, { delay = DEFAULT_DELAY, limit = DEFAULT_LIMIT } = {}) {
    this.store = store;
    this.delay = delay;
    this.limit = limit;
    this._stack = [];
    this._keys = [];
    this._index = -1;
    this._timer = null;
    this._suspended = 0;     // rafales d'édition (suspend/resume) + restore en cours
    this._restoring = false;
    this._push(store.serialize());
    this._onChange = () => this._schedule();
    store.on('change', this._onChange);
  }

  dispose() {
    this.store.off('change', this._onChange);
    this._cancel();
  }

  // --- pile ---------------------------------------------------------------

  _push(snap) {
    const k = key(snap);
    if (k === this._keys[this._index]) return false;
    // Nouvelle branche : le redo est abandonné.
    this._stack.length = this._index + 1;
    this._keys.length = this._index + 1;
    this._stack.push(snap);
    this._keys.push(k);
    if (this._stack.length > this.limit) {
      this._stack.shift();
      this._keys.shift();
    }
    this._index = this._stack.length - 1;
    return true;
  }

  // Chemin synchrone (tests, appels explicites) ; le debounce y aboutit aussi.
  snapshot() {
    this._cancel();
    return this._push(this.store.serialize());
  }

  canUndo() {
    return this._timer !== null || this._index > 0;
  }

  canRedo() {
    return this._timer === null && this._index < this._stack.length - 1;
  }

  undo() {
    this._flush();
    if (this._index <= 0) return false;
    this._index -= 1;
    this.restore(this._stack[this._index]);
    return true;
  }

  redo() {
    this._flush();
    if (this._index >= this._stack.length - 1) return false;
    this._index += 1;
    this.restore(this._stack[this._index]);
    return true;
  }

  // --- debounce / rafales -------------------------------------------------

  _schedule() {
    if (this._suspended || this._restoring) return;
    this._cancel();
    this._timer = setTimeout(() => {
      this._timer = null;
      this._push(this.store.serialize());
    }, this.delay);
  }

  _cancel() {
    if (this._timer !== null) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  // Un snapshot en attente est capturé avant tout undo/redo.
  _flush() {
    if (this._timer !== null) this.snapshot();
  }

  // Rafale d'édition d'état (équivalent de l'ancien _suspendHistory) : aucun
  // snapshot intermédiaire ; resume() en planifie un seul pour toute la rafale.
  suspend() {
    this._suspended += 1;
    this._cancel();
  }

  resume() {
    if (this._suspended > 0) this._suspended -= 1;
    if (!this._suspended) this._schedule();
  }

  // --- restauration -------------------------------------------------------

  // Réconcilie le store avec `snap` en composant add/insertAt/remove/replaceContent/move.
  // N'altère pas la pile : undo()/redo() déplacent seulement l'index.
  restore(snap) {
    const store = this.store;
    this._restoring = true;
    try {
      const wanted = new Set(snap.map((e) => e.id));
      for (const s of store.list()) if (!wanted.has(s.id)) store.remove(s.id);

      // Invariant : à l'étape i, les positions 0..i-1 sont déjà finales.
      snap.forEach((entry, i) => {
        let cur = store.get(entry.id);
        if (cur && (cur.origin !== entry.origin || !sameMeta(cur.meta, entry.meta))) {
          // Identité (origine/meta → attributs data-remote-* de la racine) : on reconstruit.
          store.remove(cur.id);
          cur = null;
        }
        if (!cur) {
          store.insertAt(i, entry);
          return;
        }
        // Inchangée (même html) : on ne touche à rien — même objet Slice, même racine.
        if (normalizeHtml(serializeSlice(cur)) !== normalizeHtml(entry.html)) {
          store.replaceContent(cur.id, entry.html);
        }
        let at = store.list().findIndex((s) => s.id === entry.id);
        while (at > i) { store.move(entry.id, 'up'); at -= 1; }
      });
    } finally {
      this._restoring = false;
    }
  }
}
