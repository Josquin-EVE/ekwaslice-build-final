const { app, BrowserWindow, ipcMain, shell } = require('electron');
const path = require('path');
const os = require('os');
const PrismicSlice = require('./lib/prismic-slice.js');
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
  * TEXTE TOUJOURS DANS LE HTML : tous les LIBELLÉS et phrases (titres, labels, textes de
    boutons, messages d'état comme « Prix en vigueur aujourd'hui », unités) s'écrivent DANS LE
    HTML, jamais depuis le JS. Le JS ne doit JAMAIS poser de texte de libellé
    (pas de textContent="Un libellé…"/innerHTML d'un libellé) : il ne met à jour QUE des VALEURS
    dynamiques (chiffres, prix) via des <span data-f="…"> déjà présents dans le HTML avec une
    valeur de repli. Ainsi tout le texte reste éditable au clic dans le studio ; seul le chiffre
    change à l'exécution. (Un message d'état variable : mets les 3 variantes en HTML ou n'change
    qu'un <span data-f> chiffré, pas la phrase entière.)
- TABLEAUX (<table>) — règles SPÉCIFIQUES car le CSS du site écrase le style des tableaux :
  1) PAS de fond de carte/slice autour d'un tableau : le <table> et son conteneur restent
     SANS bg-ink/bg-night (fond transparent), pour s'intégrer directement à la page. Le style
     porte sur les cellules, pas sur un bloc englobant coloré.
  2) Sur CHAQUE cellule (td, th) et bordure de cellule, force le style avec le préfixe "!"
     de Tailwind (= !important) SINON le site réécrit tout. Ex OBLIGATOIRE :
     !border !border-line !px-4 !py-3 !text-left !text-soft (+ th : !text-cloud !font-semibold).
     Utilise border-collapse sur le <table> et !bg-transparent (ou une couleur de charte en !)
     sur les cellules si un fond est voulu. Les !important ne s'appliquent QU'AUX tableaux.
