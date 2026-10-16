import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDom } from '../helpers/dom.js';
import { serializeSlice } from '../../src/core/slice.js';

function makeRoot(document, html) {
  const root = document.createElement('div');
  root.setAttribute('data-comp', '1');
  root.className = 'relative';
  root.innerHTML = html;
  return root;
}

const IMPORTED_HTML =
  '<style>.x{color:red}\n  .y > p { margin: 0 }</style>\n' +
  '<div class="x y" data-remote-foo="bar" data-remote-id="Z">\n  <p data-remote-x="1">Hello</p>\n</div>\n' +
  '<script type="text/ekw-js">window.__a = 1;\nconsole.log("x");</script>';

test('imported : html verbatim, round-trip identique', () => {
  const { document, cleanup } = withDom();
  try {
    const root = makeRoot(document, IMPORTED_HTML);
    const expected = root.innerHTML;
    const out = serializeSlice({ root, origin: 'imported', meta: {} });
    assert.equal(out, expected);
    assert.ok(out.includes('<style>.x{color:red}'));
    assert.ok(out.includes('<script type="text/ekw-js">'));
    assert.ok(out.includes('data-remote-foo="bar"'));
  } finally {
    cleanup();
  }
});

test('imported : seuls les artefacts d\'édition sont retirés, root non muté', () => {
  const { document, cleanup } = withDom();
  try {
    const root = makeRoot(
      document,
      '<div class="a ekw-selected" contenteditable="true" data-ekw-pending="1"><p class="ekw-editing b">t</p></div>' +
        '<div data-comp="1" draggable="true" class="opacity-40 relative">nested</div>',
    );
    const before = root.innerHTML;
    const out = serializeSlice({ root, origin: 'imported', meta: {} });
    assert.ok(!out.includes('ekw-selected'));
    assert.ok(!out.includes('ekw-editing'));
    assert.ok(!out.includes('contenteditable'));
    assert.ok(!out.includes('data-ekw-pending'));
    // pas de nettoyage "generated" sur la branche imported : verbatim hors artefacts d'édition
    assert.ok(out.includes('data-comp="1"'));
    assert.ok(out.includes('draggable="true"'));
    assert.ok(out.includes('opacity-40'));
    assert.equal(root.innerHTML, before);
  } finally {
    cleanup();
  }
});

for (const origin of ['generated', 'code', 'library']) {
  test(`${origin} : pas d'artefacts, classes Tailwind + data-* + data-eid + script conservés`, () => {
    const { document, cleanup } = withDom();
    try {
      const root = makeRoot(
        document,
        '<section class="flex gap-4 p-6 md:p-8 ekw-selected" contenteditable="true" data-foo="bar" data-eid="eabc1" data-ekw-states=\'{"hover":1}\'>' +
          '<h2 class="text-2xl ekw-editing" data-ekw-pending="1">Titre</h2>' +
          '<button onclick="remove(this)">x</button><span class="drag-handle"></span>' +
          '<script type="text/ekw-js">window.q = 2;</script></section>',
      );
      const before = root.innerHTML;
      const out = serializeSlice({ root, origin, meta: {} });
      assert.ok(!out.includes('ekw-selected'));
      assert.ok(!out.includes('ekw-editing'));
      assert.ok(!out.includes('contenteditable'));
      assert.ok(!out.includes('data-ekw-pending'));
      assert.ok(!out.includes('drag-handle'));
      assert.ok(!out.includes('onclick'));
      assert.ok(out.includes('class="flex gap-4 p-6 md:p-8"'));
      assert.ok(out.includes('data-foo="bar"'));
      assert.ok(out.includes('data-eid="eabc1"'));
      assert.ok(out.includes('<script type="text/ekw-js">window.q = 2;</script>'));
      assert.equal(root.innerHTML, before, 'le root vivant ne doit pas être muté');
    } finally {
      cleanup();
    }
  });
}

test('generated : wrappers [data-comp] imbriqués et artefacts de drag ne fuient pas', () => {
  const { document, cleanup } = withDom();
  try {
    const root = makeRoot(
      document,
      '<div data-comp="1" draggable="true" class="relative opacity-40 mb-2"><p class="opacity-40">keep</p></div>',
    );
    const out = serializeSlice({ root, origin: 'generated', meta: {} });
    assert.ok(!out.includes('data-comp'));
    assert.ok(!out.includes('draggable'));
    // opacity-40 retiré du wrapper imbriqué seulement : celui d'un enfant auteur est conservé
    assert.ok(out.includes('<p class="opacity-40">keep</p>'));
    assert.ok(out.includes('class="mb-2"'));
  } finally {
    cleanup();
  }
});

test('generated : html canonique ne contient pas l\'enveloppe racine', () => {
  const { document, cleanup } = withDom();
  try {
    const root = makeRoot(document, '<p class="a">x</p>');
    root.setAttribute('data-remote-id', 'A');
    root.classList.add('opacity-40');
    root.setAttribute('draggable', 'true');
    assert.equal(serializeSlice({ root, origin: 'generated', meta: {} }), '<p class="a">x</p>');
  } finally {
    cleanup();
  }
});
