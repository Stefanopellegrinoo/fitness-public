# Design System — "Placa de gimnasio"

Dirección visual de la app (julio 2026). Regla madre: **los números son el contenido** —
kg, reps, tiempo y calorías se tratan como protagonistas tipográficos; todo lo demás
queda quieto y neutro. Un solo acento de color. Sin gradientes decorativos, sin glows,
sin itálicas.

## Tokens

Fuente de verdad: `frontend/app/globals.css` (`:root` + `@theme inline`, Tailwind v4
CSS-first — no existe `tailwind.config`). Nunca hardcodear hex ni clases de paleta
(`blue-600`, `bg-[#...]`) en componentes: siempre clases semánticas.

| Token | Valor | Uso |
|---|---|---|
| `--background` | `#0B0A08` | Fondo OLED cálido (undertone ámbar, no gris azulado) |
| `--card` | `#151310` | Superficie de cards |
| `--secondary` | `#1E1B17` | Superficie elevada / contenedores de íconos / tracks |
| `--foreground` | `#F3F0E9` | Texto principal (blanco cálido) |
| `--muted-foreground` | `#A6A093` | Texto secundario y labels |
| `--primary` | `#F76B15` | **Único acento**: acción primaria, estado activo, dato vivo |
| `--success` | `#22C55E` | Serie completada, deltas positivos |
| `--destructive` | `#EF4444` | Errores, acciones destructivas, proteína (macro) |
| `--border` | `rgba(243,240,233,0.08)` | Bordes hairline |
| `--radius` | `0.75rem` | Radio base (chau `rounded-2xl` blandito por default) |
| `--chart-1..5` | naranja / arena / verde / gris / azul | Series de datos (la primaria siempre `chart-1`) |

Contraste verificado (WCAG AA): todos los pares en uso están entre 6.2:1 y 8.3:1.

## Tipografía

| Rol | Fuente | Uso |
|---|---|---|
| Display | **Barlow Condensed** (500/600/700) — `font-display` | Títulos de página y números grandes de stats |
| Body | **Geist** — `font-sans` | Todo el texto corriente |
| Datos | **Geist Mono** — `font-mono` | Timer, valores `x / y` en filas de macros |

Números de datos siempre con `tabular-nums-data` (no bailan al cambiar).
Micro-labels: `text-xs font-medium uppercase tracking-widest text-muted-foreground`.

## Layout

- `components/fitness/app-shell.tsx` es el **único** dueño del layout protegido:
  `max-w-lg`, `px-4 pt-6`, `pb-nav` (clearance del bottom nav + safe area) y monta
  `BottomNav` una sola vez. Las páginas NO agregan wrappers propios.
- Rutas inmersivas (sin shell ni nav): `/workout/active` — lista `IMMERSIVE_ROUTES`.
- Deuda conocida: en desktop ≥1024px la app sigue siendo la columna mobile centrada;
  el plan futuro es sidebar + dashboard a 2 columnas.

## Componentes clave

- `MetricCard` — card plana `bg-card border-border`, ícono en `bg-secondary`
  (naranja SOLO la llama de calorías), número `font-display text-4xl`.
- `EmptyState` — ícono + título + descripción + CTA concreto. Todo vacío invita a actuar.
- `ErrorState` — causa + botón "Reintentar". **Nunca** pasar `err.message` crudo:
  copy curado en español; el error real va a `console.error`.
- Charts (recharts vía `components/ui/chart.tsx`) — serie en `var(--chart-1)`,
  `CartesianGrid` con `var(--border)`, ejes visibles o valores directos sobre las
  barras. Un gráfico se lee sin hover.

## Voz y copy

- Español rioplatense con voseo, tono sobrio ("Ingresá tu email", "Revisá tu conexión").
- Errores: causa + recuperación. Toasts nunca en inglés, nunca texto crudo del backend.
- `<html lang="es">`.

## Reglas de contribución

1. Color nuevo = token nuevo en `globals.css`, discutido antes. No hex inline.
2. Gradientes decorativos, glows e itálicas: prohibidos.
3. Todo fetch-on-mount renderiza `ErrorState` con retry en fallo; todo estado vacío
   usa `EmptyState` con acción.
4. Botones CTA: variantes de `components/ui/button.tsx` — no re-especificar colores
   por className; sin `rounded-full` (los pills quedan para chips y nav).