- PRIX EKWATEUR DYNAMIQUES (API-SO) : dès que l'utilisateur veut AFFICHER ou COMPARER des
  prix Ekwateur réels (abonnement, prix du kWh, budget annuel, économie vs TRV, comparateur,
  simulateur, pricing table — élec OU gaz), NE mets jamais des prix en dur seuls : génère un
  composant qui interroge l'API tarifs en JS. Règles STRICTES :
  * Endpoint : POST https://api-so.ekwateur.fr/quotations . Headers : accept:application/json,
    content-type:application/json, x-seller-channel-id:PSFO, x-seller-id:EKWATEUR. NE code PAS
    de Referer (le navigateur le pose ; l'API n'autorise que ekwateur.fr → hors ligne/preview
    elle renvoie 401, c'est normal : le composant garde alors ses valeurs de repli).
  * Corps ÉLEC : {codeInsee:"75056", customerType:"PRIVATE", energy:"ELECTRICITY",
    electricityProductItemType:"FIXED", electricityTariffOption:"BASE" ou "HIGH_LOW",
    electricityPower: 3|6|9|12|15|18|24|30|36, electricityAnnualConsumptionReferenceBase:<conso
    kWh/an> (en HIGH_LOW = heures pleines) ; en HIGH_LOW ajoute electricityAnnualConsumptionReferenceLow:<heures creuses, >0>}.
  * Corps GAZ : {codeInsee:"75056", customerType:"PRIVATE", energy:"GAS",
    gasProductItemType:"FIXED", gasAnnualConsumptionReference:<conso kWh/an>}.
  * GAZ 2 offres : (a) MIX 15% biométhane (défaut) → kWh = gasConsumptionBasePriceInclTaxes ;
    (b) 100% BIOMÉTHANE / gaz renouvelable → AJOUTE au corps GAZ options:[{"id":"GGO"}] et lis le
    kWh dans gasConsumptionBasePriceInclTaxesWithBioGas (abonnement IDENTIQUE au mix). Sans l'option
    GGO ce champ vaut le prix du mix (ne l'utilise donc comme "100%" QUE si tu as envoyé GGO).
  * codeInsee : garde TOUJOURS "75056" par défaut — ne le demande JAMAIS à l'utilisateur et
    ne le mentionne NI dans le texte NI dans le composant (détail technique sans intérêt).
  * Champs réponse à afficher (TTC) — ÉLEC : abo electricitySubscriptionPriceInclTaxes ;
    kWh base/HP electricityConsumptionBasePriceInclTaxes ; kWh HC electricityConsumptionLowPriceInclTaxes ;
    TRV electricitySubscriptionTRVPriceInclTaxes / electricityConsumptionBaseTRVPriceInclTaxes /
    electricityConsumptionLowTrvPriceInclTaxes. GAZ : abo gasSubscriptionPriceInclTaxes ;
    kWh gasConsumptionBasePriceInclTaxes ; TRV gasSubscriptionTRVPriceInclTaxes / gasConsumptionBaseTRVPriceInclTaxes.
  * BUDGET ANNUEL : utilise TOUJOURS les totaux de l'API — totalAnnualAmount (Ekwateur) et
    totalAnnualTRVAmount (TRV). NE recalcule JAMAIS abo×12+conso×kWh pour Ekwateur : une remise
    est incluse dans totalAnnualAmount. Économie = totalAnnualTRVAmount − totalAnnualAmount.
  * PIÈGE : l'API répond 201 même avec des prix null (champ manquant / conso 0). Juge la validité
    sur la présence des prix (ex : if (j.electricitySubscriptionPriceInclTaxes == null) → repli),
    JAMAIS sur le code HTTP.
  * Offre 100% FRANÇAISE = européenne + 0,0085 €/kWh TTC (abo identique ; jamais sur le TRV).
  * 3 ÉTATS obligatoires : valeurs de repli EN DUR dans le HTML (restent affichées si l'API échoue) ;
    « … » au chargement ; « — » + message si erreur. N'affirme JAMAIS une économie nulle/négative
    (masque l'argument dans ce cas). aria-live="polite" sur les nombres qui changent.
  * TECHNIQUE : un seul <script> final, vanilla, IIFE, idempotent (pose un data-init sur la racine),
    cible les éléments par data-attributs (data-f="…", data-ekw-widget) et JAMAIS par classe (le
    style est réécrit à l'export). Format fr-FR : abo 2 décimales, kWh 4 décimales, budget entier.
  * Le style reste 100% en classes Tailwind de la charte (comme tout composant).
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
// Modèles autorisés pour le chat (le renderer peut demander un modèle rapide).
const ALLOWED_MODELS = { 'claude-sonnet-5': 1, 'claude-haiku-4-5': 1, 'claude-opus-5': 1 };

// Runner commun : spawn claude en sortie stream-json + messages partiels, pousse les
// deltas de texte au renderer au fil de l'eau (onDelta), résout avec le résultat final.
function runClaudeStream(bin, args, stdinLine, timeoutMs, onDelta) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(bin, args, { cwd: os.tmpdir() }); }
    catch (e) { return resolve({ error: 'Impossible de lancer claude : ' + e.message }); }
    let buf = '', err = '', text = '', sid = null, tokens = 0, cost = 0, found = false;
    // Timeout d'INACTIVITÉ (pas de plafond total) : remis à zéro à chaque sortie du
    // modèle. Une réflexion longue streame des tokens → jamais coupée ; seul un
    // process réellement muet pendant timeoutMs est arrêté.
    let timer;
    const armIdle = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => { try { child.kill(); } catch (_) { } resolve({ error: 'Aucune réponse du modèle depuis ' + Math.round(timeoutMs / 1000) + ' s — arrêté. Réessaie.' }); }, timeoutMs); };
    armIdle();
    function handleLine(l) {
      l = l.trim(); if (!l) return;
      let j; try { j = JSON.parse(l); } catch (_) { return; }
      if (j.type === 'stream_event' && j.event) {
        const ev = j.event;
        if (ev.type === 'content_block_delta' && ev.delta && ev.delta.type === 'text_delta') {
          const t = ev.delta.text || '';
          if (t) { text += t; try { onDelta && onDelta(t); } catch (_) { } }
        }
      } else if (j.type === 'result') {
        found = true;
        if (typeof j.result === 'string' && j.result) text = j.result; // autorité finale
        sid = j.session_id || sid;
        const u = j.usage || {};
        tokens = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
        cost = j.total_cost_usd || 0;
      } else if (j.type === 'system' && j.session_id) {
        sid = j.session_id || sid;
      }
    }
    child.stdout.on('data', d => {
      armIdle(); // toute sortie (thinking inclus) repousse le timeout
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); handleLine(line); }
    });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: 'CLI claude introuvable : ' + e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (buf.trim()) handleLine(buf); // dernière ligne éventuelle sans \n
      if (!found) return resolve({ error: err.trim() || ('claude a quitté (code ' + code + ')') });
      resolve({ text, sessionId: sid, tokens, cost });
    });
    if (stdinLine != null) {
      try { child.stdin.write(stdinLine); child.stdin.end(); }
      catch (e) { clearTimeout(timer); resolve({ error: 'stdin: ' + e.message }); }
    }
  });
}

