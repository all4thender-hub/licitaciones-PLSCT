import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

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
    const { data, error } = await supabase
      .from('scraping_provinces')
      .select('province, region')
      .eq('is_active', true);
    
    if (error) throw error;
    return data;
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