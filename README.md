# Fantasy Primera

Fantasy de la Liga de Primera de Chile 2026 con las reglas de LaLiga Fantasy: puntos por estadísticas, mercado diario con precios dinámicos, pujas secretas, cláusulas y blindaje.

Este repositorio hace dos cosas:

1. **Sincroniza los partidos reales.** Cada 30 minutos, GitHub Actions lee de ESPN (JSON público, sin clave) el calendario, los resultados, goles, tarjetas y minutos, y de FotMob (JSON público, sin clave, datos Opta) las estadísticas detalladas de cada jugador: ocasiones creadas, remates a puerta, regates, centros, recuperaciones, despejes, balones perdidos, atajadas y la nota del partido. Calcula los puntos y guarda todo en `data/`.
2. **Guarda el motor del juego.** `shared/` tiene el catálogo de jugadores, las reglas (puntos, precios, cláusulas) y el traductor de ESPN. Son los mismos archivos que usa el prototipo y que usará la app real.

## Qué se publica en `data/`

| Archivo | Contenido |
|---|---|
| `calendar.json` | Todos los partidos de la temporada con su número de fecha, hora, estado y marcador |
| `results/jN.json` | Fecha N: un campo `m_<id>` por partido terminado con las estadísticas y puntos de cada jugador |
| `prices.json` | Por jugador: puntos de la temporada, partidos, minutos, goles, asistencias, últimos 5 partidos y precio sugerido |
| `idmap.json` | Correspondencia entre jugadores de ESPN y del catálogo |
| `detail/<id>.json` | Estadísticas FotMob de cada partido (por id de ESPN) |
| `report.json` | Resumen de la última sincronización: partidos leídos, jugadores sin identificar y errores |
| `debug/` | Respuestas crudas de ESPN de muestra, para revisar la lectura |

## Puntos

Tabla completa de LaLiga Fantasy (base Opta). Los Puntos Plus (equivalentes a los Puntos DAZN, 0 a 4) salen de la nota de FotMob: menos de 6,2 = 0; 6,2 = 1; 7,0 = 2; 7,8 = 3; 8,7 o más = 4. Si un partido no tiene detalle de FotMob, se usa solo ESPN y los Puntos Plus se estiman con las estadísticas disponibles.

## Precios según el rendimiento

`prices.json` calcula los puntos esperados por fecha de cada jugador: 60% el promedio de toda la temporada y 40% los últimos 5 partidos de su club. Con pocos partidos se combina con una estimación previa, que pesa como 3 partidos. Ese valor se divide por `Core.REAL_SCALE` (relación medida entre los puntos reales y la escala de la curva, por posición) y se convierte en precio con la curva del juego: 1 punto ≈ $0,5 M, 3 ≈ $5 M, 5 ≈ $15 M, 8 ≈ $40 M.

## Uso local

```bash
node src/sync.js            # últimos 3 días y próximos 21
node src/sync.js --season   # temporada completa
node test/run.js            # prueba con ESPN simulado
```

Requiere Node 20 o superior. No usa dependencias.

## Ejecución automática

`.github/workflows/sync.yml` corre cada 30 minutos y guarda los cambios en `data/`. Cada vez que cambia el código, recalcula la temporada completa. También se puede lanzar a mano desde la pestaña Actions ("Run workflow").

ESPN y FotMob son fuentes no oficiales y gratuitas: sirven para un prototipo entre amigos. `tools/probe.js` (workflow "Probar fuentes de estadísticas") revisa que sigan respondiendo. Para un producto comercial hay que usar un proveedor con licencia (por ejemplo API-Football) y los derechos de imagen de la liga y los clubes.
