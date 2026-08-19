# Fitness

App de seguimiento de entrenamiento, nutrición y métricas corporales. PWA mobile-first, pensada para usarse con una mano entre serie y serie.

## Qué hace

- **Entrenamiento**: rutinas por día de la semana con metodología por serie (warmup, top set, backoff con porcentaje del top). Durante la sesión: timer de descanso persistente, sugerencia de peso calculada desde las series ya registradas, historial del ejercicio y peso editable por teclado o steppers.
- **Nutrición**: diario por comida con edición y borrado, catálogo de alimentos con búsqueda en OpenFoodFacts, escáner de código de barras, recetas propias con macros derivadas de los ingredientes.
- **Métricas**: peso corporal y medidas, con progresión en el dashboard.
- **Dashboard**: calorías y macros del día, volumen semanal de entrenamiento — todas las ventanas de "hoy" y "esta semana" se calculan en la zona horaria del cliente, no la del servidor.
- **Asistente**: chat de fitness con contexto real del usuario (vía OpenAI, opcional).
- **Notificaciones push** de fin de descanso (Web Push/VAPID, opcional).

## Stack

| | |
|---|---|
| `frontend/` | Next.js 15 (App Router), React 19, Tailwind v4, shadcn/ui, Vitest |
| `backend/app/` | Express, Prisma (PostgreSQL), Zod, Vitest. Redis opcional para caché |
| Auth | JWT en cookies HttpOnly, con refresh token |

## Levantar el proyecto

Requisitos: Node 20+, PostgreSQL corriendo, y opcionalmente Redis.

```bash
# 1. Configurar el backend
cd backend/app
cp .env.example .env        # completar DATABASE_URL y los dos secrets JWT
npm install
npx prisma migrate dev      # crea el esquema
npm run seed                # catálogo inicial de ejercicios y alimentos

# 2. Frontend
cd ../../frontend
npm install

# 3. Todo junto, desde la raíz
./dev.sh                    # backend en :4002, frontend en :3000
```

El frontend proxya `/backend-api/*` al backend (`frontend/next.config.mjs`), que espera el puerto 4002.

## Tests

```bash
cd backend/app && npm test            # unit + integración (necesita la DB y REDIS_URL)
cd backend/app && npm run typecheck
cd frontend    && npx vitest run
cd frontend    && npx tsc --noEmit
```

El CI (GitHub Actions) corre ambas suites con typecheck, y repite los tests bajo `TZ=Pacific/Chatham` para pescar dependencias del reloj del servidor.

Convención del repo: ningún cambio de comportamiento sin un test que falle primero, y las afirmaciones de rendimiento o de contrato en los comentarios van acompañadas de la medición que las respalda.

## Diseño

La dirección visual, tokens, tipografía y reglas de contribución de UI están en
[docs/design-system.md](docs/design-system.md). Resumen: OLED cálido, naranja
`#F76B15` como único acento, Barlow Condensed para números protagonistas, cero
gradientes decorativos, copy en español rioplatense con errores accionables.
