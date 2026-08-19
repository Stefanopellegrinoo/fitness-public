#!/usr/bin/env node

/**
 * Script de validación para deploy del backend fitness
 * Valida entorno, conexiones y funcionalidad básica
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

// Colores para output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

// Configuración
const CONFIG = {
  port: process.env.PORT || 4000,
  timeout: 10000,
  endpoints: ['/health', '/auth/signup', '/api/exercises'],
  requiredEnvVars: ['DATABASE_URL', 'JWT_SECRET', 'PORT', 'NODE_ENV'],
  optionalEnvVars: ['REDIS_URL', 'OPENAI_API_KEY', 'CORS_ORIGIN']
};

// Helper para logging
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const levelColors = {
    'INFO': colors.cyan,
    'SUCCESS': colors.green,
    'WARNING': colors.yellow,
    'ERROR': colors.red,
    'DEBUG': colors.magenta
  };
  
  console.log(`${levelColors[level]}[${level}]${colors.reset} ${timestamp} ${message}`);
  if (data) {
    console.log(colors.magenta + '  Details:' + colors.reset, JSON.stringify(data, null, 2));
  }
}

// Helper para verificar si una variable de entorno está definida
function checkEnvVar(name, required = true) {
  const value = process.env[name];
  if (!value && required) {
    log('ERROR', `Variable de entorno requerida no definida: ${name}`);
    return false;
  }
  
  if (value) {
    // Ocultar valores sensibles
    const displayValue = name.includes('SECRET') || name.includes('KEY') || name.includes('URL') 
      ? '***' + value.slice(-4)
      : value.length > 50 ? value.substring(0, 50) + '...' : value;
    
    log('INFO', `${name}=${displayValue}`);
    return true;
  } else {
    log('WARNING', `Variable opcional no definida: ${name}`);
    return true;
  }
}

// Validación de entorno
async function validateEnvironment() {
  log('INFO', '=== VALIDACIÓN DE ENTORNO ===');
  
  let allPassed = true;
  
  // Variables requeridas
  CONFIG.requiredEnvVars.forEach(varName => {
    if (!checkEnvVar(varName, true)) {
      allPassed = false;
    }
  });
  
  // Variables opcionales
  CONFIG.optionalEnvVars.forEach(varName => {
    checkEnvVar(varName, false);
  });
  
  // Verificar NODE_ENV
  if (process.env.NODE_ENV) {
    const validEnvs = ['development', 'production', 'test'];
    if (!validEnvs.includes(process.env.NODE_ENV)) {
      log('WARNING', `NODE_ENV=${process.env.NODE_ENV} no es un valor estándar (${validEnvs.join(', ')})`);
    }
  }
  
  return allPassed;
}

// Validación de TypeScript build
async function validateBuild() {
  log('INFO', '=== VALIDACIÓN DE BUILD ===');
  
  try {
    log('INFO', 'Ejecutando npm run build...');
    execSync('npm run build', { 
      cwd: process.cwd(),
      stdio: 'pipe',
      timeout: 30000
    });
    log('SUCCESS', 'Build completado exitosamente');
    
    // Verificar que dist/ existe y tiene archivos
    const distPath = path.join(process.cwd(), 'dist');
    if (!fs.existsSync(distPath)) {
      log('ERROR', 'Directorio dist/ no existe después del build');
      return false;
    }
    
    const files = fs.readdirSync(distPath);
    if (files.length === 0) {
      log('ERROR', 'Directorio dist/ está vacío');
      return false;
    }
    
    log('INFO', `dist/ contiene ${files.length} archivos`);
    
    // Verificar archivos críticos
    const criticalFiles = ['server.js', 'app.js'];
    criticalFiles.forEach(file => {
      const filePath = path.join(distPath, file);
      if (fs.existsSync(filePath)) {
        log('SUCCESS', `✓ ${file} existe en dist/`);
      } else {
        log('ERROR', `✗ ${file} NO existe en dist/`);
        return false;
      }
    });
    
    return true;
  } catch (error) {
    log('ERROR', 'Error durante el build:', {
      message: error.message,
      stdout: error.stdout?.toString(),
      stderr: error.stderr?.toString()
    });
    return false;
  }
}

// Validación de conexión a PostgreSQL
async function validatePostgres() {
  log('INFO', '=== VALIDACIÓN DE POSTGRESQL ===');
  
  try {
    // Intenta cargar el módulo de Prisma
    const prismaPath = path.join(process.cwd(), 'dist/lib/prisma.js');
    if (!fs.existsSync(prismaPath)) {
      log('WARNING', 'No se pudo encontrar módulo Prisma, saltando validación directa');
      return true;
    }
    
    // Usar require para cargar el módulo compilado
    delete require.cache[require.resolve(prismaPath)];
    const { prisma } = require(prismaPath);
    
    // Intentar consulta simple
    const result = await prisma.$queryRaw`SELECT 1 as test`;
    log('SUCCESS', 'Conexión a PostgreSQL establecida exitosamente');
    return true;
  } catch (error) {
    log('ERROR', 'Error de conexión a PostgreSQL:', {
      message: error.message,
      code: error.code
    });
    
    // Verificar si es error de URL
    if (error.message.includes('DATABASE_URL') || error.message.includes('connection')) {
      log('WARNING', 'Verifica que DATABASE_URL esté correctamente configurado');
      log('WARNING', 'Ejemplo: postgresql://user:password@localhost:5432/database');
    }
    
    return false;
  }
}

// Validación de conexión a Redis (opcional)
async function validateRedis() {
  log('INFO', '=== VALIDACIÓN DE REDIS (OPCIONAL) ===');
  
  if (!process.env.REDIS_URL) {
    log('INFO', 'REDIS_URL no definida, saltando validación');
    return true;
  }
  
  try {
    const redisPath = path.join(process.cwd(), 'dist/lib/redis.js');
    if (!fs.existsSync(redisPath)) {
      log('WARNING', 'No se pudo encontrar módulo Redis, saltando validación');
      return true;
    }
    
    delete require.cache[require.resolve(redisPath)];
    const { redis } = require(redisPath);
    
    // Test de conexión
    await redis.ping();
    log('SUCCESS', 'Conexión a Redis establecida exitosamente');
    return true;
  } catch (error) {
    log('WARNING', 'Error de conexión a Redis (esto es opcional):', {
      message: error.message
    });
    return true; // Redis es opcional
  }
}

// Validación de endpoints HTTP
async function validateEndpoints() {
  log('INFO', '=== VALIDACIÓN DE ENDPOINTS HTTP ===');
  
  let server = null;
  let serverStarted = false;
  
  try {
    // Cargar la app desde dist/
    const appPath = path.join(process.cwd(), 'dist/app.js');
    if (!fs.existsSync(appPath)) {
      log('ERROR', `No se puede encontrar app.js en ${appPath}`);
      return false;
    }
    
    delete require.cache[require.resolve(appPath)];
    const { app } = require(appPath);
    
    // Iniciar servidor temporal
    server = http.createServer(app);
    
    await new Promise((resolve, reject) => {
      server.listen(CONFIG.port, () => {
        log('SUCCESS', `Servidor iniciado en puerto ${CONFIG.port}`);
        serverStarted = true;
        resolve();
      });
      
      server.on('error', reject);
      setTimeout(() => reject(new Error('Timeout al iniciar servidor')), CONFIG.timeout);
    });
    
    // Test endpoints
    let allEndpointsPassed = true;
    
    for (const endpoint of CONFIG.endpoints) {
      try {
        const response = await new Promise((resolve, reject) => {
          const req = http.request({
            hostname: 'localhost',
            port: CONFIG.port,
            path: endpoint,
            method: 'GET',
            timeout: CONFIG.timeout
          }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
          });
          
          req.on('error', reject);
          req.on('timeout', () => reject(new Error(`Timeout para ${endpoint}`)));
          req.end();
        });
        
        if (response.statusCode >= 200 && response.statusCode < 500) {
          log('SUCCESS', `✓ ${endpoint} responded with ${response.statusCode}`);
        } else {
          log('WARNING', `✗ ${endpoint} responded with ${response.statusCode}`);
          allEndpointsPassed = false;
        }
      } catch (error) {
        log('ERROR', `Error al testear ${endpoint}:`, { message: error.message });
        allEndpointsPassed = false;
      }
    }
    
    return allEndpointsPassed;
  } catch (error) {
    log('ERROR', 'Error al iniciar servidor para pruebas:', { message: error.message });
    return false;
  } finally {
    if (server && serverStarted) {
      await new Promise(resolve => server.close(resolve));
      log('INFO', 'Servidor de pruebas detenido');
    }
  }
}

// Validación de tests existentes
async function validateTests() {
  log('INFO', '=== VALIDACIÓN DE TESTS ===');
  
  try {
    log('INFO', 'Ejecutando tests existentes...');
    const result = execSync('npm test', {
      cwd: process.cwd(),
      stdio: 'pipe',
      timeout: 60000
    });
    
    const output = result.toString();
    
    // Buscar indicadores de éxito
    if (output.includes('Test Files') && output.includes('PASS')) {
      log('SUCCESS', 'Tests ejecutados exitosamente');
      
      // Extraer estadísticas si están disponibles
      const passMatch = output.match(/PASS\s+(\d+)/);
      const failMatch = output.match(/FAIL\s+(\d+)/);
      
      if (passMatch || failMatch) {
        log('INFO', `Resultados: PASS=${passMatch?.[1] || 0}, FAIL=${failMatch?.[1] || 0}`);
      }
      
      return true;
    } else {
      log('WARNING', 'Tests ejecutados pero output inesperado:', { output: output.substring(0, 500) });
      return false;
    }
  } catch (error) {
    log('ERROR', 'Error ejecutando tests:', {
      message: error.message,
      stdout: error.stdout?.toString(),
      stderr: error.stderr?.toString()
    });
    return false;
  }
}

// Función principal
async function main() {
  console.log(colors.bold + colors.cyan + '\n' + '='.repeat(60) + colors.reset);
  console.log(colors.bold + colors.cyan + 'SCRIPT DE VALIDACIÓN PARA DEPLOY - BACKEND FITNESS' + colors.reset);
  console.log(colors.bold + colors.cyan + '='.repeat(60) + colors.reset);
  
  const results = {
    environment: false,
    build: false,
    postgres: false,
    redis: true, // Por defecto true ya que es opcional
    endpoints: false,
    tests: false
  };
  
  try {
    // 1. Validar entorno
    results.environment = await validateEnvironment();
    
    // 2. Validar build
    results.build = await validateBuild();
    
    // 3. Validar PostgreSQL (solo si ambiente pasó)
    if (results.environment) {
      results.postgres = await validatePostgres();
    } else {
      log('WARNING', 'Saltando validación de PostgreSQL debido a falla en entorno');
    }
    
    // 4. Validar Redis (opcional)
    if (results.environment) {
      results.redis = await validateRedis();
    }
    
    // 5. Validar endpoints (solo si build pasó)
    if (results.build) {
      results.endpoints = await validateEndpoints();
    } else {
      log('WARNING', 'Saltando validación de endpoints debido a falla en build');
    }
    
    // 6. Validar tests
    results.tests = await validateTests();
    
    // Reporte final
    console.log('\n' + colors.bold + colors.cyan + '='.repeat(60) + colors.reset);
    console.log(colors.bold + colors.cyan + 'REPORTE FINAL DE VALIDACIÓN' + colors.reset);
    console.log(colors.bold + colors.cyan + '='.repeat(60) + colors.reset);
    
    Object.entries(results).forEach(([test, passed]) => {
      const status = passed ? colors.green + '✓ PASÓ' : colors.red + '✗ FALLÓ';
      console.log(`${status}${colors.reset} ${test}`);
    });
    
    const allPassed = Object.values(results).every(result => result === true);
    
    if (allPassed) {
      console.log('\n' + colors.bold + colors.green + '🎉 ¡TODAS LAS VALIDACIONES PASARON! El backend está listo para deploy.' + colors.reset);
      console.log(colors.green + 'Recomendaciones:' + colors.reset);
      console.log('  1. Verificar que todas las variables de entorno de producción estén configuradas');
      console.log('  2. Ejecutar migraciones de base de datos si es necesario');
      console.log('  3. Configurar SSL/TLS para producción');
      console.log('  4. Configurar logging y monitoreo');
      process.exit(0);
    } else {
      console.log('\n' + colors.bold + colors.yellow + '⚠️  ALGUNAS VALIDACIONES FALLARON. Revisa los errores arriba.' + colors.reset);
      console.log(colors.yellow + 'Acciones recomendadas:' + colors.reset);
      
      if (!results.environment) {
        console.log('  • Verificar variables de entorno en .env');
        console.log('  • Asegurar DATABASE_URL y JWT_SECRET están definidos');
      }
      
      if (!results.build) {
        console.log('  • Ejecutar npm run build manualmente para ver errores');
        console.log('  • Verificar tsconfig.json y TypeScript');
      }
      
      if (!results.postgres) {
        console.log('  • Verificar conexión a PostgreSQL');
        console.log('  • Asegurar que la base de datos existe y es accesible');
      }
      
      if (!results.endpoints) {
        console.log('  • Verificar que el servidor puede iniciar');
        console.log('  • Revisar logs de la aplicación');
      }
      
      if (!results.tests) {
        console.log('  • Ejecutar npm test para ver detalles de fallas');
        console.log('  • Revisar tests específicos que fallen');
      }
      
      process.exit(1);
    }
  } catch (error) {
    log('ERROR', 'Error no manejado en script principal:', { message: error.message, stack: error.stack });
    process.exit(1);
  }
}

// Ejecutar
if (require.main === module) {
  main();
}

module.exports = {
  validateEnvironment,
  validateBuild,
  validatePostgres,
  validateRedis,
  validateEndpoints,
  validateTests
};