ipcMain.handle('send-chat', async (event, payload) => {
  const message = payload && payload.message;
  const sessionId = payload && payload.sessionId;
  const images = (payload && payload.images) || [];
  if ((!message || !message.trim()) && !images.length) return { error: 'Message vide.' };

  const model = (payload && payload.model && ALLOWED_MODELS[payload.model]) ? payload.model : MODEL;
  const bin = resolveClaudeBin();
  const onDelta = (t) => { try { event.sender.send('chat-delta', t); } catch (_) { } };

  // --- Avec image(s) : entrée stream-json (vision native), sortie stream-json + deltas live ---
  if (images.length) {
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages', '--model', model, '--append-system-prompt', CHARTE];
    if (sessionId) args.push('--resume', sessionId);
    const content = [{ type: 'text', text: message || 'Utilise cette image comme référence.' }];
    for (const im of images) {
      if (im && im.data && im.mime) content.push({ type: 'image', source: { type: 'base64', media_type: im.mime, data: im.data } });
    }
    const line = JSON.stringify({ type: 'user', message: { role: 'user', content } }) + '\n';
    const r = await runClaudeStream(bin, args, line, 300000, onDelta);
    if (r.error) return { error: r.error };
    return { text: r.text, sessionId: r.sessionId || sessionId || null, tokens: r.tokens, cost: r.cost };
  }

  // --- Texte seul : stream-json + deltas live (premier token quasi-instantané) ---
  const args = ['-p', message, '--model', model, '--output-format', 'stream-json', '--verbose',
    '--include-partial-messages', '--append-system-prompt', CHARTE];
  if (sessionId) args.push('--resume', sessionId);
  const r = await runClaudeStream(bin, args, null, 300000, onDelta);
  if (r.error) return { error: r.error };
  return { text: r.text, sessionId: r.sessionId || sessionId || null, tokens: r.tokens, cost: r.cost };
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
// Réglages persistés (userData/settings.json) — survivent aux MAJ (userData figé).
// Sert notamment au nom d'auteur (signalé dans le cloud) + clé de propriété.
function settingsPath() { return path.join(app.getPath('userData'), 'settings.json'); }
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) || {}; } catch (_) { return {}; } }
function writeSettings(o) {
  try { const p = settingsPath(); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); return true; }
  catch (_) { return false; }
}
ipcMain.handle('settings-get', async () => readSettings());
ipcMain.handle('settings-set', async (event, patch) => {
  const s = Object.assign(readSettings(), patch || {});
  writeSettings(s);
  return s;
});
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
  if (!id || !ownerKey) return { error: 'id/clé manquant.' };
  // name et html optionnels (null → la RPC garde l'ancien via coalesce) → permet un
  // simple renommage sans toucher au html.
  const r = await sbRpc('update_component', {
    p_id: id, p_owner_key: ownerKey,
    p_name: (payload.name != null && payload.name !== '') ? String(payload.name).slice(0, 120) : null,
    p_html: (payload.html != null) ? String(payload.html) : null
  });
  if (r.error) return r;
  return { ok: r.result === true };
});
// Renommer l'auteur sur TOUTES ses publications (owner). Renvoie le nb de lignes touchées.
ipcMain.handle('shared-rename-author', async (event, payload) => {
  const ownerKey = payload && payload.ownerKey;
  if (!ownerKey) return { error: 'clé manquante.' };
  const r = await sbRpc('rename_author', { p_owner_key: ownerKey, p_author: String((payload && payload.author) || '').slice(0, 80) });
  if (r.error) return r;
  return { count: (typeof r.result === 'number') ? r.result : 0 };
});

