const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { spawn, execSync } = require('child_process');

// ---------------------------------------------------------------------------
// DOSSIER DE DONNÉES FIGÉ — la bibliothèque de composants vit dans userData
// (hors du bundle .app → une MAJ .dmg ne la touche JAMAIS). On FIGE le nom du
// dossier ici pour qu'il ne bouge plus, même si package.json "name" change à
// l'avenir → l'utilisateur ne perd jamais sa biblio entre les versions.
// ---------------------------------------------------------------------------
const DATA_DIR = 'EkwaSlice';
try { app.setPath('userData', path.join(app.getPath('appData'), DATA_DIR)); } catch (_) { }

// ---------------------------------------------------------------------------
// CHARTE GRAPHIQUE — éditez ce bloc pour changer le style imposé à Claude.
// Injecté comme "system prompt" à chaque génération.
// ---------------------------------------------------------------------------
// Modèle utilisé pour la génération. Sonnet = bon rapport coût/qualité pour du HTML.
// Mettez 'claude-opus-5' si vous voulez la qualité max (plus cher/lent).
const MODEL = 'claude-sonnet-5';

const CHARTE = `Tu es l'assistant de l'équipe marketing d'Ekwateur (fournisseur d'énergie 100%
renouvelable en France) dans un studio de création de composants web.

Tu converses normalement en français, de façon concise et utile. Tu peux expliquer,
proposer, itérer sur les composants au fil de la conversation.

Dès que tu proposes ou modifies un composant, tu inclus son code dans un bloc \`\`\`html
(un seul bloc par composant). Ce code utilise EXCLUSIVEMENT des classes utilitaires
Tailwind CSS avec les TOKENS DE LA CHARTE EKWATEUR ci-dessous — jamais des couleurs
Tailwind génériques (pas de blue-600, slate, emerald…).

STRUCTURE "WIDGET ENCAPSULÉ" (modèle de référence, comme les composants du site) :
- Le composant est un bloc posé sur le fond le plus sombre bg-night (#101c1e).
- Conteneur / carte : bg-ink (#132527), bordure 1px border-line (#1D393D), rounded-card (16px).
  → en pratique : class="bg-ink border border-line rounded-card p-6 md:p-8".
- Sous-cartes / choix internes : bg-ink (ou bg-ink-mid si besoin de contraste) + border border-line + rounded-card.
- Éléments de saisie (inputs) : fond bg-night ou bg-ink-mid, border border-line, rounded-tag (pilule).

COULEURS (classes Tailwind disponibles) :
- Fonds sombres : bg-night (#101c1e, le plus sombre / hors-carte), bg-ink (#132527, carte),
  bg-ink-mid (#1D383C, surélevé), bg-ink-light (#2C5359, surélevé+). bg-ink-deep (#0F1A1C) existe aussi.
- Bordures : border-line (#1D393D) = bordure principale (1px) des cartes/widgets/inputs.
- Textes sur fond sombre : text-cloud (#F8FBFB, principal), text-soft (#C0DDE2, secondaire),
  text-muted (#A0B8BC, discret).
- MISE EN AVANT / highlight (titres, chiffres clés, accents) : text-secondary (#FFC969, jaune).
  Les grands titres de section sont souvent en text-secondary (#FFC969).
- INTERACTIF / CTA : bg-cta / text-cta (#74F1E3, turquoise clair) — voir BOUTONS.
- Marque : primary (#17E7D0) reste dispo pour des accents ; energy : elec (#009A59), gas (#2F80DE),
  elecmob (#9A55E1). Sémantique : success (#7BE87F), warning (#FBAA6E), error (#FFA3A3), info (#82DCEF).

TYPOGRAPHIE :
- Titres : classe font-display (Carnero, serif), toujours font-bold.
- Corps de texte : classe font-body (Gothic A1, sans-serif).

BOUTONS (toujours en PILULE rounded-tag, avec transition + hover) :
- CTA PRIMAIRE (action principale) : fond bg-cta (#74F1E3), texte text-night (#101c1e), font-semibold.
  Ex : class="bg-cta text-night font-semibold rounded-tag px-6 py-3 transition hover:brightness-110".
- CTA SECONDAIRE : contour — fond bg-night (#101c1e), texte + bordure text-cta / border-cta (#74F1E3).
  Ex : class="bg-night text-cta border border-cta rounded-tag px-6 py-3 transition hover:brightness-110".
- CTA DÉSACTIVÉ : fond bg-ink-light (#2C5359), texte text-muted, opacity-60, cursor-not-allowed
  (garde la pilule). Ex : class="bg-ink-light text-muted opacity-60 cursor-not-allowed rounded-tag px-6 py-3".
- Jamais de bouton rectangulaire dur : toujours rounded-tag (pilule).

CHAMPS DE SAISIE (input / select / textarea) :
- Pilule rounded-tag, fond bg-night (#101c1e) ou bg-ink-mid, bordure border-line (#1D393D),
  texte text-cloud, placeholder text-muted, focus:border-cta. px-4/px-5 py-3.
- Icône éventuelle dans le champ (recherche, etc.) en text-cta (#74F1E3).

STEPPERS / ÉTAPES (parcours en plusieurs étapes) :
- Étape ACTIVE : pastille ronde bg-cta (#74F1E3) + numéro text-night, label text-cta font-semibold.
- Étape FAITE : pastille ronde contour border-cta + coche (check) text-cta, label text-soft.
- Étape À VENIR : numéro et label en text-muted, pas de fond de pastille.
- Traits de liaison entre étapes : border-line (#1D393D).

FORMES :
- Cartes / conteneurs : rounded-card (16px). Petites cartes : rounded-card-sm (8px).
- Boutons / champs / badges : rounded-tag (pilule).

PICTOGRAMMES DE MARQUE (secondaire, à utiliser avec parcimonie) :
- Pour une illustration/picto de marque Ekwateur, tu PEUX utiliser un pictogramme officiel
  via : <img data-picto="NOM" class="w-12 h-12" alt="">. Le studio remplace automatiquement
  data-picto par la vraie image (rendu local dans l'app, URL Prismic à l'export).
- N'utilise QUE des noms de cette liste (sinon le picto sera ignoré) — n'invente JAMAIS un nom
  ni une URL de picto :
  ampoule, feuille, maison, maison-eclairee, soleil, panneau-solaire-soleil, maison-panneau-solaire,
  gaz, gaz-renouvelable, elec-gaz, electricite-europe, voiture-elec-rechargeable, cadeau,
  bouclier-garantie-securise, poignee-de-main-accord, recyclage, planete-energie-renouvelable,
  service-client-appel-conseille, calendrier, tirelire-pleine, document-signature, wifi.
- Pour les icônes d'interface génériques (flèches, coches, puces…), continue d'utiliser Font Awesome.

RÈGLES :
- LARGEUR DU CONTENEUR : chaque message peut indiquer "[Contexte d'affichage]" avec la
  largeur MAX du conteneur cible (ex : 712px pour le blog, 1080px pour une page générale).
  Conçois la mise en page POUR cette largeur : le contenu desktop ne dépasse pas cette valeur,
  et le nombre de colonnes / la taille des typos et images sont pensés pour cette largeur.
  Ex : à 712px évite les grilles à 4 colonnes ; à 1080px tu as plus de place.
- MOBILE-FIRST OBLIGATOIRE : 60% du trafic Ekwateur est sur mobile. Conçois d'abord pour
  petit écran, puis élargis avec les préfixes responsive de Tailwind (sm:, md:, lg:).
  Ex : "flex flex-col md:flex-row", "text-2xl md:text-4xl", "grid-cols-1 md:grid-cols-3",
  "px-4 md:px-8". Jamais de largeur fixe en pixels qui déborderait sur mobile ; utilise
  w-full, max-w-*, et des espacements qui s'adaptent. Les images/blocs restent lisibles à 390px.
- DARK MODE OBLIGATOIRE : fond le plus sombre bg-night (#101c1e) hors-carte, cartes en bg-ink
  (#132527) avec bordure border-line. N'utilise JAMAIS de fond blanc ou clair.
- Sur ces fonds sombres : texte courant en text-soft, détails en text-muted, texte fort en text-cloud.
  Les titres / mises en avant importantes en text-secondary (#FFC969, jaune).
- CTA : primaire = bg-cta text-night (pilule) ; secondaire = contour text-cta/border-cta sur bg-night.
- Ton clair, chaleureux, engageant, orienté énergie 100% renouvelable et transparence.
- Textes en français.
- STYLE : uniquement des classes Tailwind (pas de balise <style> ni d'attribut style=""
  massif). Le studio compile ces classes en CSS plain à l'export.
- INTERACTIVITÉ / JS : autorisé quand c'est utile (carrousel, accordéon, compteur, onglets…).
  Mets le JS dans UN SEUL bloc <script> à la toute fin du composant. JS "vanilla" pur
  (pas de dépendance externe, pas de CDN). Le script doit être autonome et idempotent
  (ré-exécutable), et cibler ses éléments via des sélecteurs internes au composant
  (idéalement un data-attribut ou une classe propre au composant), jamais document.body
  global. Le studio extrait ce <script> dans le champ JS à l'export.
- TABLEAUX (<table>) — règles SPÉCIFIQUES car le CSS du site écrase le style des tableaux :
  1) PAS de fond de carte/slice autour d'un tableau : le <table> et son conteneur restent
     SANS bg-ink/bg-night (fond transparent), pour s'intégrer directement à la page. Le style
     porte sur les cellules, pas sur un bloc englobant coloré.
  2) Sur CHAQUE cellule (td, th) et bordure de cellule, force le style avec le préfixe "!"
     de Tailwind (= !important) SINON le site réécrit tout. Ex OBLIGATOIRE :
     !border !border-line !px-4 !py-3 !text-left !text-soft (+ th : !text-cloud !font-semibold).
     Utilise border-collapse sur le <table> et !bg-transparent (ou une couleur de charte en !)
     sur les cellules si un fond est voulu. Les !important ne s'appliquent QU'AUX tableaux.
- N'inclus PAS de balise <html>, <head> ni <body> : seulement le fragment du composant
  (+ éventuellement le <script> final).`;

