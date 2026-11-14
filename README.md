# Mis medios en la nube (movies.emailrouting.xyz)

Clon del servidor de medios del PC, sin ningún equipo encendido:

| Pieza | Dónde vive |
|---|---|
| Sitio (este repositorio) | GitHub Pages, dominio `movies.emailrouting.xyz` |
| Servidor (Worker de Cloudflare) | `movies-api.emailrouting.xyz`, código en `servidor-medios/worker` (fuera de este repo) |
| Archivos | Google Drive, carpeta «Mis medios» (`_pistas` y `_pedidos` van ocultas) |
| Inicio de sesión | Usuario y contraseña, o cuenta de Google agregada por el admin |
| Reproducir y descargar | El Worker pide cada archivo a Drive con su propia llave (acepta adelantar y retomar) |
| Audio y subtítulos | Pistas extra en `_pistas/<video>/` (las saca `scripts/pistas.js` con ffmpeg) |
| Pegar enlaces | El Worker deja un pedido en `_pedidos`; `.github/workflows/descargar.yml` lo baja cada 5 a 15 min |

El repositorio es público y no guarda claves: la llave de Drive del robot va en el secreto `RCLONE_CONF`,
y la del Worker en su almacén KV (se conecta desde el sitio con «Conectar Google Drive», como admin).

## Roles

- **usuario**: ve, reproduce, descarga y pega enlaces.
- **admin**: además renombra, mueve, duplica, crea carpetas, elimina (a la papelera de Drive, 30 días) y administra usuarios.

## A tener en cuenta

- Si Google anula el acceso a Drive, el sitio lo avisa y el admin ve el botón «Conectar Google Drive».
- Los `.mkv` se reproducen en Chrome y Android, pero no en iPhone ni Safari.
- GitHub apaga los workflows programados de repos públicos tras 60 días sin commits; se reactiva en la pestaña Actions.
- El plan gratis de Workers permite 100.000 peticiones al día; para uso personal sobra.
