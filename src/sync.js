// Sincronización Liga de Primera 2026 (ESPN) → data/
//   node src/sync.js            pasada normal: últimos 3 días + próximos 21 días
//   node src/sync.js --season   temporada completa (carga histórica)
//   node src/sync.js --offline  no consulta ESPN; solo recalcula precios con lo guardado
const fs = require('fs');
const path = require('path');
const { Core, Espn, PLAYERS_RAW, EXP } = require('./env');
const api = require('./espn-api');
const { seasonPrices } = require('./season');

const DATA = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ANCHOR = { date: '2026-10-10', fecha: 24 }; // la fecha 24 se juega el fin de semana del 10 de octubre
const args = new Set(process.argv.slice(2));

const read = (f, def) => { try { return JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8')); } catch { return def; } };
const write = (f, obj) => { fs.mkdirSync(path.dirname(path.join(DATA, f)), { recursive: true }); fs.writeFileSync(path.join(DATA, f), JSON.stringify(obj, null, 1) + '\n'); };
const dayStr = d => d.toISOString().slice(0, 10);

function loadResults() {
  const dir = path.join(DATA, 'results'); const out = {};
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) if (/^j\d+\.json$/.test(f)) { const r = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); out[r.J] = r; }
  return out;
}

async function main() {
  const t0 = Date.now();
  const calendar = read('calendar.json', { matches: {} });
  const idmap = read('idmap.json', { map: {} });
  const results = loadResults();
  const done = new Set(Object.values(results).flatMap(r => Object.keys(r).filter(k => k.startsWith('m_')).map(k => k.slice(2))));
  const report = { at: new Date().toISOString(), mode: args.has('--season') ? 'temporada' : args.has('--offline') ? 'sin conexión' : 'normal', errors: [] };

  if (!args.has('--offline')) {
    // 1) qué días consultar
    const { days: calDays, raw: sbRaw } = await api.calendarDays();
    const today = new Date();
    const from = new Date(today.getTime() - 3 * 864e5), to = new Date(today.getTime() + 21 * 864e5);
    let days;
    if (args.has('--season')) days = calDays.filter(d => d <= dayStr(to));
    else days = [...new Set([...calDays.filter(d => d >= dayStr(from) && d <= dayStr(to)), dayStr(from), dayStr(today)])].sort();
    report.days = days.length;
    if (args.has('--season')) write('debug/scoreboard.json', sbRaw);

    // 2) partidos de esos días
    const events = [];
    for (const d of days) {
      try { const { events: evs, raw } = await api.eventsOfDay(d); events.push(...evs); if (args.has('--season') && evs.some(e => e.status === 'post') && !fs.existsSync(path.join(DATA, 'debug/scoreboard-day.json'))) write('debug/scoreboard-day.json', raw); }
      catch (e) { report.errors.push(`día ${d}: ${e.message}`); }
      await api.sleep(150);
    }
    // 3) detalle de los partidos terminados que faltan
    const input = [];
    let sampled = fs.existsSync(path.join(DATA, 'debug/summary.json'));
    for (const ev of events) {
      if (ev.status !== 'post' || (done.has(ev.id) && !args.has('--season'))) { input.push(ev); continue; }
      const goalsH = ev.details.filter(d => (d.type === 'goal' || d.type === 'penalty_goal' || d.type === 'own_goal') && d.teamId === ev.home.teamId).length;
      const goalsA = ev.details.filter(d => (d.type === 'goal' || d.type === 'penalty_goal' || d.type === 'own_goal') && d.teamId === ev.away.teamId).length;
      if (goalsH !== ev.home.score || goalsA !== ev.away.score) report.errors.push(`partido ${ev.id}: goles del detalle (${goalsH}-${goalsA}) no cuadran con el marcador (${ev.home.score}-${ev.away.score}); se usan igual`);
      try {
        const full = await api.fullMatch(ev);
        if (!sampled) { write('debug/summary.json', full._raw.summary); sampled = true; }
        delete full._raw;
        input.push(full);
      } catch (e) { report.errors.push(`partido ${ev.id}: ${e.message}`); input.push({ ...ev, status: 'in' }); }
      await api.sleep(150);
    }
    // 4) traducir a estadísticas y puntos
    const out = Espn.build({ matches: input }, { calendar, idmap: idmap.map || {} }, { anchor: ANCHOR });
    Object.assign(calendar, out.calendar);
    write('calendar.json', calendar);
    write('idmap.json', { map: out.idmap, updatedAt: Date.now() });
    for (const [J, r] of Object.entries(out.results)) results[J] = { ...(results[J] || { J: Number(J), real: true }), ...r };
    for (const r of Object.values(results)) write(`results/j${r.J}.json`, r);
    report.matches = input.length;
    report.newFinished = out.report.finished;
    report.unmatchedPlayers = [...new Set(out.report.unmatchedPlayers)];
    // jugadores que juegan pero no están en el catálogo: se acumulan con sus minutos para agregarlos
    // en modo temporada se recalcula desde cero; en pasadas normales se suman los partidos nuevos
    const extra = args.has('--season') ? {} : read('unmatched.json', {});
    for (const [id, u] of Object.entries(out.report.unmatched || {})) {
      const prev = extra[id] || { apps: 0, min: 0 };
      extra[id] = { ...prev, ...u, apps: (args.has('--season') ? 0 : prev.apps) + u.apps, min: (args.has('--season') ? 0 : prev.min) + u.min };
    }
    for (const id of Object.keys(extra)) if (out.idmap[id]) delete extra[id]; // ya identificado
    write('unmatched.json', extra);
    report.unknownTeams = out.report.unknownTeams;
    report.espnCalls = api.calls();
  }
  // 5) rendimiento de la temporada y precios
  const prices = seasonPrices({ Core, PLAYERS_RAW, EXP, calendar, results });
  write('prices.json', prices);
  report.seasonGames = prices.games;
  report.seconds = Math.round((Date.now() - t0) / 1000);
  write('report.json', report);
  console.log(JSON.stringify(report, null, 1));
}

main().catch(e => { console.error(e); process.exit(1); });
