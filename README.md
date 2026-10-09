# Fantasy Primera

Fantasy de la Liga de Primera de Chile 2026 con las reglas de LaLiga Fantasy: puntos por estadísticas, mercado diario con precios dinámicos, pujas secretas, cláusulas y blindaje.

Este repositorio hace dos cosas:

1. **Sincroniza los partidos reales.** Cada 30 minutos, GitHub Actions lee de ESPN (JSON público, sin clave) el calendario, los resultados y el detalle por jugador de cada partido terminado, calcula los puntos y guarda todo en `data/`.
2. **Guarda el motor del juego.** `shared/` tiene el catálogo de jugadores, las reglas (puntos, precios, cláusulas) y el traductor de ESPN. Son los mismos archivos que usa el prototipo y que usará la app real.

## Qué se publica en `data/`

| Archivo | Contenido |
|---|---|
| `calendar.json` | Todos los partidos de la temporada con su número de fecha, hora, estado y marcador |
| `results/jN.json` | Fecha N: un campo `m_<id>` por partido terminado con las estadísticas y puntos de cada jugador |
| `prices.json` | Por jugador: puntos de la temporada, partidos, minutos, goles, asistencias, últimos 5 partidos y precio sugerido |
| `idmap.json` | Correspondencia entre jugadores de ESPN y del catálogo |
| `report.json` | Resumen de la última sincronización: partidos leídos, jugadores sin identificar y errores |
| `debug/` | Respuestas crudas de ESPN de muestra, para revisar la lectura |

## Puntos

Tabla de LaLiga Fantasy (base Opta). De ESPN se usan: minutos, goles, asistencias, remates, remates al arco, atajadas, goles recibidos, penales, autogoles, tarjetas y gol ganador. ESPN no publica recuperaciones, despejes, regates, pases clave ni balones perdidos; para que eso no castigue los precios, la referencia de precios se ajusta por posición con `Core.REAL_SCALE`.

## Precios según el rendimiento

`prices.json` calcula los puntos esperados por fecha de cada jugador: 60% el promedio de toda la temporada y 40% los últimos 5 partidos de su club. Con pocos partidos se combina con una estimación previa, que pesa como 3 partidos. Ese valor se convierte en precio con la misma curva del juego: 1 punto ≈ $0,5 M, 3 ≈ $5 M, 5 ≈ $15 M, 8 ≈ $40 M, en escala completa.

## Uso local

```bash
node src/sync.js            # últimos 3 días y próximos 21
node src/sync.js --season   # temporada completa
node test/run.js            # prueba con ESPN simulado
```

Requiere Node 20 o superior. No usa dependencias.

## Ejecución automática

`.github/workflows/sync.yml` corre cada 30 minutos y guarda los cambios en `data/`. Cada vez que cambia el código, recalcula la temporada completa. También se puede lanzar a mano desde la pestaña Actions ("Run workflow").

ESPN es una fuente no oficial y gratuita: sirve para un prototipo entre amigos. Para un producto comercial hay que usar un proveedor con licencia (por ejemplo API-Football) y los derechos de imagen de la liga y los clubes.
