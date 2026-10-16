// Overlays & notifications du châssis : toast, overlay de chargement (gif), surimpression
// de génération (Lottie « Claude travaille »). Portés verbatim depuis index.html.
// Pur DOM / UI : aucune autorité sur le store. Tout est gardé (nœuds manquants → no-op).
//
// initOverlay(ctx?) -> { toast, showLoading, hideLoading, showGenOverlay }
//   ctx.document / ctx.window : hôtes (défaut globals).
//   ctx.lottiePath            : chemin de l'animation (défaut 'assets/claude-lottie.json').

export function initOverlay(ctx = {}) {
  const doc = ctx.document || (typeof globalThis !== 'undefined' ? globalThis.document : null);
  const win = ctx.window || (doc && doc.defaultView) || (typeof globalThis !== 'undefined' ? globalThis : null);
  const byId = (id) => (doc ? doc.getElementById(id) : null);
  const lottiePath = ctx.lottiePath || 'assets/claude-lottie.json';

  // --- toast --------------------------------------------------------------------------
  function toast(msg) {
    if (!doc || !doc.body) return;
    let t = byId('ekw-toast');
    if (!t) {
      t = doc.createElement('div');
      t.id = 'ekw-toast';
      t.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[120] px-4 py-2 rounded-lg bg-ink-deep border border-secondary text-cloud text-xs shadow-2xl transition-opacity';
      doc.body.appendChild(t);
    }
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(t._h);
    t._h = (win && win.setTimeout ? win.setTimeout : setTimeout)(() => { t.style.opacity = '0'; }, 1600);
  }

  // --- overlay de chargement (opérations async : Prismic…) ----------------------------
  function showLoading(msg) {
    const o = byId('ekw-loading');
    const m = byId('ekw-loading-msg');
    if (m) m.textContent = msg || '';
    if (o) {
      const img = o.querySelector('img[data-src]'); // lazy : charge le gif seulement à l'ouverture
      if (img && !img.getAttribute('src')) img.src = img.dataset.src;
      o.classList.remove('hidden'); o.classList.add('flex');
    }
  }
  function hideLoading() {
    const o = byId('ekw-loading');
    if (o) {
      o.classList.add('hidden'); o.classList.remove('flex');
      const img = o.querySelector('img[data-src]'); // libère le décodage au repos
      if (img) img.removeAttribute('src');
    }
  }

  // --- surimpression de génération (Lottie) -------------------------------------------
  let _genAnim = null;
  function showGenOverlay(on) {
    const ov = byId('gen-overlay');
    if (!ov) return;
    ov.classList.toggle('hidden', !on);
    ov.classList.toggle('flex', on);
    const lottie = win && win.lottie;
    if (on) {
      if (!_genAnim && lottie) {
        try {
          _genAnim = lottie.loadAnimation({
            container: byId('gen-lottie'),
            renderer: 'svg', loop: true, autoplay: true,
            path: lottiePath,
          });
        } catch (_) { /* lottie pas prêt : ignoré */ }
      }
      if (_genAnim) { try { _genAnim.goToAndPlay(0, true); } catch (_) { } }
    } else if (_genAnim) {
      try { _genAnim.stop(); } catch (_) { }
    }
  }

  return { toast, showLoading, hideLoading, showGenOverlay };
}
