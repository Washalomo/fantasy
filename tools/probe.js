// Prueba qué fuentes gratis entregan estadísticas detalladas (pases, entradas, etc.) de la Liga de Primera.
// Corre en GitHub Actions y guarda el resultado en data/debug/probe.json
const fs = require('fs');
const path = require('path');
const out = { at: new Date().toISOString(), tests: [] };
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

async function get(name, url, headers = {}) {
  const t = { name, url };
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json', ...headers } });
    t.status = r.status;
    const txt = await r.text();
    t.bytes = txt.length;
    try { t.json = JSON.parse(txt); } catch { t.sample = txt.slice(0, 300); }
  } catch (e) { t.error = String(e); }
  out.tests.push(t);
  return t;
}
const keep = (t, f) => { if (t.json) { try { t.summary = f(t.json); } catch (e) { t.summary = 'error: ' + e; } delete t.json; } };

(async () => {
  // ---------- Sofascore ----------
  const hosts = ['https://api.sofascore.com/api/v1', 'https://www.sofascore.com/api/v1'];
  let base = null, tid = null, sid = null, eid = null;
  for (const h of hosts) {
    const c = await get('sofascore países', `${h}/sport/football/categories`, { Referer: 'https://www.sofascore.com/' });
    if (!c.json) { if (c.sample) c.sample = c.sample.slice(0, 200); continue; }
    const chile = (c.json.categories || []).find(x => /^chile$/i.test(x.name));
    keep(c, () => chile ? `${chile.id} ${chile.name}` : 'Chile no aparece');
    if (!chile) continue;
    const t = await get('sofascore torneos de Chile', `${h}/category/${chile.id}/unique-tournaments`, { Referer: 'https://www.sofascore.com/' });
    if (t.json) {
      base = h;
      const list = (t.json.groups || []).flatMap(g => g.uniqueTournaments || []);
      const prim = list.find(u => /primera/i.test(u.name)) || list[0];
      tid = prim && prim.id;
      keep(t, () => list.map(u => `${u.id} ${u.name}`));
      break;
    }
    if (t.sample) t.sample = t.sample.slice(0, 200);
  }
  if (!tid && base) {
    const t = await get('sofascore búsqueda', `${base}/search/unique-tournaments?q=primera%20division%20chile`);
    keep(t, j => (j.results || []).slice(0, 5).map(r => `${r.entity.id} ${r.entity.name} ${r.entity.category && r.entity.category.name}`));
  }
  if (base && tid) {
    const s = await get('sofascore temporadas', `${base}/unique-tournament/${tid}/seasons`);
    if (s.json) sid = s.json.seasons[0].id;
    keep(s, j => j.seasons.slice(0, 3).map(x => `${x.id} ${x.year}`));
    const ev = await get('sofascore últimos partidos', `${base}/unique-tournament/${tid}/season/${sid}/events/last/0`);
    if (ev.json) { const e = ev.json.events.filter(e => e.status && e.status.type === 'finished').pop(); eid = e && e.id; }
    keep(ev, j => j.events.slice(-3).map(e => `${e.id} ${e.homeTeam.name} ${e.homeScore.current}-${e.awayScore.current} ${e.awayTeam.name} ronda ${e.roundInfo && e.roundInfo.round}`));
    if (eid) {
      const lu = await get('sofascore alineaciones con estadísticas', `${base}/event/${eid}/lineups`);
      keep(lu, j => { const p = j.home.players.find(x => x.statistics && x.statistics.minutesPlayed) || j.home.players[0]; return { jugador: p.player.name, estadisticas: p.statistics }; });
    }
  }

  // ---------- FotMob ----------
  const fm = await get('fotmob liga 273', 'https://www.fotmob.com/api/leagues?id=273&ccode3=CHL');
  let mid = null;
  if (fm.json) {
    const all = (fm.json.fixtures && (fm.json.fixtures.allMatches || fm.json.matches && fm.json.matches.allMatches)) || (fm.json.matches && fm.json.matches.allMatches) || [];
    const fin = all.filter(m => m.status && m.status.finished);
    mid = fin.length ? fin[fin.length - 1].id : null;
    keep(fm, j => ({ nombre: j.details && j.details.name, pais: j.details && j.details.country, partidos: all.length, ultimo: fin.length ? `${fin[fin.length - 1].home.name} ${fin[fin.length - 1].status.scoreStr} ${fin[fin.length - 1].away.name}` : null }));
  }
  if (mid) {
    for (const u of [`https://www.fotmob.com/api/matchDetails?matchId=${mid}`, `https://www.fotmob.com/api/data/matchDetails?matchId=${mid}`]) {
      const md = await get('fotmob detalle de partido', u);
      keep(md, j => {
        const ps = j.content && j.content.playerStats;
        if (!ps) return { claves: Object.keys(j.content || j) };
        const p = Object.values(ps)[0];
        return { jugador: p.name, grupos: (p.stats || []).map(g => ({ titulo: g.title, campos: Object.keys(g.stats || {}) })) };
      });
      if (md.summary) break;
    }
  }

  fs.mkdirSync(path.join(__dirname, '..', 'data', 'debug'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, '..', 'data', 'debug', 'probe.json'), JSON.stringify(out, null, 1));
  console.log(JSON.stringify(out, null, 1).slice(0, 6000));
})();