// Résout le chemin absolu du binaire claude (l'app packagée n'hérite pas du PATH du shell)
function resolveClaudeBin() {
  const candidates = [
    process.env.CLAUDE_BIN,
    path.join(os.homedir(), '.local/bin/claude'),
    path.join(os.homedir(), '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude'
  ].filter(Boolean);

  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch (_) {}
  }
  // Dernier recours : demander à un shell de login (charge le PATH utilisateur)
  try {
    const found = execSync('zsh -lic "command -v claude"', { encoding: 'utf8' }).trim();
    if (found) return found;
  } catch (_) {}
  return 'claude'; // laisse spawn tenter le PATH courant
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(__dirname, 'assets/logo.png'),
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });
  win.loadFile('index.html');
}

// Enlève un éventuel bloc de code markdown si le modèle en ajoute un
function stripFences(text) {
  let t = (text || '').trim();
  const m = t.match(/^```(?:html)?\s*([\s\S]*?)\s*```$/i);
  if (m) t = m[1].trim();
  return t;
}

// --- IPC : état de connexion (CLI installé ? compte connecté ?) ---
ipcMain.handle('check-claude', async () => {
  const bin = resolveClaudeBin();
  const installed = bin === 'claude' ? false : (() => {
    try { return fs.existsSync(bin); } catch (_) { return false; }
  })();
  if (!installed) return { installed: false, loggedIn: false, bin };

  return new Promise((resolve) => {
    let out = '', err = '';
    let child;
    try {
      child = spawn(bin, ['auth', 'status'], { cwd: os.tmpdir() });
    } catch (e) {
      return resolve({ installed: true, loggedIn: false, bin, error: e.message });
    }
    const timer = setTimeout(() => { child.kill(); resolve({ installed: true, loggedIn: false, bin, error: 'timeout' }); }, 10000);
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ installed: true, loggedIn: false, bin, error: e.message }); });
    child.on('close', () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        resolve({
          installed: true,
          loggedIn: !!j.loggedIn,
          email: j.email || '',
          org: j.orgName || '',
          subscription: j.subscriptionType || '',
          bin
        });
      } catch (_) {
        resolve({ installed: true, loggedIn: false, bin, error: err.trim() || 'parse' });
      }
    });
  });
});

