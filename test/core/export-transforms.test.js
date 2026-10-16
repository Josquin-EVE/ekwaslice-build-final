import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildAlias,
  rewriteHtmlClasses,
  rewriteSelector,
  rewriteJsClasses,
  namespaceKeyframes,
  applyKeyframeRefs,
  scopeRule,
} from '../../src/core/export-transforms.js';

const A = (obj) => new Map(Object.entries(obj));

// ---------- buildAlias ----------

test('buildAlias : alias eks-<uid>-N uniquement pour les classes connues d une regle CSS', () => {
  const alias = buildAlias(['title', 'px-4', 'inconnue'], new Set(['title', 'px-4']), 'ab12cd');
  assert.ok(alias.size > 0);
  assert.equal(alias.get('title'), 'eks-ab12cd-1');
  assert.equal(alias.get('px-4'), 'eks-ab12cd-2');
  assert.equal(alias.has('inconnue'), false);
});

test('buildAlias : ordre d entree deterministe, doublons dedupliques, numerotation sans trou', () => {
  const alias = buildAlias(['b', 'zz', 'a', 'b', 'a'], new Set(['a', 'b']), 'u1');
  assert.deepEqual([...alias.entries()], [['b', 'eks-u1-1'], ['a', 'eks-u1-2']]);
});

test('buildAlias : entrees vides', () => {
  assert.equal(buildAlias([], new Set(['a']), 'u').size, 0);
  assert.equal(buildAlias(['a'], new Set(), 'u').size, 0);
});

// ---------- rewriteHtmlClasses ----------

test('rewriteHtmlClasses : <div class="title"> -> classe aliasee', () => {
  const alias = buildAlias(['title'], new Set(['title']), 'ab12cd');
  assert.equal(rewriteHtmlClasses('<div class="title">x</div>', alias), '<div class="eks-ab12cd-1">x</div>');
});

test('rewriteHtmlClasses : classe sans alias supprimee, attribut retire si vide', () => {
  const alias = A({ a: 'eks-u-1' });
  assert.equal(rewriteHtmlClasses('<p class="a nope">x</p>', alias), '<p class="eks-u-1">x</p>');
  assert.equal(rewriteHtmlClasses('<p class="nope">x</p>', alias), '<p>x</p>');
  assert.equal(rewriteHtmlClasses('<p id="i" class="nope other">x</p>', alias), '<p id="i">x</p>');
});

test('rewriteHtmlClasses : guillemets simples, espaces multiples, void/self-closing', () => {
  const alias = A({ a: 'eks-u-1', b: 'eks-u-2' });
  assert.equal(rewriteHtmlClasses("<span class='a   b'>x</span>", alias), '<span class="eks-u-1 eks-u-2">x</span>');
  assert.equal(rewriteHtmlClasses('<img class="a" src="x.png"/>', alias), '<img class="eks-u-1" src="x.png"/>');
  assert.equal(rewriteHtmlClasses('<br class="b">', alias), '<br class="eks-u-2">');
});

test('rewriteHtmlClasses : ne touche ni le texte, ni les autres attributs, ni script/style/commentaires', () => {
  const alias = A({ a: 'eks-u-1' });
  const html =
    '<div data-class="a" title="class=\'a\'" onclick="if(x>1)go()">class="a" a</div>' +
    '<script>var s=\'<i class="a">\';if(i<n&&n>1){}</script>' +
    '<style>.a{color:red}</style><!-- <b class="a"> -->';
  assert.equal(rewriteHtmlClasses(html, alias), html);
});

test('rewriteHtmlClasses : > dans une valeur d attribut ne coupe pas la balise', () => {
  const alias = A({ a: 'eks-u-1' });
  assert.equal(
    rewriteHtmlClasses('<div onclick="x>1" class="a">ok</div>', alias),
    '<div onclick="x>1" class="eks-u-1">ok</div>',
  );
});

test('rewriteHtmlClasses : classes Tailwind avec : et /', () => {
  const alias = A({ 'md:px-4': 'eks-u-1', 'w-1/2': 'eks-u-2' });
  assert.equal(
    rewriteHtmlClasses('<div class="md:px-4 w-1/2">x</div>', alias),
    '<div class="eks-u-1 eks-u-2">x</div>',
  );
});

test('rewriteHtmlClasses : alias vide supprime toutes les classes', () => {
  assert.equal(rewriteHtmlClasses('<p class="a">x</p>', new Map()), '<p>x</p>');
});

// ---------- rewriteSelector ----------

