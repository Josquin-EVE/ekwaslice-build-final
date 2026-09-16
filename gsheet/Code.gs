/**
 * EkwaSlice — Bibliothèque partagée sur Google Sheets (remplace Supabase).
 *
 * Déploiement (une seule fois) :
 *   1. Ouvre la feuille → Extensions → Apps Script.
 *   2. Colle CE fichier dans Code.gs (remplace tout), enregistre.
 *   3. Déployer → Nouveau déploiement → type « Application web ».
 *        - Exécuter en tant que : Moi
 *        - Qui a accès : Tout le monde
 *   4. Copie l'URL /exec → donne-la pour la brancher dans main.js (GSHEET_EXEC_URL).
 *
 * La feuille est créée/complétée automatiquement avec l'en-tête au 1er appel.
 * owner_key = clé secrète locale de chaque poste (jamais renvoyée par « list »).
 */

var SHEET_NAME = 'components';
var HEADER = ['id', 'name', 'author', 'html', 'owner_key', 'created_at', 'updated_at'];

function sheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sh.getLastRow() === 0) sh.appendRow(HEADER);
  return sh;
}

function rows_(sh) {
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var i = 1; i < values.length; i++) {
    var r = values[i]; if (!r[0]) continue;
    out.push({ _row: i + 1, id: r[0], name: r[1], author: r[2], html: r[3], owner_key: r[4], created_at: r[5], updated_at: r[6] });
  }
  return out;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// LECTURE : liste des composants (owner_key JAMAIS renvoyé).
function doGet(e) {
  var sh = sheet_();
  var list = rows_(sh).map(function (r) {
    return { id: r.id, name: r.name, author: r.author, html: r.html, created_at: r.created_at, updated_at: r.updated_at };
  }).sort(function (a, b) { return (b.created_at || '') > (a.created_at || '') ? 1 : -1; });
  return json_({ list: list });
}

// ÉCRITURE : publish / update / delete / rename_author (verrou pour éviter les collisions).
function doPost(e) {
  var lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch (err) { return json_({ error: 'busy' }); }
  try {
    var body = {};
    try { body = JSON.parse(e.postData.contents || '{}'); } catch (_) { }
    var action = body.action;
    var sh = sheet_();
    var now = new Date().toISOString();

    if (action === 'publish') {
      if (!body.html || !body.name) return json_({ error: 'Composant vide.' });
      var id = Utilities.getUuid();
      sh.appendRow([id, String(body.name).slice(0, 120), String(body.author || '').slice(0, 80),
        String(body.html), String(body.owner_key || ''), now, now]);
      return json_({ row: { id: id } });
    }

    if (action === 'update') {
      var all = rows_(sh);
      for (var i = 0; i < all.length; i++) {
        if (all[i].id === body.id) {
          if (String(all[i].owner_key) !== String(body.owner_key)) return json_({ ok: false });
          if (body.name != null && body.name !== '') sh.getRange(all[i]._row, 2).setValue(String(body.name).slice(0, 120));
          if (body.html != null) sh.getRange(all[i]._row, 4).setValue(String(body.html));
          sh.getRange(all[i]._row, 7).setValue(now);
          return json_({ ok: true });
        }
      }
      return json_({ ok: false });
    }

    if (action === 'delete') {
      var all2 = rows_(sh);
      for (var j = 0; j < all2.length; j++) {
        if (all2[j].id === body.id) {
          if (String(all2[j].owner_key) !== String(body.owner_key)) return json_({ ok: false });
          sh.deleteRow(all2[j]._row);
          return json_({ ok: true });
        }
      }
      return json_({ ok: false });
    }

    if (action === 'rename_author') {
      var all3 = rows_(sh), n = 0;
      for (var k = 0; k < all3.length; k++) {
        if (String(all3[k].owner_key) === String(body.owner_key)) {
          sh.getRange(all3[k]._row, 3).setValue(String(body.author || '').slice(0, 80));
          n++;
        }
      }
      return json_({ count: n });
    }

    return json_({ error: 'action inconnue' });
  } finally {
    lock.releaseLock();
  }
}
