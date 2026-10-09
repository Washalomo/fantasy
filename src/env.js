// Carga los módulos compartidos con la página (catálogo, núcleo de reglas y traductor ESPN)
// en un contexto aislado, igual que en el navegador.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const dir = path.join(__dirname, '..', 'shared');
const ctx = { console, Math, Object, Array, Set, Map, JSON, String, Number, Date, Boolean, Infinity, NaN, parseFloat, parseInt, isNaN, isFinite };
vm.createContext(ctx);
const code = ['data.js', 'core.js', 'espn.js']
  .map(f => fs.readFileSync(path.join(dir, f), 'utf8').replace(/^if \(typeof module.*$/m, ''))
  .join('\n;\n') + '\n;this.Core = Core; this.Espn = Espn; this.TEAMS = TEAMS; this.PLAYERS_RAW = PLAYERS_RAW; this.EXP = typeof EXP !== "undefined" ? EXP : {};';
vm.runInContext(code, ctx);

module.exports = { Core: ctx.Core, Espn: ctx.Espn, TEAMS: ctx.TEAMS, PLAYERS_RAW: ctx.PLAYERS_RAW, EXP: ctx.EXP };
