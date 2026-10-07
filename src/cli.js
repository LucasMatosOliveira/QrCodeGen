import { parseArgs } from 'node:util';
import { generateTerminal, saveToFile } from './generator.js';
import { runInteractive } from './interactive.js';
import { runTUI } from './tui.js';

const VERSION = '1.0.0';

const HELP_TEXT = `
\x1b[1m\x1b[36mQR Code Studio CLI\x1b[0m v${VERSION}
Interface moderna com abas internas, preview em tempo real e exportação.

\x1b[1mUSO:\x1b[0m
  qr                      Abre o Studio TUI interativo com abas e live preview
  qr --wizard             Abre o assistente guiado passo a passo
  qr [conteúdo] [opções]  Geração rápida direta via linha de comando
  echo "texto" | qr       Entrada via pipe

\x1b[1mARGUMENTOS:\x1b[0m
  [conteúdo]              Link (URL) ou texto para codificar no QR Code

\x1b[1mOPÇÕES DE INTERFACE:\x1b[0m
  -t, --tui               Abre o Studio com divisão de abas internas e preview
  -w, --wizard            Abre o assistente guiado por perguntas
  -i, --interactive       Sinônimo para --tui

\x1b[1mOPÇÕES DE EXPORTAÇÃO E ESTILO:\x1b[0m
  -o, --output <arquivo>  Salva o QR code em arquivo (.png, .svg, .txt)
  --style <estilo>        Estilo dos módulos: squares, dots, rounded [padrão: squares]
  --transparent           Gera arquivo com fundo transparente (sem fundo)
  --bg <cor>              Cor de fundo em hexadecimal (ex: #ffffff, #18181b)
  -s, --size <pixels>     Tamanho da imagem em pixels (padrão: 400)
  -e, --error <nível>     Nível de correção de erro: L, M, Q, H [padrão: M]
  -m, --margin <número>   Margem / zona de respiro em módulos (padrão: 1 terminal, 4 imagem)
  -b, --big               Renderiza blocos grandes no terminal
  --invert                Inverte as cores no terminal
  -q, --quiet             Não exibe o QR code no terminal ao salvar em arquivo
      --color-dark <hex>  Cor dos módulos escuros (padrão: #000000)
      --color-light <hex> Cor do fundo (padrão: #ffffff)
  -h, --help              Exibe esta mensagem de ajuda
  -v, --version           Exibe a versão do programa

\x1b[1mEXEMPLOS:\x1b[0m
  \x1b[90m# Abrir o Studio interativo com abas e preview instantâneo:\x1b[0m
  qr

  \x1b[90m# Abrir o Studio já com um link pré-preenchido:\x1b[0m
  qr "https://meusite.com" --tui

  \x1b[90m# Gerar rápido no terminal com estilo de bolinhas (dots):\x1b[0m
  qr "https://google.com" --style dots

  \x1b[90m# Salvar PNG com bolinhas e fundo transparente:\x1b[0m
  qr "https://google.com" -o qr.png --style dots --transparent

  \x1b[90m# Entrada via pipe:\x1b[0m
  echo "Texto via pipe" | qr
`;

/**
 * Lê todo o conteúdo da entrada padrão (stdin).
 * @returns {Promise<string>}
 */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
}

/**
 * Ponto de entrada da CLI.
 * @param {string[]} rawArgs
 */