// --- IPC : générer un composant via Claude Code (headless) ---
ipcMain.handle('generate-component', async (event, prompt) => {
  if (!prompt || !prompt.trim()) return { error: 'Prompt vide.' };

  const bin = resolveClaudeBin();
  const args = [
    '-p', prompt,
    '--model', MODEL,
    '--output-format', 'json',
    '--append-system-prompt', CHARTE
  ];

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { cwd: os.tmpdir() });
    } catch (e) {
      return resolve({ error: 'Impossible de lancer claude : ' + e.message });
    }

    let out = '', err = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ error: 'Délai dépassé (90 s). Claude a mis trop de temps.' });
    }, 90000);

    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });

    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ error: 'CLI claude introuvable (' + bin + ') : ' + e.message });
    });

    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        return resolve({ error: err.trim() || ('claude a quitté avec le code ' + code) });
      }
      try {
        const json = JSON.parse(out);
        // Format --output-format json : le texte final est dans .result
        const html = stripFences(json.result || '');
        if (!html) return resolve({ error: 'Réponse vide de Claude.' });
        // Comptabilité tokens/coût de CETTE génération (usage renvoyé par le CLI)
        const u = json.usage || {};
        const tokens = (u.input_tokens || 0) + (u.output_tokens || 0)
          + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        resolve({ html, tokens, cost: json.total_cost_usd || 0 });
      } catch (e) {
        resolve({ error: 'Parsing impossible : ' + e.message + ' — brut : ' + out.slice(0, 200) });
      }
    });
  });
});

