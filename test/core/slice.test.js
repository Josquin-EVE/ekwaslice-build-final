import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDom } from '../helpers/dom.js';
import { createSliceRoot, cleanArtifacts, newEid } from '../../src/core/slice.js';

test('createSliceRoot construit la racine div[data-comp] et injecte le html', () => {
  const { cleanup } = withDom();
  try {
    const root = createSliceRoot('<p>x</p>', { origin: 'generated', meta: {} });
    assert.equal(root.tagName, 'DIV');
    assert.equal(root.hasAttribute('data-comp'), true);
    assert.equal(root.getAttribute('data-comp'), '1');
    assert.equal(root.classList.contains('relative'), true);
    assert.equal(root.querySelector('p').textContent, 'x');
  } finally {
    cleanup();
  }
});

test('createSliceRoot applique les attributs d\'identité Prismic depuis meta', () => {
  const { cleanup } = withDom();
  try {
    const root = createSliceRoot('<p>x</p>', {
      origin: 'prismic',
      meta: { prismicId: 'A', prismicField: 'html_only', prismicTitle: 'Ma slice', prismicUid: 'u1', baseVersion: 'v9' },
    });
    assert.equal(root.getAttribute('data-remote-id'), 'A');
    assert.equal(root.getAttribute('data-remote-field'), 'html_only');
    assert.equal(root.getAttribute('data-remote-title'), 'Ma slice');
    assert.equal(root.getAttribute('data-remote-uid'), 'u1');
    assert.equal(root.getAttribute('data-base-version'), 'v9');

    const bare = createSliceRoot('<p>x</p>', { origin: 'generated', meta: {} });
    for (const a of ['data-remote-id', 'data-remote-field', 'data-remote-title', 'data-remote-uid', 'data-base-version']) {
      assert.equal(bare.hasAttribute(a), false, a + ' ne doit pas être posé sans meta');
    }
  } finally {
    cleanup();
  }
});

test('createSliceRoot retire les artefacts d\'édition', () => {
  const { cleanup } = withDom();
  try {
    const html = '<div class="a ekw-selected ekw-editing" contenteditable="true" data-ekw-pending="1">'
      + '<span class="drag-handle">::</span>'
      + '<button onclick="removeComp(this)">x</button>'
      + '<button onclick="go()">ok</button>'
      + '<p contenteditable="false">t</p></div>';
    const root = createSliceRoot(html, { origin: 'generated', meta: {} });
    const a = root.querySelector('.a');
    assert.equal(a.classList.contains('ekw-selected'), false);
    assert.equal(a.classList.contains('ekw-editing'), false);
    assert.equal(a.classList.contains('a'), true);
    assert.equal(root.querySelector('[contenteditable]'), null);
    assert.equal(root.querySelector('[data-ekw-pending]'), null);
    assert.equal(root.querySelector('.drag-handle'), null);
    assert.equal(root.querySelector('button[onclick*="remove"]'), null);
    assert.equal(root.querySelectorAll('button').length, 1);
  } finally {
    cleanup();
  }
});

test('createSliceRoot mint des data-eid neufs, différents entre deux appels', () => {
  const { cleanup } = withDom();
  try {
    const html = '<a data-ekw-states="hover" data-eid="old" class="b">l</a><span>plain</span>';
    const r1 = createSliceRoot(html, { origin: 'generated', meta: {} });
    const r2 = createSliceRoot(html, { origin: 'generated', meta: {} });
    const e1 = r1.querySelector('[data-ekw-states]').getAttribute('data-eid');
    const e2 = r2.querySelector('[data-ekw-states]').getAttribute('data-eid');
    assert.ok(e1 && e2);
    assert.notEqual(e1, 'old');
    assert.notEqual(e2, 'old');
    assert.notEqual(e1, e2);
    assert.equal(r1.querySelector('span').hasAttribute('data-eid'), false);
  } finally {
    cleanup();
  }
});

test('cleanArtifacts nettoie un noeud existant (y compris lui-même) ; newEid est unique', () => {
  const { document, cleanup } = withDom();
  try {
    const n = document.createElement('div');
    n.setAttribute('contenteditable', 'true');
    n.className = 'ekw-selected';
    n.innerHTML = '<i class="drag-handle"></i>';
    assert.equal(cleanArtifacts(n), undefined);
    assert.equal(n.hasAttribute('contenteditable'), false);
    assert.equal(n.classList.contains('ekw-selected'), false);
    assert.equal(n.querySelector('.drag-handle'), null);

    const ids = new Set(Array.from({ length: 500 }, () => newEid()));
    assert.equal(ids.size, 500);
  } finally {
    cleanup();
  }
});
