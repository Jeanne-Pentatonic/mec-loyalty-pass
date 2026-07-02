#!/bin/bash
# Development certificate setup script for local HTTPS testing

CERT_DIR="$(dirname "$0")/../certificates"
SSL_DIR="$CERT_DIR/ssl"

mkdir -p "$SSL_DIR"

echo "Creating local SSL certificate for HTTPS..."

# Generate SSL certificate for local development
openssl req -x509 -newkey rsa:2048 \
  -keyout "$SSL_DIR/server.key" \
  -out "$SSL_DIR/server.crt" \
  -days 365 \
  -nodes \
  -subj "/CN=localhost" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1,IP:192.168.1.153" \
  2>/dev/null

echo "SSL certificates created:"
echo "  - $SSL_DIR/server.key"
echo "  - $SSL_DIR/server.crt"
echo ""
echo "To trust the certificate on macOS (required for iPhone testing):"
echo "  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain $SSL_DIR/server.crt"
echo ""
echo "You can now start the server with: npm start"
echo "Then open https://localhost:3000 or https://192.168.1.153:3000"