// --- IPC : conversation continue avec Claude (garde le contexte) ---
ipcMain.handle('send-chat', async (event, payload) => {
  const message = payload && payload.message;
  const sessionId = payload && payload.sessionId;
  if (!message || !message.trim()) return { error: 'Message vide.' };

  const bin = resolveClaudeBin();
  const args = ['-p', message, '--model', MODEL, '--output-format', 'json', '--append-system-prompt', CHARTE];
  if (sessionId) args.push('--resume', sessionId);

  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(bin, args, { cwd: os.tmpdir() });
    } catch (e) {
      return resolve({ error: 'Impossible de lancer claude : ' + e.message });
    }
    let out = '', err = '';
    const timer = setTimeout(() => {
      child.kill();
      resolve({ error: 'Délai dépassé (120 s).' });
    }, 120000);
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: 'CLI claude introuvable : ' + e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve({ error: err.trim() || ('claude a quitté (code ' + code + ')') });
      try {
        const j = JSON.parse(out);
        const u = j.usage || {};
        const tokens = (u.input_tokens || 0) + (u.output_tokens || 0)
          + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        resolve({ text: j.result || '', sessionId: j.session_id || sessionId || null, tokens, cost: j.total_cost_usd || 0 });
      } catch (e) {
        resolve({ error: 'Parsing impossible : ' + e.message });
      }
    });
  });
});

