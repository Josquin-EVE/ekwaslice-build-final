import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDom } from '../helpers/dom.js';
import { mountSliceThumb } from '../../src/ui/slice-thumb.js';

test('mountSliceThumb cree une iframe (repli srcdoc sans IntersectionObserver)', () => {
  const env = withDom();
  const { document: doc, window: win } = env;
  try {
    const c = doc.createElement('div');
    doc.body.appendChild(c);
    mountSliceThumb(c, '<b>x</b>', { buildThumbDoc: (h) => '<html>' + h + '</html>', win });
    const ifr = c.querySelector('iframe');
    assert.ok(ifr);
    assert.match(ifr.getAttribute('srcdoc') || '', /<b>x<\/b>/);
  } finally { env.cleanup(); }
});
