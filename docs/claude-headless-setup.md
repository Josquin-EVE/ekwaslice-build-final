# Setup « Claude headless » dans une app Electron

Comment EkwaSlice pilote Claude **sans API payante** : en spawnant le **CLI `claude`** déjà installé et connecté sur la machine de l'utilisateur. Guide repiquable pour un projet Electron similaire.

> Fichiers de référence dans ce repo : `main.js` (spawn + IPC), `preload.js` (pont), `index.html` (renderer/chat).

---

## Principe

- **Pas** l'API Anthropic payante. On lance le binaire `claude` local → c'est **l'abonnement (Max/Pro) de l'utilisateur** qui paie, rien de centralisé.
- Le spawn se fait **dans le main process** Electron, jamais dans le renderer :
  `nodeIntegration:false`, `contextIsolation:true`, et un `preload.js` qui expose un `window.api` étanche (contextBridge). Le renderer n'a jamais accès à `child_process`.
- **Zéro clé API embarquée** dans l'app distribuée (pas de coût, pas de fuite). Prérequis : `claude` installé + loggé sur **chaque** poste.

---

## 1. Résoudre le binaire `claude`

Une app `.app` packagée n'hérite **pas** du PATH du shell → il faut chercher le binaire explicitement.

```js
function resolveClaudeBin() {
  const candidates = [
    process.env.CLAUDE_BIN,
    path.join(os.homedir(), '.local/bin/claude'),
    path.join(os.homedir(), '.claude/local/claude'),
    '/opt/homebrew/bin/claude',
    '/usr/local/bin/claude'
  ].filter(Boolean);
  for (const c of candidates) { try { if (fs.existsSync(c)) return c; } catch (_) {} }
  // Dernier recours : shell de login (charge le PATH utilisateur)
  try {
    const found = execSync('zsh -lic "command -v claude"', { encoding: 'utf8' }).trim();
    if (found) return found;
  } catch (_) {}
  return 'claude'; // laisse spawn tenter le PATH courant
}
```

**Piège #1** : sans cette résolution, l'app packagée ne trouve pas `claude`. Le fallback `zsh -lic` recharge le PATH user.

---

## 2. Vérifier l'état (installé + connecté)

```
claude auth status
```

