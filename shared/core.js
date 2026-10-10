// ============================================================================
// Núcleo Fantasy Primera: reglas puras compartidas por el prototipo y el
// backend (Supabase Edge Functions). Sin catálogo, sin DOM, sin base de datos.
// Puntuación = tabla LaLiga Fantasy. Mercado y cláusulas = reglas LaLiga Fantasy.
// ============================================================================
const Core = (() => {
  const POS = ['POR', 'DEF', 'MED', 'DEL'];
  const POS_LONG = ['Portero', 'Defensa', 'Mediocampista', 'Delantero'];
  const FORMATIONS = {
    '4-3-3': [1, 4, 3, 3], '4-4-2': [1, 4, 4, 2], '3-4-3': [1, 3, 4, 3],
    '3-5-2': [1, 3, 5, 2], '4-5-1': [1, 4, 5, 1], '5-3-2': [1, 5, 3, 2], '5-4-1': [1, 5, 4, 1],
  };
  const DEFAULTS = {
    budget0: 100_000_000,       // presupuesto inicial
    squadRef: 40_000_000,       // si tu plantilla inicial vale menos que esto, la diferencia se compensa en saldo
    squadMax: 24,               // máximo de jugadores en plantilla
    squadStart: 14,             // jugadores que te da la liga al entrar
    marketSize: 12,             // jugadores libres en el mercado diario
    jornadaEvery: 7,            // ciclos de mercado entre fechas (7 = una fecha por semana)
    cycleMs: 24 * 3600 * 1000,  // duración del ciclo de mercado
    clauseProtect: 14,          // ciclos de protección tras fichar (2 semanas)
    clauseMin: 1_000_000,       // ninguna cláusula vale menos de 1M
    debtPct: 0.2,               // deuda máxima para pujas y ofertas: 20% del valor del equipo
    reward: 100_000,            // recompensa diaria
    perPoint: 100_000,          // dinero por punto en la fecha
    totalJornadas: 30,
    shieldMax: 2,               // doble blindaje: hasta 2 jugadores a la vez
    shieldCycles: 1,            // cada blindaje dura un ciclo (24 h)
    offerCycles: 3,             // las ofertas entre mánagers caducan a los 3 ciclos
  };
  const MIN_VALUE = 150_000;
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const round10k = v => Math.round(v / 10_000) * 10_000;

  // ---------- Aleatoriedad determinista ----------
  function hashStr(s) {
    let h = 1779033703 ^ s.length;
    for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
    h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }
  function rng(seed) {
    let a = hashStr(String(seed));
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normal(r) { return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r()); }

  // ---------- Precio <-> puntos esperados por fecha ----------
  // 1 pt ≈ 0,5M · 3 pts ≈ 5M · 5 pts ≈ 15M · 8 pts ≈ 40M
  const valueFor = e => Math.max(MIN_VALUE, round10k(490_000 * Math.pow(Math.max(0, e), 2.12)));
  const expectedPts = v => Math.pow(v / 490_000, 1 / 2.12);

  // ---------- Puntuación (tabla LaLiga Fantasy) ----------
  const STAT_KEYS = ['min', 'g', 'a', 'kp', 'sot', 'drb', 'box', 'rec', 'clr', 'lost', 'yc', 'rc', 'dbl', 'pkm', 'pks', 'pkp', 'pkc', 'sav', 'gc', 'win', 'plus', 'pts'];
  function blankStats() { const o = {}; STAT_KEYS.forEach(k => { o[k] = 0; }); return o; }

  // "Puntos Plus" 0–4: equivalente propio a los Puntos DAZN
  function plusPoints(pos, s) {
    if (s.min <= 0) return 0;
    let raw;
    if (pos === 0) raw = s.sav * 0.55 + (s.gc === 0 && s.min >= 60 ? 1.1 : 0) + s.pks * 1.5 + s.clr * 0.2 + s.rec * 0.12 - s.gc * 0.45 - s.lost * 0.05;
    else if (pos === 1) raw = s.rec * 0.2 + s.clr * 0.28 + s.drb * 0.2 + s.kp * 0.45 + (s.gc === 0 && s.min >= 60 ? 0.8 : 0) + s.g * 0.8 + s.a * 0.6 - s.gc * 0.3 - s.lost * 0.07 - s.yc * 0.4;
    else if (pos === 2) raw = s.rec * 0.17 + s.kp * 0.5 + s.drb * 0.28 + s.box * 0.14 + s.sot * 0.28 + s.g * 0.8 + s.a * 0.7 + s.clr * 0.08 - s.lost * 0.07 - s.yc * 0.4;
    else raw = s.sot * 0.38 + s.drb * 0.32 + s.box * 0.16 + s.kp * 0.4 + s.g * 0.9 + s.a * 0.6 + s.rec * 0.08 - s.lost * 0.06 - s.yc * 0.4;
    raw += s.win * 0.8 - s.rc * 1.5;
    raw *= Math.sqrt(Math.min(1, s.min / 90));
    return clamp(Math.round(raw - 0.6), 0, 4);
  }

  // [total, desglose]
  function score(pos, s) {
    if (!s || s.min <= 0) return [0, []];
    const d = [];
    const add = (label, pts) => { if (pts) d.push([label, pts]); };
    add(s.min >= 60 ? 'Jugó +60 min' : 'Jugó -60 min', s.min >= 60 ? 2 : 1);
    add('Goles', s.g * [6, 6, 5, 4][pos]);
    add('Asistencias de gol', s.a * 3);
    add('Asistencias sin gol', s.kp);
    if (s.min >= 60 && s.gc === 0) add('Portería a cero', [4, 3, 2, 1][pos]);
    add('Penalti fallado', -2 * s.pkm);
    add('Penalti parado', 5 * s.pks);
    add('Penalti provocado', 2 * s.pkp);
    add('Penalti cometido', -2 * s.pkc);
    add('Goles recibidos', -Math.floor(s.gc / 2) * (pos <= 1 ? 2 : 1));
    add('Tarjeta amarilla', -s.yc);
    add('Doble amarilla', -s.dbl);
    add('Tarjeta roja', -3 * s.rc);
    if (pos === 0) add('Paradas', Math.floor(s.sav / 2));
    add('Remates a puerta', Math.floor(s.sot / 2));
    add('Regates', Math.floor(s.drb / 2));
    add('Balones al área', Math.floor(s.box / 2));
    add('Recuperaciones', Math.floor(s.rec / 5));
    add('Despejes', Math.floor(s.clr / 3));
    add('Balones perdidos', -Math.floor(s.lost / [8, 8, 10, 12][pos]));
    add('Puntos Plus', s.plus);
    return [d.reduce((t, [, v]) => t + v, 0), d];
  }
  // Con nota del partido (FotMob/Opta, 0–10) los Puntos Plus salen de la nota, como los Puntos DAZN
  function plusFromRating(r) { return r == null ? null : r >= 8.7 ? 4 : r >= 7.8 ? 3 : r >= 7.0 ? 2 : r >= 6.2 ? 1 : 0; }
  function finalize(pos, s, rating) {
    const pr = s.min > 0 ? plusFromRating(rating) : null;
    s.plus = pr != null ? pr : plusPoints(pos, s); s.pts = score(pos, s)[0]; return s;
  }

  // ---------- Adaptador API-Football (/fixtures/players + /fixtures/events) ----------
  // st: response[].players[].statistics[0]. ctx: { gc: goles recibidos con el jugador en cancha, win: 1 si marcó el gol ganador }
  // API-Football no entrega recuperaciones, despejes ni llegadas al área: se aproximan
  // con quites + intercepciones, bloqueos y remates totales.
  const n = x => { const v = typeof x === 'string' ? parseFloat(x) : x; return Number.isFinite(v) ? v : 0; };
  function posFromApi(p) { return { G: 0, D: 1, M: 2, F: 3 }[String(p || '').charAt(0).toUpperCase()] ?? 2; }
  function fromApiFootball(pos, st, ctx = {}) {
    const s = blankStats();
    const g = st.games || {}, sh = st.shots || {}, go = st.goals || {}, pa = st.passes || {}, ta = st.tackles || {},
      dr = st.dribbles || {}, ca = st.cards || {}, pe = st.penalty || {};
    s.min = n(g.minutes);
    if (s.min <= 0) return s;
    s.g = n(go.total); s.a = n(go.assists);
    s.kp = Math.max(0, n(pa.key) - s.a);
    s.sot = n(sh.on); s.box = n(sh.total);
    s.drb = n(dr.success);
    s.rec = n(ta.total) + n(ta.interceptions);
    s.clr = n(ta.blocks);
    const total = n(pa.total), acc = String(pa.accuracy ?? '').includes('%') ? Math.round(total * n(pa.accuracy) / 100) : n(pa.accuracy);
    s.lost = Math.max(0, total - acc) + Math.max(0, n(dr.attempts) - s.drb);
    s.yc = n(ca.yellow) > 0 ? 1 : 0; s.rc = n(ca.red) > 0 ? 1 : 0; s.dbl = n(ca.yellow) > 0 && n(ca.red) > 0 ? 1 : 0;
    s.pkm = n(pe.missed); s.pks = n(pe.saved); s.pkp = n(pe.won); s.pkc = n(pe.commited ?? pe.committed);
    s.sav = n(go.saves);
    s.gc = ctx.gc != null ? ctx.gc : n(go.conceded);
    s.win = ctx.win ? 1 : 0;
    return finalize(pos, s);
  }
  // Goles recibidos con cada jugador en cancha y gol ganador, a partir de eventos y alineaciones.
  // events: /fixtures/events response. starters: Set de ids titulares por equipo. teams: [homeId, awayId]
  function matchContext(events, starters, teams, homeGoals, awayGoals) {
    const on = {}, off = {}, goalsBy = { [teams[0]]: [], [teams[1]]: [] };
    for (const id of starters) on[id] = 0;
    for (const e of events || []) {
      const t = (e.time && (e.time.elapsed || 0) + (e.time.extra || 0)) || 0;
      if (e.type === 'subst') { // API-Football: player = sale, assist = entra
        if (e.player && e.player.id) off[e.player.id] = t;
        if (e.assist && e.assist.id) on[e.assist.id] = t;
      } else if (e.type === 'Goal' && e.detail !== 'Missed Penalty' && e.team) {
        goalsBy[e.team.id] = goalsBy[e.team.id] || [];
        goalsBy[e.team.id].push({ t, scorer: e.player && e.player.id, own: e.detail === 'Own Goal' });
      } else if (e.type === 'Card' && /Red/.test(e.detail || '') && e.player) off[e.player.id] = t;
    }
    const conceded = (pid, teamId) => {
      const opp = teamId === teams[0] ? teams[1] : teams[0];
      const a = on[pid] ?? null; if (a == null) return 0;
      const b = off[pid] ?? 999;
      return (goalsBy[opp] || []).filter(gl => gl.t >= a && gl.t <= b).length;
    };
    let winner = null;
    if (homeGoals !== awayGoals) {
      const w = homeGoals > awayGoals ? teams[0] : teams[1], need = Math.min(homeGoals, awayGoals);
      const gs = (goalsBy[w] || []).slice().sort((x, y) => x.t - y.t);
      if (gs[need] && !gs[need].own) winner = gs[need].scorer;
    }
    return { conceded, winner };
  }

  // ---------- Puntos esperados desde los totales reales de la temporada ----------
  // s: totales del jugador (de /players?league&season). teamGames: partidos jugados por su equipo.
  // Devuelve puntos promedio por fecha (contando las fechas en que no jugó como 0).
  function estimateFromSeason(pos, s, teamGames, teamGoalsAgainst, teamCleanSheets) {
    const apps = n(s.apps), starts = n(s.starts), min = n(s.minutes);
    if (!teamGames || apps <= 0 || min <= 0) return 0;
    const share = clamp(min / (teamGames * 90), 0, 1);
    const f = 0.75; // efecto de redondear "cada N" partido a partido
    let p = starts * 2 + Math.max(0, apps - starts) * 1;
    p += n(s.goals) * [6, 6, 5, 4][pos] + n(s.assists) * 3 + Math.max(0, n(s.keyPasses) - n(s.assists));
    p += Math.max(0, starts) * 0 + (teamCleanSheets || 0) * share * [4, 3, 2, 1][pos];
    p += -2 * n(s.penMissed) + 5 * n(s.penSaved) + 2 * n(s.penWon) - 2 * n(s.penCommitted);
    p -= (teamGoalsAgainst || 0) * share * (pos <= 1 ? 0.85 : 0.42);
    p -= n(s.yellow) + 3 * n(s.red);
    if (pos === 0) p += n(s.saves) / 2 * f;
    p += (n(s.shotsOn) + n(s.dribbles) + n(s.shots)) / 2 * f;
    p += (n(s.tackles) + n(s.interceptions)) / 5 * f + n(s.blocks) / 3 * f;
    p -= Math.max(0, n(s.passes) - n(s.passesAccurate)) / [8, 8, 10, 12][pos] * f;
    p += starts * 1.1; // promedio de Puntos Plus de un titular
    return Math.max(0, p / teamGames);
  }

  // Relación entre los puntos reales (ESPN + FotMob/Opta, con Puntos Plus por nota) y la escala con que se
  // calibró la curva de precios, por posición. Medida con la temporada 2026 (jugadores con 8+ partidos):
  // POR 1,56 · DEF 1,28 · MED 0,99 · DEL 1,28, suavizada para que los arqueros y defensas no queden baratos.
  const REAL_SCALE = [1.25, 1.15, 0.9, 1.15];
  const BASIC_SCALE = REAL_SCALE;

  // ---------- Precio: un ciclo de mercado para un jugador ----------
  // st: { v, tr, perf }. ctx: { pts: puntos de la fecha recién jugada (undefined si no hubo fecha),
  //   demand: {bids, premium, buys, sells}, status: 'inj'|'sus'|'duda'|null, cyclesPerJornada, noise }
  function priceStep(st, ctx) {
    const v = st.v, ev = expectedPts(v) * (ctx.evScale || 1);
    let perf = st.perf ?? ev, s = 0;
    if (ctx.pts !== undefined) {
      const pts = ctx.pts || 0;
      perf = 0.65 * perf + 0.35 * pts;
      s += 0.028 * clamp((pts - ev) / (2.5 + 0.4 * ev), -1.5, 1.5);
    }
    s += (0.03 / Math.max(1, ctx.cyclesPerJornada || 7)) * clamp((perf - ev) / (1.5 + 0.35 * ev), -1.5, 1.5);
    const d = ctx.demand;
    if (d) s += 0.006 * Math.min(d.bids, 5) + 0.06 * clamp(d.premium, 0, 0.6) + 0.012 * d.buys - 0.01 * d.sells;
    if (ctx.status) s -= ctx.status === 'inj' ? 0.012 : ctx.status === 'sus' ? 0.006 : 0.004;
    s += 0.0009 + (ctx.noise || 0) * 0.004; // leve inflación: entra dinero por puntos y recompensas
    const tr = 0.6 * (st.tr || 0) + s;
    const nv = Math.max(MIN_VALUE, round10k(v * (1 + clamp(tr, -0.08, 0.08))));
    return { v: nv, tr: Math.round(tr * 1e5) / 1e5, perf: Math.round(perf * 100) / 100, chg: nv - v };
  }

  // ---------- Calendario de fechas en ciclos ----------
  function jornadaAt(cfg, k) {
    const kb = cfg.kBase || 0, jb = cfg.jBase || 0, E = cfg.jornadaEvery;
    if (k <= kb || (k - kb) % E) return null;
    const J = jb + (k - kb) / E;
    return J >= 1 && J <= cfg.totalJornadas ? J : null;
  }
  function nextJornada(cfg, c) {
    const kb = cfg.kBase || 0, jb = cfg.jBase || 0, E = cfg.jornadaEvery;
    const k = c < kb ? 1 : Math.floor((c - kb) / E) + 1;
    const J = jb + k;
    return J > cfg.totalJornadas ? null : { J, k: kb + k * E };
  }
  function playedJornadas(cfg, c) { const nj = nextJornada(cfg, c); return nj ? nj.J - 1 : cfg.totalJornadas; }

  // ---------- Calendario real (partidos de verdad) ----------
  // cal: { matches: { espnId: {J, h, a, kickoff, status, hg, ag} } }. results: { J: {done: {espnId: true}} }
  // La fecha del fantasy empieza 1 hora antes del primer partido real y se cierra cuando terminan todos sus partidos.
  const START_BEFORE = 3600e3;
  const OFF = st => st === 'postponed' || st === 'canceled';
  // Resultado real: cada partido llega como campo m_<id> con {pid: estadísticas}. Une todo en stats y done.
  function normalizeResult(v) {
    if (!v || !v.real) return v;
    const stats = {}, done = {};
    for (const [k, val] of Object.entries(v)) if (k.startsWith('m_') && val && typeof val === 'object') { done[k.slice(2)] = true; Object.assign(stats, val); }
    return { ...v, stats, done };
  }
  function realFechas(cal, results = {}) {
    const by = {};
    for (const [id, m] of Object.entries((cal && cal.matches) || {})) (by[m.J] = by[m.J] || []).push({ id, ...m });
    return Object.keys(by).map(Number).sort((a, b) => a - b).map(J => {
      const ms = by[J].sort((a, b) => a.kickoff - b.kickoff);
      const live = ms.filter(m => !OFF(m.status));
      const first = (live[0] || ms[0]).kickoff, last = (live[live.length - 1] || ms[ms.length - 1]).kickoff;
      const done = (results[J] && results[J].done) || {};
      const closed = live.length > 0 && live.every(m => m.status === 'post' && done[m.id]);
      return { J, start: first - START_BEFORE, first, last, matches: ms, closed };
    });
  }
  // Estado ahora: fecha en juego (empezó y no cerró), próxima fecha, y si las cláusulas o alineaciones están cerradas
  function realState(cal, results, now, minJ = 0) {
    const fs = realFechas(cal, results).filter(f => f.J >= minJ);
    const current = fs.find(f => f.start <= now && !f.closed) || null;
    const next = fs.find(f => f.start > now) || null;
    return { fechas: fs, current, next, lineupLocked: !!current, clauseLocked: !!next && now >= next.start - 24 * 3600e3 };
  }

  // ---------- Cláusulas (reglas LaLiga Fantasy) ----------
  // La cláusula nunca es menor que el valor de mercado ni que 1M.
  function clauseOf(own, value, cfg = DEFAULTS) { return Math.max(own.clause || 0, value || 0, cfg.clauseMin || 0); }
  // Cláusula al fichar: lo pagado, nunca menos que el valor de mercado ni que 1M.
  function initialClause(price, value, cfg = DEFAULTS) { return Math.max(price || 0, value || 0, cfg.clauseMin || 0); }
  // Subir cláusula 1:2 (pagas 1, sube 2). No se puede con deuda.
  const raisedClause = (current, paid) => current + 2 * paid;
  // Se cierran 24 h antes de la fecha (último ciclo) y se reabren al jugarse
  function clauseLocked(cfg, cycle) { const nj = nextJornada(cfg, cycle); return !!nj && nj.k === cycle + 1; }
  // lockedNow: en modo real, si las cláusulas están cerradas (24 h antes del inicio de la fecha)
  function clauseBlock(cfg, own, cycle, now, lockedNow) {
    if (cycle < (own.protect || 0)) return `Protegido tras su fichaje: ${own.protect - cycle} ciclo(s) más`;
    if ((own.shieldUntil || 0) > now) return 'Blindado por su dueño';
    if (lockedNow === undefined ? clauseLocked(cfg, cycle) : lockedNow) return 'Cláusulas cerradas: faltan menos de 24 horas para la fecha';
    return null;
  }
  // Doble blindaje: hasta 2 jugadores a la vez, solo con la cláusula ya activa (fuera de la protección de fichaje)
  function shieldBlock(cfg, own, cycle, now, activeShields) {
    if ((own.shieldUntil || 0) > now) return 'Ya está blindado';
    if (cycle < (own.protect || 0)) return 'Todavía está protegido por su fichaje: no necesita blindaje';
    if (activeShields >= cfg.shieldMax) return `Ya tienes ${cfg.shieldMax} blindajes activos`;
    return null;
  }
  // Deuda: pujas y ofertas pueden dejarte en negativo hasta el 20% del valor de tu equipo.
  const spendLimit = (cash, teamValue, cfg = DEFAULTS) => cash + Math.floor(teamValue * cfg.debtPct);
  // Oferta de la liga por un jugador en venta: cercana al valor de mercado, se renueva cada ciclo
  function leagueOffer(seed, cycle, pid, value) { const r = rng(`lo-${seed}-${cycle}-${pid}`); return Math.max(MIN_VALUE, round10k(value * (0.95 + 0.1 * r()))); }

  return {
    POS, POS_LONG, FORMATIONS, DEFAULTS, MIN_VALUE, STAT_KEYS, clamp, round10k,
    hashStr, rng, normal, valueFor, expectedPts, blankStats, plusPoints, plusFromRating, score, finalize, BASIC_SCALE, REAL_SCALE, realFechas, realState, normalizeResult,
    posFromApi, fromApiFootball, matchContext, estimateFromSeason, priceStep,
    jornadaAt, nextJornada, playedJornadas, clauseOf, initialClause, raisedClause, clauseLocked, clauseBlock, shieldBlock, spendLimit, leagueOffer,
  };
})();
if (typeof module !== 'undefined') module.exports = Core;
