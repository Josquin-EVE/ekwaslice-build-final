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
  const jwt = buildJwt(key, now);
  const res = await fetch(key.token_uri || DEFAULT_TOKEN_URI, {
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

module.exports = {
  __setUserDataDir,
  credPath,
  isServiceAccount,
  importKey,
  keyStatus,
  buildJwt,
  getAccessToken,
};