// ---------------------------------------------------------------------------
// PUSH PRISMIC — envoie une slice directement dans Prismic (custom_slice) via le
// CLI headless + MCP Prismic (mcp__claude_ai_Prismic). Crée un DOCUMENT dans une
// release fixe "EkwaSlice" (créée si absente). NE PUBLIE JAMAIS (publication
// manuelle depuis le dashboard). allowlist d'outils scopée (pas de skip-permissions).
// ---------------------------------------------------------------------------
ipcMain.handle('push-prismic', async (event, payload) => {
  const title = ((payload && payload.title) || '').trim();
  const html = (payload && payload.html) || '';
  const css = (payload && payload.css) || '';
  const js = (payload && payload.js) || '';
  if (!title) return { error: 'Titre manquant.' };
  if (!html && !css && !js) return { error: 'Composant vide.' };

  const bin = resolveClaudeBin();
  // Release PAR UTILISATEUR (isolation : publier sa release ne publie pas celle des autres,
  // et pas de collision de label entre users). Fallback "EkwaSlice" si pas de nom.
  const author = ((payload && payload.author) || '').trim();
  const releaseLabel = author ? ('EkwaSlice — ' + author) : 'EkwaSlice';
  // Cache du releaseId par auteur : évite le list_releases/create_release à chaque envoi.
  const relKey = author || '__default__';
  const settings = readSettings();
  const relCache = settings.prismicReleases || {};
  const cachedRel = relCache[relKey];

  const steps = ['Objectif : créer UN document dans Prismic via le MCP Prismic (repository "ekwateur-edito").',
    'Les outils MCP Prismic sont déférés : charge-les avec ToolSearch si nécessaire.',
    'Étapes STRICTES :'];
  if (cachedRel) {
    // Chemin rapide : release connue → un seul appel create_document.
    steps.push('1. Utilise DIRECTEMENT releaseId = ' + JSON.stringify(cachedRel) + ' (ne fais PAS list_releases).');
    steps.push('   Repli SEULEMENT si create_document échoue car cette release est introuvable/invalide :');
    steps.push('   alors list_releases, trouve/crée la release de label ' + JSON.stringify(releaseLabel) + ', et recommence.');
  } else {
    steps.push('1. list_releases sur "ekwateur-edito" ; trouve la release dont le label est EXACTEMENT ' + JSON.stringify(releaseLabel) + '.');
    steps.push('   Si aucune, crée-la avec create_release (label ' + JSON.stringify(releaseLabel) + ').');
  }
  steps.push('2. create_document : repository "ekwateur-edito", customTypeId "custom_slice", locale "fr-fr",',
    '   releaseId = cette release, title = ' + JSON.stringify(title) + ', content =',
    '   { "html_only": {"__TYPE__":"FieldContent","type":"Text","value": <HTML>},',
    '     "css": {"__TYPE__":"FieldContent","type":"Text","value": <CSS>},',
    '     "js": {"__TYPE__":"FieldContent","type":"Text","value": <JS>} }',
    '   où <HTML>/<CSS>/<JS> sont EXACTEMENT les blocs délimités ci-dessous (ne les modifie pas).',
    '3. NE PUBLIE JAMAIS (pas de publish_release).',
    'Termine par UNE SEULE ligne JSON et rien d\'autre : {"documentId":"...","releaseId":"...","ok":true}',
    '',
    '===HTML_ONLY_START===', html, '===HTML_ONLY_END===',
    '===CSS_START===', css, '===CSS_END===',
    '===JS_START===', js, '===JS_END===');
  const prompt = steps.join('\n');

  const args = ['-p', prompt,
    '--allowedTools', 'ToolSearch',
    'mcp__claude_ai_Prismic',
    'mcp__claude_ai_Prismic__list_releases',
    'mcp__claude_ai_Prismic__create_release',
    'mcp__claude_ai_Prismic__create_document',
    '--model', 'claude-haiku-4-5', '--output-format', 'json'];

  return new Promise((resolve) => {
    let child;
    try { child = spawn(bin, args, { cwd: os.tmpdir() }); }
    catch (e) { return resolve({ error: 'Impossible de lancer claude : ' + e.message }); }
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); resolve({ error: 'Délai dépassé (180 s).' }); }, 180000);
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: 'CLI claude introuvable : ' + e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve({ error: err.trim() || ('claude a quitté (code ' + code + ')') });
      let result = '';
      try { result = JSON.parse(out).result || ''; } catch (_) { return resolve({ error: 'Parsing réponse impossible.' }); }
      let info = null;
      const m = result.match(/\{[^{}]*"documentId"[^{}]*\}/);
      if (m) { try { info = JSON.parse(m[0]); } catch (_) { } }
      if (info && info.documentId) {
        // Mémorise le releaseId pour accélérer les prochains envois de cet auteur.
        if (info.releaseId && info.releaseId !== cachedRel) {
          try { const s = readSettings(); s.prismicReleases = s.prismicReleases || {}; s.prismicReleases[relKey] = info.releaseId; writeSettings(s); } catch (_) { }
        }
        return resolve({ ok: true, documentId: info.documentId, releaseId: info.releaseId || null });
      }
      return resolve({ ok: false, error: 'Réponse inattendue de Claude', raw: result.slice(0, 300) });
    });
  });
});

