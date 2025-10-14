import dotenv from 'dotenv';

dotenv.config();

// Configuración para la Plataforma de Contratación del Sector Público (PLACSP)
export const placspConfig = {
  // URL del feed ATOM oficial
  atomFeedUrl: 'https://contrataciondelsectorpublico.gob.es/sindicacion/sindicacion_643/licitacionesPerfilesContratanteCompleto3.atom',
  
  // Límite de entradas a procesar por sync
  maxEntriesToProcess: 500,
  
  // Códigos CPV de construcción (División 45)
  constructionCPVs: [
    '45000000', // Trabajos de construcción
    '45100000', // Preparación de obras
    '45110000', // Demolición y preparación del terreno
    '45200000', // Trabajos completos o parciales de construcción
    '45210000', // Construcción de edificios
    '45220000', // Obras de ingeniería civil
    '45230000', // Construcción de tuberías, líneas de comunicación
    '45240000', // Construcción de obras hidráulicas
    '45250000', // Construcción de otras obras de ingeniería civil
    '45260000', // Construcción de techumbres y otras obras especiales
    '45300000', // Trabajos de instalación de edificios
    '45310000', // Instalación eléctrica
    '45320000', // Instalación de fontanería y climatización
    '45330000', // Instalación de cocinas, escaleras
    '45400000', // Trabajos de acabado de edificios
    '45410000', // Enlucido
    '45420000', // Instalación de carpintería
    '45430000', // Revestimiento de suelos y paredes
    '45440000', // Trabajos de pintura
    '45450000', // Otros trabajos de acabado
    '45500000'  // Alquiler de maquinaria de construcción
  ],

  // Keywords de construcción (backup si CPV no está claro)
  constructionKeywords: [
    'obra', 'construcción', 'edificación', 'reforma',
    'rehabilitación', 'infraestructura', 'urbanización',
    'pavimentación', 'instalación eléctrica', 'fontanería',
    'demolición', 'cimentación', 'estructura', 'albañilería',
    'cerramiento', 'cubierta', 'saneamiento', 'carpintería',
    'revestimiento', 'impermeabilización', 'tabiquería'
  ],

  // Mapa de provincias españolas (para normalizar)
  provincias: [
    'Álava', 'Albacete', 'Alicante', 'Almería', 'Asturias', 'Ávila',
    'Badajoz', 'Barcelona', 'Burgos', 'Cáceres', 'Cádiz', 'Cantabria',
    'Castellón', 'Ciudad Real', 'Córdoba', 'Cuenca', 'Gerona', 'Granada',
    'Guadalajara', 'Guipúzcoa', 'Huelva', 'Huesca', 'Islas Baleares',
    'Jaén', 'La Coruña', 'La Rioja', 'Las Palmas', 'León', 'Lérida',
    'Lugo', 'Madrid', 'Málaga', 'Murcia', 'Navarra', 'Orense', 'Palencia',
    'Pontevedra', 'Salamanca', 'Santa Cruz de Tenerife', 'Segovia',
    'Sevilla', 'Soria', 'Tarragona', 'Teruel', 'Toledo', 'Valencia',
    'Valladolid', 'Vizcaya', 'Zamora', 'Zaragoza'
  ],

  // Estados de licitación que nos interesan
  estadosActivos: [
    'PUB', // Publicada
    'ADJ', // Adjudicada
    'EV'   // Evaluación
  ]
};

export default placspConfig;