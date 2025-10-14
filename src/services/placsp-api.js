import axios from 'axios';
import { parseStringPromise } from 'xml2js';
import { placspConfig } from '../config/placsp.js';
import { logger } from '../utils/logger.js';

class PLACSPApi {
  constructor() {
    this.feedUrl = placspConfig.atomFeedUrl;
    
    this.client = axios.create({
      timeout: 60000,
      headers: {
        'User-Agent': 'TenderSyncBot/1.0',
        'Accept': 'application/atom+xml, application/xml, text/xml'
      }
    });
  }

  /**
   * Obtener y parsear el feed ATOM
   * @returns {Promise<Array>} - Array de licitaciones
   */
  async getFeed() {
    try {
      logger.info('🔍 Obteniendo feed ATOM de PLACSP...');
      
      const response = await this.client.get(this.feedUrl);
      
      logger.info('✅ Feed descargado, parseando XML...');
      
      // Parsear XML a JSON
      const parsed = await parseStringPromise(response.data, {
        explicitArray: false,
        mergeAttrs: true,
        trim: true
      });

      // Extraer entries del feed
      const entries = parsed.feed?.entry || [];
      const entriesArray = Array.isArray(entries) ? entries : [entries];
      
      logger.info(`✅ Feed parseado: ${entriesArray.length} licitaciones encontradas`);
      
      return entriesArray;

    } catch (error) {
      logger.error('❌ Error obteniendo feed PLACSP:', error.message);
      throw new Error(`Error en API PLACSP: ${error.message}`);
    }
  }

  /**
   * Obtener licitaciones de construcción filtradas por provincias de usuarios
   * @param {Array} userProvinces - Array de provincias de usuarios
   * @returns {Promise<Array>}
   */
  async getConstructionTendersByProvinces(userProvinces) {
    try {
      if (!userProvinces || userProvinces.length === 0) {
        logger.warn('⚠️ No hay provincias de usuarios para filtrar');
        return [];
      }

      logger.info(`📍 Filtrando por provincias: ${userProvinces.join(', ')}`);

      // 1. Obtener feed completo
      const allEntries = await this.getFeed();

      // 2. Limitar a las primeras N entradas para no saturar
      const entriesToProcess = allEntries.slice(0, placspConfig.maxEntriesToProcess);
      logger.info(`📦 Procesando ${entriesToProcess.length} licitaciones...`);

      // 3. Filtrar por construcción
      logger.info('🔍 Filtrando por sector construcción...');
      const constructionEntries = this.filterByConstruction(entriesToProcess);
      logger.info(`✅ ${constructionEntries.length} licitaciones de construcción`);

      // 4. Filtrar por provincias de usuarios
      logger.info('🔍 Filtrando por provincias de usuarios...');
      const filteredByProvince = this.filterByProvinces(constructionEntries, userProvinces);
      logger.info(`✅ ${filteredByProvince.length} licitaciones en provincias con usuarios`);

      // 5. Transformar a formato útil
      const tenders = filteredByProvince.map(entry => this.transformEntry(entry)).filter(t => t !== null);

      return tenders;

    } catch (error) {
      logger.error('❌ Error obteniendo licitaciones:', error.message);
      throw error;
    }
  }

  /**
   * Filtrar solo licitaciones de construcción (CPV 45*)
   * @param {Array} entries
   * @returns {Array}
   */
  filterByConstruction(entries) {
    return entries.filter(entry => {
      try {
        const cpvCode = this.extractCPV(entry);
        
        if (!cpvCode) return false;

        // Verificar si empieza por 45 (construcción)
        return cpvCode.toString().startsWith('45');

      } catch (error) {
        return false;
      }
    });
  }

  /**
   * Filtrar por provincias de usuarios
   * @param {Array} entries
   * @param {Array} provinces
   * @returns {Array}
   */
  filterByProvinces(entries, provinces) {
    const provincesLower = provinces.map(p => this.normalizeProvince(p));

    // DEBUG: Ver qué provincias tienen las licitaciones
    const foundProvinces = new Set();
    entries.forEach(entry => {
      const province = this.extractProvince(entry);
      if (province) foundProvinces.add(province);
    });
    
    logger.info(`🔍 DEBUG - Provincias encontradas en licitaciones: ${Array.from(foundProvinces).join(', ')}`);
    logger.info(`🔍 DEBUG - Provincias buscadas: ${provinces.join(', ')}`);

    return entries.filter(entry => {
      try {
        const province = this.extractProvince(entry);
        
        if (!province) return false;

        const normalizedProvince = this.normalizeProvince(province);
        const match = provincesLower.includes(normalizedProvince);
        
        if (match) {
          logger.info(`✅ Match encontrado: ${province}`);
        }
        
        return match;

      } catch (error) {
        return false;
      }
    });
  }

  /**
   * Extraer código CPV del entry
   * @param {Object} entry
   * @returns {string|null}
   */
  extractCPV(entry) {
    try {
      const contractFolder = entry['cac-place-ext:ContractFolderStatus'] || entry.ContractFolderStatus;
      
      if (!contractFolder) return null;

      const procurementProject = contractFolder['cac:ProcurementProject'];
      if (!procurementProject) return null;

      const requiredCommodity = procurementProject['cac:RequiredCommodityClassification'];
      if (!requiredCommodity) return null;

      const itemClass = Array.isArray(requiredCommodity) 
        ? requiredCommodity[0]['cbc:ItemClassificationCode']
        : requiredCommodity['cbc:ItemClassificationCode'];

      return itemClass?._ || itemClass || null;

    } catch (error) {
      return null;
    }
  }

