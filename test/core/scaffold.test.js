import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDom } from '../helpers/dom.js';

test('withDom monte un document avec #canvas', () => {
  const { document, cleanup } = withDom('<div id="canvas"></div>');
  try {
    assert.notEqual(document.getElementById('canvas'), null);
    assert.equal(globalThis.document, document);
  } finally {
    cleanup();
  }
  assert.equal(globalThis.document, undefined);
});
