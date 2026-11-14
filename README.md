# Mis medios en la nube (movies.emailrouting.xyz)

Clon del servidor de medios del PC, sin ningún equipo encendido:

| Pieza | Dónde vive |
|---|---|
| Sitio (este repositorio) | GitHub Pages, dominio `movies.emailrouting.xyz` |
| Archivos | Google Drive, carpeta «Mis medios» |
| Inicio de sesión | Cuenta de Google. Solo ven archivos las cuentas con acceso a esa carpeta |
| Reproducir y descargar | `sw.js` pide cada archivo a Drive con la sesión (acepta adelantar y retomar) |
| Pegar enlaces | La web deja un pedido en `Mis medios/_pedidos`; `.github/workflows/descargar.yml` lo baja a Drive cada 5 a 15 min con `rclone copyurl` |

El repositorio puede ser público: no guarda claves. La llave de Drive del robot va en el secreto
`RCLONE_CONF` de GitHub, y el ID de la carpeta raíz en la variable `ROOT_ID`.

## Puesta en marcha (una vez)

1. Google Cloud: proyecto nuevo, activar «Google Drive API», pantalla de consentimiento «Externa» y
   publicada (queda «sin verificar»: al entrar, Google muestra un aviso que se acepta una vez).
   - Cliente OAuth «Aplicación web», origen autorizado `https://movies.emailrouting.xyz`. Su ID va en `config.js`.
   - Cliente OAuth «App de escritorio», para rclone.
2. Drive: carpeta «Mis medios» con la subcarpeta `_pedidos`. Su ID va en `config.js` (`ROOT_ID`) y en la variable `ROOT_ID` del repositorio.
3. rclone en el PC: `rclone config` con el cliente de escritorio (remoto llamado `drive`). Subir el disco con
   `rclone copy D:\ drive:"Mis medios" --exclude ".*/**" --exclude "$*/**" --exclude "System Volume Information/**" -P`.
   Guardar el `rclone.conf` como secreto: `gh secret set RCLONE_CONF < %APPDATA%\rclone\rclone.conf`.
4. GitHub Pages desde la rama `main`, dominio propio `movies.emailrouting.xyz` y HTTPS obligatorio.
5. Cloudflare DNS: `CNAME movies → miinfcl.github.io`, **solo DNS** (nube gris), para que GitHub emita el certificado.

## A tener en cuenta

- Compartir con alguien = compartirle la carpeta «Mis medios» en Drive (lector para ver; editor para pegar enlaces).
- Los `.mkv` se reproducen en Chrome y Android, pero no en iPhone ni Safari (igual que en el servidor local).
- GitHub apaga los workflows programados de repos públicos tras 60 días sin commits. Si se apaga, se reactiva en la pestaña Actions.
- Drive limita cuánto se puede descargar de un mismo archivo por día. Para uso personal no suele notarse.
