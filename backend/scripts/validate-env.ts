#!/usr/bin/env ts-node
/**
 * Script de validación de entorno de producción
 * Valida que las variables de entorno requeridas estén presentes y sean seguras
 * 
 * Uso: ts-node validate-env.ts
 * Script debe fallar con código 1 si el entorno no es válido para producción
 */

// @ts-ignore - ts-node ejecuta desde el directorio raíz del backend
import { z } from 'zod';
// @ts-ignore
import dotenv from 'dotenv';

// Cargar variables de entorno desde .env si existe
dotenv.config();

// Esquema de validación para entorno de producción
const ProductionEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters in production'),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid URL'),
  PORT: z.coerce.number().min(1).max(65535).optional().default(4000),
  CORS_ORIGIN: z.string().optional().default('http://localhost:3000'),
});

// Valor por defecto inseguro para desarrollo (debe NO usarse en producción)
const DEV_INSECURE_KEY = 'dev-only-insecure-key';

/**
 * Validar entorno de producción
 * @throws Error con mensaje descriptivo si la validación falla
 */
function validateProductionEnvironment(): void {
  console.log('Validando entorno de producción...');

  try {
    // Parsear variables de entorno
    const env = ProductionEnvSchema.parse(process.env);
    
    // Verificar que estamos en producción
    if (env.NODE_ENV !== 'production') {
      console.warn('NODE_ENV no es "production". Script diseñado para validación en producción.');
      console.warn(`   Valor actual: ${env.NODE_ENV}`);
    }
    
    // Validaciones específicas para producción
    if (env.NODE_ENV === 'production') {
      // 1. JWT_SECRET no debe ser el valor por defecto de desarrollo
      if (env.JWT_SECRET === DEV_INSECURE_KEY) {
        throw new Error(
          'JWT_SECRET está usando el valor por defecto inseguro de desarrollo en producción.\n' +
          '   Esto es una vulnerabilidad de seguridad grave.\n' +
          '   Configura una clave segura de al menos 32 caracteres.'
        );
      }
      
      // 2. JWT_SECRET debe tener al menos 32 caracteres
      if (env.JWT_SECRET.length < 32) {
        throw new Error(
          `JWT_SECRET es demasiado corto para producción.\n` +
          `   Longitud actual: ${env.JWT_SECRET.length} caracteres (mínimo requerido: 32).\n` +
          `   Genera una clave segura con: openssl rand -base64 48`
        );
      }
      
      // 3. DATABASE_URL debe estar presente
      if (!env.DATABASE_URL || env.DATABASE_URL.trim() === '') {
        throw new Error('DATABASE_URL no está configurado en producción.');
      }
      
      // 4. Validar que DATABASE_URL no sea una URL de desarrollo local
      if (env.DATABASE_URL.includes('localhost') || env.DATABASE_URL.includes('127.0.0.1')) {
        console.warn('DATABASE_URL apunta a localhost. Asegúrate que esto es intencional para producción.');
      }
      
      console.log('Entorno de producción validado correctamente');
      console.log(`   NODE_ENV: ${env.NODE_ENV}`);
      console.log(`   JWT_SECRET length: ${env.JWT_SECRET.length} caracteres`);
      console.log(`   DATABASE_URL: ${env.DATABASE_URL.split('@')[0]}@... (URL ofuscada por seguridad)`);
      console.log(`   PORT: ${env.PORT}`);
      console.log(`   CORS_ORIGIN: ${env.CORS_ORIGIN}`);
    } else {
      console.log(`Entorno de ${env.NODE_ENV} validado (no se aplican restricciones de producción)`);
      console.log(`   JWT_SECRET: ${env.JWT_SECRET.length < 32 ? 'Demasiado corto para producción' : 'Longitud adecuada'}`);
    }
    
  } catch (error) {
    if (error instanceof z.ZodError) {
      // Errores de validación Zod
      console.error('Error de validación de variables de entorno:');
      error.errors.forEach((err, index) => {
        console.error(`   ${index + 1}. ${err.path.join('.')}: ${err.message}`);
      });
      console.error('\nVariables de entorno requeridas para producción:');
      console.error('   - NODE_ENV=production');
      console.error('   - JWT_SECRET=<clave segura de al menos 32 caracteres>');
      console.error('   - DATABASE_URL=<url de base de datos>');
      process.exit(1);
    } else if (error instanceof Error) {
      // Errores de validación personalizados
      console.error(error.message);
      process.exit(1);
    } else {
      // Error desconocido
      console.error('Error desconocido durante la validación:', error);
      process.exit(1);
    }
  }
}

/**
 * Validar entorno de desarrollo (menos estricto)
 */
function validateDevelopmentEnvironment(): void {
  console.log('Validando entorno de desarrollo...');
  
  try {
    const EnvSchema = z.object({
      NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
      JWT_SECRET: z.string().default(DEV_INSECURE_KEY),
      DATABASE_URL: z.string().url().optional(),
    });
    
    const env = EnvSchema.parse(process.env);
    
    console.log('Entorno de desarrollo validado');
    console.log(`   NODE_ENV: ${env.NODE_ENV}`);
    console.log(`   JWT_SECRET: ${env.JWT_SECRET === DEV_INSECURE_KEY ? 'Usando valor por defecto' : 'Configurado'}`);
    console.log(`   DATABASE_URL: ${env.DATABASE_URL ? 'Configurado' : 'No configurado'}`);
    
  } catch (error) {
    console.error('Error validando entorno de desarrollo:', error);
    process.exit(1);
  }
}

/**
 * Punto de entrada del script
 */
function main(): void {
  // Determinar modo de validación basado en argumentos o NODE_ENV
  const args = process.argv.slice(2);
  const isProductionCheck = args.includes('--production') || args.includes('-p') || process.env.NODE_ENV === 'production';
  
  if (isProductionCheck) {
    validateProductionEnvironment();
  } else {
    validateDevelopmentEnvironment();
  }
  
  console.log('\nValidación completada exitosamente');
  process.exit(0);
}

// Ejecutar solo si se llama directamente
if (require.main === module) {
  main();
}

export { validateProductionEnvironment, validateDevelopmentEnvironment };