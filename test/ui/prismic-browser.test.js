import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDom } from '../helpers/dom.js';
import { initPrismicBrowser } from '../../src/ui/prismic-browser.js';

function fakeApi(slices) {
  return { listPrismicSlices: async () => ({ ok: true, slices }) };
}

test('mount + load rend une carte par slice (data-slice-id)', async () => {
  const env = withDom();
  const { document: doc, window: win } = env;
  try {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    const api = fakeApi([{ id: 'the-id', name: 'Slice A', html: '<div>a</div>' }]);
    const b = initPrismicBrowser({ document: doc, window: win, api, buildThumbDoc: () => '<html></html>', onPick() {} });
    b.mount(container);
    await b.load();
    assert.equal(container.querySelectorAll('[data-slice-id]').length, 1);
  } finally { env.cleanup(); }
});

test('clic sur une carte appelle onPick avec son id', async () => {
  const env = withDom();
  const { document: doc, window: win } = env;
  try {
    const container = doc.createElement('div');
    doc.body.appendChild(container);
    let picked = null;
    const api = fakeApi([{ id: 'the-id', name: 'Slice A', html: '<div>a</div>' }]);
    const b = initPrismicBrowser({ document: doc, window: win, api, buildThumbDoc: () => '', onPick: (id) => { picked = id; } });
    b.mount(container);
    await b.load();
    container.querySelector('[data-slice-id]').click();
    assert.equal(picked, 'the-id');
    assert.equal(b.getSelectedId(), 'the-id');
  } finally { env.cleanup(); }
});
