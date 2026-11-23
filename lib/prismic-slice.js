(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PrismicSlice = api;
})(typeof self !== 'undefined' ? self : this, function () {
  function parsePrismicDocId(input) {
    const s = String(input || '').trim();
    if (!s) return null;
    const mUrl = s.match(/\/pages\/([A-Za-z0-9_-]+)/);
    if (mUrl) return mUrl[1];
    const mId = s.match(/^[A-Za-z0-9_-]{10,}$/);
    return mId ? s : null;
  }
  function neutralizeScripts(html) {
    return String(html || '').replace(/<script(?![^>]*\stype=)([^>]*)>/gi, '<script type="text/ekw-js"$1>');
  }
  function buildVerbatimSliceHTML(trio) {
    trio = trio || {};
    const css = (trio.css || '').trim();
    const js = (trio.js || '').trim();
    const content = (trio.html_only || '').trim() || (trio.html || '').trim();
    let out = '<div>';
    if (css) out += '<style>' + css + '</style>';
    out += neutralizeScripts(content);
    if (js) out += '<script type="text/ekw-js">' + js + '</script>';
    out += '</div>';
    return out;
  }
  // Nom de slice affichable : rejette une valeur qui ressemble à du CSS/code (fuite d'un
  // bloc <style>/@font-face dans le nom dérivé du HTML), tronque les noms trop longs, et
  // retombe sur un libellé dérivé de l'id quand il ne reste rien de lisible.
  function cleanSliceName(raw, id) {
    let s = (typeof raw === 'string' ? raw : '').replace(/\s+/g, ' ').trim();
    if (s && /@font-face|font-family\s*:|\bsrc\s*:\s*url|url\(|[{}]|;base64,/i.test(s)) s = '';
    if (s.length > 80) s = s.slice(0, 80).trim();
    if (!s) { const short = (typeof id === 'string' ? id : '').slice(0, 6); return short ? 'Slice ' + short : 'Slice'; }
    return s;
  }
  function extractTrioFromClaudeResult(text) {
    const s = String(text || '');
    let jsonStr = null;
    const fence = s.match(/```json\s*([\s\S]*?)```/i);
    if (fence) jsonStr = fence[1];
    else { const b = s.indexOf('{'), e = s.lastIndexOf('}'); if (b >= 0 && e > b) jsonStr = s.slice(b, e + 1); }
    if (!jsonStr) return null;
    try { const o = JSON.parse(jsonStr); if (o && (('html' in o) || ('html_only' in o))) return o; } catch (_) { }
    return null;
  }
  return { parsePrismicDocId, buildVerbatimSliceHTML, extractTrioFromClaudeResult, cleanSliceName };
});
