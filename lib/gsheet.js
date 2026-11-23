// Bibliotheque partagee Google Sheets — processus principal (CommonJS).
// Partie 1 : gestion de la cle de compte de service + auth JWT RS256 (sans dependance).
// SECURITE : ne jamais logger ni renvoyer la cle privee / le token d'acces.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
const CRED_FILE = 'gsheet-credentials.json';

let userDataOverride = null;
let tokenCache = null; // { token, exp } (exp en secondes epoch)

// Injection pour les tests (evite de charger electron sous node --test).
function __setUserDataDir(dir) {
  userDataOverride = dir || null;
  tokenCache = null;
}

function userDataDir() {
  if (userDataOverride) return userDataOverride;
  return require('electron').app.getPath('userData');
}

function credPath() {
  return path.join(userDataDir(), CRED_FILE);
}

function isServiceAccount(json) {
  return !!(
    json &&
    typeof json === 'object' &&
    json.type === 'service_account' &&
    json.private_key &&
    json.client_email
  );
}

function importKey(srcPath) {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(srcPath, 'utf8'));
  } catch (e) {
    return { error: 'Fichier illisible ou JSON invalide' };
  }
  if (!isServiceAccount(json)) {
    return { error: "Ce fichier n'est pas une cle de compte de service Google" };
  }
  try {
    const dst = credPath();
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(srcPath, dst);
    fs.chmodSync(dst, 0o600);
    return { ok: true, email: json.client_email };
  } catch (e) {
    return { error: 'Copie de la cle impossible : ' + e.message };
  }
}

function loadKey() {
  const json = JSON.parse(fs.readFileSync(credPath(), 'utf8'));
  return isServiceAccount(json) ? json : null;
}

function keyStatus() {
  try {
    const key = loadKey();
    return key ? { present: true, email: key.client_email } : { present: false };
  } catch (e) {
    return { present: false };
  }
}

const b64url = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

function buildJwt(key, now) {
  const iat = Math.floor(now);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: key.client_email,
    scope: SCOPE,
    aud: key.token_uri || DEFAULT_TOKEN_URI,
    iat,
    exp: iat + 3600,
  };
  const input = b64url(header) + '.' + b64url(claim);
  const sig = crypto.sign('RSA-SHA256', Buffer.from(input), key.private_key);
  return input + '.' + sig.toString('base64url');
}

async function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.exp - 300 > now) return tokenCache.token;
  let key;
  try {
    key = loadKey();
  } catch (e) {
    key = null;
  }
  if (!key) throw new Error('Cle Google Sheets absente ou invalide');
  const tokenUri = key.token_uri || DEFAULT_TOKEN_URI;
  let origin = '';
  try {
    origin = new URL(tokenUri).origin;
  } catch (e) {
    /* origine invalide */
  }
  if (origin !== 'https://oauth2.googleapis.com') {
    throw new Error('token_uri non autorise (origine attendue : oauth2.googleapis.com)');
  }
  const jwt = buildJwt(key, now);
  const res = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }).toString(),
  });
  if (!res.ok) throw new Error('Auth Google refusee (HTTP ' + res.status + ')');
  const data = await res.json();
  if (!data.access_token) throw new Error('Reponse auth Google sans access_token');
  tokenCache = { token: data.access_token, exp: now + (Number(data.expires_in) || 3600) };
  return tokenCache.token;
}

// ---------------------------------------------------------------- CRUD Sheets
const SPREADSHEET_ID = '1UyRgL40gGxsmEF6Dq2mXpE4Jp55eH4BjWGZVZRc31EM';
const TAB = 'Sheet1';
const COLUMNS = ['id', 'name', 'author', 'html', 'created_at', 'updated_at', 'owner_key'];
const BASE = 'https://sheets.googleapis.com/v4/spreadsheets/' + SPREADSHEET_ID;
const LAST_COL = 'G';
const AUTHOR_COL = 'C';

function rowToObject(row) {
  const r = row || [];
  const o = {};
  COLUMNS.forEach((c, i) => {
    o[c] = r[i] == null ? '' : String(r[i]);
  });
  return o;
}

