# Studio Composants Ekwateur — Récap projet

_Document de reprise après `/clear`. Dernière mise à jour : 2026-08-26._

Équipe marketing Ekwateur (fournisseur énergie 100% renouvelable). App **Electron** de bureau : générer des composants web à la charte Ekwateur via l'IA, les éditer visuellement (low-code), et prévisualiser en responsive.

---

## 1. Décision d'architecture fondatrice

**L'app n'embarque PAS l'API Anthropic.** Elle lance le CLI `claude` déjà installé/loggé sur la machine (`spawn` depuis le main process Electron).

- **Pourquoi** : l'utilisateur ne veut aucun surcoût. Les comptes Claude Entreprise (claude.ai) n'incluent pas l'API (facturée au token). Le CLI Claude Code réutilise l'auth de la machine.
- **Surcoût réel = ZÉRO.** Auth confirmée : `Claude Team account`, org Marketing (`claude auth status`). Les coûts affichés ($) sont indicatifs, comptés sur le plan Team, jamais facturés en plus.
- Tous les collègues ont un siège Team.

---

## 2. Comment ça marche techniquement

```
UI (index.html) → preload.js (pont sécurisé) → main.js (IPC) → spawn `claude` → réponse
```

- **`main.js`** : résout le chemin absolu de `claude` (l'app packagée n'hérite pas du PATH), IPC handlers, injecte la CHARTE en `--append-system-prompt`, modèle `claude-sonnet-5`.
- **`preload.js`** : expose `window.api` (sendChat, generateComponent, checkClaude) via contextBridge (contextIsolation, pas de nodeIntegration).
- **`index.html`** : toute l'UI + logique (Tailwind + config Ekwateur + tout le JS inline).

### IPC exposés
- `send-chat` `{message, sessionId}` → relance `claude -p --resume <session_id>` = **conversation continue** (contexte gardé). Renvoie `{text, sessionId, tokens, cost}`.
- `check-claude` → `claude auth status` (coût zéro) : `{installed, loggedIn, email, org, subscription}`.
- `generate-component` → ancien one-shot, **plus utilisé** (gardé, inoffensif).

---

## 3. Fonctionnalités livrées (toutes vérifiées)

1. **Écran de garde connexion** : au lancement, `check-claude`. CLI absent → montre `curl … install.sh`. Pas connecté → montre `claude login`. Connecté → ouvre l'app. `claude login` = action manuelle unique par poste (OAuth, non automatisable par design).

2. **Chat Claude continu** (panneau droit, remplace l'ancien rappel charte + barre "Générer") : bulles user/assistant, contexte gardé via session_id, bouton **"Insérer dans le canvas"** sur chaque bloc ```html, bouton **"Nouveau"** (reset session). Non-streaming (spinner "Claude réfléchit").

3. **Éditeur low-code** (slice par slice) : clic sur **tout élément** → sélection (contour turquoise) + mini-toolbar flottante : ⤴ parent · ↑↓ réordonner parmi voisins · ✎ éditer · ⧉ dupliquer · 🗑 supprimer.

4. **Éditeur texte riche** (pendant l'édition) : barre de format flottante — **gras / italique / souligné** (execCommand), **6 pastilles couleur Ekwateur** (foreColor), **lien hypertexte** (bulle #ekw-link avec save/restore de la Range, createLink/insertHTML/unlink — ne supprime jamais le texte), **espace insécable** (`&nbsp;`). Double-clic = édition inline directe.

5. **Modes Édition / Aperçu** : toggle en haut. Édition = canvas éditable. **Aperçu = iframe 100% fidèle** à la nav user (liens/boutons cliquables, zéro barre d'action, contenu propre). Chips largeur **Desktop / Tablette 768px / Mobile 390px** (vrais breakpoints Tailwind via iframe, pas une illusion). Rebuild iframe seulement en entrant en Aperçu.

6. **Charte Ekwateur (dark-first)** : tokens miroités dans `tailwind.config` inline (classes nommées `bg-primary`, `text-ink`, `rounded-btn`…). CHARTE dans main.js impose ces classes + **mobile-first** (60% trafic mobile) + fonds sombres. Palette clé : primary `#17E7D0`, ink `#132527`, gold `#FEDC5D`, orange `#FF931E`, elec `#009A59`, gas `#2F80DE`.

7. **Polices locales** : Carnero (titres) + Gothic A1 (corps) dans `assets/fonts/`, en `@font-face` (offline, pas de Google Fonts).

8. **Perf** : Tailwind Play CDN + Font Awesome **vendorés en local** (`assets/vendor/`) → zéro CDN réseau, offline. Iframe ne recharge Tailwind qu'en entrant en Aperçu.

---

## 4. Carte des fichiers

```
mon-studio-electron/
├── main.js            # Electron main : spawn claude, IPC, CHARTE, MODEL, résolution PATH
├── preload.js         # pont contextBridge → window.api
├── index.html         # UI complète + config Tailwind Ekwateur + tout le JS
├── package.json       # electron + electron-builder ; scripts start / build:win/mac/linux
├── assets/
│   ├── fonts/         # carnero-var.ttf, gothic-a1-400/600/700.otf
│   └── vendor/        # tailwindcss.js (407KB), fontawesome.css + webfonts/
└── ressources/
    ├── charte-graphique.html   # Design System Ekwateur complet (1.6MB — NE PAS lire en entier, grep les tokens)
    └── Fonts/                  # sources des polices
```

**CHARTE** et **MODEL** = constantes éditables en tête de `main.js`.

---

## 5. Contraintes / limites connues

- **Tailwind Play (JIT runtime)** obligatoire car l'IA génère des classes arbitraires. Pas de build purgé possible sans casser ça. Recompile encore sur mutation DOM, mais léger (tout local).
- **Carnero** = police propriétaire, rendue en local dans l'app (pas de dépendance externe).
- Chat **non-streaming** (le texte n'apparaît pas au fil de l'eau). Évolution possible : vrai streaming via `--output-format stream-json`.
- `claude login` reste manuel une fois par poste (sécurité par siège).

---

## 6. Lancer l'app

```bash
cd "/Users/josquin.eve@ekwateur.fr/Documents/Claude code/mon-studio-electron"
npm start
```

Build distribuable : `npm run build:mac` / `build:win` / `build:linux` (electron-builder → `dist/`).

**Test rapide dev (navigateur, sans Electron)** : `python3 -m http.server 8777` puis ouvrir `http://localhost:8777/index.html` (le chat ne marchera pas sans `window.api`, mais l'éditeur/templates oui). Masquer la garde : `document.getElementById('gate').style.display='none'`.

---

## 7. POINT OUVERT (à trancher à la reprise)

Les **4 templates génériques** de la bibliothèque gauche (Héros / Carte / Grille / CTA) sont encore en **style blanc générique**, décalés de la charte dark Ekwateur. Trois options :
1. Les recharter en Ekwateur dark
2. Les remplacer par des presets Ekwateur (offre élec, gaz, duo, borne VE…)
3. Les virer (workflow 100% via chat IA)

_Aucune décision prise._

---

## 8. Idées d'évolution évoquées

- Vrai streaming du chat.
- Presets Ekwateur dans la bibliothèque.
- (à compléter selon besoins.)
