// Prepara los datos de data/ para copiarlos a la base de la liga (página de Claude).
//   node tools/to-artifact.js <carpeta-salida> [sha-ya-aplicado]
// Escribe en la carpeta de salida:
//   calendar.json  -> doc real/calendar
//   prices.json    -> doc real/prices
//   results-jN.json -> doc results/jN (solo fechas recientes o por jugarse; cada partido es un campo m_<id>)
//   manifest.json  -> lista de escrituras y si hay cambios respecto del sha ya aplicado
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const out = process.argv[2] || 'salida';
const appliedSha = process.argv[3] || '';
const root = path.join(__dirname, '..');
const data = f => JSON.parse(fs.readFileSync(path.join(root, 'data', f), 'utf8'));
fs.mkdirSync(out, { recursive: true });

const sha = execSync('git rev-parse HEAD', { cwd: root }).toString().trim();
const calendar = data('calendar.json');
const prices = data('prices.json');

// fechas recientes: alguna fecha con partidos desde hace 12 días en adelante
const now = Date.now(), recent = new Set();
for (const m of Object.values(calendar.matches || {})) if (m.kickoff >= now - 12 * 864e5) recent.add(m.J);
const writes = [
  { collection: 'real', doc_id: 'calendar', file: 'calendar.json' },
  { collection: 'real', doc_id: 'prices', file: 'prices.json' },
];
fs.writeFileSync(path.join(out, 'calendar.json'), JSON.stringify({ ...calendar, updatedAt: Date.now(), sha }));
fs.writeFileSync(path.join(out, 'prices.json'), JSON.stringify({ ...prices, sha }));
for (const J of [...recent].sort((a, b) => a - b)) {
  const f = path.join(root, 'data', 'results', `j${J}.json`);
  if (!fs.existsSync(f)) continue;
  const r = JSON.parse(fs.readFileSync(f, 'utf8'));
  const doc = { J, real: true, updatedAt: r.updatedAt || Date.now() };
  for (const [k, v] of Object.entries(r)) if (k.startsWith('m_')) doc[k] = v;
  const name = `results-j${J}.json`;
  fs.writeFileSync(path.join(out, name), JSON.stringify(doc));
  writes.push({ collection: 'results', doc_id: `j${J}`, file: name, merge: true });
}
const manifest = { sha, changed: sha !== appliedSha, writes };
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
console.log(JSON.stringify(manifest, null, 1));