// ---------------------------------------------------------------------------
// BIBLIOTHÈQUE DE COMPOSANTS — persistée sur disque (userData/library.json).
// Stocke le HTML "auteur" du slice (ré-éditable + ré-exportable à tout moment).
// ---------------------------------------------------------------------------
function libraryPath() { return path.join(app.getPath('userData'), 'library.json'); }
function readLibrary() {
  try { return JSON.parse(fs.readFileSync(libraryPath(), 'utf8')) || []; }
  catch (_) { return []; }
}
function writeLibrary(list) {
  try {
    const p = libraryPath();
    fs.mkdirSync(path.dirname(p), { recursive: true }); // le dossier peut ne pas exister
    fs.writeFileSync(p, JSON.stringify(list));
    return true;
  } catch (e) { return false; }
}
// Récupère la biblio d'anciens noms de dossier (avant qu'il soit figé), UNE SEULE FOIS,
// sans jamais supprimer/écraser une biblio existante non vide (100% non-destructif).
function migrateLibraryIfNeeded() {
  try {
    const target = libraryPath();
    let cur = null;
    try { cur = JSON.parse(fs.readFileSync(target, 'utf8')); } catch (_) { cur = null; }
    if (Array.isArray(cur) && cur.length > 0) return; // déjà des slices → on ne touche à RIEN
    const appData = app.getPath('appData');
    const olds = ['studio-composants', 'Studio Composants', 'StudioComposants', 'Ekwaslice'];
    for (const name of olds) {
      const src = path.join(appData, name, 'library.json');
      if (path.resolve(src) === path.resolve(target)) continue;
      let data = null;
      try { data = JSON.parse(fs.readFileSync(src, 'utf8')); } catch (_) { continue; }
      if (Array.isArray(data) && data.length) {
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, JSON.stringify(data)); // COPIE (la source reste intacte)
        break;
      }
    }
  } catch (_) { }
}
ipcMain.handle('library-list', async () => readLibrary());
ipcMain.handle('library-save', async (event, item) => {
  if (!item || !item.html) return { error: 'Composant vide.' };
  const list = readLibrary();
  const id = item.id || ('c-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
  const i = list.findIndex(x => x.id === id);
  const prev = i >= 0 ? list[i] : {};
  // Écrasement d'un item existant : on PRÉSERVE les champs non fournis (remoteId/source/
  // author/createdAt) → garde le lien cloud quand on met à jour le html d'un composant publié.
  const rec = {
    id,
    name: (item.name || prev.name || 'Composant').slice(0, 80),
    html: item.html,
    createdAt: item.createdAt || prev.createdAt || Date.now(),
    source: item.source || prev.source || 'local',
    author: item.author !== undefined ? item.author : (prev.author || ''),
    remoteId: item.remoteId !== undefined ? item.remoteId : (prev.remoteId || null)
  };
  if (i >= 0) list[i] = rec; else list.unshift(rec);
  if (!writeLibrary(list)) return { error: 'Écriture impossible.' };
  return { list };
});
ipcMain.handle('library-delete', async (event, id) => {
  const list = readLibrary().filter(x => x.id !== id);
  writeLibrary(list);
  return { list };
});

// ---------------------------------------------------------------------------
// BIBLIOTHÈQUE PARTAGÉE EN LIGNE (Supabase) — publier / recharger.
// La clé "publishable" est PUBLIQUE par design (protégée par les policies RLS
// select+insert de la table `components`) → OK de l'embarquer dans l'app. On
// n'embarque JAMAIS la clé service_role. Aucune suppression distante depuis
// l'app en v1 (évite qu'un user efface la biblio de toute l'équipe).
// ---------------------------------------------------------------------------
const SUPABASE_URL = 'https://pmkyywodvhpuigpaauil.supabase.co';
const SUPABASE_KEY = 'sb_publishable_8qiTIeB0EQauo9OhZ7vrMw_3s3AhYzG';
function sbHeaders(extra) {
  return Object.assign({ apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY }, extra || {});
}
ipcMain.handle('shared-list', async () => {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch(
      SUPABASE_URL + '/rest/v1/components?select=id,name,author,html,created_at,updated_at&order=created_at.desc',
      { headers: sbHeaders(), signal: ctrl.signal }
    );
    clearTimeout(t);
    if (!res.ok) return { error: 'HTTP ' + res.status };
    const rows = await res.json();
    return { list: Array.isArray(rows) ? rows : [] };
  } catch (e) { return { error: e.message }; }
});
ipcMain.handle('shared-publish', async (event, item) => {
  if (!item || !item.html || !item.name) return { error: 'Composant vide.' };
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const body = {
      name: String(item.name).slice(0, 120),
      author: String(item.author || '').slice(0, 80),
      html: String(item.html)
    };
    if (item.ownerKey) body.owner_key = String(item.ownerKey); // clé de propriété (secrète)
    // ?select=id : ne renvoie QUE l'id (return=representation ferait un SELECT * qui inclut
    // owner_key, non lisible par anon → "permission denied").
    const res = await fetch(SUPABASE_URL + '/rest/v1/components?select=id', {
      method: 'POST',
      headers: sbHeaders({ 'Content-Type': 'application/json', Prefer: 'return=representation' }),
      body: JSON.stringify(body),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { error: 'HTTP ' + res.status + (txt ? ' ' + txt.slice(0, 120) : '') };
    }
    const rows = await res.json();
    return { row: Array.isArray(rows) ? rows[0] : rows };
  } catch (e) { return { error: e.message }; }
});
// Appel générique d'une fonction RPC Postgres (renvoie le corps décodé).
async function sbRpc(fn, args) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  try {
    const res = await fetch(SUPABASE_URL + '/rest/v1/rpc/' + fn, {
      method: 'POST',
      headers: sbHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(args || {}),
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      return { error: 'HTTP ' + res.status + (txt ? ' ' + txt.slice(0, 120) : '') };
    }
    return { result: await res.json() };
  } catch (e) { clearTimeout(t); return { error: e.message }; }
}
// SUPPRIMER sa publication (la RPC vérifie owner_key côté serveur → renvoie true si effacé).
ipcMain.handle('shared-delete', async (event, payload) => {
  const id = payload && payload.id, ownerKey = payload && payload.ownerKey;
  if (!id || !ownerKey) return { error: 'id/clé manquant.' };
  const r = await sbRpc('delete_component', { p_id: id, p_owner_key: ownerKey });
  if (r.error) return r;
  return { ok: r.result === true };
});
// METTRE À JOUR sa publication (idem, true si mis à jour).
ipcMain.handle('shared-update', async (event, payload) => {
  const id = payload && payload.id, ownerKey = payload && payload.ownerKey;
  if (!id || !ownerKey || !payload.html) return { error: 'id/clé/html manquant.' };
  const r = await sbRpc('update_component', {
    p_id: id, p_owner_key: ownerKey,
    p_name: (payload.name || '').slice(0, 120), p_html: String(payload.html)
  });
  if (r.error) return r;
  return { ok: r.result === true };
});

