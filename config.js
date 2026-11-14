// Configuración del clon en la nube. Nada de esto es secreto: el ID de cliente de Google es público por diseño.
window.MEDIOS = {
  // ID de cliente OAuth (tipo "Aplicación web") del proyecto de Google Cloud. Origen autorizado: https://movies.emailrouting.xyz
  CLIENT_ID: 'PENDIENTE.apps.googleusercontent.com',
  // Carpeta raíz en Google Drive con los medios (su ID, de la URL drive.google.com/drive/folders/<ID>).
  // Si queda vacío, se busca una carpeta llamada ROOT_NAME.
  ROOT_ID: '',
  ROOT_NAME: 'Mis medios',
  // Subcarpeta (dentro de la raíz) donde la web deja los pedidos de descarga que procesa GitHub Actions.
  QUEUE_NAME: '_pedidos',
};
