// Simula ESPN para probar la sincronización sin red. Estructura según respuestas reales observadas.
const ev = (id, date, state, h, a, hs, as, details = []) => ({ id, date, status: { type: { state, name: state === 'post' ? 'STATUS_FULL_TIME' : state === 'x' ? 'STATUS_POSTPONED' : 'STATUS_SCHEDULED', completed: state === 'post' } },
  competitions: [{ competitors: [{ homeAway: 'home', team: { id: h[0], displayName: h[1] }, score: String(hs) }, { homeAway: 'away', team: { id: a[0], displayName: a[1] }, score: String(as) }], details }] });
const LSE = ['4137', 'La Serena'], UCH = ['4139', 'Universidad de Chile'], COB = ['4133', 'Cobresal'], UDC = ['5362', 'Universidad de Concepción'];
const det = (text, clock, team, id, name, f = {}) => ({ type: { text }, clock: { displayValue: clock }, team: { id: team }, athletesInvolved: [{ id, displayName: name }], scoringPlay: !!f.goal, penaltyKick: !!f.pen, ownGoal: !!f.own, yellowCard: text === 'Yellow Card', redCard: text === 'Red Card' });
const DAYS = {
  '20260913': { events: [ev('401850656', '2026-09-13T18:00Z', 'post', LSE, UCH, 0, 3, [
    det('Yellow Card', "11'", '4137', '149759', 'Rafael Delgado'), det('Goal', "47'", '4139', '345276', 'Agustin Arce', { goal: 1 }),
    det('Goal', "55'", '4139', '205198', 'Fabian Hormazabal', { goal: 1 }), det('Goal - Header', "90'+4'", '4139', '167681', 'Igor Lichnovsky', { goal: 1 })])] },
  '20261010': { events: [ev('401850660', '2026-10-10T18:00Z', 'pre', COB, UDC, 0, 0), ev('401850663', '2026-10-10T23:00Z', 'x', ['885', 'Universidad Católica'], ['4138', 'Audax Italiano'], 0, 0)] },
};
const st = o => Object.entries(o).map(([name, value]) => ({ name, value }));
const SUMMARY = { rosters: [
  { homeAway: 'home', team: { id: '4137' }, roster: [
    { starter: true, jersey: '33', athlete: { id: '149759', displayName: 'Rafael Delgado' }, stats: st({ appearances: 1, yellowCards: 1, goalsConceded: 3, totalShots: 0 }) },
    { starter: true, jersey: '23', athlete: { id: '253929', displayName: 'Matías Marín' }, subbedOut: { didSub: true }, stats: st({ totalShots: 5, shotsOnTarget: 1 }) },
    { starter: true, jersey: '31', athlete: { id: '336564', displayName: 'José Tapia' }, stats: st({ saves: 0, goalsConceded: 3 }) },
    { starter: false, jersey: '6', athlete: { id: '204911', displayName: 'Sebastián Díaz' }, subbedIn: { didSub: true }, stats: st({ appearances: 1 }) },
    { starter: false, jersey: '1', athlete: { id: '1', displayName: 'F. Lanzillotta' }, stats: st({ appearances: 0 }) }] },
  { homeAway: 'away', team: { id: '4139' }, roster: [
    { starter: true, jersey: '25', athlete: { id: '201316', displayName: 'Gabriel Castellón' }, stats: st({ saves: 3, goalsConceded: 0 }) },
    { starter: true, jersey: '28', athlete: { id: '345276', displayName: 'Agustin Arce' }, stats: st({ totalGoals: 1, shotsOnTarget: 2, totalShots: 3, yellowCards: 1 }) },
    { starter: true, jersey: '17', athlete: { id: '205198', displayName: 'Fabian Hormazabal' }, stats: st({ totalGoals: 1, goalAssists: 1, shotsOnTarget: 2, totalShots: 3 }) },
    { starter: false, jersey: '3', athlete: { id: '167681', displayName: 'Igor Lichnovsky' }, subbedIn: { didSub: true }, stats: st({ totalGoals: 1, shotsOnTarget: 1, totalShots: 1 }) }] }],
  plays: [{ type: { text: 'Substitution' }, clock: { displayValue: "82'" }, participants: [{ athlete: { id: '204911' } }, { athlete: { id: '253929' } }] }] };
const CORE = {
  '4137': { entries: [{ playerId: 149759, jersey: '33', starter: true }, { playerId: 253929, jersey: '23', starter: true, subbedOut: { didSub: true, clock: { displayValue: "82'" } } }, { playerId: 336564, jersey: '31', starter: true }, { playerId: 204911, jersey: '6', starter: false, subbedIn: { didSub: true, clock: { displayValue: "82'" } } }] },
  '4139': { entries: [{ playerId: 201316, jersey: '25', starter: true }, { playerId: 345276, jersey: '28', starter: true }, { playerId: 205198, jersey: '17', starter: true }, { playerId: 167681, jersey: '3', starter: false, subbedIn: { didSub: true, clock: { value: 4440, displayValue: "74'" } } }] },
};
global.fetch = async (url) => {
  let body = null;
  const u = String(url);
  if (/scoreboard\?dates=(\d+)/.test(u)) body = DAYS[u.match(/dates=(\d+)/)[1]] || { events: [] };
  else if (/scoreboard$/.test(u)) body = { leagues: [{ calendar: ['2026-09-13T07:00Z', '2026-10-10T07:00Z'] }], events: [] };
  else if (/summary\?event=/.test(u)) body = SUMMARY;
  else if (/competitors\/(\d+)\/roster/.test(u)) body = CORE[u.match(/competitors\/(\d+)\/roster/)[1]];
  return { ok: !!body, status: body ? 200 : 404, json: async () => body };
};