function objectToRow(obj) {
  return COLUMNS.map((c) => (obj[c] == null ? '' : String(obj[c])));
}

function stripOwnerKey(obj) {
  const { owner_key, ...rest } = obj; // eslint-disable-line no-unused-vars
  return rest;
}

async function api(method, url, body) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = '';
    try {
      const j = await res.json();
      detail = j && j.error && j.error.message ? ' : ' + j.error.message : '';
    } catch (e) {
      /* corps non JSON */
    }
    throw new Error('Google Sheets HTTP ' + res.status + detail);
  }
  return res.json();
}

const rangeUrl = (a1) => BASE + '/values/' + TAB + '!' + a1;

async function fetchRows() {
  const data = await api('GET', rangeUrl('A:' + LAST_COL));
  return data.values || [];
}

const errMsg = (e) => ({ error: (e && e.message) || String(e) });

async function list() {
  try {
    const rows = await fetchRows();
    return { list: rows.slice(1).map(rowToObject).map(stripOwnerKey) };
  } catch (e) {
    return errMsg(e);
  }
}

async function publish({ name, author, html, ownerKey }) {
  try {
    const rows = await fetchRows();
    const appendUrl = rangeUrl('A:' + LAST_COL + ':append') + '?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
    if (rows.length === 0) await api('POST', appendUrl, { values: [COLUMNS] });
    const id = crypto.randomUUID();
    const row = objectToRow({
      id,
      name,
      author,
      html,
      created_at: new Date().toISOString(),
      updated_at: '',
      owner_key: ownerKey,
    });
    await api('POST', appendUrl, { values: [row] });
    return { row: { id } };
  } catch (e) {
    return errMsg(e);
  }
}

// Renvoie l'index (0-based dans rows) de la ligne de donnees d'id donne, ou -1.
function findOwned(rows, id, ownerKey) {
  const idx = rows.findIndex((r, i) => i > 0 && r[0] === id);
  if (idx === -1) return { idx: -1 };
  const obj = rowToObject(rows[idx]);
  if (!ownerKey || obj.owner_key !== ownerKey) return { idx, forbidden: true };
  return { idx, obj };
}

async function update({ id, ownerKey, name, html }) {
  try {
    const rows = await fetchRows();
    const f = findOwned(rows, id, ownerKey);
    if (!f.obj) return { ok: false };
    const next = {
      ...f.obj,
      name: name == null ? f.obj.name : name,
      html: html == null ? f.obj.html : html,
      updated_at: new Date().toISOString(),
    };
    const r = f.idx + 1;
    await api('PUT', rangeUrl('A' + r + ':' + LAST_COL + r) + '?valueInputOption=RAW', { values: [objectToRow(next)] });
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

async function remove({ id, ownerKey }) {
  try {
    const rows = await fetchRows();
    const f = findOwned(rows, id, ownerKey);
    if (!f.obj) return { ok: false };
    const meta = await api('GET', BASE + '?fields=sheets.properties');
    const sheetId = meta.sheets[0].properties.sheetId;
    await api('POST', BASE + ':batchUpdate', {
      requests: [
        { deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: f.idx, endIndex: f.idx + 1 } } },
      ],
    });
    return { ok: true };
  } catch (e) {
    return errMsg(e);
  }
}

async function renameAuthor({ ownerKey, author }) {
  try {
    if (!ownerKey) return { count: 0 };
    const rows = await fetchRows();
    let count = 0;
    for (let i = 1; i < rows.length; i++) {
      if (rowToObject(rows[i]).owner_key !== ownerKey) continue;
      const r = i + 1;
      await api('PUT', rangeUrl(AUTHOR_COL + r) + '?valueInputOption=RAW', { values: [[author == null ? '' : String(author)]] });
      count++;
    }
    return { count };
  } catch (e) {
    return errMsg(e);
  }
}

module.exports = {
  COLUMNS,
  SPREADSHEET_ID,
  TAB,
  rowToObject,
  objectToRow,
  stripOwnerKey,
  list,
  publish,
  update,
  remove,
  renameAuthor,
  __setUserDataDir,
  credPath,
  isServiceAccount,
  importKey,
  keyStatus,
  buildJwt,
  getAccessToken,
};
