import express from 'express';
import dotenv from 'dotenv';
import { syncJob } from './jobs/sync-job.js';
import { syncService } from './services/sync-service.js';
import { matchingService } from './services/matching-service.js';
import { placspAPI } from './services/placsp-api.js';
import { supabase, supabaseHelpers } from './config/supabase.js';
import { logger } from './utils/logger.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json());

// CORS básico
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  next();
});

// Log de requests
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`);
  next();
});

// ==================== RUTAS ====================

/**
 * Health check
 */
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Tender Sync Backend - PLACSP',
    version: '2.0.0',
    timestamp: new Date().toISOString()
  });
});

/**
 * Health check detallado
 */
app.get('/health', async (req, res) => {
  try {
    const apiHealth = await placspAPI.healthCheck();
    const jobStatus = syncJob.getStatus();
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      components: {
        api: apiHealth,
        syncJob: jobStatus
      }
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

/**
 * Estado del cron job
 */
app.get('/sync/status', (req, res) => {
  const status = syncJob.getStatus();
  res.json(status);
});

/**
 * Ejecutar sincronización manual
 */
app.post('/sync/run', async (req, res) => {
  try {
    logger.info('🔧 Sincronización manual solicitada via API');
    
    syncJob.runNow().catch(error => {
      logger.error('Error en sincronización manual:', error);
    });

    res.json({
      status: 'started',
      message: 'Sincronización iniciada en background'
    });
  } catch (error) {
    logger.error('Error al iniciar sincronización:', error);
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

/**
 * Obtener logs de sincronización recientes
 */
app.get('/sync/logs', async (req, res) => {
  try {
    const { data: logs, error } = await supabase
      .from('sync_logs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(10);

    if (error) throw error;

    res.json({ logs });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

/**
 * Estadísticas del sistema
 */
app.get('/stats', async (req, res) => {
  try {
    const { count: activeTenders } = await supabase
      .from('tenders')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'active')
      .eq('is_active', true);

    const { count: activeUsers } = await supabase
      .from('companies')
      .select('*', { count: 'exact', head: true })
      .in('subscription_status', ['trial', 'active']);

    const { count: newMatches } = await supabase
      .from('user_tender_matches')
      .select('*', { count: 'exact', head: true })
      .eq('status', 'new');

    const { data: provinces } = await supabase
      .from('scraping_provinces')
      .select('province, user_count')
      .eq('is_active', true);

    const { data: activeUsers2 } = await supabase
      .from('companies')
      .select('user_id')
      .in('subscription_status', ['trial', 'active']);

    const userIds = activeUsers2?.map(u => u.user_id) || [];

    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('preferred_province, locations')
      .in('user_id', userIds);

    const userProvincesSet = new Set();
    profiles?.forEach(profile => {
      if (profile.preferred_province) userProvincesSet.add(profile.preferred_province);
      if (profile.locations) profile.locations.forEach(loc => userProvincesSet.add(loc));
    });

    const uniqueProvinces = Array.from(userProvincesSet);

    res.json({
      tenders: {
        active: activeTenders
      },
      users: {
        active: activeUsers
      },
      matches: {
        new: newMatches
      },
      provinces: provinces || [],
      user_provinces: uniqueProvinces
    });

  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

/**
 * Obtener provincias activas
 */
app.get('/provinces', async (req, res) => {
  try {
    const { data: activeUsers } = await supabase
      .from('companies')
      .select('user_id')
      .in('subscription_status', ['trial', 'active']);

    const userIds = activeUsers?.map(u => u.user_id) || [];

    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('preferred_province, locations')
      .in('user_id', userIds);

    const provinces = new Set();
    
    profiles?.forEach(profile => {
      if (profile.preferred_province) {
        provinces.add(profile.preferred_province);
      }
      if (profile.locations && Array.isArray(profile.locations)) {
        profile.locations.forEach(loc => {
          if (loc) provinces.add(loc);
        });
      }
    });

    const provincesArray = Array.from(provinces);

    res.json({ 
      total: provincesArray.length,
      provinces: provincesArray,
      active_users: activeUsers?.length || 0
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

/**
 * Testear API de PLACSP
 */
app.get('/test/api', async (req, res) => {
  try {
    logger.info('🧪 Testing PLACSP API...');
    
    const { data: activeUsers } = await supabase
      .from('companies')
      .select('user_id')
      .in('subscription_status', ['trial', 'active']);

    const userIds = activeUsers?.map(u => u.user_id) || [];

    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('preferred_province, locations')
      .in('user_id', userIds);
    
    const provinces = new Set();
    
    profiles?.forEach(profile => {
      if (profile.preferred_province) {
        provinces.add(profile.preferred_province);
      }
      if (profile.locations && Array.isArray(profile.locations)) {
        profile.locations.forEach(loc => {
          if (loc) provinces.add(loc);
        });
      }
    });

    const provincesArray = Array.from(provinces);
    
    if (provincesArray.length === 0) {
      return res.json({
        status: 'warning',
        message: 'No hay provincias configuradas. Añade ubicaciones en user_profiles (locations o preferred_province).',
        provinces: [],
        active_users: userIds.length,
        profiles_checked: profiles?.length || 0
      });
    }

    logger.info(`📍 Testeando con provincias: ${provincesArray.join(', ')}`);
    
    const tenders = await placspAPI.getConstructionTendersByProvinces(provincesArray);
    
    res.json({
      status: 'ok',
      message: 'API PLACSP funcionando correctamente',
      provinces: provincesArray,
      active_users: userIds.length,
      tenders_found: tenders.length,
      sample: tenders.slice(0, 3).map(t => ({
        id: t.id,
        title: t.title,
        province: t.province,
        cpv_code: t.cpv_code,
        budget: t.budget
      }))
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

/**
 * Obtener matches de un usuario
 */
app.get('/matches/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const matches = await matchingService.getUserMatches(userId);
    
    res.json({
      user_id: userId,
      total: matches.length,
      matches
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

// ==================== ERROR HANDLERS ====================

app.use((req, res) => {
  res.status(404).json({
    status: 'error',
    message: 'Endpoint no encontrado'
  });
});

app.use((err, req, res, next) => {
  logger.error('Error no manejado:', err);
  res.status(500).json({
    status: 'error',
    message: err.message
  });
});

// ==================== INICIAR SERVIDOR ====================

async function startServer() {
  try {
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.info('🚀 INICIANDO TENDER SYNC BACKEND - PLACSP');
    logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    const provinces = await supabaseHelpers.getActiveProvinces();
    logger.info(`✅ Conectado a Supabase - ${provinces.length} provincias activas`);

    const { data: activeUsers } = await supabase
      .from('companies')
      .select('user_id')
      .in('subscription_status', ['trial', 'active']);

    const userIds = activeUsers?.map(u => u.user_id) || [];

    const { data: profiles } = await supabase
      .from('user_profiles')
      .select('preferred_province, locations')
      .in('user_id', userIds);
    
    const uniqueProvinces = new Set();
    profiles?.forEach(profile => {
      if (profile.preferred_province) uniqueProvinces.add(profile.preferred_province);
      if (profile.locations) profile.locations.forEach(loc => uniqueProvinces.add(loc));
    });
    
    const provincesArray = Array.from(uniqueProvinces);
    
    if (provincesArray.length > 0) {
      logger.info(`📍 Provincias de usuarios: ${provincesArray.join(', ')}`);
    } else {
      logger.warn('⚠️ No hay provincias configuradas en user_profiles (locations o preferred_province)');
    }

    const apiHealth = await placspAPI.healthCheck();
    if (apiHealth.status === 'ok') {
      logger.info('✅ API de PLACSP operativa');
    } else {
      logger.warn('⚠️ Problemas con API de PLACSP');
    }

    syncJob.start();
    logger.info('✅ Cron job de sincronización iniciado');

    app.listen(PORT, () => {
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      logger.info(`✅ Servidor corriendo en puerto ${PORT}`);
      logger.info(`🌐 URL: http://localhost:${PORT}`);
      logger.info(`📝 Logs en: ./logs/`);
      logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    });

  } catch (error) {
    logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    logger.error('❌ ERROR AL INICIAR SERVIDOR');
    logger.error(`Error: ${error.message}`);
    logger.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    process.exit(1);
  }
}

process.on('SIGTERM', () => {
  logger.info('⏸️ SIGTERM recibido. Cerrando servidor...');
  syncJob.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  logger.info('⏸️ SIGINT recibido. Cerrando servidor...');
  syncJob.stop();
  process.exit(0);
});

startServer();