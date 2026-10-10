// Lectura de FotMob (JSON público, sin clave; datos Opta): estadísticas detalladas por jugador.
// ESPN sigue siendo la fuente del calendario, goles, tarjetas y minutos; FotMob completa pases clave,
// regates, centros, recuperaciones, despejes, balones perdidos, atajadas y la nota del partido.
const LEAGUE = 273; // Liga de Primera (Chile)
const BASE = 'https://www.fotmob.com/api/data';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
let calls = 0;
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function getJSON(url, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      calls++;
      const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } catch (e) { last = e; await sleep(800 * (i + 1)); }
  }
  throw new Error(`FotMob ${url}: ${last && last.message}`);
}

// Partidos de la temporada: [{ id, home, away, utc, finished }]
async function leagueMatches() {
  const j = await getJSON(`${BASE}/leagues?id=${LEAGUE}&ccode3=CHL`);
  const all = (j.fixtures && j.fixtures.allMatches) || (j.matches && j.matches.allMatches) || [];
  return all.map(m => ({ id: String(m.id), home: m.home.name, away: m.away.name, utc: Date.parse(m.status.utcTime), finished: !!m.status.finished, cancelled: !!m.status.cancelled, round: m.round }));
}

// Estadísticas por jugador de un partido, en forma compacta
function parseMatch(j) {
  const g = j.general || {};
  const homeId = g.homeTeam && g.homeTeam.id, awayId = g.awayTeam && g.awayTeam.id;
  const players = [];
  for (const p of Object.values((j.content && j.content.playerStats) || {})) {
    const st = {};
    for (const grp of p.stats || []) for (const s of Object.values(grp.stats || {})) {
      if (!s || !s.key || !s.stat) continue;
      st[s.key] = s.stat.value != null ? s.stat.value : 0;
      if (s.stat.total != null) st[s.key + '_total'] = s.stat.total;
    }
    const n = k => Number(st[k]) || 0;
    const min = n('minutes_played');
    if (!min) continue; // suplente que no entró
    players.push({
      name: p.name, shirt: p.shirtNumber != null ? String(p.shirtNumber) : null,
      side: p.teamId === homeId ? 'home' : p.teamId === awayId ? 'away' : null, gk: !!p.isGoalkeeper,
      rating: st.rating_title != null ? Number(st.rating_title) : null,
      min, g: n('goals'), a: n('assists'), chances: n('chances_created'), sot: n('ShotsOnTarget'), shots: n('total_shots'),
      drb: n('dribbles_succeeded'), crosses: n('accurate_crosses'), boxTouches: n('touches_opp_box'),
      rec: n('recoveries'), clr: n('clearances'), tck: n('matchstats.headers.tackles'), int: n('interceptions'),
      disp: n('dispossessed'), sav: n('saves'), gc: st.goals_conceded != null ? n('goals_conceded') : null,
      passes: n('accurate_passes'), passesTotal: n('accurate_passes_total'), err: n('errors_led_to_goal'),
    });
  }
  return { id: String(g.matchId || ''), home: g.homeTeam && g.homeTeam.name, away: g.awayTeam && g.awayTeam.name, players, at: Date.now() };
}

async function matchDetail(id) { return parseMatch(await getJSON(`${BASE}/matchDetails?matchId=${id}`)); }

module.exports = { leagueMatches, matchDetail, parseMatch, calls: () => calls, sleep };
