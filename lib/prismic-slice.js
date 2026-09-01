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
  return { parsePrismicDocId, buildVerbatimSliceHTML, extractTrioFromClaudeResult };
});