test('rewriteSelector : renomme les tokens .classe, mot entier uniquement', () => {
  const alias = A({ title: 'eks-u-1', 'title-big': 'eks-u-2' });
  assert.equal(rewriteSelector('.title', alias), '.eks-u-1');
  assert.equal(rewriteSelector('.title-big', alias), '.eks-u-2');
  assert.equal(rewriteSelector('.title .title-big>p.title:hover', alias), '.eks-u-1 .eks-u-2>p.eks-u-1:hover');
  assert.equal(rewriteSelector('.title-x', alias), '.title-x');
});

test('rewriteSelector : classes echappees (Tailwind) et pseudo-fonctions', () => {
  const alias = A({ 'md:px-4': 'eks-u-1', 'w-1/2': 'eks-u-2', a: 'eks-u-3' });
  assert.equal(rewriteSelector('.md\\:px-4', alias), '.eks-u-1');
  assert.equal(rewriteSelector('.w-1\\/2', alias), '.eks-u-2');
  assert.equal(rewriteSelector(':not(.a)', alias), ':not(.eks-u-3)');
});

test('rewriteSelector : ne touche pas les valeurs d attribut ni les classes sans alias', () => {
  const alias = A({ pdf: 'eks-u-1' });
  assert.equal(rewriteSelector('a[href$=".pdf"]', alias), 'a[href$=".pdf"]');
  assert.equal(rewriteSelector('.autre', alias), '.autre');
});

// ---------- rewriteJsClasses ----------

test('rewriteJsClasses : \'.carousel-track\' -> alias (fix carrousel)', () => {
  const alias = A({ 'carousel-track': 'eks-ab12cd-2' });
  assert.equal(rewriteJsClasses("q('.carousel-track')", alias), "q('.eks-ab12cd-2')");
});

test('rewriteJsClasses : querySelector complexe, guillemets doubles, selecteur compose', () => {
  const alias = A({ slide: 'eks-u-1', dot: 'eks-u-2' });
  assert.equal(
    rewriteJsClasses('el.querySelectorAll(".slide, div.dot.slide > span")', alias),
    'el.querySelectorAll(".eks-u-1, div.eks-u-2.eks-u-1 > span")',
  );
});

test('rewriteJsClasses : classList.add/remove/toggle/contains/replace avec classes nues', () => {
  const alias = A({ active: 'eks-u-1', open: 'eks-u-2' });
  assert.equal(rewriteJsClasses("el.classList.add('active')", alias), "el.classList.add('eks-u-1')");
  assert.equal(rewriteJsClasses('el.classList.remove("active","open")', alias), 'el.classList.remove("eks-u-1","eks-u-2")');
  assert.equal(rewriteJsClasses("el.classList.toggle('open', on)", alias), "el.classList.toggle('eks-u-2', on)");
  assert.equal(rewriteJsClasses("if(el.classList.contains('active')){}", alias), "if(el.classList.contains('eks-u-1')){}");
  assert.equal(rewriteJsClasses("el.classList.replace('active','open')", alias), "el.classList.replace('eks-u-1','eks-u-2')");
});

test('rewriteJsClasses : className = / += et setAttribute(class) et getElementsByClassName', () => {
  const alias = A({ a: 'eks-u-1', b: 'eks-u-2' });
  assert.equal(rewriteJsClasses("el.className = 'a b other'", alias), "el.className = 'eks-u-1 eks-u-2 other'");
  assert.equal(rewriteJsClasses("el.className += ' a'", alias), "el.className += ' eks-u-1'");
  assert.equal(rewriteJsClasses("el.setAttribute('class','b')", alias), "el.setAttribute('class','eks-u-2')");
  assert.equal(rewriteJsClasses("d.getElementsByClassName('a')", alias), "d.getElementsByClassName('eks-u-1')");
});

test('rewriteJsClasses : chaine nue egale a un nom de classe HORS API classe n est PAS reecrite', () => {
  const alias = A({ active: 'eks-u-1' });
  const js = "if (state === 'active') { mode = \"active\"; } el.className == 'active'";
  assert.equal(rewriteJsClasses(js, alias), js);
});

test('rewriteJsClasses : acces propriete et identifiants hors chaine intacts', () => {
  const alias = A({ track: 'eks-u-1' });
  const js = "const x = obj.track; var track = 1; fn('.track'); a.track.b";
  assert.equal(rewriteJsClasses(js, alias), "const x = obj.track; var track = 1; fn('.eks-u-1'); a.track.b");
});

