// Datos públicos del proyecto Supabase de DataLite. La clave publicable está pensada para ir en el
// navegador: los datos los protegen las políticas RLS y las funciones de la base, no esta clave.
// Las claves secretas (service role, Wompi) viven solo en las variables de entorno de Vercel.
export const CLOUD = {
  url: 'https://dwluwzeqexgihihauuos.supabase.co',
  anonKey: 'sb_publishable_995ySHRNqs69PEcbJo2Saw_HrGxU1JF',
};

// Conexiones a hojas en línea (Pro y Empresa). Estos identificadores son públicos por diseño:
// el acceso a los archivos lo concede cada usuario en la ventana oficial de Google o Microsoft.
// Mientras estén vacíos, los botones de conexión no aparecen.
export const CONNECT = {
  google: {
    clientId: '',   // Google Cloud → Credenciales → ID de cliente OAuth (aplicación web)
    apiKey: '',     // Clave de API restringida a data-lite.vercel.app y docs.google.com (para el selector)
    appId: '',      // Número del proyecto de Google Cloud
  },
  microsoft: {
    clientId: '',   // Microsoft Entra → Registros de aplicaciones → ID de aplicación (cliente)
  },
};
