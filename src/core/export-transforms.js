// Transformations pures (chaînes) de la chaîne d'export : aliasing des classes
// HTML + CSS + JS avec UN SEUL alias partagé, namespacing des keyframes, scope
// des règles. Aucun DOM, aucun effet de bord : testable en Node avec des fixtures.
//
// Principe de fiabilité : on ne réécrit que des tokens de classe EXACTS connus de
// l'alias (mot entier). Une classe construite dynamiquement (concaténation) n'est
// volontairement pas réécrite : la CHARTE demande à Claude de cibler data-* dans ce cas.

// Caractères d'un identifiant de classe CSS (non échappé).
const CLASS_CH = '[A-Za-z0-9_\\u00a0-\\uffff-]';

// ---------------------------------------------------------------------------
// buildAlias
// ---------------------------------------------------------------------------

// classe -> `eks-<uid>-N`, seulement pour les classes connues d'une règle CSS.
// Ordre = ordre d'entrée (dédupliqué), numérotation continue à partir de 1.
export function buildAlias(usedClasses, knownClasses, uid) {
  const alias = new Map();
  let n = 0;
  for (const cls of usedClasses) {
    if (!cls || alias.has(cls) || !knownClasses.has(cls)) continue;
    n += 1;
    alias.set(cls, `eks-${uid}-${n}`);
  }
  return alias;
}

// ---------------------------------------------------------------------------
// rewriteHtmlClasses
// ---------------------------------------------------------------------------

