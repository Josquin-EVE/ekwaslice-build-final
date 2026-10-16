import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withDom } from '../helpers/dom.js';
import { exportSlice, collectCssRules, getLastExport } from '../../src/core/export.js';

function makeSlice(document, html, origin = 'generated', meta = {}) {
  const root = document.createElement('div');
  root.setAttribute('data-comp', '1');
  root.className = 'relative';
  root.innerHTML = html;
  return { id: 's1', root, origin, meta };
}

const rule = (selector, body, media = '') => ({ media, selector, body });
const wrapperOf = (html) => /^<div class="(eks-[\w]+)">/.exec(html)[1];

const CARD_HTML =
  '<div class="card"><button class="btn" onclick="go()">Go</button></div>' +
  "<script>document.querySelector('.card').addEventListener('click', go);</script>";
const CARD_RULES = [rule('.card', 'padding: 8px'), rule('.btn', 'color: red')];

test('generated : classes aliasées, CSS scopé, le JS garde le MÊME alias (sélecteur survit)', () => {
  const { document, cleanup } = withDom();
  try {
    const slice = makeSlice(document, CARD_HTML);
    const out = exportSlice(slice, { collectCssRules: () => CARD_RULES });
    const w = wrapperOf(out.html);

    const cardAlias = /<div class="(eks-\w+-\d+)">/.exec(out.html.replace(/^<div class="eks-\w+">/, ''))[1];
    const btnAlias = /<button class="(eks-\w+-\d+)"/.exec(out.html)[1];
    assert.notEqual(cardAlias, 'card');
    assert.notEqual(cardAlias, btnAlias);
    assert.ok(!/class="[^"]*\b(card|btn)\b/.test(out.html), 'classes d\'origine absentes du html');
    assert.ok(out.html.includes('onclick="go()"'), 'autres attributs conservés');

    // CSS : scopé par le wrapper, selecteurs réécrits
    assert.ok(out.css.includes(`.${w} .${cardAlias}{padding: 8px}`), out.css);
    assert.ok(out.css.includes(`.${w} .${btnAlias}{color: red}`), out.css);
    assert.ok(!/\.card\b|\.btn\b/.test(out.css));
    assert.ok(out.css.includes(`.${w} { all: initial;`), 'reset défensif du wrapper');

    // JS : IIFE + même alias que .card
    assert.ok(out.js.startsWith('(function () {') && out.js.endsWith('})();'));
    assert.ok(out.js.includes(`querySelector('.${cardAlias}')`), out.js);
    assert.ok(!out.js.includes("'.card'"));
    assert.ok(!out.html.includes('<script'), 'script extrait du html');
  } finally {
    cleanup();
  }
});

test('generated : classe sans CSS mais ciblée par le JS est conservée (hook JS)', () => {
  const { document, cleanup } = withDom();
  try {
    const slice = makeSlice(
      document,
      '<div class="track"><i class="dot"></i></div><script>document.querySelectorAll(".dot").forEach(d => d)</script>',
    );
    const out = exportSlice(slice, { collectCssRules: () => [rule('.track', 'display: flex')] });
    const dot = /<i class="(eks-\w+-\d+)"/.exec(out.html);
    assert.ok(dot, 'la classe .dot reste sur le noeud : ' + out.html);
    assert.ok(out.js.includes(`".${dot[1]}"`), out.js);
  } finally {
    cleanup();
  }
});

test('generated : classe ni stylée ni ciblée par le JS est supprimée ; artefacts d\'édition retirés', () => {
  const { document, cleanup } = withDom();
  try {
    const slice = makeSlice(
      document,
      '<div class="card orphan ekw-selected" contenteditable="true"><img data-picto="x" data-picto-url="https://cdn/x.svg" src="local.svg"></div>',
    );
    const out = exportSlice(slice, { collectCssRules: () => CARD_RULES });
    assert.ok(!out.html.includes('orphan'));
    assert.ok(!out.html.includes('ekw-selected'));
    assert.ok(!out.html.includes('contenteditable'));
    assert.ok(out.html.includes('src="https://cdn/x.svg"'));
    assert.ok(!out.html.includes('data-picto'));
    assert.equal(out.js, '');
  } finally {
    cleanup();
  }
});

