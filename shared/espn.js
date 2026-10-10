// ============================================================================
// Traductor ESPN → Fantasy Primera. Convierte partidos reales (calendario,
// goles, tarjetas, alineaciones con minutos de cambio) en estadísticas y puntos
// con las reglas de Core. Lo ejecuta la tarea programada con Node.
// Requiere TEAMS, PLAYERS_RAW, DORSAL (data.js) y Core (core.js).
// Convención ESPN: en goles el equipo es el que suma el gol (también en autogoles);
// en tarjetas, el equipo del jugador.
// ============================================================================
const Espn = (() => {
  const H = 3600e3;
  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
  const TEAM_ALIASES = {
    'colo colo': 'COL', 'universidad catolica': 'UC', 'u catolica': 'UC', 'universidad de chile': 'UCH', 'u de chile': 'UCH',
    'everton': 'EVE', 'everton cd': 'EVE', 'everton de vina del mar': 'EVE', 'palestino': 'PAL', 'deportes limache': 'LIM', 'limache': 'LIM', 'dep limache': 'LIM',
    'nublense': 'NUB', 'deportes concepcion': 'DCO', 'dep concepcion': 'DCO', 'huachipato': 'HUA', 'la serena': 'LSE', 'deportes la serena': 'LSE',
    'coquimbo unido': 'COQ', 'audax italiano': 'AUD', 'o higgins': 'OHI', 'ohiggins': 'OHI', 'cobresal': 'CSL',
    'universidad de concepcion': 'UDC', 'u de concepcion': 'UDC', 'union la calera': 'ULC', 'u la calera': 'ULC',
  };
  function teamIndex(name) {
    const n = norm(name), code = TEAM_ALIASES[n];
    if (code) return TEAMS.findIndex(t => t.short === code);
    const i = TEAMS.findIndex(t => norm(t.name) === n);
    return i;
  }
  // Catálogo por equipo, con nombre partido en inicial + apellidos
  const ROSTER = TEAMS.map(() => []);
  for (const [id, name, team, pos] of PLAYERS_RAW) {
    const t = norm(name).split(' ');
    const initial = t[0].length === 1 ? t[0] : t[0];
    ROSTER[team].push({ id, pos, first: initial, last: t.slice(1).join(' '), lastFirst: t[1] || '', full: norm(name), num: (typeof DORSAL !== 'undefined' && DORSAL[id]) || null });
  }
  // Busca el jugador del catálogo que corresponde a un nombre de ESPN ("Fernando Zampedri")
  function matchPlayer(team, espnName) {
    const t = norm(espnName).split(' ').filter(Boolean);
    if (!t.length) return null;
    const first = t[0], rest = t.slice(1).join(' ');
    let best = null, bestScore = 0;
    for (const c of ROSTER[team] || []) {
      let sc = 0;
      if (c.full === norm(espnName)) sc = 10;
      else {
        const lastOk = c.last && (rest === c.last || rest.startsWith(c.last + ' ') || c.last.startsWith(rest) || (c.lastFirst && t.includes(c.lastFirst)));
        const firstOk = c.first.length === 1 ? first.startsWith(c.first) : (first.startsWith(c.first) || c.first.startsWith(first));
        if (lastOk && firstOk) sc = 6 + (rest === c.last ? 2 : 0);
        else if (lastOk && c.last.length > 4) sc = 3; // mismo apellido, distinta inicial: dudoso
      }
      if (sc > bestScore) { bestScore = sc; best = c; }
    }
    return bestScore >= 6 ? best : null;
  }
  function matchByJersey(team, jersey) {
    const n = Number(jersey); if (!n) return null;
    const c = (ROSTER[team] || []).filter(x => x.num === n);
    return c.length === 1 ? c[0] : null;
  }
  // Mismo nombre en otro club (jugadores transferidos durante la temporada)
  function matchAnyTeam(name) {
    let found = null;
    for (let t = 0; t < TEAMS.length; t++) { const c = matchPlayer(t, name); if (c) { if (found) return null; found = c; } }
    return found;
  }
  // Identifica a un jugador de ESPN: por nombre en su club, por dorsal, o por nombre en otro club
  function resolve(team, name, jersey) { return (name && matchPlayer(team, name)) || matchByJersey(team, jersey) || (name && matchAnyTeam(name)) || null; }

  // Agrupa partidos en fechas. Una fecha = ventana de días con varios partidos y cada club una sola vez.
  // Los partidos sueltos (reprogramados a mitad de semana) toman el número de la fecha original:
  // la fecha más cercana en que ninguno de los dos clubes jugó.
  function assignFechas(matches, prev, anchor) {
    const out = {};
    const sorted = matches.slice().sort((a, b) => a.kickoff - b.kickoff);
    const groups = [];
    let cur = null;
    for (const m of sorted) {
      if (!cur || cur.teams.has(m.h) || cur.teams.has(m.a) || cur.n >= TEAMS.length / 2 || m.kickoff - cur.last > 2.5 * 24 * H) {
        cur = { teams: new Set(), n: 0, first: m.kickoff, last: m.kickoff, ids: [] }; groups.push(cur);
      }
      cur.teams.add(m.h); cur.teams.add(m.a); cur.n++; cur.last = m.kickoff; cur.ids.push(m.id);
    }
    let big = groups.filter(g => g.n >= 4), small = groups.filter(g => g.n < 4);
    if (!big.length) { big = groups; small = []; } // sin fechas completas en la consulta: cada grupo cuenta
    const known = g => { const k = g.ids.map(id => prev[id] && prev[id].J).filter(Boolean); return k.length ? k.sort((a, b) => k.filter(x => x === b).length - k.filter(x => x === a).length)[0] : null; };
    const Js = big.map(known);
    if (anchor && !Js.some(Boolean)) {
      const day = Date.parse(anchor.date + 'T12:00:00Z');
      const ai = big.findIndex(g => g.ids.some(id => Math.abs(sorted.find(m => m.id === id).kickoff - day) < 30 * H));
      if (ai >= 0) Js[ai] = anchor.fecha;
    }
    for (let i = 1; i < big.length; i++) if (!Js[i] && Js[i - 1]) Js[i] = Js[i - 1] + 1;
    for (let i = big.length - 2; i >= 0; i--) if (!Js[i] && Js[i + 1]) Js[i] = Js[i + 1] - 1;
    big.forEach((g, gi) => { if (Js[gi]) for (const id of g.ids) out[id] = Js[gi]; });
    // partidos sueltos
    for (const g of small) for (const id of g.ids) {
      if (prev[id] && prev[id].J) { out[id] = prev[id].J; continue; }
      const m = sorted.find(x => x.id === id);
      let best = null, bestD = Infinity;
      big.forEach((bg, gi) => {
        if (!Js[gi] || bg.teams.has(m.h) || bg.teams.has(m.a)) return;
        const d = Math.abs(bg.first - m.kickoff);
        if (bg.first <= m.kickoff && d < bestD) { bestD = d; best = Js[gi]; }
      });
      if (best) out[id] = best;
    }
    return out;
  }

  // Estadísticas de un partido terminado. m: partido normalizado; roster: {teamIdx: [{name, starter, inMin, outMin}]}
  function matchStats(m, idmap, report) {
    const stats = {};
    const goals = []; // {t, team, pid|null, own}
    const cardsBy = {};
    for (const d of m.details || []) {
      const team = d.team;
      const pid = d.athleteId != null && idmap[d.athleteId] !== undefined ? idmap[d.athleteId] : null;
      if (d.type === 'goal' || d.type === 'penalty_goal' || d.type === 'own_goal') goals.push({ t: d.minute, team, pid, own: d.type === 'own_goal', pen: d.type === 'penalty_goal' });
      else if (d.type === 'yellow' || d.type === 'red') { if (pid) (cardsBy[pid] = cardsBy[pid] || []).push(d); }
      else if (d.type === 'missed_penalty' && pid) (cardsBy[pid] = cardsBy[pid] || []).push(d);
    }
    // ESPN ya indica el equipo que suma el gol (también en autogoles)
    const scoredFor = g => g.team;
    for (const team of [m.h, m.a]) {
      const opp = team === m.h ? m.a : m.h;
      for (const r of (m.rosters && m.rosters[team]) || []) {
        const pid = r.athleteId != null ? idmap[r.athleteId] : null;
        if (!pid) continue;
        const p = PLAYERS_RAW.find(x => x[0] === pid); if (!p) continue;
        const pos = p[3];
        let from = r.starter ? 0 : (r.inMin != null ? r.inMin : null);
        if (from == null) continue; // no entró
        const reds = (cardsBy[pid] || []).filter(c => c.type === 'red');
        let to = r.outMin != null ? r.outMin : 999; // 999 = hasta el final, descuentos incluidos
        if (reds.length) to = Math.min(to, reds[0].minute);
        const s = Core.blankStats();
        s.min = Math.max(1, Math.min(90, to) - Math.min(90, from));
        const mine = goals.filter(g => g.pid === pid && !g.own);
        s.g = mine.length;
        // estadísticas detalladas del jugador (resumen de ESPN), cuando vienen
        const x = r.stats || null;
        if (x) {
          const n = k => Number(x[k]) || 0;
          s.a = n('goalAssists'); s.sot = Math.max(n('shotsOnTarget'), s.g); s.box = Math.max(n('totalShots'), s.sot);
          s.sav = n('saves');
        }
        const yel = (cardsBy[pid] || []).filter(c => c.type === 'yellow').length;
        s.yc = yel > 0 ? 1 : 0; s.rc = reds.length ? 1 : 0; s.dbl = yel > 0 && reds.length ? 1 : 0;
        s.pkm = (cardsBy[pid] || []).filter(c => c.type === 'missed_penalty').length;
        s.gc = goals.filter(g => scoredFor(g) === opp && g.t >= from && g.t <= to).length;
        if (x && x.goalsConceded != null && pos === 0) s.gc = Number(x.goalsConceded) || 0;
        stats[pid] = { pos, s, rating: null };
      }
    }
    // detalle de FotMob (Opta): completa la tabla de LaLiga y la nota del partido para los Puntos Plus
    const det = m.detail || {};
    for (const [pid, d] of Object.entries(det)) {
      let e = stats[pid];
      if (!e) {
        // jugó según FotMob pero ESPN no lo trae en la planilla
        const p = PLAYERS_RAW.find(x => x[0] === pid); if (!p || !d.min) continue;
        const s = Core.blankStats(); s.min = Math.min(90, d.min); s.g = d.g;
        const opp = d.team === m.h ? m.a : m.h;
        s.gc = s.min >= 60 ? goals.filter(g => scoredFor(g) === opp).length : 0;
        e = stats[pid] = { pos: p[3], s, rating: null };
      }
      const s = e.s;
      s.a = Math.max(s.a, d.a);
      s.kp = Math.max(0, d.chances - d.a);
      s.sot = Math.max(s.sot, d.sot, s.g);
      s.drb = d.drb; s.box = d.crosses; s.rec = d.rec; s.clr = d.clr; s.lost = d.disp;
      if (e.pos === 0) { s.sav = d.sav; if (d.gc != null) s.gc = d.gc; }
      e.rating = d.rating;
    }
    if (m.detail) report.detailed = (report.detailed || 0) + 1;
    // gol ganador
    if (m.hg !== m.ag) {
      const w = m.hg > m.ag ? m.h : m.a, need = Math.min(m.hg, m.ag);
      const gs = goals.filter(g => scoredFor(g) === w).sort((x, y) => x.t - y.t);
      const g = gs[need];
      if (g && !g.own && g.pid && stats[g.pid]) stats[g.pid].s.win = 1;
    }
    const out = {};
    for (const [pid, { pos, s, rating }] of Object.entries(stats)) { const f = Core.finalize(pos, s, rating); out[pid] = Core.STAT_KEYS.map(k => f[k]); }
    return out;
  }

  // input: { matches: [...ESPN normalizados] }, state: { calendar: {matches:{}}, idmap: {} }, cfg: { anchor }
  function build(input, state, cfg) {
    const idmap = { ...(state.idmap || {}) };
    const prevCal = (state.calendar && state.calendar.matches) || {};
    const report = { unknownTeams: [], unmatchedPlayers: [], matches: 0, finished: 0 };
    const ms = [];
    for (const raw of input.matches || []) {
      const h = teamIndex(raw.home.name), a = teamIndex(raw.away.name);
      if (h < 0 || a < 0) { report.unknownTeams.push(raw.home.name + ' / ' + raw.away.name); continue; }
      const kickoff = Date.parse(raw.date);
      const status = String(raw.status || 'pre').toLowerCase();
      const m = { id: String(raw.id), h, a, kickoff, status, hg: Number(raw.home.score) || 0, ag: Number(raw.away.score) || 0, details: [], rosters: {} };
      const teamOf = x => (x === raw.home.teamId || norm(x) === norm(raw.home.name)) ? h : a;
      for (const d of raw.details || []) m.details.push({ type: d.type, minute: Number(d.minute) || 0, team: teamOf(d.teamId != null ? d.teamId : d.team), athleteId: d.athleteId != null ? String(d.athleteId) : null, name: d.athleteName });
      for (const side of ['home', 'away']) {
        const tIdx = side === 'home' ? h : a;
        const list = (raw.rosters && raw.rosters[side]) || [];
        m.rosters[tIdx] = list.map(r => ({ athleteId: String(r.athleteId), name: r.name || null, jersey: r.jersey, starter: !!r.starter, inMin: r.inMin != null ? Number(r.inMin) : null, outMin: r.outMin != null ? Number(r.outMin) : null, stats: r.stats || null, pos: r.pos || null }));
      }
      // nombres conocidos por goles y tarjetas (más confiables que el dorsal)
      for (const d of m.details) {
        if (!d.athleteId || !d.name) continue;
        const playerTeam = d.type === 'own_goal' ? (d.team === h ? a : h) : d.team;
        const c = matchPlayer(playerTeam, d.name) || matchAnyTeam(d.name);
        if (c) idmap[d.athleteId] = c.id;
        else if (idmap[d.athleteId] === undefined) idmap[d.athleteId] = null;
      }
      for (const tIdx of [h, a]) {
        for (const r of m.rosters[tIdx]) {
          if (idmap[r.athleteId] === undefined || (idmap[r.athleteId] === null && r.name)) {
            const c = resolve(tIdx, r.name, r.jersey);
            idmap[r.athleteId] = c ? c.id : null;
            if (!c && (r.starter || r.inMin != null)) report.unmatchedPlayers.push(`${r.name || '#' + r.jersey} (${TEAMS[tIdx].short})`);
          }
        }
      }
      if (m.status === 'post') for (const tIdx of [h, a]) for (const r of m.rosters[tIdx] || []) {
        if (idmap[r.athleteId] || !(r.starter || r.inMin != null)) continue;
        const u = (report.unmatched = report.unmatched || {})[r.athleteId] = report.unmatched[r.athleteId] || { name: r.name, team: TEAMS[tIdx].short, jersey: r.jersey || null, pos: r.pos != null ? r.pos : null, apps: 0, min: 0, last: 0 };
        const from = r.starter ? 0 : r.inMin, to = r.outMin != null ? Math.min(90, r.outMin) : 90;
        u.apps++; u.min += Math.max(1, to - from);
        if (m.kickoff > u.last) { u.last = m.kickoff; u.team = TEAMS[tIdx].short; if (r.name) u.name = r.name; if (r.jersey) u.jersey = r.jersey; if (r.pos != null) u.pos = r.pos; }
      }
      // detalle FotMob del mismo partido: jugadores identificados por nombre y dorsal
      if (raw.detail && raw.detail.players) {
        m.detail = {};
        for (const d of raw.detail.players) {
          const tIdx = d.side === 'home' ? h : d.side === 'away' ? a : null;
          if (tIdx == null) continue;
          const c = resolve(tIdx, d.name, d.shirt);
          if (c) m.detail[c.id] = { ...d, team: tIdx };
          else if (d.min >= 20) report.unmatchedPlayers.push(`${d.name} (${TEAMS[tIdx].short}, FotMob)`);
        }
      }
      ms.push(m); report.matches++;
    }
    // fechas
    const allForGrouping = ms.map(m => ({ id: m.id, h: m.h, a: m.a, kickoff: m.kickoff }));
    for (const [id, pm] of Object.entries(prevCal)) if (!allForGrouping.some(x => x.id === id)) allForGrouping.push({ id, h: pm.h, a: pm.a, kickoff: pm.kickoff });
    const fechaOf = assignFechas(allForGrouping, prevCal, cfg.anchor);
    const calendar = { ...prevCal };
    const results = {};
    for (const m of ms) {
      const J = fechaOf[m.id];
      if (!J) continue;
      calendar[m.id] = { J, h: m.h, a: m.a, kickoff: m.kickoff, status: m.status, hg: m.hg, ag: m.ag };
      if (m.status === 'post' && (m.rosters[m.h] || []).length && (m.rosters[m.a] || []).length) {
        // cada partido es un campo propio (m_<id>): actualizar uno nunca pisa a los demás ni los puntos ya calculados
        (results[J] = results[J] || { J, real: true });
        results[J]['m_' + m.id] = matchStats(m, idmap, report);
        results[J].updatedAt = Date.now();
        report.finished++;
      }
    }
    return { calendar: { matches: calendar, updatedAt: Date.now() }, results, idmap, report };
  }
  return { build, matchPlayer, matchByJersey, resolve, teamIndex, assignFechas, norm };
})();
if (typeof module !== 'undefined') module.exports = Espn;
