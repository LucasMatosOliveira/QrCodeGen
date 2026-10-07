# QR Code Studio CLI

Sistema CLI completo para geração e estilização de QR Codes com **interface de abas internas (TUI)**, **preview em tempo real no terminal** e suporte a exportação em alta qualidade (**PNG**, **SVG**, **TXT**).

---

## 🖥️ Interface com Divisão de Abas (Studio TUI)

Ao rodar simplesmente:

```bash
qr
```
*(ou explicitamente com `qr -t` ou `qr --tui`)*

Você entra no **QR Code Studio**, uma interface visual no terminal dividida em dois painéis (requer stdin e stdout em um terminal interativo; mínimo 70×20):

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  QR CODE STUDIO                                                              │
│ [1 Conteúdo] [2 Estilo] [3 Cores] [4 Exportar]                               │
├──────────────────────────────────┬───────────────────────────────────────────┤
│  CONTEÚDO                        │ PREVIEW COMPACTO                          │
│                                  │ Estilo aplicado no arquivo.               │
│ ▶ Conteúdo                       │           ▄▄▄▄▄▄▄  ▄ ▄▄ ▄▄▄▄▄▄▄           │
│    https://github.com            │           █ ▄▄▄ █ ▄█  █ █ ▄▄▄ █           │
│    18 caracteres                 │           █ ███ █ █▀ ▀█ █ ███ █           │
│                                  │           █▄▄▄▄▄█ █▀▄▀▄ █▄▄▄▄▄█           │
│   Correção de erro               │           ▄ ▄▄▄▄▄ ▀▄▀▄  ▄▄▄▄▄             │
│    ◄         M (~15%)          ► │           ...                             │
├──────────────────────────────────┴───────────────────────────────────────────┤
│ ! Margem menor que 4: valide a leitura.                                      │
│ [Tab] Abas [↑↓] Campos [←→] Cursor [^S] Salvar [Esc] Sair                    │
└──────────────────────────────────────────────────────────────────────────────┘
```

### ✨ Recursos do Studio:
- **Abas Internas**:
  - `1 Conteúdo`: Digite ou cole o link/texto; o cursor se move com `←`/`→`, `Home`/`End`, `Backspace`/`Delete`.
  - `2 Estilo`: Alterne entre Quadrados, Bolinhas (Dots) e Arredondado, e escolha a margem.
  - `3 Cores`: Alterne cores dos módulos e fundo branco, transparente ou escuro.
  - `4 Exportar`: Escolha PNG, SVG ou TXT; a extensão do nome segue o formato. TXT não leva cores nem transparência.
- **Preview em Tempo Real**:
  - Mostra o QR estilizado quando cabe; caso contrário, um preview compacto em meio-bloco. Se nem o compacto couber, a área explica o tamanho necessário — o QR nunca é desenhado cortado.
  - O preview é aproximado; o arquivo exportado usa exatamente estilo, cores e margem escolhidos.
  - Avisos no rodapé: cores iguais, fundo transparente e margem menor que 4.
- **Teclas e mouse**:
  - `Tab` / `Shift+Tab`: muda de aba; `1`–`4`, `S` e `Q` funcionam fora dos campos de texto.
  - `↑` / `↓`: navega entre os campos; `Enter` avança para o próximo campo.
  - `←` / `→` ou `Espaço`: altera a opção selecionada.
  - `Ctrl+S`: salva de qualquer campo. Se o arquivo já existe, `Enter` substitui e `Esc` cancela.
  - `Esc`, `Q` ou `Ctrl+C`: sai e restaura o terminal.
  - Mouse: clique nas abas e campos; metade esquerda/direita de um seletor volta/avança a opção; a roda altera o seletor sob o ponteiro.
  - Texto colado é inserido no campo de texto, nunca interpretado como atalho.

---

## 🧭 Assistente Guiado Passo a Passo (Wizard)

Se preferir o modo interativo guiado por perguntas sequenciais:

```bash
qr --wizard
```

---

## ⚡ Geração Rápida via Linha de Comando (Scripts & CI/CD)

Você também pode passar comandos diretos com flags:

```bash
# Preview no terminal com bolinhas:
qr "https://google.com" --style dots

# Salvar PNG com fundo transparente e bolinhas:
qr "https://github.com" -o meu-qr.png --style dots --transparent

# Salvar SVG com cantos arredondados e cor azul:
qr "https://meusite.com" -o meu-qr.svg --style rounded --color-dark "#2563eb"

# Entrada via Pipe:
echo "Texto do pipe" | qr --style dots
```

---

## ⚙️ Tabela de Opções da CLI

| Opção | Abreviação | Descrição | Padrão |
|---|---|---|---|
| `-t, --tui` | `-t` | Abre o Studio com abas internas e preview em tempo real | Ativo por padrão no terminal |
| `-w, --wizard` | `-w` | Abre o assistente interativo passo a passo | - |
| `-o, --output <arquivo>` | `-o` | Caminho do arquivo de saída (`.png`, `.svg`, `.txt`) | `(nenhum)` |
| `--style <estilo>` | | Estilo dos módulos: `squares`, `dots`, `rounded` | `squares` |
| `--transparent` | | Fundo transparente (sem fundo) | `false` |
| `--bg <cor>` | | Cor do fundo em hexadecimal (ex: `#ffffff`, `#18181b`) | `#ffffff` |
| `--color-dark <hex>` | | Cor dos módulos do QR code | `#000000` |
| `-s, --size <pixels>` | `-s` | Tamanho da imagem em pixels | `400` |
| `-e, --error <nível>` | `-e` | Nível de correção de erro: `L`, `M`, `Q`, `H` | `M` |
| `-m, --margin <número>` | `-m` | Margem em módulos (0 a 4) | `1` (terminal) / `4` (imagem) |
| `-q, --quiet` | `-q` | Não desenha no terminal (útil ao salvar arquivo) | `false` |
| `-h, --help` | `-h` | Exibe a mensagem de ajuda | |
| `-v, --version` | `-v` | Exibe a versão | |

---

## 🧪 Testes Automatizados

Para rodar os testes unitários e de integração:

```bash
npm test
```
