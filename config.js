// Configuración del sitio en la nube. Nada de esto es secreto.
window.MEDIOS = {
  // Worker de Cloudflare que guarda la conexión a Drive y maneja usuarios (proyecto: servidor-medios/worker)
  API: 'https://movies-api.emailrouting.xyz',
  // Cliente OAuth "Aplicación web" para "Entrar con Google" (solo pide nombre y correo, no Drive)
  CLIENT_ID: '868288828915-vkouml3on1ad948t745hnq1ub3ee4gmk.apps.googleusercontent.com',
};
