import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDom } from '../helpers/dom.js';
import { SliceStore } from '../../src/core/store.js';
import { serializeSlice } from '../../src/core/slice.js';
import { initLibrary } from '../../src/features/library.js';
import { initPrismicBrowser } from '../../src/ui/prismic-browser.js';

const PAGE = '<!doctype html><html><body><div id="canvas"></div>'
  + '<button id="tab-local"></button><button id="tab-shared"></button><button id="tab-prismic"></button><button id="shared-reload" class="hidden"></button>'
  + '<div id="comp-grid" class="flex"></div>'
  + '<div id="shared-grid" class="hidden"></div>'
  + '<div id="prismic-grid" class="hidden"></div>'
  + '<div id="saveModal" class="hidden"></div>'
  + '<input id="save-name-input"><div id="save-overwrite-row" class="hidden"></div>'
  + '<input id="save-overwrite" type="checkbox"><b id="save-overwrite-name"></b></body></html>';

// Faux IPC en mémoire (même forme que main.js : {list} | {error}).
function fakeApi(initial = []) {
  const state = { list: initial.slice(), saved: [], deleted: [] };
  return {
    state,
    libraryList: async () => state.list.slice(),
    librarySave: async (item) => {
      state.saved.push(item);
      const id = item.id || 'c-' + (state.list.length + 1);
      const i = state.list.findIndex((x) => x.id === id);
      const rec = { ...(i >= 0 ? state.list[i] : {}), ...item, id };
      if (i >= 0) state.list[i] = rec; else state.list.unshift(rec);
      return { list: state.list.slice() };
    },
    libraryDelete: async (id) => { state.deleted.push(id); state.list = state.list.filter((x) => x.id !== id); return { list: state.list.slice() }; },
  };
}

function setup(opts = {}) {
  const env = withDom(PAGE);
  const store = new SliceStore(env.document.getElementById('canvas'));
  const api = fakeApi(opts.items);
  const sel = { el: null }; const selected = []; const toasts = [];
  let prismicBrowser = null;
  if (opts.prismicApi) {
    prismicBrowser = initPrismicBrowser({
      document: env.document, window: env.window, api: opts.prismicApi,
      buildThumbDoc: () => '', onPick: opts.onPrismicPick || (() => {}),
    });
  }
  const flags = {};
  const lib = initLibrary(store, {
    document: env.document, window: env.window, api,
    editing: { getSelected: () => sel.el, deselect: () => { sel.el = null; }, selectElement: (el) => { sel.el = el; selected.push(el); } },
    prismicBrowser,
    hooks: {
      toast: (m) => toasts.push(m), confirm: () => opts.confirm !== false,
      hasReadToken: () => !!opts.hasReadToken,
      openPrismicConfig: () => { flags.configOpened = true; },
    },
  });
  return { ...env, store, api, lib, sel, selected, toasts, flags };
}

test('saveComponent -> confirmSave : sauvegarde serializeSlice (html propre, sans wrapper/artefacts) de la slice sélectionnée', async () => {
  const t = setup();
  try {
    t.store.add('<p>autre</p>');
    const s = t.store.add('<h2>Mon titre</h2><p class="ekw-selected" contenteditable="true">x</p>', 'generated');
    t.sel.el = s.root.querySelector('p'); // sélection = descendant -> remonte à la slice
    assert.equal(t.lib.saveComponent(), true);
    const name = t.document.getElementById('save-name-input');
    assert.equal(name.value, 'Mon titre');                                    // nom suggéré
    assert.ok(t.document.getElementById('saveModal').classList.contains('flex'));
    assert.equal(await t.lib.confirmSave(), true);
    assert.equal(t.api.state.saved.length, 1);
    const item = t.api.state.saved[0];
    assert.equal(item.name, 'Mon titre');
    // html = serializeSlice : ni data-comp ni artefacts d'édition (un class="" résiduel vient du core)
    assert.equal(item.html, serializeSlice(s));
    assert.match(item.html, /^<h2>Mon titre<\/h2><p( class="")?>x<\/p>$/);
    assert.ok(!/data-comp|contenteditable|ekw-selected/.test(item.html));
    assert.equal(item.id, undefined);                                          // nouveau item
    assert.equal(t.lib.getItems().length, 1);
    assert.ok(t.document.getElementById('saveModal').classList.contains('hidden'));
    assert.equal(t.document.querySelectorAll('#comp-grid > div').length, 1);  // grille rafraîchie
  } finally { t.cleanup(); }
});

test('saveComponent : rien de sélectionné -> toast, pas de modale ni d\'écriture', async () => {
  const t = setup();
  try {
    t.store.add('<p>a</p>');
    assert.equal(t.lib.saveComponent(), false);
    assert.deepEqual(t.toasts, ['Sélectionnez un bloc à sauvegarder']);
    assert.equal(await t.lib.confirmSave(), false);
    assert.equal(t.api.state.saved.length, 0);
  } finally { t.cleanup(); }
});

