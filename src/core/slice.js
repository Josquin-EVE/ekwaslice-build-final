// Construction et nettoyage de la racine d'une slice (un seul chemin, remplace
// mountSlice / cleanForSave / cleanHTML / exportPlain historiques).
// Pur DOM : aucun montage de pictos ni régénération des styles d'états ici.

// Mapping meta → attributs d'identité Prismic posés sur la racine.
const IDENTITY_ATTRS = [
  ['prismicId', 'data-remote-id'],
  ['prismicTitle', 'data-remote-title'],
  ['prismicField', 'data-remote-field'],
  ['baseVersion', 'data-base-version'],
  ['prismicUid', 'data-remote-uid'],
];

let eidCounter = 0;

// Id court et unique : préfixe 'e' (format historique) + aléa + compteur de module.
export function newEid() {
  eidCounter += 1;
  return 'e' + Math.random().toString(36).slice(2, 6) + eidCounter.toString(36);
}

// Retire les artefacts d'édition du noeud et de ses descendants.
export function cleanArtifacts(node) {
  const all = [node, ...node.querySelectorAll('*')];
  for (const el of all) {
    el.classList.remove('ekw-selected', 'ekw-editing');
    el.removeAttribute('contenteditable');
    el.removeAttribute('data-ekw-pending');
  }
  node.querySelectorAll('.drag-handle, button[onclick*="remove"]').forEach((el) => el.remove());
}

// Construit la racine d'une slice : div[data-comp="1"].relative contenant `html`.
// `origin` fait partie du contrat d'appel du store ; il n'a pas d'effet DOM ici.
export function createSliceRoot(html, { origin, meta = {} } = {}) {
  const root = document.createElement('div');
  root.setAttribute('data-comp', '1');
  root.classList.add('relative');
  root.innerHTML = html;

  cleanArtifacts(root);

  // Les data-eid du html source sont ignorés : on en mint de neufs pour que deux
  // instances d'une même slice ne partagent jamais leurs règles d'états.
  root.querySelectorAll('[data-ekw-states]').forEach((el) => el.setAttribute('data-eid', newEid()));

  for (const [key, attr] of IDENTITY_ATTRS) {
    const value = meta[key];
    if (value !== undefined && value !== null && value !== '') root.setAttribute(attr, String(value));
  }
  return root;
}

// Point d'entrée unique de sérialisation : html stocké / exporté d'une slice.
// Retourne le contenu de la racine (pas l'enveloppe div[data-comp]) ; le root vivant n'est jamais muté.
// - origin 'imported' : verbatim (<style>, <script type="text/ekw-js">, data-remote-*…), seuls les
//   artefacts d'édition sont retirés ; aucun scope/compile/renommage, aucun autre nettoyage.
// - sinon (generated/code/library) : html auteur canonique. En plus des artefacts d'édition, on retire
//   les résidus de drag et les wrappers [data-comp] imbriqués (data-comp, draggable, opacity-40,
//   relative), comme le faisaient cleanForSave/cleanHTML — uniquement sur ces wrappers, car
//   `opacity-40`/`relative` sont des classes Tailwind légitimes ailleurs dans le contenu auteur.
export function serializeSlice(slice) {
  const clone = slice.root.cloneNode(true);
  cleanArtifacts(clone);
  if (slice.origin !== 'imported') {
    clone.querySelectorAll('[data-comp]').forEach((el) => {
      el.removeAttribute('data-comp');
      el.removeAttribute('draggable');
      el.classList.remove('opacity-40', 'relative');
      if (!el.classList.length) el.removeAttribute('class');
    });
  }
  return clone.innerHTML;
}