// Commentaires | blocs <script>/<style> (laissés tels quels) | balises ouvrantes.
// Les valeurs d'attributs quotées peuvent contenir `>` sans couper la balise.
const HTML_TAG_RE =
  /<!--[\s\S]*?-->|<(script|style)\b(?:"[^"]*"|'[^']*'|[^'">])*>[\s\S]*?<\/\1\s*>|<([a-zA-Z][a-zA-Z0-9:-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/gi;
const HTML_ATTR_RE = /(\s+)([^\s=>/"']+)(?:(\s*=\s*)("[^"]*"|'[^']*'|[^\s"'>]+))?/g;

// Remplace les classes des éléments par leur alias ; une classe sans alias est
// supprimée (attribut retiré s'il devient vide). Le texte, les autres attributs,
// <script>, <style> et les commentaires ne sont pas touchés.
export function rewriteHtmlClasses(html, alias) {
  return html.replace(HTML_TAG_RE, (match, blockName, tagName, attrs) => {
    if (blockName || match.startsWith('<!--')) return match;
    const newAttrs = attrs.replace(HTML_ATTR_RE, (whole, ws, name, eq, rawValue) => {
      if (name.toLowerCase() !== 'class' || rawValue === undefined) return whole;
      const value = /^["']/.test(rawValue) ? rawValue.slice(1, -1) : rawValue;
      const mapped = value
        .split(/\s+/)
        .filter(Boolean)
        .map((c) => alias.get(c))
        .filter(Boolean);
      return mapped.length ? `${ws}class="${mapped.join(' ')}"` : '';
    });
    return `<${tagName}${newAttrs}>`;
  });
}

// ---------------------------------------------------------------------------
// rewriteSelector
// ---------------------------------------------------------------------------

// Chaînes et [attributs] sautés ; sinon token `.classe` (échappements CSS permis).
const SELECTOR_TOKEN_RE = new RegExp(
  `"(?:\\\\.|[^"\\\\])*"|'(?:\\\\.|[^'\\\\])*'|\\[[^\\]]*\\]|\\.((?:\\\\.|${CLASS_CH})+)`,
  'g',
);

// Renomme les tokens `.classe` d'un sélecteur CSS (mot entier). Une classe sans
// alias est laissée telle quelle.
export function rewriteSelector(selector, alias) {
  return selector.replace(SELECTOR_TOKEN_RE, (match, token) => {
    if (token === undefined) return match;
    const name = token.replace(/\\(.)/g, '$1'); // `md\:px-4` -> `md:px-4`
    const to = alias.get(name);
    return to ? `.${to}` : match;
  });
}

// ---------------------------------------------------------------------------
// rewriteJsClasses
// ---------------------------------------------------------------------------

// `.classe` (mot entier) dans le texte d'une chaîne JS (sélecteur).
const JS_DOT_CLASS_RE = new RegExp(`\\.(${CLASS_CH}+)`, 'g');
// class="a b" / class='a b' (éventuellement échappé \") dans du markup construit en JS.
const JS_CLASS_ATTR_RE = /((?<![\w-])class\s*=\s*\\?(["']))([^"'\\]*)/g;

const REGEX_PRECEDERS = new Set('(,=:[!&|?{};+-*%<>~^}');
const REGEX_KEYWORDS = new Set([
  'return', 'typeof', 'case', 'in', 'of', 'void', 'delete', 'throw', 'new', 'instanceof', 'yield', 'await',
]);

function rewriteClassList(text, alias) {
  return text.replace(/[^\s]+/g, (t) => alias.get(t) ?? t);
}

// `atEnd` : la chaîne est coupée juste après (template avant ${}) ou non terminée ;
// le dernier token d'une valeur class="..." peut alors être partiel et reste intact.
function rewriteSelectorInString(text, alias, atEnd) {
  let out = text.replace(JS_DOT_CLASS_RE, (m, name) => {
    const to = alias.get(name);
    return to ? `.${to}` : m;
  });
  out = out.replace(JS_CLASS_ATTR_RE, (m, head, _q, value, offset, whole) => {
    const partialTail = atEnd && offset + m.length === whole.length && !/\s$/.test(value);
    const tokens = value.split(/(\s+)/);
    const lastTok = tokens.length - 1;
    const mapped = tokens.map((t, idx) => {
      if (/^\s*$/.test(t)) return t;
      if (partialTail && idx === lastTok) return t;
      return alias.get(t) ?? t;
    });
    return head + mapped.join('');
  });
  return out;
}

// Parcourt du code JS en sautant commentaires et littéraux regex ; réécrit
// uniquement le contenu des chaînes, selon le contexte (API de classes ou sélecteur).
function scan(src, start, alias, stopAtBrace) {
  const n = src.length;
  let out = '';
  let i = start;
  let braceDepth = 0;
  let parenDepth = 0;
  const calls = []; // appels d'API : { depth, kind: 'list' | 'attr' }
  let pending = 0; // 1 : la prochaine chaîne est une liste de classes ; 2 : virgule puis 1
  let lastSig = '';
  let lastWord = '';

  const inListCall = () => {
    const c = calls[calls.length - 1];
    return c && c.kind === 'list' && c.depth === parenDepth;
  };
  const inAttrCall = () => {
    const c = calls[calls.length - 1];
    return c && c.kind === 'attr' && c.depth === parenDepth;
  };

  while (i < n) {
    const ch = src[i];

    if (/\s/.test(ch)) { out += ch; i += 1; continue; }

    // Commentaires : copiés tels quels (une apostrophe dedans ne casse pas le scan).
    if (ch === '/' && src[i + 1] === '/') {
      let j = src.indexOf('\n', i);
      if (j < 0) j = n;
      out += src.slice(i, j); i = j; continue;
    }
    if (ch === '/' && src[i + 1] === '*') {
      let j = src.indexOf('*/', i + 2);
      j = j < 0 ? n : j + 2;
      out += src.slice(i, j); i = j; continue;
    }

    const isString = ch === '"' || ch === "'" || ch === '`';
    if (pending === 2) {
      if (ch === ',') { pending = 1; out += ch; i += 1; lastSig = ch; lastWord = ''; continue; }
      pending = 0;
    } else if (pending === 1 && !isString) {
      pending = 0;
    }

    // Chaînes simples
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < n && src[j] !== ch && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      const content = src.slice(i + 1, j);
      let next = content;
      if (pending === 1 || inListCall()) next = rewriteClassList(content, alias);
      else next = rewriteSelectorInString(content, alias, src[j] !== ch);
      if (inAttrCall() && content === 'class') pending = 2;
      else if (pending === 1) pending = 0;
      const close = src[j] === ch ? ch : '';
      out += ch + next + close;
      i = src[j] === ch ? j + 1 : j;
      lastSig = ch; lastWord = '';
      continue;
    }

    // Template literals : parties statiques traitées, ${expr} scanné comme du code.
    if (ch === '`') {
      const parts = []; // { s: texte statique } | { e: code réécrit }
      let cur = '';
      let j = i + 1;
      while (j < n) {
        const c = src[j];
        if (c === '\\') { cur += src.slice(j, j + 2); j += 2; continue; }
        if (c === '`') { j += 1; break; }
        if (c === '$' && src[j + 1] === '{') {
          parts.push({ s: cur }); cur = '';
          const sub = scan(src, j + 2, alias, true);
          parts.push({ e: sub.out });
          j = sub.i;
          continue;
        }
        cur += c; j += 1;
      }
      parts.push({ s: cur });
      const hasInterp = parts.some((p) => p.e !== undefined);
      const asList = pending === 1 || inListCall();
      if (pending === 1) pending = 0;
      let res = '`';
      parts.forEach((p, idx) => {
        if (p.e !== undefined) { res += '${' + p.e + '}'; return; }
        const last = idx === parts.length - 1;
        if (asList) res += hasInterp ? p.s : rewriteClassList(p.s, alias);
        else res += rewriteSelectorInString(p.s, alias, !last); // suivie d'un ${} : dernier token potentiellement partiel
      });
      out += res + '`';
      i = j; lastSig = '`'; lastWord = '';
      continue;
    }

    // Littéral regex (heuristique sur le jeton précédent)
    if (ch === '/') {
      const regexAllowed = lastSig === '' || REGEX_PRECEDERS.has(lastSig) || (lastWord && REGEX_KEYWORDS.has(lastWord));
      if (regexAllowed) {
        let j = i + 1;
        let inClass = false;
        let ok = false;
        while (j < n && src[j] !== '\n') {
          const c = src[j];
          if (c === '\\') { j += 2; continue; }
          if (c === '[') inClass = true;
          else if (c === ']') inClass = false;
          else if (c === '/' && !inClass) { ok = true; break; }
          j += 1;
        }
        if (ok) {
          j += 1;
          while (j < n && /[a-z]/i.test(src[j])) j += 1;
          out += src.slice(i, j); i = j; lastSig = ')'; lastWord = '';
          continue;
        }
      }
    }

    // Identifiants / nombres
    if (/[A-Za-z0-9_$]/.test(ch)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j += 1;
      lastWord = src.slice(i, j); lastSig = src[j - 1];
      out += lastWord; i = j;
      continue;
    }

    // Ponctuation
    if (ch === '(') {
      const tail = out.slice(-60);
      if (/classList\s*\??\.\s*(?:add|remove|toggle|contains|replace)\s*$/.test(tail) || /\bgetElementsByClassName\s*$/.test(tail)) {
        calls.push({ depth: parenDepth + 1, kind: 'list' });
      } else if (/\bsetAttribute\s*$/.test(tail)) {
        calls.push({ depth: parenDepth + 1, kind: 'attr' });
      }
      parenDepth += 1;
    } else if (ch === ')') {
      const c = calls[calls.length - 1];
      if (c && c.depth === parenDepth) calls.pop();
      parenDepth -= 1;
    } else if (ch === '{') {
      braceDepth += 1;
    } else if (ch === '}') {
      if (stopAtBrace && braceDepth === 0) return { out, i: i + 1 };
      braceDepth -= 1;
    } else if (ch === '=' && src[i + 1] !== '=' && /className\s*\+?$/.test(out.slice(-40))) {
      pending = 1;
    }
    out += ch; i += 1; lastSig = ch; lastWord = '';
  }
  return { out, i };
}

// Réécrit, dans les chaînes du JS, les classes connues de l'alias :
//  - sélecteurs : '.carousel-track', 'div.dot.on > span' (token `.classe` mot entier) ;
//  - API de classes : classList.add/remove/toggle/contains/replace, className = / +=,
//    setAttribute('class', ...), getElementsByClassName (chaîne = liste de classes) ;
//  - markup construit en JS : class="a b".
// Une chaîne nue égale à un nom de classe HORS de ces API (ex. state === 'active')
// n'est jamais réécrite. Les classes construites par concaténation ne le sont pas non plus.
export function rewriteJsClasses(js, alias) {
  if (!js || !alias || alias.size === 0) return js;
  return scan(js, 0, alias, false).out;
}

// ---------------------------------------------------------------------------
// keyframes
// ---------------------------------------------------------------------------

const KEYFRAMES_DEF_RE = /(@(?:-[a-z]+-)?keyframes\s+)([A-Za-z_][\w-]*)/gi;
const ANIMATION_DECL_RE = /((?<![\w-])(?:-[a-z]+-)?animation(?:-name)?\s*:)([^;}]*)/gi;

// Réécrit les références aux keyframes renommées dans les déclarations
// `animation` / `animation-name` (préfixes vendeur inclus). Seuls les noms de
// `renames` (mot entier) sont touchés : durées, easings et autres valeurs intacts.
export function applyKeyframeRefs(css, renames) {
  if (!renames || renames.size === 0) return css;
  return css.replace(ANIMATION_DECL_RE, (m, head, value) =>
    head +
    value.replace(/(?<![\w-])([A-Za-z_][\w-]*)(?![\w-])/g, (word) => renames.get(word) ?? word),
  );
}

// `@keyframes name` -> `name-<uid>` pour les keyframes DÉFINIES dans le css, et
// références `animation` / `animation-name` mises à jour. Idempotent.
export function namespaceKeyframes(css, uid) {
  const renames = new Map();
  for (const m of css.matchAll(KEYFRAMES_DEF_RE)) {
    if (!renames.has(m[2])) renames.set(m[2], `${m[2]}-${uid}`);
  }
  if (renames.size === 0) return { css, renames };
  const renamed = css.replace(KEYFRAMES_DEF_RE, (m, head, name) => head + renames.get(name));
  return { css: applyKeyframeRefs(renamed, renames), renames };
}

// ---------------------------------------------------------------------------
// scopeRule
// ---------------------------------------------------------------------------

// Découpe une liste de sélecteurs sur les virgules de premier niveau
// (ni dans (), ni dans [], ni dans une chaîne).
function splitSelectorList(selector) {
  const parts = [];
  let depth = 0;
  let quote = '';
  let cur = '';
  for (let i = 0; i < selector.length; i += 1) {
    const c = selector[i];
    if (quote) {
      cur += c;
      if (c === '\\') { cur += selector[i + 1] ?? ''; i += 1; } else if (c === quote) quote = '';
      continue;
    }
    if (c === '\\') { cur += c + (selector[i + 1] ?? ''); i += 1; continue; }
    if (c === '"' || c === "'") quote = c;
    else if (c === '(' || c === '[') depth += 1;
    else if (c === ')' || c === ']') depth -= 1;
    else if (c === ',' && depth === 0) { parts.push(cur); cur = ''; continue; }
    cur += c;
  }
  parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// Préfixe chaque sélecteur de `.<uid> ` : scopeRule('.title','color:red','ab12cd')
// -> `.ab12cd .title{color:red}`.
export function scopeRule(selector, body, uid) {
  const scoped = splitSelectorList(selector).map((s) => `.${uid} ${s}`).join(',');
  return `${scoped}{${body}}`;
}