Sortie JSON → `loggedIn`, `email`, `orgName`, `subscriptionType`. Si non loggé → afficher un écran de garde (instructions d'install/login). `cwd: os.tmpdir()`, timeout ~10 s.

---

## 3. One-shot (génération simple)

```
claude -p "<prompt>" --model claude-sonnet-5 --output-format json --append-system-prompt "<SYSTEM_PROMPT>"
```

- Réponse = **un** JSON : texte final dans **`.result`**, usage dans `.usage`, coût dans `.total_cost_usd`.
- `spawn(bin, args, { cwd: os.tmpdir() })` (pas de pollution du projet).
- Timeout total court (ex 90 s) acceptable ici car réponse unique.

Comptage tokens :
```js
const u = json.usage || {};
const tokens = (u.input_tokens||0) + (u.output_tokens||0)
             + (u.cache_creation_input_tokens||0) + (u.cache_read_input_tokens||0);
```

---

## 4. Chat en streaming (contexte conservé)

```
claude -p "<msg>" --model <m> --output-format stream-json --verbose --include-partial-messages [--resume <sessionId>]
```

- stdout = **NDJSON** (un objet JSON par ligne). Bufferiser et parser **ligne par ligne** (découper sur `\n`, garder le reliquat).
- **Deltas live** : lignes `type:"stream_event"` → `event.content_block_delta.delta.text_delta` → pousser au renderer via IPC (`chat-delta`) pour l'affichage au fil de l'eau.
- Ligne `type:"result"` = **autorité finale** : texte complet + `session_id` + usage + coût.
- **`--resume <session_id>`** : rejoue le fil → la conversation garde son contexte.

**Piège #2 — timeout d'INACTIVITÉ, pas de plafond total.** Remettre le timer à zéro **à chaque** sortie stdout. Ainsi une longue réflexion (qui streame des tokens) n'est jamais coupée ; seul un process réellement muet pendant X s est tué. Un timeout total fixe couperait les grosses générations.

Squelette du runner :
```js
function runClaudeStream(bin, args, stdinLine, timeoutMs, onDelta) {
  return new Promise((resolve) => {
    const child = spawn(bin, args, { cwd: os.tmpdir() });
    let buf='', err='', text='', sid=null, tokens=0, cost=0, found=false, timer;
    const armIdle = () => { clearTimeout(timer); timer = setTimeout(() => { child.kill(); resolve({error:'muet'}); }, timeoutMs); };
    armIdle();
    const handleLine = (l) => {
      l=l.trim(); if(!l) return; let j; try{ j=JSON.parse(l);}catch(_){return;}
      if (j.type==='stream_event' && j.event?.type==='content_block_delta' && j.event.delta?.type==='text_delta') {
        text += j.event.delta.text||''; onDelta?.(j.event.delta.text||'');
      } else if (j.type==='result') { found=true; if(typeof j.result==='string') text=j.result; sid=j.session_id||sid; /* usage... */ }
      else if (j.type==='system' && j.session_id) sid=j.session_id;
    };
    child.stdout.on('data', d => { armIdle(); buf+=d; let i; while((i=buf.indexOf('\n'))>=0){ handleLine(buf.slice(0,i)); buf=buf.slice(i+1);} });
    child.stderr.on('data', d => err+=d);
    child.on('close', code => { clearTimeout(timer); if(buf.trim()) handleLine(buf); found ? resolve({text,sessionId:sid,tokens,cost}) : resolve({error:err.trim()||('code '+code)}); });
    if (stdinLine!=null) { child.stdin.write(stdinLine); child.stdin.end(); }
  });
}
```

---

## 5. Vision (images)

Entrée sur **stdin** en stream-json :
```
claude -p --input-format stream-json --output-format stream-json --verbose --include-partial-messages
```
Puis écrire une ligne sur stdin :
```json
{"type":"user","message":{"role":"user","content":[
  {"type":"text","text":"Utilise cette image comme référence."},
  {"type":"image","source":{"type":"base64","media_type":"image/png","data":"<base64>"}}
]}}
```

---

## 6. System prompt

`--append-system-prompt "<...>"` → **s'ajoute** au prompt système par défaut de Claude Code (ne le remplace pas).

**Piège #3** : le spawn hérite aussi des **skills + réglages `~/.claude`** de l'utilisateur. Un skill peut « fuiter » dans la sortie (ex : *brainstorming* qui sort « Classification », des questions numérotées, parfois en anglais). Contre-mesure : règles fortes **en tête** du system prompt (ex « réponds toujours en français », « n'affiche jamais ton raisonnement interne/méta-process », « va droit au but »).

---

## Architecture IPC (résumé)

```
renderer (index.html)  ──window.api.*──▶  preload.js (contextBridge)
                                              │ ipcRenderer.invoke / on
                                              ▼
                                        main.js : ipcMain.handle(...)
                                              │ child_process.spawn('claude', ...)
                                              ▼
                                        CLI claude (abonnement user)
```

Exemple de pont `preload.js` :
```js
contextBridge.exposeInMainWorld('api', {
  checkClaude:       () => ipcRenderer.invoke('check-claude'),
  generateComponent: (prompt) => ipcRenderer.invoke('generate-component', prompt),
  sendChat:          (payload) => ipcRenderer.invoke('send-chat', payload),
  onChatDelta:       (cb) => { const h=(e,t)=>cb(t); ipcRenderer.on('chat-delta', h); return () => ipcRenderer.removeListener('chat-delta', h); },
});
```

---

## Pièges — checklist

- [ ] **PATH** : résoudre le binaire (section 1), ne pas compter sur `spawn('claude')` nu dans l'app packagée.
- [ ] **NDJSON** : parser ligne par ligne, traiter le reliquat sans `\n` au `close`.
- [ ] **Timeout d'inactivité**, pas de plafond total (sinon grosses générations coupées).
- [ ] **`cwd: os.tmpdir()`** pour tous les spawns.
- [ ] **`claude` installé + loggé** sur chaque poste (prérequis ; c'est l'abonnement user qui paie).
- [ ] `--output-format json` → `.result` ; `stream-json` → events + ligne `result` finale.
- [ ] `--resume <session_id>` pour conserver le contexte du chat.
- [ ] Brider les fuites de skills `~/.claude` via le system prompt.
- [ ] Renderer étanche : `contextIsolation:true`, tout passe par `window.api`.
