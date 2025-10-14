import { supabase } from '../config/supabase.js';
import { logger } from '../utils/logger.js';

class MatchingService {
  /**
   * Hacer matching de licitaciones con usuarios
   * @param {Array} tenders - Nuevas licitaciones
   * @returns {Promise<Object>}
   */
  async matchTendersWithUsers(tenders) {
    logger.info(`🎯 Matching de ${tenders.length} licitaciones con usuarios...`);

    let totalMatches = 0;
    const matchesByUser = {};

    for (const tender of tenders) {
      try {
        // Obtener usuarios de la provincia de la licitación
        const users = await this.getUsersByProvince(tender.province);

        for (const user of users) {
          const matchScore = this.calculateMatchScore(tender, user);

          // Solo crear match si score >= 60
          if (matchScore >= 60) {
            const match = await this.createMatch(user, tender, matchScore);
            
            if (match) {
              totalMatches++;
              matchesByUser[user.user_id] = (matchesByUser[user.user_id] || 0) + 1;
            }
          }
        }
      } catch (error) {
        logger.error(`❌ Error en matching de licitación ${tender.id}:`, error.message);
      }
    }

    logger.info(`✅ Creados ${totalMatches} matches para ${Object.keys(matchesByUser).length} usuarios`);

    return {
      totalMatches,
      usersMatched: Object.keys(matchesByUser).length,
      matchesByUser
    };
  }

  /**
   * Obtener usuarios de una provincia específica
   * @param {string} province
   * @returns {Promise<Array>}
   */
  async getUsersByProvince(province) {
    try {
      logger.info(`🔍 Buscando usuarios en provincia: ${province}`);
      
      // Obtener usuarios activos
      const { data: activeUsers, error: usersError } = await supabase
        .from('companies')
        .select('user_id')
        .in('subscription_status', ['trial', 'active']);

      if (usersError) {
        logger.error(`❌ Error obteniendo usuarios activos:`, usersError);
        return [];
      }

      logger.info(`   📊 Usuarios activos: ${activeUsers?.length || 0}`);

      if (!activeUsers || activeUsers.length === 0) {
        logger.warn(`   ⚠️ No hay usuarios activos`);
        return [];
      }

      const userIds = activeUsers.map(u => u.user_id);

      // Obtener perfiles con esa provincia en locations
      const { data: profiles, error: profilesError } = await supabase
        .from('user_profiles')
        .select('*')
        .in('user_id', userIds)
        .eq('onboarding_completed', true);

      if (profilesError) {
        logger.error(`   ❌ Error obteniendo perfiles:`, profilesError);
        return [];
      }

      logger.info(`   📊 Perfiles completados: ${profiles?.length || 0}`);

      // Filtrar los que tienen esta provincia
      const usersInProvince = profiles?.filter(profile => {
        const hasProvince = 
          profile.preferred_province === province ||
          (profile.locations && profile.locations.includes(province));
        
        if (hasProvince) {
          logger.info(`   ✅ Usuario encontrado: ${profile.company_name} (${province})`);
        }
        
        return hasProvince;
      }) || [];

      logger.info(`   📊 Total usuarios en ${province}: ${usersInProvince.length}`);

      // Obtener datos de companies
      const { data: companies } = await supabase
        .from('companies')
        .select('*')
        .in('user_id', usersInProvince.map(p => p.user_id))
        .in('subscription_status', ['trial', 'active']);

      // Combinar datos
      return usersInProvince.map(profile => {
        const company = companies?.find(c => c.user_id === profile.user_id);
        return {
          ...profile,
          subscription_status: company?.subscription_status,
          subscription_tier: company?.subscription_tier
        };
      });

    } catch (error) {
      logger.error(`❌ Error obteniendo usuarios de ${province}:`, error.message);
      return [];
    }
  }

