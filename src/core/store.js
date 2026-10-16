// SliceStore : autorité unique sur #canvas. Toute mutation structurelle de la
// liste de slices (ajout, retrait, ordre, remplacement de contenu) passe ici ;
// le DOM du canvas et la liste ordonnée restent synchrones par construction.
import { createSliceRoot, serializeSlice } from './slice.js';

// Identité d'un document Prismic : jamais héritée par une copie.
const PRISMIC_IDENTITY_KEYS = ['prismicId', 'prismicTitle', 'prismicField', 'baseVersion', 'prismicUid'];

export class SliceStore {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this._slices = [];            // ordre = ordre DOM
    this._byRoot = new Map();     // root (enfant direct du canvas) -> slice
    this._listeners = new Set();
    this._seq = 0;
  }

  // --- événements -----------------------------------------------------------

  on(type, cb) {
    if (type === 'change') this._listeners.add(cb);
  }

  off(type, cb) {
    if (type === 'change') this._listeners.delete(cb);
  }

  _emit() {
    for (const cb of [...this._listeners]) cb();
  }

  // --- lecture --------------------------------------------------------------

  get(id) {
    return this._slices.find((s) => s.id === id) || null;
  }

  // Slice propriétaire de n'importe quel descendant : on remonte jusqu'à l'enfant
  // direct du canvas (robuste aux wrappers [data-comp] imbriqués).
  sliceOf(node) {
    let n = node || null;
    while (n && n.parentNode !== this.canvas) n = n.parentNode;
    return (n && this._byRoot.get(n)) || null;
  }

  list() {
    return this._slices.slice();
  }

  serialize() {
    return this._slices.map((s, order) => ({
      id: s.id,
      html: serializeSlice(s),
      origin: s.origin,
      meta: { ...s.meta },
      order,
    }));
  }

  // --- mutations ------------------------------------------------------------

  _register(root, origin, meta) {
    this._seq += 1;
    return { id: 's' + this._seq, root, origin, meta: { ...meta } };
  }

  add(html, origin = 'generated', meta = {}) {
    const root = createSliceRoot(html, { origin, meta });
    const slice = this._register(root, origin, meta);
    this.canvas.appendChild(root);
    this._slices.push(slice);
    this._byRoot.set(root, slice);
    this._emit();
    return slice;
  }

  remove(id) {
    const i = this._slices.findIndex((s) => s.id === id);
    if (i < 0) return;
    const [slice] = this._slices.splice(i, 1);
    this._byRoot.delete(slice.root);
    slice.root.remove();
    this._emit();
  }

  move(id, dir) {
    const i = this._slices.findIndex((s) => s.id === id);
    const j = dir === 'up' ? i - 1 : dir === 'down' ? i + 1 : -1;
    if (i < 0 || j < 0 || j >= this._slices.length) return;
    const [slice] = this._slices.splice(i, 1);
    this._slices.splice(j, 0, slice);
    const next = this._slices[j + 1];
    this.canvas.insertBefore(slice.root, next ? next.root : null);
    this._emit();
  }

  duplicate(id) {
    const i = this._slices.findIndex((s) => s.id === id);
    if (i < 0) return null;
    const src = this._slices[i];
    // Le contenu de la copie vient du sérialiseur : même chemin que l'export.
    const meta = { ...src.meta };
    for (const k of PRISMIC_IDENTITY_KEYS) delete meta[k];
    const root = createSliceRoot(serializeSlice(src), { origin: src.origin, meta });
    const slice = this._register(root, src.origin, meta);
    this._slices.splice(i + 1, 0, slice);
    this._byRoot.set(root, slice);
    this.canvas.insertBefore(root, src.root.nextSibling);
    this._emit();
    return slice;
  }

  // Remplace le contenu de la racine existante : la racine (donc ses attributs
  // data-remote-*, data-eid…), le meta, l'origine et l'id de slice sont conservés.
  replaceContent(id, html) {
    const slice = this.get(id);
    if (!slice) return null;
    const fresh = createSliceRoot(html, { origin: slice.origin, meta: slice.meta });
    slice.root.replaceChildren(...fresh.childNodes);
    this._emit();
    return slice;
  }

  clear() {
    this._slices = [];
    this._byRoot.clear();
    this.canvas.replaceChildren();
    this._emit();
  }

  // Édition de contenu hors store (inspecteur, chat) : notifie sans muter.
  touch(id) {
    if (this.get(id)) this._emit();
  }
}
