// Prueba la sincronización completa con ESPN simulado: node test/run.js
const { execFileSync } = require('child_process');
const fs = require('fs'), os = require('os'), path = require('path');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fp-'));
execFileSync('node', ['-r', './test/mock-espn.js', 'src/sync.js', '--season'], { env: { ...process.env, DATA_DIR: tmp }, stdio: 'inherit' });
const r = JSON.parse(fs.readFileSync(path.join(tmp, 'results', fs.readdirSync(path.join(tmp, 'results'))[0]), 'utf8'));
const s = r.m_401850656, K = 21;
console.log('Hormazábal', s['uch-f-hormazabal'].join(','), '\nCastellón', s['uch-g-castellon'].join(','), '\nDelgado', s['lse-r-delgado'].join(','));
const ok = s['uch-f-hormazabal'][K] === 23 && s['uch-g-castellon'][K] === 10 && s['lse-r-delgado'][K] === 2;
console.log(ok ? 'OK: puntos esperados' : 'FALLO: puntos distintos a lo esperado');
process.exit(ok ? 0 : 1);