// ---------------------------------------------------------------------------
// PULL PRISMIC — lit un document Prismic (custom_slice) via le CLI headless +
// MCP Prismic et renvoie le trio html_only/css/js/html verbatim. Lecture seule
// (get_document), ne modifie rien côté Prismic.
// ---------------------------------------------------------------------------
ipcMain.handle('pull-prismic', async (event, docId) => {
  const id = PrismicSlice.parsePrismicDocId(docId);
  if (!id) return { error: 'Identifiant Prismic invalide.' };

  // --- CHEMIN RAPIDE : API Content Prismic en direct (si token configuré) ---
  // Quasi instantané, sans LLM ni ré-sérialisation. Token de LECTURE stocké
  // localement (userData), jamais embarqué/distribué. access_token = mécanisme
  // d'auth documenté de l'API Content Prismic (HTTPS vers l'API Prismic elle-même).
  const token = (readSettings().prismicToken || '').trim();
  if (token) {
    try {
      const base = 'https://ekwateur-edito.cdn.prismic.io/api/v2';
      const apiRes = await fetch(base + '?access_token=' + encodeURIComponent(token));
      if (apiRes.status === 401 || apiRes.status === 403) return { error: 'Token Prismic refusé (' + apiRes.status + ') — vérifie-le dans les réglages.' };
      if (!apiRes.ok) return { error: 'API Prismic: HTTP ' + apiRes.status };
      const apiJson = await apiRes.json();
      const master = (apiJson.refs || []).find(r => r.isMasterRef) || (apiJson.refs || [])[0];
      if (!master) return { error: 'Réponse API Prismic inattendue (pas de ref).' };
      const q = '[[at(document.id,"' + id + '")]]';
      const url = base + '/documents/search?ref=' + encodeURIComponent(master.ref) + '&q=' + encodeURIComponent(q) + '&access_token=' + encodeURIComponent(token);
      const res = await fetch(url);
      if (!res.ok) return { error: 'API Content Prismic: HTTP ' + res.status };
      const j = await res.json();
      const d = (j.results || [])[0];
      if (!d) return { error: 'Document introuvable (id ' + id + ') ou non publié.' };
      const data = d.data || {};
      const str = v => (typeof v === 'string' ? v : '');
      return { ok: true, trio: { html_only: str(data.html_only), css: str(data.css), js: str(data.js), html: str(data.html) }, documentId: d.id, baseVersionId: '', title: str(data.title) || d.uid || d.id };
    } catch (e) { return { error: 'API Content Prismic: ' + e.message }; }
  }

  // --- REPLI : LLM + MCP (lent) si aucun token configuré ---
  const bin = resolveClaudeBin();
  const prompt = [
    'Tâche mécanique, AUCUNE réflexion ni préambule : charge get_document via ToolSearch, appelle-le UNE fois, renvoie le JSON. Rien d\'autre.',
    'get_document repository "ekwateur-edito", documentId ' + JSON.stringify(id) + '.',
    'Réponds UNIQUEMENT par un bloc ```json contenant EXACTEMENT :',
    '{"title":"…","documentId":"' + id + '","baseVersionId":"<version.id renvoyé>",',
    ' "html_only":"<champ html_only ou \\"\\">","css":"<champ css>","js":"<champ js>","html":"<champ html>"}',
    'Valeurs texte EXACTES des champs (chaîne vide si absent). Ne modifie rien.'
  ].join('\n');
  const args = ['-p', prompt,
    '--allowedTools', 'ToolSearch', 'mcp__claude_ai_Prismic', 'mcp__claude_ai_Prismic__get_document',
    '--model', 'claude-haiku-4-5', '--output-format', 'json'];
  return new Promise((resolve) => {
    let child;
    try { child = spawn(bin, args, { cwd: os.tmpdir() }); }
    catch (e) { return resolve({ error: 'Impossible de lancer claude : ' + e.message }); }
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); resolve({ error: 'Délai dépassé (180 s).' }); }, 180000);
    child.stdout.on('data', d => { out += d.toString(); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', (e) => { clearTimeout(timer); resolve({ error: 'CLI claude introuvable : ' + e.message }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return resolve({ error: err.trim() || ('claude a quitté (code ' + code + ')') });
      let result = '';
      try { result = JSON.parse(out).result || ''; } catch (_) { return resolve({ error: 'Parsing réponse impossible.' }); }
      const o = PrismicSlice.extractTrioFromClaudeResult(result);
      if (!o || !o.documentId) return resolve({ error: 'Réponse inattendue de Claude', raw: result.slice(0, 300) });
      resolve({ ok: true, trio: { html_only: o.html_only || '', css: o.css || '', js: o.js || '', html: o.html || '' }, documentId: o.documentId, baseVersionId: o.baseVersionId || '', title: o.title || '' });
    });
  });
});

