import cron from 'node-cron';
import { syncService } from '../services/sync-service.js';
import { logger } from '../utils/logger.js';
import dotenv from 'dotenv';

dotenv.config();

class SyncJob {
  constructor() {
    // Leer configuración de cron desde .env
    // Por defecto: cada 6 horas (0 */6 * * *)
    this.schedule = process.env.SYNC_CRON_SCHEDULE || '0 */6 * * *';
    this.isRunning = false;
    this.task = null;
    this.lastExecution = null;
  }

  /**
   * Iniciar el cron job
   */
  start() {
    logger.info(`⏰ Programando sincronización con schedule: ${this.schedule}`);
    
    // Crear tarea cron
    this.task = cron.schedule(this.schedule, async () => {
      await this.execute();
    });

    logger.info('✅ Cron job iniciado correctamente');
    logger.info(`📅 Próxima ejecución: ${this.getNextExecutionTime()}`);

    // Opción: ejecutar inmediatamente al iniciar
    if (process.env.RUN_ON_START === 'true') {
      logger.info('🚀 Ejecutando sincronización inicial...');
      this.execute();
    }
  }

  /**
   * Detener el cron job
   */
  stop() {
    if (this.task) {
      this.task.stop();
      logger.info('⏸️ Cron job detenido');
    }
  }

  /**
   * Ejecutar sincronización
   */
  async execute() {
    // Prevenir ejecuciones concurrentes
    if (this.isRunning) {
      logger.warn('⚠️ Ya hay una sincronización en curso. Saltando esta ejecución.');
      return;
    }

    this.isRunning = true;
    this.lastExecution = new Date();
    const startTime = Date.now();

    try {
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('🚀 INICIANDO SINCRONIZACIÓN PROGRAMADA');
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      const result = await syncService.runSync();

      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info('✅ SINCRONIZACIÓN COMPLETADA');
      logger.info(`⏱️ Duración: ${duration}s`);
      logger.info(`📦 Licitaciones obtenidas: ${result.tenders.fetched}`);
      logger.info(`✨ Nuevas: ${result.tenders.new}`);
      logger.info(`🔄 Actualizadas: ${result.tenders.updated}`);
      logger.info(`🎯 Matches creados: ${result.matches}`);
      if (result.errors > 0) {
        logger.warn(`⚠️ Errores: ${result.errors}`);
      }
      logger.info(`📅 Próxima ejecución: ${this.getNextExecutionTime()}`);
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    } catch (error) {
      logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.error('❌ ERROR EN SINCRONIZACIÓN');
      logger.error(`Error: ${error.message}`);
      logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Ejecutar sincronización manualmente (para testing)
   */
  async runNow() {
    logger.info('🔧 Ejecutando sincronización manual...');
    await this.execute();
  }

  /**
   * Obtener hora de la próxima ejecución (simplificado)
   */
  getNextExecutionTime() {
    if (!this.task) return 'No programada';
    
    try {
      // Parsear el cron expression manualmente para casos comunes
      const parts = this.schedule.split(' ');
      
      // Para '0 */6 * * *' (cada 6 horas en el minuto 0)
      if (this.schedule === '0 */6 * * *') {
        const now = new Date();
        const currentHour = now.getHours();
        
        // Calcular próxima hora múltiplo de 6
        const nextHour = Math.ceil((currentHour + 1) / 6) * 6;
        
        const next = new Date(now);
        if (nextHour >= 24) {
          next.setDate(next.getDate() + 1);
          next.setHours(nextHour - 24);
        } else {
          next.setHours(nextHour);
        }
        next.setMinutes(0);
        next.setSeconds(0);
        
        return next.toLocaleString('es-ES', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Europe/Madrid'
        });
      }
      
      // Para otros schedules, mostrar info básica
      return `Según schedule: ${this.schedule}`;
      
    } catch (error) {
      logger.error('Error calculando próxima ejecución:', error);
      return `Schedule activo: ${this.schedule}`;
    }
  }

  /**
   * Obtener estado del job
   */
  getStatus() {
    return {
      schedule: this.schedule,
      isRunning: this.isRunning,
      nextExecution: this.getNextExecutionTime(),
      lastExecution: this.lastExecution ? this.lastExecution.toLocaleString('es-ES', {
        timeZone: 'Europe/Madrid'
      }) : 'Nunca',
      isActive: this.task !== null
    };
  }
}

// Exportar instancia única
export const syncJob = new SyncJob();
export default syncJob;

// Si este archivo se ejecuta directamente, correr sync una vez
if (import.meta.url === `file://${process.argv[1]}`) {
  logger.info('🔧 Ejecutando sincronización manual desde CLI...');
  
  const job = new SyncJob();
  await job.execute();
  
  process.exit(0);
}