// Lectura de ESPN (JSON público, sin clave) y conversión al formato de entrada del traductor.
// Todas las lecturas son tolerantes: ESPN no documenta su API y algunos campos varían entre partidos.

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/soccer/chi.1';
const CORE = 'https://sports.core.api.espn.com/v2/sports/soccer/leagues/chi.1';

const sleep = ms => new Promise(r => setTimeout(r, ms));
let calls = 0;

async function getJSON(url, tries = 3) {
  for (let i = 0; i < tries; i++) {
    try {
      calls++;
      const res = await fetch(url, { headers: { 'User-Agent': 'fantasy-primera-sync/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (e) {
      if (i === tries - 1) throw new Error(`${url}: ${e.message}`);
      await sleep(800 * (i + 1));
    }
  }
}

// "47'" -> 47 · "90'+4'" -> 94 · {value: 4440} (segundos) -> 74
function minuteOf(clock) {
  if (clock == null) return null;
  if (typeof clock === 'number') return clock > 200 ? Math.round(clock / 60) : clock;
  if (typeof clock === 'string') {
    const m = clock.match(/(\d+)'?\s*(?:\+\s*(\d+))?/);
    return m ? Number(m[1]) + (m[2] ? Number(m[2]) : 0) : null;
  }
  if (typeof clock === 'object') {
    if (clock.displayValue) return minuteOf(String(clock.displayValue));
    if (clock.value != null) return minuteOf(Number(clock.value));
  }
  return null;
}

function statusOf(ev) {
  const t = (ev.status && ev.status.type) || {};
  const name = String(t.name || '') + ' ' + String(t.description || '');
  if (/POSTPON|aplaz/i.test(name)) return 'postponed';
  if (/CANCEL|SUSPEND|ABANDON/i.test(name)) return 'canceled';
  return t.state || (t.completed ? 'post' : 'pre');
}

function detailType(d) {
  const text = String((d.type && d.type.text) || '');
  if (d.ownGoal || /own goal/i.test(text)) return 'own_goal';
  if (d.scoringPlay) return d.penaltyKick || /penalty/i.test(text) ? 'penalty_goal' : 'goal';
  if (d.redCard || /red card/i.test(text)) return 'red';
  if (d.yellowCard || /yellow card/i.test(text)) return 'yellow';
  if (/penalty/i.test(text) && /miss|saved/i.test(text)) return 'missed_penalty';
  return null;
}

// Días con partidos de la temporada (del calendario del scoreboard)
async function calendarDays() {
  const sb = await getJSON(`${SITE}/scoreboard`);
  const cal = (sb && sb.leagues && sb.leagues[0] && sb.leagues[0].calendar) || [];
  const days = new Set();
  for (const c of cal) {
    const iso = typeof c === 'string' ? c : (c && (c.startDate || c.value || c.date));
    if (iso) days.add(String(iso).slice(0, 10));
    if (c && Array.isArray(c.entries)) for (const e of c.entries) if (e.startDate) days.add(String(e.startDate).slice(0, 10));
  }
  return { days: [...days].sort(), raw: sb };
}

// Partidos de un día (YYYY-MM-DD)
async function eventsOfDay(day) {
  const sb = await getJSON(`${SITE}/scoreboard?dates=${day.replace(/-/g, '')}`);
  const out = [];
  for (const ev of (sb && sb.events) || []) {
    const comp = (ev.competitions && ev.competitions[0]) || {};
    const side = ha => (comp.competitors || []).find(c => c.homeAway === ha) || {};
    const h = side('home'), a = side('away');
    const status = statusOf(ev);
    const details = [];
    for (const d of comp.details || []) {
      const type = detailType(d);
      if (!type) continue;
      const ath = (d.athletesInvolved && d.athletesInvolved[0]) || {};
      details.push({ type, minute: minuteOf(d.clock) || 0, teamId: d.team && String(d.team.id), athleteId: ath.id != null ? String(ath.id) : null, athleteName: ath.displayName || ath.fullName || null });
    }
    out.push({
      id: String(ev.id), date: ev.date, status,
      home: { name: (h.team && (h.team.displayName || h.team.name)) || '', teamId: h.team && String(h.team.id), score: Number(h.score) || 0 },
      away: { name: (a.team && (a.team.displayName || a.team.name)) || '', teamId: a.team && String(a.team.id), score: Number(a.score) || 0 },
      details,
    });
  }
  return { events: out, raw: sb };
}

// Estadísticas por jugador del resumen del partido: { teamId: { athleteId: {name, jersey, starter, stats} } }
async function summaryRosters(eventId) {
  const s = await getJSON(`${SITE}/summary?event=${eventId}`);
  const out = {};
  for (const r of (s && s.rosters) || []) {
    const tid = r.team && String(r.team.id);
    const map = out[tid] = {};
    for (const e of r.roster || []) {
      const ath = e.athlete || {};
      if (ath.id == null) continue;
      const stats = {};
      for (const st of e.stats || []) if (st && st.name) stats[st.name] = Number(st.value != null ? st.value : st.displayValue) || 0;
      map[String(ath.id)] = {
        name: ath.displayName || ath.fullName || null, jersey: e.jersey || ath.jersey || null, starter: !!e.starter,
        inMin: e.subbedIn && e.subbedIn.didSub ? minuteOf(e.subbedIn.clock || e.subbedIn) : null,
        outMin: e.subbedOut && e.subbedOut.didSub ? minuteOf(e.subbedOut.clock || e.subbedOut) : null,
        subIn: !!(e.subbedIn && (e.subbedIn.didSub || e.subbedIn === true)), subOut: !!(e.subbedOut && (e.subbedOut.didSub || e.subbedOut === true)),
        stats,
      };
    }
  }
  // minutos de cambio desde las jugadas (si el resumen las trae)
  const subs = [];
  for (const p of [...((s && s.keyEvents) || []), ...((s && s.plays) || [])]) {
    const t = String((p.type && p.type.text) || p.text || '');
    if (!/substitution/i.test(t)) continue;
    const parts = (p.participants || []).map(x => x.athlete && String(x.athlete.id)).filter(Boolean);
    subs.push({ minute: minuteOf(p.clock), ids: parts });
  }
  return { rosters: out, subs, raw: s };
}

// Alineación con minutos de cambio (API "core"): [{athleteId, jersey, starter, inMin, outMin}]
async function coreRoster(eventId, teamId) {
  const r = await getJSON(`${CORE}/events/${eventId}/competitions/${eventId}/competitors/${teamId}/roster`);
  const out = [];
  for (const e of (r && r.entries) || []) {
    const sin = e.subbedIn || {}, sout = e.subbedOut || {};
    out.push({
      athleteId: String(e.playerId != null ? e.playerId : (e.athlete && e.athlete.$ref || '').split('/').pop().split('?')[0]),
      jersey: e.jersey || null, starter: !!e.starter,
      inMin: sin.didSub ? minuteOf(sin.clock || sin.time || sin) : null,
      outMin: sout.didSub ? minuteOf(sout.clock || sout.time || sout) : null,
    });
  }
  return { entries: out, raw: r };
}

// Partido terminado listo para el traductor: une resumen (nombres y estadísticas) y alineación (minutos)
async function fullMatch(ev) {
  const sum = await summaryRosters(ev.id);
  const rosters = {};
  for (const side of ['home', 'away']) {
    const tid = ev[side].teamId;
    let core = null;
    try { core = await coreRoster(ev.id, tid); } catch (e) { core = null; }
    const fromSum = sum.rosters[tid] || {};
    const ids = new Set([...Object.keys(fromSum), ...((core && core.entries) || []).map(x => x.athleteId)]);
    const list = [];
    for (const id of ids) {
      const s = fromSum[id] || {}, c = ((core && core.entries) || []).find(x => x.athleteId === id) || {};
      let inMin = c.inMin != null ? c.inMin : s.inMin, outMin = c.outMin != null ? c.outMin : s.outMin;
      const played = s.starter || c.starter || inMin != null || s.subIn || (s.stats && s.stats.appearances > 0);
      if (!played) continue;
      // cambio sin minuto: buscarlo en las jugadas del resumen
      if ((s.subIn || s.subOut) && inMin == null && outMin == null) {
        const sb = sum.subs.find(x => x.ids.includes(id));
        if (sb) { if (s.subIn) inMin = sb.minute; else outMin = sb.minute; }
      }
      list.push({ athleteId: id, name: s.name || null, jersey: c.jersey || s.jersey || null, starter: !!(c.starter || s.starter), inMin: inMin != null ? inMin : (s.subIn && !s.starter ? 60 : null), outMin, stats: s.stats || null });
    }
    rosters[side] = list;
  }
  return { ...ev, rosters, _raw: { summary: sum.raw } };
}

module.exports = { getJSON, calendarDays, eventsOfDay, summaryRosters, coreRoster, fullMatch, minuteOf, statusOf, detailType, calls: () => calls, sleep };
