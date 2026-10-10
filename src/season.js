// Rendimiento de la temporada y precio sugerido por jugador, a partir de todos los partidos procesados.
// Precio = puntos esperados por fecha (60% toda la temporada + 40% últimos 5 partidos de su club),
// combinados con la estimación previa del jugador (pesa como 3 partidos, así un solo partido no dispara
// el precio), llevados a la escala de la curva de precios con Core.REAL_SCALE y convertidos con Core.valueFor.
const PRIOR_GAMES = 3;
// Sobre 8 puntos por fecha (escala completa) la curva se suaviza a la mitad: así la élite se diferencia
// sin que los mejores superen lo que permite un presupuesto de $100 M.
const compress = x => (x <= 8 ? x : Math.min(13, 8 + (x - 8) * 0.5));

function seasonPrices({ Core, PLAYERS_RAW, EXP = {}, calendar, results }) {
  const K = Core.STAT_KEYS, IP = K.indexOf('pts'), IM = K.indexOf('min'), IG = K.indexOf('g'), IA = K.indexOf('a');
  const team = Object.fromEntries(PLAYERS_RAW.map(p => [p[0], p[2]]));
  const pos = Object.fromEntries(PLAYERS_RAW.map(p => [p[0], p[3]]));
  const matches = calendar.matches || {};
  // partidos terminados de cada club, en orden
  const clubGames = {};
  for (const [id, m] of Object.entries(matches)) {
    if (m.status !== 'post') continue;
    for (const t of [m.h, m.a]) (clubGames[t] = clubGames[t] || []).push({ id, kickoff: m.kickoff });
  }
  for (const t of Object.keys(clubGames)) clubGames[t].sort((a, b) => a.kickoff - b.kickoff);
  // puntos por jugador y partido
  const byPlayer = {};
  for (const r of Object.values(results)) {
    for (const [k, stats] of Object.entries(r)) {
      if (!k.startsWith('m_') || !stats) continue;
      const mid = k.slice(2);
      for (const [pid, arr] of Object.entries(stats)) (byPlayer[pid] = byPlayer[pid] || {})[mid] = arr;
    }
  }
  const players = {};
  for (const [pid] of PLAYERS_RAW.map(p => [p[0]])) {
    const games = clubGames[team[pid]] || [];
    const mine = byPlayer[pid] || {};
    let pts = 0, min = 0, g = 0, a = 0, pj = 0;
    for (const [mid, arr] of Object.entries(mine)) { pts += arr[IP]; min += arr[IM]; g += arr[IG]; a += arr[IA]; if (arr[IM] > 0) pj++; }
    const last5 = games.slice(-5).map(x => (mine[x.id] ? mine[x.id][IP] : 0));
    const eAll = games.length ? pts / games.length : 0;
    const eLast = last5.length ? last5.reduce((s, x) => s + x, 0) / last5.length : 0;
    const sc = Core.REAL_SCALE[pos[pid]];
    const prior = (EXP[pid] != null ? EXP[pid] : 0.5) * sc;
    const n = games.length;
    const eReal = n ? 0.6 * eAll + 0.4 * eLast : null;
    const e = n ? (n * eReal + PRIOR_GAMES * prior) / (n + PRIOR_GAMES) : null;
    players[pid] = {
      e: e == null ? null : Math.round(e * 100) / 100,
      v: e == null ? null : Core.valueFor(compress(Math.max(0, e) / sc)),
      pj, pts, min, g, a, last5,
    };
  }
  return { players, games: Object.values(matches).filter(m => m.status === 'post').length, updatedAt: Date.now() };
}

module.exports = { seasonPrices };
