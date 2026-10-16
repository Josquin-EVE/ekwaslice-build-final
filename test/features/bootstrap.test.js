import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDom } from '../helpers/dom.js';

// Smoke test du keystone d'intégration (Task 12) : boot() câble tout le cœur canvas-content
// sous jsdom. On ne lance pas Electron : l'IPC (window.api) est absent, on exerce donc le
// chemin « chat » via chat.renderAssistant (qui applique la réponse par le store, sans IPC).
// Empêche l'auto-boot au moment de l'import (DOM pas encore prêt).
globalThis.__EKW_NO_AUTOBOOT = true;

// Squelette DOM minimal mais réaliste (ids attendus par boot/les features ; tout est gardé).
const SKELETON = `<!doctype html><html><head></head><body>
  <div id="gate"></div><div id="gate-iconwrap"></div><i id="gate-icon"></i><img id="gate-gif">
  <h2 id="gate-title"></h2><p id="gate-msg"></p><div id="gate-cmd"></div><button id="gate-btn"></button>
  <div id="ekw-loading"></div><p id="ekw-loading-msg"></p>
  <button id="btn-import-prismic"></button><button id="btn-push-prismic"></button>
  <button id="prismic-update-btn"></button><button id="btn-export"></button><button id="btn-settings"></button>
  <div id="library-panel"></div>
  <button id="toggle-pictos"></button><i data-picto-chev></i>
  <input data-picto-search><div data-picto-grid></div>
  <div id="comp-grid"></div>
  <div id="editor-panel"></div><button id="editor-close"></button>
  <div id="editor-nav"></div><div id="editor-elctx"></div><div id="editor-crumbs"></div>
  <div id="editor-format"></div><div id="editor-states"></div><div id="editor-state-hint"></div>
  <div id="editor-style"></div>
  <button data-mode="edit" class="mode-btn"></button><button data-mode="preview" class="mode-btn"></button>
  <button id="btn-undo"></button><button id="btn-redo"></button>
  <select id="page-width"><option value="1080">1080</option><option value="712">712</option></select>
  <div id="width-chips"></div>
  <button data-w="desktop" class="w-btn"></button>
  <div id="editor-actions"></div>
  <div id="canvas-scroll"><div id="canvas-fit"><div id="canvas">
    <div id="empty-state"></div>
  </div></div></div>
  <div id="device-stage"><iframe id="device-frame"></iframe></div>
  <div id="gen-overlay"><div id="gen-lottie"></div></div>
  <div id="chat-log"><div id="chat-welcome"></div></div>
  <div id="chat-context"></div><span id="chat-context-label"></span><i id="chat-context-icon"></i>
  <button id="chat-context-action"></button><div id="chat-images"></div>
  <input id="chat-file"><button id="chat-attach"></button><button id="chat-fast"></button>
  <textarea id="chat-input"></textarea><button id="chat-send"></button><button id="btn-new-chat"></button>
  <div id="authorModal"></div><span id="author-modal-title"></span><label id="author-modal-label"></label>
  <input id="author-name-input"><button id="author-confirm"></button><button id="author-cancel"></button><button id="author-close"></button>
  <div id="codeModal"></div><pre id="out-html"></pre><pre id="out-css"></pre><pre id="out-js"></pre>
</body></html>`;

const CODE_BLOCK = (inner) => 'ok\n```html\n' + inner + '\n```';

async function setup() {
  const env = withDom(SKELETON);
  if (!env.window.requestAnimationFrame) env.window.requestAnimationFrame = (cb) => setTimeout(() => cb(Date.now()), 0);
  const { boot } = await import('../../src/bootstrap.js');
  const app = boot({ document: env.document, window: env.window });
  return { ...env, app };
}

test('boot() renvoie un handle non-null avec tous les modules câblés', async () => {
  const { cleanup, app } = await setup();
  try {
    assert.ok(app, 'boot() doit renvoyer un handle');
    for (const k of ['store', 'history', 'editing', 'chat', 'prismic', 'library', 'importCode', 'preview', 'modals', 'toolbar', 'overlay']) {
      assert.ok(app[k], 'module manquant : ' + k);
    }
  } finally { cleanup(); }
});

test('chemin chat (renderAssistant) : une réponse code ajoute une slice au store + au canvas', async () => {
  const { cleanup, app, document } = await setup();
  try {
    const canvas = document.getElementById('canvas');
    const empty = document.getElementById('empty-state');
    const before = app.store.list().length;
    app.chat.renderAssistant(CODE_BLOCK('<div class="p-4"><h2>Hello</h2></div>'), null);
    assert.equal(app.store.list().length, before + 1, 'une slice doit être ajoutée via le store');
    const slice = app.store.list()[app.store.list().length - 1];
    assert.ok(canvas.contains(slice.root), 'la racine de la slice doit être dans le canvas');
    assert.equal(empty.style.display, 'none', 'empty-state masqué (écouteur change idempotent)');
  } finally { cleanup(); }
});

test('newChat() réinitialise la session + le pending et vide le log, sans toucher au canvas', async () => {
  const { cleanup, app, document } = await setup();
  try {
    const canvas = document.getElementById('canvas');
    // Génère une slice, puis arme un candidat (pending) via une réponse ciblée.
    app.chat.renderAssistant(CODE_BLOCK('<div class="p-4"><h2>Base</h2></div>'), null);
    const root = app.store.list()[0].root;
    app.chat.renderAssistant(CODE_BLOCK('<div class="p-4"><h2>Edit</h2></div>'), root);
    assert.ok(app.chat.getPending(), 'un candidat doit être en attente avant le reset');
    const sliceCount = app.store.list().length;

    document.getElementById('btn-new-chat').click(); // câblé par la toolbar → boot.newChat()

    assert.equal(app.chat.getPending(), null, 'pending réinitialisé');
    assert.equal(app.chat.getSessionId(), null, 'session CLI réinitialisée (prochain sendChat sans --resume)');
    assert.equal(app.store.list().length, sliceCount, 'canvas INTACT (reset du chat seul)');
    assert.ok(canvas.contains(root), 'la slice reste dans le canvas');
    const log = document.getElementById('chat-log');
    assert.ok(log.querySelector('#chat-welcome'), 'log vidé vers l’accueil');
    assert.ok(!/Base|Edit/.test(log.textContent), 'anciennes bulles effacées');
  } finally { cleanup(); }
});