// ---------------------------------------------------------------------------
// UPDATE PRISMIC — met à jour un document Prismic EXISTANT (custom_slice) via
// le CLI headless + MCP Prismic (update_document). Nécessite documentId ET
// baseVersionId (jamais de spawn sans les deux). NE PUBLIE JAMAIS.
// ---------------------------------------------------------------------------
ipcMain.handle('update-prismic', async (event, payload) => {
  const documentId = ((payload && payload.documentId) || '').trim();
  const field = ((payload && payload.field) || 'html_only').trim();
  const html = (payload && payload.html) || '';
  const css = (payload && payload.css) || '';
  const js = (payload && payload.js) || '';
  const author = ((payload && payload.author) || '').trim();
  if (!documentId) return { error: 'Document Prismic manquant (réimporte la slice).' };
  if (!html && !css && !js) return { error: 'Contenu vide.' };
  const bin = resolveClaudeBin();
  // Release par auteur (comme push) + cache du releaseId. baseVersionId récupéré
  // FRAIS via get_document (l'import rapide API Content ne le fournit pas, et frais
  // = jamais périmé → une 2e maj d'affilée marche).
  const releaseLabel = author ? ('EkwaSlice — ' + author) : 'EkwaSlice';
  const relKey = author || '__default__';
  const relCache = (readSettings().prismicReleases) || {};
  const cachedRel = relCache[relKey];
  const updatesDesc = field === 'html'
    ? '   updates = { "html": {"__TYPE__":"FieldContent","type":"Text","value": <HTML>} } (ce doc utilise le champ "html" ; ne touche PAS "css"/"js"). <HTML> = bloc délimité ci-dessous, ne le modifie pas.'
    : '   updates = { "html_only": {"__TYPE__":"FieldContent","type":"Text","value": <HTML>}, "css": {"__TYPE__":"FieldContent","type":"Text","value": <CSS>}, "js": {"__TYPE__":"FieldContent","type":"Text","value": <JS>} }  <HTML>/<CSS>/<JS> = blocs délimités ci-dessous, ne les modifie pas.';
  const steps = [
    'Objectif : METTRE À JOUR un document Prismic existant via le MCP Prismic (repository "ekwateur-edito").',
    'Les outils MCP Prismic sont déférés : charge-les avec ToolSearch si nécessaire.',
    'Étapes STRICTES :',
    '1. list_document_versions repository "ekwateur-edito", documentId ' + JSON.stringify(documentId) + ' → prends l\'id de la version PUBLISHED (sinon la plus récente) = baseVersionId. NE lis PAS le contenu du doc (inutile, plus rapide).'
  ];
  if (cachedRel) {
    steps.push('2. Utilise DIRECTEMENT releaseId = ' + JSON.stringify(cachedRel) + '. Repli SEULEMENT si invalide : list_releases puis trouve/crée la release de label ' + JSON.stringify(releaseLabel) + ' (create_release).');
  } else {
    steps.push('2. list_releases ; trouve la release de label EXACTEMENT ' + JSON.stringify(releaseLabel) + '. Si absente, crée-la (create_release, label ' + JSON.stringify(releaseLabel) + ').');
  }
  steps.push(
    '3. update_document : repository "ekwateur-edito", documentId ' + JSON.stringify(documentId) + ', baseVersionId = le version.id de l\'étape 1, releaseId = la release de l\'étape 2,',
    updatesDesc,
    '4. NE PUBLIE JAMAIS (pas de publish_release).',
    'Termine par UNE SEULE ligne JSON et rien d\'autre : {"documentId":"…","ok":true,"releaseId":"<id de la release utilisée>"}',
    '',
    '===HTML_ONLY_START===', html, '===HTML_ONLY_END===',
    '===CSS_START===', css, '===CSS_END===',
    '===JS_START===', js, '===JS_END==='
  );
  const prompt = steps.join('\n');
  const args = ['-p', prompt,
    '--allowedTools', 'ToolSearch',
    'mcp__claude_ai_Prismic__list_document_versions',
    'mcp__claude_ai_Prismic__list_releases',
    'mcp__claude_ai_Prismic__create_release',
    'mcp__claude_ai_Prismic__update_document',
    '--model', 'claude-haiku-4-5', '--output-format', 'stream-json', '--verbose', '--include-partial-messages'];
  // Timeout d'INACTIVITÉ (300 s sans aucune sortie) : la maj enchaîne plusieurs
  // appels MCP + écrit ~20KB → dépassait le plafond fixe de 180 s. Chaque étape
  // émet des events → le timer se remet à zéro, seul un vrai blocage coupe.
  const r = await runClaudeStream(bin, args, null, 300000, null);
  if (r.error) return { error: r.error };
  const result = r.text || '';
  const m = result.match(/\{[^{}]*"documentId"[^{}]*\}/);
  let info = null; if (m) { try { info = JSON.parse(m[0]); } catch (_) { } }
  if (info && info.documentId) {
    if (info.releaseId && info.releaseId !== cachedRel) {
      try { const s = readSettings(); s.prismicReleases = s.prismicReleases || {}; s.prismicReleases[relKey] = info.releaseId; writeSettings(s); } catch (_) { }
    }
    return { ok: true, documentId: info.documentId, releaseId: info.releaseId || null };
  }
  return { ok: false, error: 'Réponse inattendue de Claude', raw: result.slice(0, 300) };
});

