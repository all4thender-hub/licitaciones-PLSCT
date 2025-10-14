import { supabase, supabaseHelpers } from '../config/supabase.js';
import { placspAPI } from './placsp-api.js';
import { matchingService } from './matching-service.js';
import { logger } from '../utils/logger.js';

class SyncService {
  /**
   * Ejecutar sincronización completa
   * @returns {Promise<Object>} - Resultado de la sincronización
   */
  async runSync() {
    let syncLog = null;
    const startTime = Date.now();

    try {
      logger.info('🚀 Iniciando sincronización de licitaciones...');

      // 1. Crear log de sincronización
      syncLog = await supabaseHelpers.createSyncLog({
        provinces: []
      });

      // 2. Obtener provincias de usuarios activos
      const userProvinces = await this.getUserProvinces();
      
      if (userProvinces.length === 0) {
        logger.warn('⚠️ No hay usuarios con provincias configuradas');
        await supabaseHelpers.updateSyncLog(syncLog.id, {
          status: 'completed',
          tenders_fetched: 0,
          tenders_new: 0,
          tenders_updated: 0,
          metadata: {
            message: 'No hay provincias de usuarios configuradas'
          }
        });
        return { success: true, tenders: { fetched: 0, new: 0, updated: 0 }, matches: 0 };
      }

      logger.info(`📍 Provincias de usuarios: ${userProvinces.join(', ')}`);

      // 3. Obtener licitaciones de la API PLACSP
      const tenders = await placspAPI.getConstructionTendersByProvinces(userProvinces);
      
      logger.info(`📦 Obtenidas ${tenders.length} licitaciones de la API`);

      // 4. Procesar y guardar licitaciones
      const { newTenders, updatedTenders, errors } = await this.processTenders(tenders);

      // 5. Hacer matching con usuarios
      logger.info('🎯 Iniciando matching con usuarios...');
      
      // Hacer matching con todas las licitaciones guardadas (nuevas + actualizadas)
      const allTendersToMatch = [...newTenders, ...updatedTenders];
      
      // Si no hay licitaciones nuevas/actualizadas, buscar las que ya existen
      if (allTendersToMatch.length === 0 && tenders.length > 0) {
        logger.info('📋 No hay licitaciones nuevas, buscando licitaciones existentes para matching...');
        
        // Obtener las licitaciones guardadas desde la BD
        const externalIds = tenders.map(t => t.contract_folder_id || t.id);
        const { data: existingTenders } = await supabase
          .from('tenders')
          .select('*')
          .in('external_id', externalIds)
          .eq('is_active', true);
        
        if (existingTenders && existingTenders.length > 0) {
          logger.info(`📋 Encontradas ${existingTenders.length} licitaciones existentes para matching`);
          const matchingResults = await matchingService.matchTendersWithUsers(existingTenders);
          
          // Actualizar log con resultados
          const duration = ((Date.now() - startTime) / 1000).toFixed(2);
          
          await supabaseHelpers.updateSyncLog(syncLog.id, {
            status: 'completed',
            provinces: userProvinces,
            tenders_fetched: tenders.length,
            tenders_new: newTenders.length,
            tenders_updated: updatedTenders.length,
            metadata: {
              duration_seconds: parseFloat(duration),
              errors_count: errors.length,
              matches_created: matchingResults.totalMatches,
              user_provinces: userProvinces,
              errors: errors.slice(0, 10)
            }
          });

          logger.info(`✅ Sincronización completada en ${duration}s`);
          logger.info(`   - Nuevas: ${newTenders.length}`);
          logger.info(`   - Actualizadas: ${updatedTenders.length}`);
          logger.info(`   - Matches creados: ${matchingResults.totalMatches}`);

          return {
            success: true,
            duration: parseFloat(duration),
            tenders: {
              fetched: tenders.length,
              new: newTenders.length,
              updated: updatedTenders.length
            },
            matches: matchingResults.totalMatches,
            provinces: userProvinces,
            errors: errors.length
          };
        }
      }
      
      const matchingResults = await matchingService.matchTendersWithUsers(allTendersToMatch);

      // 6. Actualizar log con resultados
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);
      
      await supabaseHelpers.updateSyncLog(syncLog.id, {
        status: 'completed',
        provinces: userProvinces,
        tenders_fetched: tenders.length,
        tenders_new: newTenders.length,
        tenders_updated: updatedTenders.length,
        metadata: {
          duration_seconds: parseFloat(duration),
          errors_count: errors.length,
          matches_created: matchingResults.totalMatches,
          user_provinces: userProvinces,
          errors: errors.slice(0, 10) // Solo primeros 10 errores
        }
      });

      logger.info(`✅ Sincronización completada en ${duration}s`);
      logger.info(`   - Nuevas: ${newTenders.length}`);
      logger.info(`   - Actualizadas: ${updatedTenders.length}`);
      logger.info(`   - Matches creados: ${matchingResults.totalMatches}`);

      return {
        success: true,
        duration: parseFloat(duration),
        tenders: {
          fetched: tenders.length,
          new: newTenders.length,
          updated: updatedTenders.length
        },
        matches: matchingResults.totalMatches,
        provinces: userProvinces,
        errors: errors.length
      };

    } catch (error) {
      logger.error('❌ Error en sincronización:', error);

      // Actualizar log con error
      if (syncLog) {
        await supabaseHelpers.updateSyncLog(syncLog.id, {
          status: 'error',
          error_message: error.message
        });
      }

      throw error;
    }
  }

  /**
   * Obtener provincias de usuarios activos
   * @returns {Promise<Array>}
   */
  async getUserProvinces() {
    try {
      // Obtener usuarios activos
      const { data: activeUsers } = await supabase
        .from('companies')
        .select('user_id')
        .in('subscription_status', ['trial', 'active']);

      if (!activeUsers || activeUsers.length === 0) {
        logger.warn('⚠️ No hay usuarios activos');
        return [];
      }

      const userIds = activeUsers.map(u => u.user_id);

      // Obtener perfiles con provincias
      const { data: profiles } = await supabase
        .from('user_profiles')
        .select('preferred_province, locations')
        .in('user_id', userIds)
        .eq('onboarding_completed', true);

      if (!profiles || profiles.length === 0) {
        logger.warn('⚠️ No hay perfiles completados');
        return [];
      }

      // Recopilar todas las provincias únicas
      const provinces = new Set();
      
      profiles.forEach(profile => {
        // Añadir preferred_province si existe
        if (profile.preferred_province) {
          provinces.add(profile.preferred_province);
        }
        
        // Añadir locations (es un array)
        if (profile.locations && Array.isArray(profile.locations)) {
          profile.locations.forEach(location => {
            if (location) provinces.add(location);
          });
        }
      });

      const provincesArray = Array.from(provinces);
      
      if (provincesArray.length === 0) {
        logger.warn('⚠️ Usuarios activos pero sin provincias configuradas');
      }

      return provincesArray;

    } catch (error) {
      logger.error('❌ Error obteniendo provincias de usuarios:', error.message);
      return [];
    }
  }

  /**
   * Procesar y guardar licitaciones en Supabase
   * @param {Array} tenders - Licitaciones a procesar
   * @returns {Promise<Object>}
   */
  async processTenders(tenders) {
    const newTenders = [];
    const updatedTenders = [];
    const errors = [];

    for (const tender of tenders) {
      try {
        // Buscar si ya existe por external_id
        const externalId = tender.contract_folder_id || tender.id;
        
        const { data: existing } = await supabase
          .from('tenders')
          .select('id, updated_at')
          .eq('external_id', externalId)
          .single();

        const tenderData = this.transformTenderData(tender);

        if (existing) {
          // Actualizar si ha cambiado
          if (this.shouldUpdate(existing, tender)) {
            await supabase
              .from('tenders')
              .update(tenderData)
              .eq('id', existing.id);
            
            updatedTenders.push(tenderData);
            logger.debug(`🔄 Actualizada: ${tender.title}`);
          }
        } else {
          // Insertar nueva licitación
          const { data: inserted, error } = await supabase
            .from('tenders')
            .insert(tenderData)
            .select()
            .single();

          if (error) throw error;

          newTenders.push(inserted);
          logger.debug(`✨ Nueva: ${tender.title}`);
        }

        // Guardar datos raw
        await this.saveRawTender(tender, externalId);

      } catch (error) {
        logger.error(`❌ Error procesando licitación ${tender.id}:`);
        logger.error(`   Error completo:`, JSON.stringify(error, null, 2));
        logger.error(`   Message: ${error.message}`);
        logger.error(`   Code: ${error.code}`);
        logger.error(`   Details: ${error.details}`);
        errors.push({
          tender_id: tender.id,
          error: error.message || 'Error desconocido',
          error_code: error.code,
          error_details: error.details
        });
      }
    }

    return { newTenders, updatedTenders, errors };
  }

  /**
   * Transformar datos de PLACSP al formato de Supabase
   * @param {Object} tender - Licitación de PLACSP
   * @returns {Object}
   */
  transformTenderData(tender) {
    return {
      external_id: tender.contract_folder_id || tender.id,
      source_system: 'placsp',
      title: tender.title || 'Sin título',
      description: tender.description || tender.summary || '',
      contracting_body: tender.contracting_body || 'No especificado',
      province: tender.province || 'Sin especificar',
      region: this.getRegionFromProvince(tender.province),
      municipality: null,
      work_type: this.determineWorkType(tender.cpv_code),
      budget: tender.budget,
      publication_date: tender.published || tender.updated || new Date().toISOString().split('T')[0],
      deadline: tender.deadline,
      cpv_code: tender.cpv_code || '45000000',
      status: this.mapStatus(tender.status),
      source_url: tender.link || null,
      source_name: 'Plataforma de Contratación del Sector Público',
      requirements: [],
      contact_email: null,
      raw_content: JSON.stringify(tender),
      is_active: true,
      fetched_at: new Date().toISOString(),
      inserted_by: 'placsp_sync'
    };
  }

  /**
   * Determinar tipo de obra según CPV
   * @param {string} cpvCode
   * @returns {string}
   */
  determineWorkType(cpvCode) {
    if (!cpvCode) return 'Construcción General';
    
    const cpv = cpvCode.toString();
    
    if (cpv.startsWith('4521')) return 'Edificación';
    if (cpv.startsWith('4522')) return 'Ingeniería Civil';
    if (cpv.startsWith('4511')) return 'Demolición';
    if (cpv.startsWith('4531')) return 'Instalaciones Eléctricas';
    if (cpv.startsWith('4532')) return 'Fontanería y Climatización';
    if (cpv.startsWith('4541')) return 'Rehabilitación';
    
    return 'Construcción General';
  }

  /**
   * Obtener región desde provincia
   * @param {string} province
   * @returns {string}
   */
  getRegionFromProvince(province) {
    const regionMap = {
      'Madrid': 'Comunidad de Madrid',
      'Málaga': 'Andalucía',
      'Sevilla': 'Andalucía',
      'Barcelona': 'Cataluña',
      'Valencia': 'Comunidad Valenciana',
      'Alicante': 'Comunidad Valenciana',
      'Vizcaya': 'País Vasco',
      'Guipúzcoa': 'País Vasco',
      'Álava': 'País Vasco'
    };
    
    return regionMap[province] || null;
  }

  /**
   * Mapear estado de PLACSP a nuestro schema
   * @param {string} statusCode
   * @returns {string}
   */
  mapStatus(statusCode) {
    const statusMap = {
      'PUB': 'active',
      'ADJ': 'awarded',
      'EV': 'active',
      'RES': 'closed',
      'AN': 'closed'
    };

    return statusMap[statusCode] || 'active';
  }

  /**
   * Verificar si una licitación debe actualizarse
   * @param {Object} existing
   * @param {Object} newData
   * @returns {boolean}
   */
  shouldUpdate(existing, newData) {
    // Actualizar si han pasado más de 24 horas
    const existingDate = new Date(existing.updated_at);
    const hoursSinceUpdate = (Date.now() - existingDate.getTime()) / (1000 * 60 * 60);
    
    return hoursSinceUpdate > 24;
  }

  /**
   * Guardar datos raw de la licitación
   * @param {Object} tender
   * @param {string} externalId
   */
  async saveRawTender(tender, externalId) {
    try {
      await supabase
        .from('tenders_raw')
        .insert({
          source_system: 'placsp',
          external_id: externalId,
          fetched_at: new Date().toISOString(),
          payload: tender
        });
    } catch (error) {
      // No fallar si no se puede guardar raw
      logger.warn(`⚠️ No se pudo guardar tender raw ${externalId}`);
    }
  }

  /**
   * Limpiar licitaciones antiguas (más de 6 meses cerradas)
   */
  async cleanupOldTenders() {
    try {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

      const { data } = await supabase
        .from('tenders')
        .update({ is_active: false })
        .eq('status', 'closed')
        .lt('deadline', sixMonthsAgo.toISOString())
        .select('count');

      logger.info(`🧹 Limpiadas ${data?.length || 0} licitaciones antiguas`);
    } catch (error) {
      logger.error('❌ Error al limpiar licitaciones:', error.message);
    }
  }
}

export const syncService = new SyncService();
export default syncService;