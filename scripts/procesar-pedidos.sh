#!/usr/bin/env bash
# Lee los pedidos (JSON) de la carpeta de cola en Drive y baja cada enlace a la carpeta pedida.
# Pedido: {"url": "...", "carpeta": "<id de carpeta de Drive>", "por": "correo", "fecha": "..."}
# Resultado: si sale bien, el pedido se borra; si falla, queda como <nombre>.error.json con el motivo.
set -uo pipefail
R="drive,root_folder_id=${ROOT_ID}:"          # remoto "drive" del rclone.conf, anclado a la carpeta raíz
Q="${R}${QUEUE_NAME}"
MEDIA='\.(mp4|m4v|webm|mkv|mov|avi|ts|wmv|mp3|m4a|aac|flac|wav|ogg|opus|jpe?g|png|gif|webp)$'

mapfile -t PEDIDOS < <(rclone lsf "$Q" --files-only --exclude '*.error.json' --include 'pedido-*.json' --exclude '*' 2>/dev/null)
echo "Pedidos en cola: ${#PEDIDOS[@]}"

falla() {  # $1 nombre del pedido, $2 json original, $3 motivo
  local base="${1%.json}"
  jq -c --arg e "$3" '. + {error: $e}' <<<"$2" | rclone rcat "$Q/$base.error.json"
  rclone deletefile "$Q/$1" 2>/dev/null
  echo "  FALLÓ: $3"
}

for P in "${PEDIDOS[@]}"; do
  echo "== $P"
  J=$(rclone cat "$Q/$P") || continue
  URL=$(jq -r '.url // empty' <<<"$J"); DEST=$(jq -r '.carpeta // empty' <<<"$J")
  [[ -z "$DEST" || ! "$DEST" =~ ^[A-Za-z0-9_-]+$ ]] && DEST="$ROOT_ID"
  if [[ ! "$URL" =~ ^https?:// ]]; then falla "$P" "$J" "Enlace inválido"; continue; fi

  # Marcar como "descargando" para que la web lo muestre así
  base="${P%.json}"
  jq -c '. + {estado: "descargando"}' <<<"$J" | rclone rcat "$Q/$P"

  # ¿Es multimedia? Por extensión o por el tipo que declara el servidor
  HDRS=$(curl -sIL --max-time 20 -A 'Mozilla/5.0' "$URL" | tr -d '\r')
  CT=$(grep -i '^content-type:' <<<"$HDRS" | tail -1 | cut -d' ' -f2- | cut -d';' -f1)
  NAMEOPT=(--auto-filename)   # nombre tomado del enlace; si el servidor manda uno, se usa ese
  grep -qi '^content-disposition:.*filename' <<<"$HDRS" && NAMEOPT=(--auto-filename --header-filename)
  PATHPART="${URL%%\?*}"
  if ! [[ "${PATHPART,,}" =~ $MEDIA || "${CT,,}" =~ ^(video|audio|image)/ ]]; then
    falla "$P" "$J" "No parece un archivo multimedia (tipo: ${CT:-desconocido})"; continue
  fi

  if rclone copyurl "$URL" "drive,root_folder_id=${DEST}:" "${NAMEOPT[@]}" \
       --user-agent 'Mozilla/5.0' --retries 3 --low-level-retries 10 --stats 30s --stats-one-line -v; then
    rclone deletefile "$Q/$P"; echo "  OK"
  else
    falla "$P" "$J" "La descarga falló (el enlace puede haber vencido o pedir inicio de sesión)"
  fi
done