// ---------------------------------------------------------------------------
// MISE À JOUR — vérif légère (sans signature) : compare la version locale à la
// dernière GitHub Release. Ne télécharge/installe RIEN ; le renderer affiche une
// bannière avec un lien de téléchargement (install manuelle).
// NB: pour que la vérif aboutisse, les Releases doivent être PUBLIQUES (repo public
// ou repo public dédié aux releases). Sinon l'API renvoie 404 → pas de bannière.
// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// PROXY PRIX (API-SO) — permet à l'APERÇU de l'app d'afficher les VRAIS prix.
// Le fetch d'une slice depuis l'iframe (file://) recevrait 401 (Referer). On
// relaie ici depuis Node avec le Referer forcé (comme test-api.mjs). Lecture
// seule d'une API tarifaire publique ; en prod la slice appelle l'API en direct.
// ---------------------------------------------------------------------------
ipcMain.handle('get-quotation', async (event, body) => {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    const res = await fetch('https://api-so.ekwateur.fr/quotations', {
      method: 'POST',
      headers: {
        'accept': 'application/json', 'content-type': 'application/json',
        'x-seller-channel-id': 'PSFO', 'x-seller-id': 'EKWATEUR',
        'origin': 'https://ekwateur.fr', 'referer': 'https://ekwateur.fr/'
      },
      body: JSON.stringify(body || {}),
      signal: ctrl.signal
    });
    clearTimeout(t);
    let json = null; try { json = await res.json(); } catch (_) { }
    return { ok: res.ok, status: res.status, json };
  } catch (e) { return { ok: false, status: 0, error: e.message }; }
});

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