test('insert : store.add(html,"library",{libId}) ; sélectionne la nouvelle racine', async () => {
  const t = setup({ items: [{ id: 'c-9', name: 'Hero', html: '<section>Hero</section>' }] });
  try {
    const calls = [];
    const origAdd = t.store.add.bind(t.store);
    t.store.add = (html, origin, meta) => { calls.push({ html, origin, meta }); return origAdd(html, origin, meta); };
    await t.lib.load();
    const s = t.lib.insert(t.lib.getItems()[0]);
    assert.deepEqual(calls, [{ html: '<section>Hero</section>', origin: 'library', meta: { libId: 'c-9' } }]);
    assert.equal(s.origin, 'library');
    assert.equal(s.meta.libId, 'c-9');
    assert.equal(t.store.list().length, 1);
    assert.deepEqual(t.selected, [s.root]);
  } finally { t.cleanup(); }
});

test('clic sur une vignette insère ; clic sur la croix supprime sans insérer', async () => {
  const t = setup({ items: [{ id: 'c-1', name: 'A', html: '<p>A</p>' }] });
  try {
    await t.lib.load();
    const card = t.document.querySelector('#comp-grid > div');
    card.click();
    assert.equal(t.store.list().length, 1);
    card.querySelector('[data-del]').click();
    await new Promise((r) => setTimeout(r, 0));
    assert.equal(t.store.list().length, 1);            // pas de seconde insertion
    assert.deepEqual(t.api.state.deleted, ['c-1']);
    assert.equal(t.lib.getItems().length, 0);
  } finally { t.cleanup(); }
});

test('slice issue de la biblio : sauvegarde propose l\'écrasement et envoie l\'id d\'origine', async () => {
  const t = setup({ items: [{ id: 'c-7', name: 'Bandeau', html: '<p>v1</p>' }] });
  try {
    await t.lib.load();
    const s = t.lib.insert(t.lib.getItems()[0]);
    s.root.querySelector('p').textContent = 'v2';
    t.sel.el = s.root;
    t.lib.saveComponent();
    assert.equal(t.document.getElementById('save-name-input').value, 'Bandeau');
    assert.ok(t.document.getElementById('save-overwrite').checked);
    await t.lib.confirmSave();
    assert.equal(t.api.state.saved[0].id, 'c-7');
    assert.equal(t.api.state.saved[0].html, '<p>v2</p>');
    assert.equal(t.lib.getItems().length, 1);          // écrasé, pas dupliqué
  } finally { t.cleanup(); }
});

// --- Bibliothèque PARTAGÉE (Google Sheets) -----------------------------------------------

test('loadShared peuple la grille partagee depuis l API (1 row, sans owner_key)', async () => {
  const t = setup();
  try {
    t.api.gsheetKeyStatus = async () => ({ present: true });
    t.api.sharedList = async () => ({ list: [{ id: 's1', name: 'Hero partagé', author: 'Jo', html: '<b>x</b>' }] });
    await t.lib.loadShared();
    const sg = t.document.getElementById('shared-grid');
    assert.equal(sg.querySelectorAll('[data-shared-card]').length, 1);
  } finally { t.cleanup(); }
});

test('publish sans cle declenche le prompt d import (NO_KEY)', async () => {
  const t = setup();
  try {
    t.api.settingsGet = async () => ({ author: 'Jo' }); // auteur défini -> pas de modale de nom
    let imported = false;
    t.api.sharedPublish = async () => ({ error: 'NO_KEY' });
    t.api.gsheetImportKey = async () => { imported = true; return { error: 'CANCELLED' }; };
    await t.lib.publish({ name: 't', html: '<i>x</i>' });
    assert.equal(imported, true);
  } finally { t.cleanup(); }
});

// --- Onglet Prismic (3ᵉ source dans le hub) ----------------------------------------------

test('setLibTab(prismic) monte et peuple la grille Prismic (token present)', async () => {
  const t = setup({
    hasReadToken: true,
    prismicApi: { listPrismicSlices: async () => ({ ok: true, slices: [{ id: 'p1', name: 'Slice', html: '<b>x</b>' }] }) },
  });
  try {
    t.lib.setLibTab('prismic');
    await new Promise((r) => setTimeout(r, 0)); // load() est async
    const pg = t.document.getElementById('prismic-grid');
    assert.equal(pg.classList.contains('hidden'), false);
    assert.equal(pg.querySelectorAll('[data-slice-id]').length, 1);
  } finally { t.cleanup(); }
});

test('setLibTab(prismic) sans token : invite a configurer, pas de crash', () => {
  const t = setup({ hasReadToken: false });
  try {
    t.lib.setLibTab('prismic');
    const pg = t.document.getElementById('prismic-grid');
    assert.equal(pg.classList.contains('hidden'), false);
    assert.match(pg.textContent, /token/i);
    const cfg = pg.querySelector('[data-prismic-config]');
    assert.ok(cfg);
    cfg.click();
    assert.equal(t.flags.configOpened, true);
  } finally { t.cleanup(); }
});

test('remove : refus de confirmation -> aucune suppression', async () => {
  const t = setup({ items: [{ id: 'c-1', name: 'A', html: '<p>A</p>' }], confirm: false });
  try {
    await t.lib.load();
    assert.equal(await t.lib.remove('c-1'), false);
    assert.deepEqual(t.api.state.deleted, []);
    assert.equal(t.lib.getItems().length, 1);
  } finally { t.cleanup(); }
});
