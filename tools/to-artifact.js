// Prepara los datos de data/ para copiarlos a la base de la liga (página de Claude).
//   node tools/to-artifact.js <carpeta-salida> [sha-ya-aplicado] [--sync <real-sync.json>]
// Con --sync (el doc real/sync guardado como archivo) solo se incluyen los docs de fechas que cambiaron.
// Escribe en la carpeta de salida:
//   calendar.json  -> doc real/calendar
//   prices.json    -> doc real/prices
//   results-jN.json -> doc results/jN (todas las fechas con partidos leídos; cada partido es un campo m_<id>)
//   manifest.json  -> lista de escrituras y si hay cambios respecto del sha ya aplicado
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const out = (process.argv.slice(2).filter(a => !a.startsWith('--'))[0]) || 'salida';
const args = process.argv.slice(2);
const si = args.indexOf('--sync');
const syncFile = si >= 0 ? args.splice(si, 2)[1] : null;
const appliedSha = args[1] || '';
let prevHashes = {};
if (syncFile) { try { const j = JSON.parse(fs.readFileSync(syncFile, 'utf8')); prevHashes = (j.data || j).hashes || {}; } catch { prevHashes = {}; } }
const crypto = require('crypto');
const hash = o => crypto.createHash('sha1').update(JSON.stringify(o)).digest('hex').slice(0, 12);
const root = path.join(__dirname, '..');
const data = f => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
fs.mkdirSync(out, { recursive: true });

const sha = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
const calendar = data('calendar.json');
const prices = data('prices.json');

const writes = [
  { collection: 'real', doc_id: 'calendar', file: 'calendar.json' },
  { collection: 'real', doc_id: 'prices', file: 'prices.json' },
];
fs.writeFileSync(path.join(out, 'calendar.json'), JSON.stringify({ ...calendar, updatedAt: Date.now(), sha }));
fs.writeFileSync(path.join(out, 'prices.json'), JSON.stringify({ ...prices, sha }));
// resultados: todas las fechas (para el detalle fecha a fecha de cada jugador); solo las que cambiaron
const hashes = {};
const dir = path.join(root, 'data', 'results');
const Js = fs.existsSync(dir) ? fs.readdirSync(dir).map(f => (f.match(/^j(\d+)\.json$/) || [])[1]).filter(Boolean).map(Number).sort((a, b) => a - b) : [];
for (const J of Js) {
  const r = JSON.parse(fs.readFileSync(path.join(dir, `j${J}.json`), 'utf8'));
  const doc = { J, real: true };
  for (const [k, v] of Object.entries(r)) if (k.startsWith('m_')) doc[k] = v;
  const h = hash(doc);
  hashes['j' + J] = h;
  if (prevHashes['j' + J] === h) continue;
  doc.updatedAt = r.updatedAt || Date.now();
  const name = `results-j${J}.json`;
  fs.writeFileSync(path.join(out, name), JSON.stringify(doc));
  writes.push({ collection: 'results', doc_id: `j${J}`, file: name, merge: true });
}
const manifest = { sha, changed: sha !== appliedSha || writes.length > 2, writes, sync: { sha, hashes, at: Date.now() } };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(JSON.stringify(manifest, null, 1));
