const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const gsheet = require('../lib/gsheet.js');

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const TEST_RSA_PEM = privateKey.export({ type: 'pkcs8', format: 'pem' });

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gsheet-test-'));
}

test('isServiceAccount rejette un JSON non service_account', () => {
  assert.strictEqual(gsheet.isServiceAccount({ type: 'authorized_user' }), false);
  assert.strictEqual(gsheet.isServiceAccount(null), false);
  assert.strictEqual(gsheet.isServiceAccount({ type: 'service_account', client_email: 'a@b' }), false);
  assert.strictEqual(gsheet.isServiceAccount({ type: 'service_account', private_key: 'x' }), false);
  assert.strictEqual(
    gsheet.isServiceAccount({ type: 'service_account', private_key: 'x', client_email: 'a@b' }),
    true
  );
});

test('buildJwt produit 3 segments base64url, header RS256 et signature valide', () => {
  const jwt = gsheet.buildJwt(
    { client_email: 'a@b', token_uri: 'https://t', private_key: TEST_RSA_PEM },
    1000
  );
  const parts = jwt.split('.');
  assert.strictEqual(parts.length, 3);
  for (const p of parts) assert.match(p, /^[A-Za-z0-9_-]+$/);
  const header = JSON.parse(Buffer.from(parts[0], 'base64url'));
  assert.strictEqual(header.alg, 'RS256');
  assert.strictEqual(header.typ, 'JWT');
  const claim = JSON.parse(Buffer.from(parts[1], 'base64url'));
  assert.strictEqual(claim.iss, 'a@b');
  assert.strictEqual(claim.aud, 'https://t');
  assert.strictEqual(claim.iat, 1000);
  assert.strictEqual(claim.exp - claim.iat, 3600);
  assert.match(claim.scope, /spreadsheets/);
  const ok = crypto.verify(
    'RSA-SHA256',
    Buffer.from(parts[0] + '.' + parts[1]),
    crypto.createPublicKey(TEST_RSA_PEM),
    Buffer.from(parts[2], 'base64url')
  );
  assert.strictEqual(ok, true);
});

test('importKey copie vers credPath en 0600 et keyStatus ne renvoie pas la clé', () => {
  const userData = tmpDir();
  gsheet.__setUserDataDir(userData);
  assert.deepStrictEqual(gsheet.keyStatus(), { present: false });
  const src = path.join(tmpDir(), 'key.json');
  fs.writeFileSync(
    src,
    JSON.stringify({
      type: 'service_account',
      client_email: 'svc@proj.iam.gserviceaccount.com',
      private_key: TEST_RSA_PEM,
      token_uri: 'https://oauth2.googleapis.com/token',
    })
  );
  const r = gsheet.importKey(src);
  assert.deepStrictEqual(r, { ok: true, email: 'svc@proj.iam.gserviceaccount.com' });
  assert.strictEqual(gsheet.credPath(), path.join(userData, 'gsheet-credentials.json'));
  assert.ok(fs.existsSync(gsheet.credPath()));
  assert.strictEqual(fs.statSync(gsheet.credPath()).mode & 0o777, 0o600);
  const st = gsheet.keyStatus();
  assert.deepStrictEqual(st, { present: true, email: 'svc@proj.iam.gserviceaccount.com' });
  assert.ok(!JSON.stringify(st).includes('PRIVATE KEY'));
});

test('importKey refuse un mauvais fichier sans rien copier', () => {
  const userData = tmpDir();
  gsheet.__setUserDataDir(userData);
  const dir = tmpDir();
  const bad = path.join(dir, 'bad.json');
  fs.writeFileSync(bad, JSON.stringify({ type: 'authorized_user', client_email: 'a@b' }));
  const txt = path.join(dir, 'note.txt');
  fs.writeFileSync(txt, 'pas du json');
  for (const f of [bad, txt, path.join(dir, 'absent.json')]) {
    const r = gsheet.importKey(f);
    assert.ok(r.error, 'erreur attendue pour ' + f);
    assert.strictEqual(r.ok, undefined);
  }
  assert.ok(!fs.existsSync(gsheet.credPath()));
  assert.deepStrictEqual(gsheet.keyStatus(), { present: false });
});

test('rowToObject / objectToRow sont reciproques dans l ordre COLUMNS', () => {
  const o = { id: '1', name: 'n', author: 'a', html: '<i>', created_at: 't', updated_at: '', owner_key: 'k' };
  assert.deepStrictEqual(gsheet.COLUMNS, ['id', 'name', 'author', 'html', 'created_at', 'updated_at', 'owner_key']);
  assert.deepStrictEqual(gsheet.objectToRow(o), ['1', 'n', 'a', '<i>', 't', '', 'k']);
  assert.deepStrictEqual(gsheet.rowToObject(gsheet.objectToRow(o)), o);
  // ligne tronquee (cellules vides finales omises par l'API) -> chaines vides
  assert.deepStrictEqual(gsheet.rowToObject(['1', 'n']).owner_key, '');
});

test('stripOwnerKey retire owner_key', () => {
  const r = gsheet.stripOwnerKey({ id: '1', owner_key: 'k' });
  assert.strictEqual('owner_key' in r, false);
  assert.strictEqual(r.id, '1');
});

test('le mapping de list ne renvoie jamais owner_key', () => {
  const mapped = [['1', 'n', 'a', '<i>', 't', '', 'SECRET']].map(gsheet.rowToObject).map(gsheet.stripOwnerKey);
  assert.strictEqual(JSON.stringify(mapped).includes('SECRET'), false);
  assert.strictEqual(mapped[0].name, 'n');
});

test('getAccessToken refuse un token_uri hors oauth2.googleapis.com', async () => {
  const userData = tmpDir();
  gsheet.__setUserDataDir(userData);
  fs.writeFileSync(
    gsheet.credPath(),
    JSON.stringify({
      type: 'service_account',
      client_email: 'svc@proj.iam.gserviceaccount.com',
      private_key: TEST_RSA_PEM,
      token_uri: 'https://evil.example.com/token',
    })
  );
  await assert.rejects(() => gsheet.getAccessToken(), /token_uri/);
});