  /**
   * Calcular score de match entre licitación y usuario
   * @param {Object} tender
   * @param {Object} user
   * @returns {number} Score de 0-100
   */
  calculateMatchScore(tender, user) {
    let score = 0;
    const reasons = [];

    // 1. Match de provincia (40 puntos - más peso)
    if (user.preferred_province === tender.province) {
      score += 40;
      reasons.push('Provincia preferida');
    } else if (user.locations && user.locations.includes(tender.province)) {
      score += 40;
      reasons.push('Provincia en ubicaciones');
    } else {
      // Si no hay match de provincia exacto, dar puntos base si está en España
      score += 10;
    }

    // 2. Match de presupuesto (30 puntos)
    if (tender.budget) {
      if (user.budget_min && user.budget_max) {
        if (tender.budget >= user.budget_min && tender.budget <= user.budget_max) {
          score += 30;
          reasons.push('Presupuesto en rango');
        } else if (tender.budget >= user.budget_min * 0.5 && tender.budget <= user.budget_max * 2) {
          score += 20;
          reasons.push('Presupuesto cercano al rango');
        } else {
          score += 5;
        }
      } else {
        // Si no tiene rango definido, dar puntos base
        score += 15;
      }
    } else {
      // Sin presupuesto definido
      score += 10;
    }

    // 3. Match de sector/tipo de obra (20 puntos - más flexible)
    if (user.sectors && user.sectors.length > 0) {
      const tenderType = tender.work_type.toLowerCase();
      const tenderTitle = tender.title.toLowerCase();
      
      // Mapeo de sectores del usuario a palabras clave
      const sectorKeywords = {
        'Edificación residencial': ['edificación', 'edificio', 'vivienda', 'residencial', 'pabellón'],
        'Obra civil': ['obra civil', 'infraestructura', 'urbanización', 'pavimentación', 'carretera', 'ingeniería civil'],
        'Rehabilitación y reformas': ['rehabilitación', 'reforma', 'restauración', 'mejora'],
        'Instalaciones': ['instalación', 'instalaciones', 'eléctrica', 'fontanería', 'climatización']
      };
      
      let hasSectorMatch = false;
      
      for (const sector of user.sectors) {
        const keywords = sectorKeywords[sector] || [sector.toLowerCase()];
        
        for (const keyword of keywords) {
          if (tenderType.includes(keyword) || tenderTitle.includes(keyword)) {
            hasSectorMatch = true;
            break;
          }
        }
        
        if (hasSectorMatch) break;
      }
      
      if (hasSectorMatch) {
        score += 20;
        reasons.push('Sector coincide');
      } else {
        score += 10;
        reasons.push('Sector relacionado con construcción');
      }
    } else {
      // Si no tiene sectores definidos, dar puntos base
      score += 15;
    }

    // 4. Estado y disponibilidad (10 puntos)
    if (tender.status === 'active') {
      score += 5;
    }

    if (tender.deadline) {
      const daysUntilDeadline = this.getDaysUntilDeadline(tender.deadline);
      if (daysUntilDeadline > 15) {
        score += 5;
        reasons.push('Plazo amplio');
      } else if (daysUntilDeadline > 7) {
        score += 3;
        reasons.push('Plazo moderado');
      }
    }

    return Math.min(score, 100);
  }

  /**
   * Calcular días hasta el deadline
   * @param {string} deadline
   * @returns {number}
   */
  getDaysUntilDeadline(deadline) {
    const deadlineDate = new Date(deadline);
    const today = new Date();
    const diffTime = deadlineDate - today;
    return Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  }

  /**
   * Crear match entre usuario y licitación
   * @param {Object} user
   * @param {Object} tender
   * @param {number} matchScore
   * @returns {Promise<Object>}
   */
  async createMatch(user, tender, matchScore) {
    try {
      // Verificar si ya existe el match
      const { data: existing } = await supabase
        .from('user_tender_matches')
        .select('id')
        .eq('user_id', user.user_id)
        .eq('tender_id', tender.id)
        .single();

      if (existing) {
        logger.debug(`⏭️ Match ya existe para usuario ${user.user_id} y licitación ${tender.id}`);
        return null;
      }

      // Crear nuevo match
      const { data: match, error } = await supabase
        .from('user_tender_matches')
        .insert({
          user_id: user.user_id,
          tender_id: tender.id,
          match_score: matchScore,
          match_reasons: this.getMatchReasons(tender, user, matchScore),
          status: 'new',
          created_at: new Date().toISOString()
        })
        .select()
        .single();

      if (error) throw error;

      logger.info(`✨ Match creado: ${user.company_name} - ${tender.title.substring(0, 50)}... (Score: ${matchScore})`);

      return match;

    } catch (error) {
      logger.error(`❌ Error creando match:`, error.message);
      return null;
    }
  }

  /**
   * Generar razones del match
   * @param {Object} tender
   * @param {Object} user
   * @param {number} score
   * @returns {Array}
   */
  getMatchReasons(tender, user, score) {
    const reasons = [];

    if (user.preferred_province === tender.province) {
      reasons.push(`Ubicación: ${tender.province} (tu provincia preferida)`);
    }

    if (tender.budget && user.budget_min && user.budget_max) {
      if (tender.budget >= user.budget_min && tender.budget <= user.budget_max) {
        reasons.push(`Presupuesto: €${tender.budget.toLocaleString()} (dentro de tu rango)`);
      }
    }

    if (user.sectors && user.sectors.length > 0) {
      reasons.push(`Sector: ${tender.work_type}`);
    }

    if (tender.deadline) {
      const days = this.getDaysUntilDeadline(tender.deadline);
      reasons.push(`Plazo: ${days} días para presentar oferta`);
    }

    reasons.push(`Match score: ${score}/100`);

    return reasons;
  }

  /**
   * Obtener matches pendientes de un usuario
   * @param {string} userId
   * @returns {Promise<Array>}
   */
  async getUserMatches(userId) {
    try {
      const { data: matches } = await supabase
        .from('user_tender_matches')
        .select(`
          *,
          tenders (*)
        `)
        .eq('user_id', userId)
        .in('status', ['new', 'viewed'])
        .order('match_score', { ascending: false })
        .order('created_at', { ascending: false });

      return matches || [];
    } catch (error) {
      logger.error(`❌ Error obteniendo matches del usuario:`, error.message);
      return [];
    }
  }

  /**
   * Marcar match como visto
   * @param {string} matchId
   * @param {string} userId
   */
  async markMatchAsViewed(matchId, userId) {
    try {
      await supabase
        .from('user_tender_matches')
        .update({
          status: 'viewed',
          viewed_at: new Date().toISOString()
        })
        .eq('id', matchId)
        .eq('user_id', userId);

      logger.info(`👁️ Match ${matchId} marcado como visto`);
    } catch (error) {
      logger.error(`❌ Error marcando match como visto:`, error.message);
    }
  }
}

export const matchingService = new MatchingService();
export default matchingService;