test('rewriteJsClasses : pas de faux positif sur sous-chaine d un identifiant plus long', () => {
  const alias = A({ slide: 'eks-u-1' });
  assert.equal(rewriteJsClasses("q('.slide-nav'); q('.slides'); q('.my-slide'); q('.slide_x')", alias),
    "q('.slide-nav'); q('.slides'); q('.my-slide'); q('.slide_x')");
  assert.equal(rewriteJsClasses("q('.slide')", alias), "q('.eks-u-1')");
});

test('rewriteJsClasses : classe construite par concatenation non reecrite (pas d heroisme)', () => {
  const alias = A({ dot: 'eks-u-1' });
  const js = "q('.' + name); q('.d' + 'ot'); q('.dot-' + i)";
  assert.equal(rewriteJsClasses(js, alias), js);
});

test('rewriteJsClasses : commentaires avec apostrophe n empechent pas la suite ; commentaire non modifie', () => {
  const alias = A({ a: 'eks-u-1' });
  const js = "// don't touch '.a' here\n/* it's '.a' */\nq('.a')";
  assert.equal(rewriteJsClasses(js, alias), "// don't touch '.a' here\n/* it's '.a' */\nq('.eks-u-1')");
});

test('rewriteJsClasses : litteral regex contenant une quote n empeche pas la suite', () => {
  const alias = A({ a: 'eks-u-1' });
  assert.equal(rewriteJsClasses("s.replace(/\"/g,''); q('.a'); const r = x / 2; q('.a')", alias),
    "s.replace(/\"/g,''); q('.eks-u-1'); const r = x / 2; q('.eks-u-1')");
});

test('rewriteJsClasses : template literal (selecteur statique) et ${expr} traite comme du code', () => {
  const alias = A({ a: 'eks-u-1' });
  assert.equal(rewriteJsClasses('q(`.a > ${n}`)', alias), 'q(`.eks-u-1 > ${n}`)');
  assert.equal(rewriteJsClasses('q(`.a ${obj.a}`)', alias), 'q(`.eks-u-1 ${obj.a}`)');
  assert.equal(rewriteJsClasses('q(`.x${q(".a")}`)', alias), 'q(`.x${q(".eks-u-1")}`)');
});

test('rewriteJsClasses : class="..." dans le markup construit par le JS', () => {
  const alias = A({ dot: 'eks-u-1', on: 'eks-u-2' });
  assert.equal(rewriteJsClasses("h.innerHTML = '<i class=\"dot on\"></i>'", alias), "h.innerHTML = '<i class=\"eks-u-1 eks-u-2\"></i>'");
  assert.equal(rewriteJsClasses("h.innerHTML = \"<i class='dot'></i>\"", alias), "h.innerHTML = \"<i class='eks-u-1'></i>\"");
  assert.equal(rewriteJsClasses('h.innerHTML = `<i class="dot ${c}"></i>`', alias), 'h.innerHTML = `<i class="eks-u-1 ${c}"></i>`');
});

test('rewriteJsClasses : token de classe coupe par ${} dans un template n est pas reecrit', () => {
  const alias = A({ dot: 'eks-u-1', do: 'eks-u-9' });
  assert.equal(rewriteJsClasses('h = `<i class="do${x}">`', alias), 'h = `<i class="do${x}">`');
  assert.equal(rewriteJsClasses('h = `<i class="dot do ${x}">`', alias), 'h = `<i class="eks-u-1 eks-u-9 ${x}">`');
});

test('rewriteJsClasses : fragment suivi de ${} ou de + : dernier token jamais reecrit (classes dynamiques)', () => {
  const alias = A({ dot: 'E2', slide: 'E3' });
  const same = [
    'q(`.dot${i}`)',
    "q('.dot' + i)",
    "el.classList.add('dot' + i)",
    "el.className = 'dot' + i",
    "'<i class=\"dot' + i + '\">'",
  ];
  for (const js of same) assert.equal(rewriteJsClasses(js, alias), js, js);
  // Les tokens non terminaux du meme fragment restent reecrits.
  assert.equal(rewriteJsClasses("q('.slide .dot' + i)", alias), "q('.E3 .dot' + i)");
  assert.equal(rewriteJsClasses("el.className = 'slide dot' + i", alias), "el.className = 'E3 dot' + i");
  assert.equal(rewriteJsClasses("el.className = 'slide ' + i", alias), "el.className = 'E3 ' + i");
  // += n'est pas une concatenation de chaine : la chaine est complete.
  assert.equal(rewriteJsClasses("q('.dot'); x += 1", alias), "q('.E2'); x += 1");
});

test('rewriteJsClasses : alias vide / js vide', () => {
  assert.equal(rewriteJsClasses("q('.a')", new Map()), "q('.a')");
  assert.equal(rewriteJsClasses('', A({ a: 'x' })), '');
});