test('imported : verbatim {html, css, js}, data-remote-* du contenu conservés', () => {
  const { document, cleanup } = withDom();
  try {
    const content = '<div class="x y" data-remote-foo="bar"><p data-remote-x="1">Hello</p></div>';
    const slice = makeSlice(
      document,
      `<div><style>.x{color:red}\n.y > p { margin: 0 }</style>${content}<script type="text/ekw-js">window.__a = 1;\nconsole.log("x");</script></div>`,
      'imported',
      { prismicId: 'Z', prismicField: 'html_only' },
    );
    slice.root.setAttribute('data-remote-id', 'Z');
    const out = exportSlice(slice, { collectCssRules: () => { throw new Error('non appelé en verbatim'); } });
    assert.deepEqual(out, {
      html: content,
      css: '.x{color:red}\n.y > p { margin: 0 }',
      js: 'window.__a = 1;\nconsole.log("x");',
    });
    assert.ok(out.html.includes('data-remote-foo="bar"') && out.html.includes('data-remote-x="1"'));
  } finally {
    cleanup();
  }
});

test('imported : champ html -> tout dans html, type text/ekw-js neutralisé', () => {
  const { document, cleanup } = withDom();
  try {
    const slice = makeSlice(
      document,
      '<div><style>.a{}</style><p class="a">t</p><script type="text/ekw-js">1+1</script></div>',
      'imported',
      { prismicField: 'html' },
    );
    const out = exportSlice(slice);
    assert.equal(out.css, '');
    assert.equal(out.js, '');
    assert.equal(out.html, '<style>.a{}</style><p class="a">t</p><script>1+1</script>');
  } finally {
    cleanup();
  }
});

test('isolation : deux slices mêmes classes, CSS différent -> uid distincts, aucune collision', () => {
  const { document, cleanup } = withDom();
  try {
    const html = '<div class="title">T</div>';
    const a = exportSlice(makeSlice(document, html), { collectCssRules: () => [rule('.title', 'color: red')] });
    const b = exportSlice(makeSlice(document, html), { collectCssRules: () => [rule('.title', 'color: blue')] });
    const wa = wrapperOf(a.html);
    const wb = wrapperOf(b.html);
    assert.notEqual(wa, wb);
    const aliasA = /<div class="(eks-\w+-\d+)"/.exec(a.html.replace(/^<div class="eks-\w+">/, ''))[1];
    const aliasB = /<div class="(eks-\w+-\d+)"/.exec(b.html.replace(/^<div class="eks-\w+">/, ''))[1];
    assert.notEqual(aliasA, aliasB);
    assert.ok(a.css.includes(`.${wa} .${aliasA}{color: red}`));
    assert.ok(b.css.includes(`.${wb} .${aliasB}{color: blue}`));
    assert.ok(!a.css.includes(wb) && !b.css.includes(wa));
  } finally {
    cleanup();
  }
});

test('html / body / :root seuls sont IGNORÉS ; `body .card` -> `.uid .card`', () => {
  const { document, cleanup } = withDom();
  try {
    const slice = makeSlice(document, '<div class="card">x</div>');
    const out = exportSlice(slice, {
      collectCssRules: () => [
        rule('body', 'margin: 0'),
        rule(':root', '--x: 1'),
        rule('html', 'line-height: 1.2'),
        rule('html, body', 'padding: 1px'),
        rule('body .card', 'color: green'),
        rule('.card', 'padding: 8px'),
      ],
    });
    const w = wrapperOf(out.html);
    const alias = /<div class="(eks-\w+-\d+)"/.exec(out.html.replace(/^<div class="eks-\w+">/, ''))[1];
    for (const leaked of ['margin: 0', '--x: 1', 'line-height: 1.2', 'padding: 1px']) {
      assert.ok(!out.css.includes(leaked), `${leaked} ne doit pas être exporté : ${out.css}`);
    }
    assert.ok(out.css.includes(`.${w} .${alias}{color: green}`), '`body .card` -> `.uid .card`');
    assert.ok(!/\b(body|html|:root)\b/.test(out.css), out.css);
  } finally {
    cleanup();
  }
});

test('fuite du châssis : une règle `body` (font-family app) n\'est pas exportée sur le wrapper', () => {
  const { document, cleanup } = withDom();
  try {
    const out = exportSlice(makeSlice(document, '<div class="card">x</div>'), {
      collectCssRules: () => [rule('body', 'font-family: Carnero'), rule('.card', 'padding: 8px')],
    });
    const w = wrapperOf(out.html);
    const alias = /<div class="(eks-\w+-\d+)"/.exec(out.html.replace(/^<div class="eks-\w+">/, ''))[1];
    assert.ok(!out.css.includes('Carnero'), out.css);
    assert.ok(!out.css.includes(`.${w}{`), 'aucune règle `.uid{…}` issue de body');
    assert.ok(out.css.includes(`.${w} .${alias}{padding: 8px}`), out.css);
  } finally {
    cleanup();
  }
});