  /**
   * Extraer provincia del entry (busca en múltiples lugares)
   * @param {Object} entry
   * @returns {string|null}
   */
  extractProvince(entry) {
    try {
      // Método 1: Buscar en campos estructurados
      const contractFolder = entry['cac-place-ext:ContractFolderStatus'] || entry.ContractFolderStatus;
      
      if (contractFolder) {
        const locatedContract = contractFolder['cac:ProcurementProject']?.['cac:RealizedLocation'];
        if (locatedContract) {
          const address = Array.isArray(locatedContract)
            ? locatedContract[0]['cac:Address']
            : locatedContract['cac:Address'];

          const province = address?.['cbc:CountrySubentityCode'] || address?.['cbc:CountrySubentity'];
          if (province?._ || province) {
            return province?._ || province;
          }
        }
      }

      // Método 2: Buscar en el título y descripción
      const title = entry.title?._ || entry.title || '';
      const summary = entry.summary?._ || entry.summary || '';
      const text = `${title} ${summary}`.toLowerCase();

      // Lista de provincias españolas
      const provincias = [
        'álava', 'albacete', 'alicante', 'almería', 'asturias', 'ávila',
        'badajoz', 'barcelona', 'burgos', 'cáceres', 'cádiz', 'cantabria',
        'castellón', 'ciudad real', 'córdoba', 'cuenca', 'gerona', 'girona', 'granada',
        'guadalajara', 'guipúzcoa', 'gipuzkoa', 'huelva', 'huesca', 'baleares',
        'jaén', 'coruña', 'rioja', 'palmas', 'león', 'lérida', 'lleida',
        'lugo', 'madrid', 'málaga', 'malaga', 'murcia', 'navarra', 'orense', 'ourense', 'palencia',
        'pontevedra', 'salamanca', 'tenerife', 'segovia',
        'sevilla', 'soria', 'tarragona', 'teruel', 'toledo', 'valencia',
        'valladolid', 'vizcaya', 'bizkaia', 'zamora', 'zaragoza'
      ];

      for (const provincia of provincias) {
        if (text.includes(provincia)) {
          // Capitalizar primera letra
          return provincia.charAt(0).toUpperCase() + provincia.slice(1);
        }
      }

      // Método 3: Buscar en organismo contratante
      const contractingBody = this.extractContractingBody(contractFolder);
      const bodyText = contractingBody.toLowerCase();
      
      for (const provincia of provincias) {
        if (bodyText.includes(provincia)) {
          return provincia.charAt(0).toUpperCase() + provincia.slice(1);
        }
      }

      return null;

    } catch (error) {
      return null;
    }
  }

  /**
   * Normalizar nombre de provincia
   * @param {string} province
   * @returns {string}
   */
  normalizeProvince(province) {
    if (!province) return '';
    
    return province
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .trim();
  }

  /**
   * Transformar entry XML a formato de licitación
   * @param {Object} entry
   * @returns {Object}
   */
  transformEntry(entry) {
    try {
      const contractFolder = entry['cac-place-ext:ContractFolderStatus'] || entry.ContractFolderStatus;
      const procurement = contractFolder?.['cac:ProcurementProject'] || {};

      return {
        id: entry.id || entry['cbc:ID'],
        title: entry.title?._ || entry.title || 'Sin título',
        summary: entry.summary?._ || entry.summary || '',
        link: entry.link?.href || entry.link,
        published: entry.published,
        updated: entry.updated,
        
        contract_folder_id: contractFolder?.['cbc:ContractFolderID'] || null,
        cpv_code: this.extractCPV(entry),
        province: this.extractProvince(entry),
        budget: this.extractBudget(procurement),
        description: procurement['cbc:Description'] || '',
        deadline: this.extractDeadline(contractFolder),
        
        contracting_body: this.extractContractingBody(contractFolder),
        
        status: this.extractStatus(contractFolder),
        
        raw_xml: entry
      };

    } catch (error) {
      logger.error('❌ Error transformando entry:', error.message);
      return null;
    }
  }

  /**
   * Extraer presupuesto
   * @param {Object} procurement
   * @returns {number|null}
   */
  extractBudget(procurement) {
    try {
      const budgetAmount = procurement['cbc:BudgetAmount'];
      const amount = budgetAmount?._ || budgetAmount;
      return amount ? parseFloat(amount) : null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extraer fecha límite
   * @param {Object} contractFolder
   * @returns {string|null}
   */
  extractDeadline(contractFolder) {
    try {
      const tenderSubmission = contractFolder['cac:TenderingProcess']?.['cac:TenderSubmissionDeadlinePeriod'];
      const deadline = tenderSubmission?.['cbc:EndDate'];
      return deadline?._ || deadline || null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Extraer organismo contratante
   * @param {Object} contractFolder
   * @returns {string}
   */
  extractContractingBody(contractFolder) {
    try {
      const party = contractFolder['cac:LocatedContractingParty']?.['cac:Party'];
      const name = party?.['cac:PartyName']?.['cbc:Name'];
      return name?._ || name || 'No especificado';
    } catch (error) {
      return 'No especificado';
    }
  }

  /**
   * Extraer estado
   * @param {Object} contractFolder
   * @returns {string}
   */
  extractStatus(contractFolder) {
    try {
      const statusCode = contractFolder['cbc:ContractFolderStatusCode'];
      return statusCode?._ || statusCode || 'PUB';
    } catch (error) {
      return 'PUB';
    }
  }

  /**
   * Health check de la API
   * @returns {Promise<Object>}
   */
  async healthCheck() {
    try {
      const response = await this.client.head(this.feedUrl);
      return {
        status: 'ok',
        timestamp: new Date().toISOString(),
        message: 'API PLACSP operativa'
      };
    } catch (error) {
      return {
        status: 'error',
        timestamp: new Date().toISOString(),
        error: error.message
      };
    }
  }
}

export const placspAPI = new PLACSPApi();
export default placspAPI;