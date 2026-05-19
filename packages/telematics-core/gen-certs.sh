#!/usr/bin/env bash
# gen-certs.sh — Generate a self-signed CA + broker TLS certificate for AXIS EMQX.
#
# Usage:
#   ./gen-certs.sh                           # localhost (development)
#   BROKER_HOST=mqtt.example.com ./gen-certs.sh
#   BROKER_HOST=1.2.3.4 ./gen-certs.sh      # IP SAN added automatically
#   FORCE=1 ./gen-certs.sh                  # overwrite existing certs
#
# Outputs to ./certs/:
#   ca.key       — CA private key  (never send to devices or commit to git)
#   ca.pem       — CA certificate  (distribute to devices for trust)
#   broker.key   — Broker private key
#   broker.pem   — Broker certificate (signed by CA)
#
# Environment variables:
#   BROKER_HOST   Hostname or IP the MQTT broker is reachable at (default: localhost)
#   DAYS          Certificate validity in days (default: 3650)
#   FORCE         Set to 1 to regenerate even if certs already exist

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CERTS_DIR="${SCRIPT_DIR}/certs"

BROKER_HOST="${BROKER_HOST:-localhost}"
DAYS="${DAYS:-3650}"
FORCE="${FORCE:-}"

# ── Argument parsing ──────────────────────────────────────────────────────────
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=1 ;;
    --help|-h)
      sed -n '2,/^set /p' "$0" | grep '^#' | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "[error] Unknown argument: $arg" >&2
      exit 1
      ;;
  esac
done

# ── Prerequisites ─────────────────────────────────────────────────────────────
if ! command -v openssl &>/dev/null; then
  echo "[error] openssl not found — install it and retry." >&2
  exit 1
fi

# ── Idempotency guard ─────────────────────────────────────────────────────────
if [[ -z "$FORCE" && -f "${CERTS_DIR}/ca.pem" ]]; then
  echo "[skip]  Certificates already exist in ${CERTS_DIR}/"
  echo "        Run with FORCE=1 or --force to regenerate."
  exit 0
fi

mkdir -p "${CERTS_DIR}"

echo ""
echo "[axis]  Generating TLS certificates"
echo "        Broker host : ${BROKER_HOST}"
echo "        Validity    : ${DAYS} days"
echo "        Output      : ${CERTS_DIR}/"
echo ""

# ── Step 1 — CA private key ───────────────────────────────────────────────────
echo "[1/4]   CA private key (4096-bit RSA)…"
openssl genrsa -out "${CERTS_DIR}/ca.key" 4096 2>/dev/null

# ── Step 2 — CA self-signed certificate ──────────────────────────────────────
echo "[2/4]   CA self-signed certificate…"
openssl req -x509 -new -nodes \
  -key  "${CERTS_DIR}/ca.key" \
  -sha256 \
  -days "${DAYS}" \
  -out  "${CERTS_DIR}/ca.pem" \
  -subj "/O=AXIS-Telematics/CN=AXIS-Telematics-CA" \
  2>/dev/null

# ── Step 3 — Broker key + CSR ────────────────────────────────────────────────
echo "[3/4]   Broker private key + CSR…"
openssl genrsa -out "${CERTS_DIR}/broker.key" 2048 2>/dev/null

openssl req -new \
  -key  "${CERTS_DIR}/broker.key" \
  -out  "${CERTS_DIR}/broker.csr" \
  -subj "/O=AXIS-Telematics/CN=${BROKER_HOST}" \
  2>/dev/null

# ── Step 4 — Sign broker cert with CA (SAN required by modern TLS) ────────────
echo "[4/4]   Signing broker certificate with CA…"

# Detect IP vs DNS so the SAN is set correctly.
if [[ "${BROKER_HOST}" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SAN="IP:${BROKER_HOST}"
else
  SAN="DNS:${BROKER_HOST}"
fi

openssl x509 -req \
  -in       "${CERTS_DIR}/broker.csr" \
  -CA       "${CERTS_DIR}/ca.pem" \
  -CAkey    "${CERTS_DIR}/ca.key" \
  -CAcreateserial \
  -out      "${CERTS_DIR}/broker.pem" \
  -days     "${DAYS}" \
  -sha256 \
  -extfile  <(printf "subjectAltName=%s\nextendedKeyUsage=serverAuth\n" "$SAN") \
  2>/dev/null

# ── Clean up intermediaries ───────────────────────────────────────────────────
rm -f "${CERTS_DIR}/broker.csr" "${CERTS_DIR}/ca.srl"

# ── Permissions ───────────────────────────────────────────────────────────────
chmod 600 "${CERTS_DIR}/ca.key" "${CERTS_DIR}/broker.key"
chmod 644 "${CERTS_DIR}/ca.pem" "${CERTS_DIR}/broker.pem"

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "[done]  Certificate files:"
echo ""
printf "        %-18s  %s\n" "ca.pem"     "Distribute to devices — used for broker trust"
printf "        %-18s  %s\n" "broker.pem" "Broker TLS certificate"
printf "        %-18s  %s\n" "broker.key" "Broker private key — keep secret"
printf "        %-18s  %s\n" "ca.key"     "CA private key — keep secret, not sent anywhere"
echo ""
echo "[next]  1. Start EMQX:"
echo "           docker compose -f docker-compose.emqx.yml up -d"
echo ""
echo "        2. Configure your server environment:"
echo "           MQTT_HOST=${BROKER_HOST}"
echo "           MQTT_PORT=8883"
echo "           MQTT_TLS=true"
echo "           MQTT_CA_FILE=/path/to/certs/ca.pem"
echo ""
echo "        3. Provision devices via:"
echo "           POST /api/devices/:imei/provision"
echo "           Then import the returned credentials into EMQX via its dashboard"
echo "           or: POST http://localhost:18083/api/v5/authentication/<authn_id>/users"
echo ""