// ---------------------------------------------------------------------------
// MISE À JOUR — vérif légère (sans signature) : compare la version locale à la
// dernière GitHub Release. Ne télécharge/installe RIEN ; le renderer affiche une
// bannière avec un lien de téléchargement (install manuelle).
// NB: pour que la vérif aboutisse, les Releases doivent être PUBLIQUES (repo public
// ou repo public dédié aux releases). Sinon l'API renvoie 404 → pas de bannière.
// ---------------------------------------------------------------------------
const UPDATE_REPO = 'Josquin-EVE/ekwaslice-build-final';
function cmpSemver(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < 3; i++) { if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0); }
  return 0;
}
ipcMain.handle('check-update', async () => {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://api.github.com/repos/${UPDATE_REPO}/releases/latest`, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'EkwaSlice-Updater' },
      signal: ctrl.signal
    });
    clearTimeout(t);
    if (!res.ok) return { ok: false, status: res.status };
    const j = await res.json();
    const latest = (j.tag_name || '').replace(/^v/i, '').trim();
    const current = app.getVersion();
    const dmg = (j.assets || []).find(a => /\.dmg$/i.test(a.name));
    return {
      ok: true,
      update: latest ? cmpSemver(latest, current) > 0 : false,
      version: latest, current,
      url: j.html_url,
      download: dmg ? dmg.browser_download_url : (j.html_url || null),
      notes: (j.body || '').slice(0, 500)
    };
  } catch (e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('open-external', async (event, url) => {
  if (typeof url === 'string' && /^https?:\/\//i.test(url)) { shell.openExternal(url); return true; }
  return false;
});

app.whenReady().then(() => {
  migrateLibraryIfNeeded(); // récupère les slices d'un ancien nom de dossier (non-destructif)
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
