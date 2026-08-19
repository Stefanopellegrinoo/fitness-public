# Scripts de Validación para Deploy

## `test-deploy.js`

Script de validación completo para verificar que el backend está listo para producción.

### Uso

```bash
# Desde el directorio raíz del proyecto
cd /home/stefano/proyectos/fitness/backend/app
node scripts/test-deploy.js

# O directamente
./scripts/test-deploy.js
```

### Qué valida

1. **Entorno**
   - Variables de entorno críticas (`DATABASE_URL`, `JWT_SECRET`, `PORT`, `NODE_ENV`)
   - Variables opcionales (`REDIS_URL`, `OPENAI_API_KEY`, `CORS_ORIGIN`)

2. **Build de TypeScript**
   - Ejecuta `npm run build`
   - Verifica que `dist/` se crea con archivos críticos (`server.js`, `app.js`)

3. **Conexiones a bases de datos**
   - PostgreSQL (requerido)
   - Redis (opcional)

4. **Endpoints HTTP**
   - Inicia servidor temporal en el puerto configurado
   - Testea endpoints clave (`/health`, `/auth/signup`, `/api/exercises`)

5. **Tests existentes**
   - Ejecuta `npm test` para verificar que los tests pasan

### Output

El script genera un reporte estructurado con:
- ✅ Validaciones que pasan
- ❌ Validaciones que fallan
- Recomendaciones específicas para cada fallo
- Timestamps para tracking

### Integración con CI/CD

Puedes integrar este script en tu pipeline:

```yaml
# Ejemplo para GitHub Actions
- name: Validar backend
  run: node scripts/test-deploy.js
  
# O con variables de entorno específicas
- name: Validar backend para producción
  env:
    DATABASE_URL: ${{ secrets.DATABASE_URL }}
    JWT_SECRET: ${{ secrets.JWT_SECRET }}
    NODE_ENV: production
  run: node scripts/test-deploy.js
```

### Variables de entorno requeridas

```bash
# Críticas
DATABASE_URL=postgresql://user:password@localhost:5432/fitness_db
JWT_SECRET=tu_super_secreto_jwt
PORT=4000
NODE_ENV=production

# Opcionales
REDIS_URL=redis://localhost:6379
OPENAI_API_KEY=sk-...
CORS_ORIGIN=http://localhost:3000,https://tu-app.com
```

### Configuración

El script tiene timeouts configurables:
- Build TypeScript: 30s
- Conexión PostgreSQL: 10s
- Endpoints HTTP: 10s por request
- Tests: 60s

### Troubleshooting

**Error: "Variable de entorno requerida no definida"**
```bash
# Crear o verificar .env
cp .env.example .env
# Editar .env con tus valores
```

**Error: "Timeout al iniciar servidor"**
```bash
# Verificar que el puerto no esté en uso
netstat -tulpn | grep :4000
# Cambiar PORT en .env si es necesario
```

**Error: "Conexión a PostgreSQL falló"**
```bash
# Verificar que PostgreSQL está corriendo
sudo systemctl status postgresql
# Verificar credenciales en DATABASE_URL
```

**Error: "Build falló"**
```bash
# Ejecutar build manualmente para ver errores
npm run build
# Verificar TypeScript
npx tsc --noEmit
```