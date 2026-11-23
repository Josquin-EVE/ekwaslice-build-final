import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDom } from '../helpers/dom.js';
import { initPreview } from '../../src/ui/preview.js';

// Feature B : masquer les blocs editor-only hors mode édition.
// Mécanisme = marqueur unique data-mode sur <body>, posé par preview.setMode.
test('setMode pose data-mode sur body (edit/preview)', () => {
  const env = withDom();
  const { document: doc, window: win } = env;
  try {
    const canvas = doc.createElement('div');
    doc.body.appendChild(canvas);
    const store = { canvas, list: () => [] };
    const preview = initPreview(store, { document: doc, window: win, canvas });

    preview.setMode('preview');
    assert.equal(doc.body.dataset.mode, 'preview');

    preview.setMode('edit');
    assert.equal(doc.body.dataset.mode, 'edit');

    if (preview.dispose) preview.dispose();
  } finally {
    env.cleanup();
  }
});
