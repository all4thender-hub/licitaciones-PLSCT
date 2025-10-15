import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error('Faltan variables de entorno de Supabase. Revisa tu archivo .env');
}

// Cliente con privilegios de servicio (bypass RLS)
export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

// Funciones helper para queries comunes
export const supabaseHelpers = {
  // Obtener provincias activas (que tienen usuarios)
  async getActiveProvinces() {
  try {
    // Obtener usuarios activos
    const { data: activeUsers, error: usersError } = await supabase
      .from('companies')
      .select('user_id')
      .in('subscription_status', ['trial', 'active']);

    if (usersError) throw usersError;

    if (!activeUsers || activeUsers.length === 0) {
      logger.warn('⚠️ No hay usuarios activos');
      return [];
    }

    const userIds = activeUsers.map(u => u.user_id);

    // Obtener provincias de user_profiles
    const { data: profiles, error: profilesError } = await supabase
      .from('user_profiles')
      .select('preferred_province, locations')
      .in('user_id', userIds);

    if (profilesError) throw profilesError;

    // Extraer provincias únicas
    const provincesSet = new Set();
    
    profiles?.forEach(profile => {
      // Preferred province
      if (profile.preferred_province) {
        provincesSet.add(profile.preferred_province);
      }
      
      // Locations (array)
      if (profile.locations && Array.isArray(profile.locations)) {
        profile.locations.forEach(loc => {
          if (loc && typeof loc === 'string') {
            provincesSet.add(loc.trim());
          }
        });
      }
    });

    const provinces = Array.from(provincesSet).sort();
    
    logger.info(`📍 ${provinces.length} provincias activas: ${provinces.join(', ')}`);
    
    return provinces;

  } catch (error) {
    logger.error('❌ Error obteniendo provincias activas:', error);
    return [];
  }
  },

  // Verificar si un CPV es de construcción
  async isConstructionCPV(cpvCode) {
    const { data, error } = await supabase
      .from('cpv_construction')
      .select('code')
      .eq('code', cpvCode)
      .single();
    
    return !error && data !== null;
  },

  // Obtener configuración de Tenders.guru
  async getTendersGuruConfig() {
    const { data, error } = await supabase
      .from('tenders_guru_config')
      .select('*')
      .eq('is_active', true)
      .single();
    
    if (error) throw error;
    return data;
  },

  // Guardar log de sincronización
  async createSyncLog(logData) {
    const { data, error } = await supabase
      .from('sync_logs')
      .insert({
        source: 'tenders_guru',
        sync_type: 'scheduled',
        started_at: new Date().toISOString(),
        status: 'running',
        ...logData
      })
      .select()
      .single();
    
    if (error) throw error;
    return data;
  },

  // Actualizar log de sincronización
  async updateSyncLog(logId, updates) {
    const { error } = await supabase
      .from('sync_logs')
      .update({
        ...updates,
        completed_at: new Date().toISOString()
      })
      .eq('id', logId);
    
    if (error) throw error;
  },

  // Actualizar última sincronización
  async updateLastSync() {
    const { data: config } = await supabase
      .from('tenders_guru_config')
      .select('id')
      .eq('is_active', true)
      .single();

    if (config) {
      await supabase
        .from('tenders_guru_config')
        .update({
          last_sync: new Date().toISOString()
        })
        .eq('id', config.id);
    }
  }
};

export default supabase;