# Mis medios en la nube (movies.emailrouting.xyz)

Biblioteca de películas sin ningún equipo encendido:

| Pieza | Dónde vive |
|---|---|
| Sitio (este repositorio) | GitHub Pages, dominio `movies.emailrouting.xyz` |
| Servidor (Worker de Cloudflare) | `movies-api.emailrouting.xyz`, código en `servidor-medios/worker` (fuera de este repo) |
| Archivos | Carpeta «Mis medios» en el Google Drive de cada admin que lo conectó; el sitio las muestra juntas |
| Carátulas y sinopsis | `catalogo.json` en la raíz del Drive principal (se ve en Drive, no en el sitio); los datos vienen de TMDB |
| Pistas y calidades | Carpeta con el mismo nombre del video, a su lado (se ve en Drive, no en el sitio): `pistas.json`, `audio-N.m4a`, `sub-N.vtt`, `1080p.mp4`… `144p.mp4`, y lo que suban los admins (`Audio - X.ext`, `Subtítulos - X.ext`) |
| Pegar enlaces (admins) | El Worker deja un pedido en `_pedidos`; `.github/workflows/pedidos.yml` lo baja al Drive con más espacio |
| Hacer calidades | `.github/workflows/calidades.yml`, cada hora, solo a los videos que les falte |

El repositorio es público y no guarda claves: el robot pide las llaves de los Drive al Worker con el secreto `ROBOT_KEY`.

## Roles

- **usuario** (cualquiera que entre con Google, o con un usuario creado por un admin): ve, reproduce y descarga.
- **admin**: además pega enlaces, sube audios y subtítulos, renombra, mueve, duplica, oculta, crea carpetas, elimina (a la papelera de Drive, 30 días), administra usuarios y suma su propio Drive.

## Catálogo

Por cada película, el sitio busca en TMDB su carátula, sinopsis, año, géneros y nota, y lo guarda en `catalogo.json`.
Si una salió mal, cambia su `"titulo"` (o pon su número de TMDB en `"tmdb"`) y el sitio la vuelve a buscar.

## A tener en cuenta

- GitHub apaga los workflows programados de repos públicos tras 60 días sin commits; se reactivan en la pestaña Actions.
- El plan gratis de Workers permite 100.000 peticiones al día; para uso personal sobra.