test('rewriteJsClasses : meme alias HTML+CSS+JS -> le selecteur du carrousel survit a l export', () => {
  const alias = buildAlias(['carousel-track', 'slide'], new Set(['carousel-track', 'slide']), 'ab12cd');
  const html = rewriteHtmlClasses('<div class="carousel-track"><div class="slide">1</div></div>', alias);
  const css = rewriteSelector('.carousel-track', alias);
  const js = rewriteJsClasses("const t=root.querySelector('.carousel-track');t.classList.add('slide')", alias);
  const cls = html.match(/class="([^"]+)"/)[1];
  assert.equal(cls, 'eks-ab12cd-1');
  assert.equal(css, '.eks-ab12cd-1');
  assert.ok(js.includes("querySelector('." + cls + "')"));
});

// ---------- keyframes ----------

test('namespaceKeyframes : @keyframes renomme ET reference animation mise a jour', () => {
  const { css, renames } = namespaceKeyframes('@keyframes spin{from{opacity:0}to{opacity:1}} .x{animation:spin 1s}', 'ab12cd');
  assert.ok(css.includes('@keyframes spin-ab12cd'));
  assert.match(css, /animation:\s*spin-ab12cd 1s/);
  assert.equal(renames.get('spin'), 'spin-ab12cd');
});

test('namespaceKeyframes : animation-name, prefixes -webkit-, listes, !important', () => {
  const src =
    '@-webkit-keyframes fade{0%{a:b}} @keyframes fade{0%{a:b}} @keyframes spin{0%{a:b}}' +
    ' .a{animation-name:fade} .b{-webkit-animation: spin 2s linear infinite, fade 1s ease !important}';
  const { css } = namespaceKeyframes(src, 'u');
  assert.ok(css.includes('@-webkit-keyframes fade-u'));
  assert.ok(css.includes('@keyframes fade-u'));
  assert.ok(css.includes('animation-name:fade-u'));
  assert.ok(css.includes('-webkit-animation: spin-u 2s linear infinite, fade-u 1s ease !important'));
});

test('namespaceKeyframes : ne touche que les keyframes definis, ni durees ni autres noms', () => {
  const src = '@keyframes spin{0%{a:b}} .a{animation:other 1s ease-in-out} .b{animation:spin 1s;animation-timing-function:ease} .c{transition:spinner 1s}';
  const { css, renames } = namespaceKeyframes(src, 'u');
  assert.deepEqual([...renames.keys()], ['spin']);
  assert.ok(css.includes('.a{animation:other 1s ease-in-out}'));
  assert.ok(css.includes('.b{animation:spin-u 1s;animation-timing-function:ease}'));
  assert.ok(css.includes('.c{transition:spinner 1s}'));
});

test('namespaceKeyframes : nom plus long contenant le nom (spin vs spinner) et idempotence', () => {
  const src = '@keyframes spin{0%{a:b}} .a{animation:spinner 1s} .b{animation:spin 1s}';
  const { css, renames } = namespaceKeyframes(src, 'u');
  assert.ok(css.includes('.a{animation:spinner 1s}'));
  assert.ok(css.includes('.b{animation:spin-u 1s}'));
  assert.equal(applyKeyframeRefs(css, renames), css);
});

test('namespaceKeyframes : sans keyframes -> css inchange, renames vide', () => {
  const { css, renames } = namespaceKeyframes('.x{color:red}', 'u');
  assert.equal(css, '.x{color:red}');
  assert.equal(renames.size, 0);
});

test('applyKeyframeRefs : reecrit uniquement les declarations animation, avec renames fournis', () => {
  const out = applyKeyframeRefs('.x{animation:spin 1s} .y{--animation:spin}', new Map([['spin', 'spin-u']]));
  assert.equal(out, '.x{animation:spin-u 1s} .y{--animation:spin}');
  assert.equal(applyKeyframeRefs('.x{animation:spin 1s}', new Map()), '.x{animation:spin 1s}');
});

// ---------- scopeRule ----------

test('scopeRule : forme exacte .<uid> <selector>{body}', () => {
  assert.equal(scopeRule('.title', 'color:red', 'ab12cd'), '.ab12cd .title{color:red}');
});

test('scopeRule : liste de selecteurs prefixee chacun, virgule dans :is() preservee', () => {
  assert.equal(scopeRule('.a, .b', 'x:y', 'u'), '.u .a,.u .b{x:y}');
  assert.equal(scopeRule(':is(.a,.b) p', 'x:y', 'u'), '.u :is(.a,.b) p{x:y}');
});
