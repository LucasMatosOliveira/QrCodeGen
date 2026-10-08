#!/bin/sh
# Instalador automático para o QR Code Studio CLI (QrCodeGen)
# Suporta macOS e Linux (ARM64 e x64) sem necessidade de Node.js instalado.
#
# Uso:
#   curl -fsSL https://raw.githubusercontent.com/LucasMatosOliveira/QrCodeGen/main/install.sh | sh

set -eu

REPO="LucasMatosOliveira/QrCodeGen"
BINARY_NAME="qr"
ALIAS_NAME="qrcode-cli"

echo "==> Detectando ambiente..."

# Identificar Sistema Operacional
case "$(uname -s)" in
  Darwin)
    OS="darwin"
    ;;
  Linux)
    OS="linux"
    ;;
  *)
    echo "Erro: Sistema operacional '$(uname -s)' não suportado por este instalador." >&2
    echo "Para Windows, baixe o executável .exe diretamente em:" >&2
    echo "https://github.com/${REPO}/releases" >&2
    exit 1
    ;;
esac

# Identificar Arquitetura
case "$(uname -m)" in
  x86_64|amd64)
    ARCH="x64"
    ;;
  arm64|aarch64)
    ARCH="arm64"
    ;;
  *)
    echo "Erro: Arquitetura '$(uname -m)' não suportada." >&2
    exit 1
    ;;
esac

TARGET="qr-${OS}-${ARCH}"
DOWNLOAD_URL="https://github.com/${REPO}/releases/latest/download/${TARGET}"

# Definir diretório de instalação
if [ -n "${INSTALL_DIR:-}" ]; then
  DEST_DIR="$INSTALL_DIR"
elif [ -w "/usr/local/bin" ]; then
  DEST_DIR="/usr/local/bin"
else
  DEST_DIR="$HOME/.local/bin"
fi

mkdir -p "$DEST_DIR"

echo "==> Baixando ${TARGET} da última Release do GitHub..."

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
TMP_FILE="$TMP_DIR/$BINARY_NAME"

if command -v curl >/dev/null 2>&1; then
  if ! curl -fsSL "$DOWNLOAD_URL" -o "$TMP_FILE"; then
    echo "Erro ao baixar de $DOWNLOAD_URL" >&2
    echo "Verifique se a release já foi publicada em https://github.com/${REPO}/releases" >&2
    exit 1
  fi
elif command -v wget >/dev/null 2>&1; then
  if ! wget -qO "$TMP_FILE" "$DOWNLOAD_URL"; then
    echo "Erro ao baixar de $DOWNLOAD_URL" >&2
    echo "Verifique se a release já foi publicada em https://github.com/${REPO}/releases" >&2
    exit 1
  fi
else
  echo "Erro: curl ou wget é necessário para realizar o download." >&2
  exit 1
fi

chmod +x "$TMP_FILE"

echo "==> Instalando em ${DEST_DIR}/${BINARY_NAME}..."

if [ -w "$DEST_DIR" ]; then
  mv -f "$TMP_FILE" "$DEST_DIR/$BINARY_NAME"
  ln -sf "$DEST_DIR/$BINARY_NAME" "$DEST_DIR/$ALIAS_NAME" 2>/dev/null || cp -f "$DEST_DIR/$BINARY_NAME" "$DEST_DIR/$ALIAS_NAME"
else
  echo "Permissão de superusuário necessária para gravar em ${DEST_DIR}..."
  sudo mv -f "$TMP_FILE" "$DEST_DIR/$BINARY_NAME"
  sudo ln -sf "$DEST_DIR/$BINARY_NAME" "$DEST_DIR/$ALIAS_NAME" 2>/dev/null || sudo cp -f "$DEST_DIR/$BINARY_NAME" "$DEST_DIR/$ALIAS_NAME"
fi

echo ""
echo "✨ QR Code Studio CLI instalado com sucesso!"
echo "Comandos disponíveis: '${BINARY_NAME}' e '${ALIAS_NAME}'"

# Verificar se o diretório está no PATH
case ":$PATH:" in
  *":$DEST_DIR:"*)
    echo ""
    echo "Tudo pronto! Para começar, execute:"
    echo "  ${BINARY_NAME}"
    ;;
  *)
    echo ""
    echo "⚠️  Atenção: O diretório '$DEST_DIR' não está no seu PATH."
    echo "Adicione ao seu terminal rodando o comando correspondente ao seu shell:"
    case "${SHELL:-}" in
      *zsh*)
        echo "  echo 'export PATH=\"$DEST_DIR:\$PATH\"' >> ~/.zshrc && source ~/.zshrc"
        ;;
      *bash*)
        echo "  echo 'export PATH=\"$DEST_DIR:\$PATH\"' >> ~/.bashrc && source ~/.bashrc"
        ;;
      *fish*)
        echo "  fish_add_path $DEST_DIR"
        ;;
      *)
        echo "  export PATH=\"$DEST_DIR:\$PATH\""
        ;;
    esac
    ;;
esac
