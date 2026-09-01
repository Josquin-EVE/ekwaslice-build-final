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
  return { parsePrismicDocId };
});