test('@media : règles regroupées par media, mobile-first ; body dans un media ignoré', () => {
  const { document, cleanup } = withDom();
  try {
    const slice = makeSlice(document, '<div class="card">x</div>');
    const out = exportSlice(slice, {
      collectCssRules: () => [
        rule('.card', 'padding: 24px', '(min-width: 1024px)'),
        rule('.card', 'padding: 16px', '(min-width: 768px)'),
        rule('.card', 'padding: 8px'),
        rule('body', 'margin: 0', '(min-width: 768px)'),
      ],
    });
    const w = wrapperOf(out.html);
    const i0 = out.css.indexOf('padding: 8px');
    const i768 = out.css.indexOf('@media (min-width: 768px)');
    const i1024 = out.css.indexOf('@media (min-width: 1024px)');
    assert.ok(i0 > 0 && i0 < i768 && i768 < i1024, out.css);
    assert.ok(!out.css.includes('margin: 0') && !out.css.includes(`.${w}{`), out.css);
  } finally {
    cleanup();
  }
});

test('keyframes : namespacées par uid, références animation mises à jour, inutilisées omises', () => {
  const { document, cleanup } = withDom();
  try {
    const slice = makeSlice(document, '<div class="spin">x</div>');
    const out = exportSlice(slice, {
      uid: 'k1',
      collectCssRules: () => [
        rule('.spin', 'animation: spin 1s linear infinite'),
        rule('@keyframes spin', 'from { opacity: 0; } to { opacity: 1; }'),
        rule('@keyframes unused', 'from { opacity: 0; } to { opacity: 1; }'),
      ],
    });
    assert.ok(out.css.includes('@keyframes spin-k1'), out.css);
    assert.ok(out.css.includes('animation: spin-k1 1s linear infinite'), out.css);
    assert.ok(!out.css.includes('unused'));
  } finally {
    cleanup();
  }
});

test('états hover (data-ekw-states) -> règles scopées, attribut retiré, data-eid conservé', () => {
  const { document, cleanup } = withDom();
  try {
    const slice = makeSlice(
      document,
      '<a class="card" data-eid="e1" data-ekw-states=\'{"hover":{"color":"red"}}\'>x</a>',
    );
    const out = exportSlice(slice, { collectCssRules: () => CARD_RULES });
    const w = wrapperOf(out.html);
    assert.ok(out.css.includes(`.${w} [data-eid="e1"]:hover{color:red}`), out.css);
    assert.ok(!out.html.includes('data-ekw-states'));
    assert.ok(out.html.includes('data-eid="e1"'));
  } finally {
    cleanup();
  }
});

test('lastExport : renseigné après chaque export', () => {
  const { document, cleanup } = withDom();
  try {
    const out = exportSlice(makeSlice(document, '<div class="card">x</div>'), { collectCssRules: () => CARD_RULES });
    assert.equal(getLastExport(), out);
  } finally {
    cleanup();
  }
});

test('collectCssRules : lit document.styleSheets (règles, @media, @keyframes)', () => {
  const { document, cleanup } = withDom();
  try {
    const st = document.createElement('style');
    st.textContent = '.a{color:red}@media (min-width: 640px){.b{margin:0}}@keyframes pop{from{opacity:0}to{opacity:1}}';
    document.head.appendChild(st);
    const rules = collectCssRules();
    const a = rules.find((r) => r.selector === '.a');
    const b = rules.find((r) => r.selector === '.b');
    const k = rules.find((r) => r.selector === '@keyframes pop');
    assert.ok(a && a.media === '' && /color:\s*red/.test(a.body));
    assert.ok(b && b.media.includes('min-width: 640px') && /margin:\s*0/.test(b.body));
    assert.ok(k && k.body.includes('opacity'));

    // par défaut exportSlice lit le document
    const out = exportSlice(makeSlice(document, '<div class="a">x</div>'));
    assert.ok(/color:\s*red/.test(out.css));
  } finally {
    cleanup();
  }
});