export async function run(rawArgs = []) {
  const optionsConfig = {
    tui: { type: 'boolean', short: 't', default: false },
    wizard: { type: 'boolean', short: 'w', default: false },
    interactive: { type: 'boolean', short: 'i', default: false },
    output: { type: 'string', short: 'o' },
    style: { type: 'string' },
    transparent: { type: 'boolean', default: false },
    bg: { type: 'string' },
    size: { type: 'string', short: 's' },
    error: { type: 'string', short: 'e' },
    margin: { type: 'string', short: 'm' },
    big: { type: 'boolean', short: 'b', default: false },
    invert: { type: 'boolean', default: false },
    quiet: { type: 'boolean', short: 'q', default: false },
    'color-dark': { type: 'string' },
    'color-light': { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
    version: { type: 'boolean', short: 'v', default: false }
  };

  let parsed;
  try {
    parsed = parseArgs({
      args: rawArgs,
      options: optionsConfig,
      allowPositionals: true
    });
  } catch (err) {
    console.error(`\x1b[31mErro de argumento:\x1b[0m ${err.message}`);
    console.error(`Execute \x1b[36mqr --help\x1b[0m para ver as opções disponíveis.`);
    process.exitCode = 1;
    return;
  }

  const { values, positionals } = parsed;

  if (values.help) {
    console.log(HELP_TEXT);
    return;
  }

  if (values.version) {
    console.log(`v${VERSION}`);
    return;
  }

  const initialContent = positionals.length > 0 ? positionals.join(' ').trim() : '';

  // Se o usuário solicitou o assistente guiado
  if (values.wizard) {
    await runInteractive({ content: initialContent });
    return;
  }

  // Se o usuário solicitou a TUI explicitamente
  if (values.tui || values.interactive) {
    await runTUI({ content: initialContent || 'https://github.com' });
    return;
  }

  // 1. Determina o conteúdo de entrada
  let content = '';

  if (positionals.length > 0) {
    content = positionals.join(' ').trim();
  } else if (!process.stdin.isTTY) {
    // Pipe / stdin redirecionado
    content = (await readStdin()).trim();
  } else {
    // Terminal interativo sem argumentos -> Abre o Studio TUI com abas e live preview!
    await runTUI({ content: 'https://github.com' });
    return;
  }

  if (!content) {
    console.error(`\x1b[33mNenhum link ou texto informado. Operação cancelada.\x1b[0m`);
    process.exitCode = 1;
    return;
  }

  const style = values.style || 'squares';
  const errorLevel = values.error ? values.error.toUpperCase() : 'M';
  const marginParam = values.margin !== undefined ? Number(values.margin) : undefined;
  const imageSize = values.size !== undefined ? Number(values.size) : 400;

  if (values.size !== undefined && (isNaN(imageSize) || imageSize <= 0)) {
    throw new Error('A opção --size deve ser um número positivo maior que zero.');
  }

  if (values.margin !== undefined && (isNaN(marginParam) || marginParam < 0)) {
    throw new Error('A opção --margin deve ser um número inteiro maior ou igual a zero.');
  }

  // Determina cor de fundo (transparente ou hex)
  let lightColor = values['color-light'] || values.bg || '#ffffff';
  if (values.transparent) {
    lightColor = 'transparent';
  }
  const darkColor = values['color-dark'] || '#000000';

  // 2. Se a opção de salvar em arquivo foi definida
  if (values.output) {
    const fileResult = await saveToFile(content, values.output, {
      style,
      width: imageSize,
      margin: marginParam ?? 4,
      errorCorrectionLevel: errorLevel,
      darkColor,
      lightColor
    });

    const sizeKb = (fileResult.size / 1024).toFixed(1);
    console.log(`\n\x1b[32m✔ QR Code salvo com sucesso!\x1b[0m`);
    console.log(`  \x1b[1mArquivo:\x1b[0m ${fileResult.path}`);
    console.log(`  \x1b[1mFormato:\x1b[0m ${fileResult.format.toUpperCase()} (${fileResult.size} bytes / ~${sizeKb} KB)`);
    console.log(`  \x1b[1mEstilo:\x1b[0m ${style}`);
    console.log(`  \x1b[1mFundo:\x1b[0m ${values.transparent ? 'Transparente' : lightColor}`);
  }

  // 3. Renderiza no terminal (a menos que --quiet esteja ativo)
  if (!values.quiet) {
    const terminalQr = await generateTerminal(content, {
      style,
      small: !values.big,
      inverse: values.invert,
      errorCorrectionLevel: errorLevel,
      darkColor,
      lightColor: values.transparent ? 'transparent' : (values['color-light'] || values.bg || null),
      margin: marginParam !== undefined ? marginParam : (!values.big ? 1 : 2)
    });

    console.log(`\n${terminalQr}\n`);

    const preview = content.length > 60 ? `${content.slice(0, 57)}...` : content;
    console.log(`\x1b[90mConteúdo:\x1b[0m \x1b[1m${preview}\x1b[0m`);
    console.log(`\x1b[90mEstilo:\x1b[0m ${style} | \x1b[90mCorreção:\x1b[0m Nível ${errorLevel}`);
  }
}
