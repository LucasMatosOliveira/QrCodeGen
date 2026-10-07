import {
  intro,
  outro,
  text,
  select,
  isCancel,
  cancel,
  spinner,
  note
} from '@clack/prompts';
import pc from 'picocolors';
import { generateTerminal, saveToFile } from './generator.js';

function checkCancel(value) {
  if (isCancel(value)) {
    cancel('Operação cancelada pelo usuário.');
    process.exit(0);
  }
}

function isValidHex(hex) {
  return /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(hex.trim());
}

function formatHex(hex) {
  const clean = hex.trim();
  return clean.startsWith('#') ? clean : `#${clean}`;
}

const COLOR_OPTIONS = [
  { value: '#000000', label: '⚫ Preto clássico (#000000)' },
  { value: '#2563eb', label: '🔵 Azul (#2563eb)' },
  { value: '#7c3aed', label: '🟣 Roxo (#7c3aed)' },
  { value: '#16a34a', label: '🟢 Verde (#16a34a)' },
  { value: '#dc2626', label: '🔴 Vermelho (#dc2626)' },
  { value: '#ea580c', label: '🟠 Laranja (#ea580c)' },
  { value: '#ffffff', label: '⚪ Branco (#ffffff)' },
  { value: 'custom', label: '🎨 Cor personalizada (HEX)' }
];

/**
 * Executa o fluxo interativo com preview em tempo real no terminal.
 * @param {object} [initialOptions={}]
 */
export async function runInteractive(initialOptions = {}) {
  console.clear();
  intro(pc.bgCyan(pc.black(' 📱 GERADOR DE QR CODE INTERATIVO ')));

  // 1. Entrada de Conteúdo
  let content = initialOptions.content;
  if (!content) {
    const inputContent = await text({
      message: 'Digite o link ou texto para o QR Code:',
      placeholder: 'https://exemplo.com.br ou qualquer mensagem',
      validate: (val) => {
        if (!val || !val.trim()) return 'Por favor, digite um link ou texto válido.';
      }
    });
    checkCancel(inputContent);
    content = inputContent.trim();
  }

  // 2. Estilo inicial dos módulos
  let style = await select({
    message: 'Escolha o estilo visual do QR Code:',
    initialValue: 'squares',
    options: [
      { value: 'squares', label: '⬛ Quadrados clássicos', hint: 'Padrão tradicional' },
      { value: 'dots', label: '🔘 Bolinhas / Pontos', hint: 'Módulos circulares modernos' },
      { value: 'rounded', label: '🔲 Cantos arredondados', hint: 'Design suave' }
    ]
  });
  checkCancel(style);

  // 3. Configuração de Fundo
  let lightColor = '#ffffff';
  let hasBackground = true;

  async function promptBackground() {
    const bgChoice = await select({
      message: 'Configuração do fundo (background):',
      initialValue: hasBackground ? (lightColor === '#18181b' ? 'dark' : (lightColor === 'transparent' ? 'transparent' : 'white')) : 'white',
      options: [
        { value: 'transparent', label: '🚫 Sem fundo (Transparente)', hint: 'Usa o fundo natural do terminal/design' },
        { value: 'white', label: '⚪ Fundo branco padrão (#ffffff)', hint: 'Contraste clássico' },
        { value: 'dark', label: '⚫ Fundo escuro (#18181b)', hint: 'Ideal para temas escuros' },
        { value: 'custom', label: '🎨 Cor de fundo personalizada (HEX)', hint: 'Digitar código hex' }
      ]
    });
    checkCancel(bgChoice);

    if (bgChoice === 'transparent') {
      hasBackground = false;
      lightColor = 'transparent';
    } else if (bgChoice === 'white') {
      hasBackground = true;
      lightColor = '#ffffff';
    } else if (bgChoice === 'dark') {
      hasBackground = true;
      lightColor = '#18181b';
    } else if (bgChoice === 'custom') {
      const customBg = await text({
        message: 'Digite o código HEX para o fundo (ex: #f0fdf4):',
        placeholder: '#ffffff',
        validate: (v) => {
          if (!isValidHex(v)) return 'Código HEX inválido. Use formato #RGB ou #RRGGBB.';
        }
      });
      checkCancel(customBg);
      hasBackground = true;
      lightColor = formatHex(customBg);
    }
  }

  await promptBackground();

  // 4. Cor dos módulos
  let darkColor = lightColor === '#18181b' ? '#ffffff' : '#000000';

  async function promptColor() {
    const colorChoice = await select({
      message: 'Cor principal dos módulos do QR Code:',
      initialValue: darkColor,
      options: COLOR_OPTIONS
    });
    checkCancel(colorChoice);

    if (colorChoice === 'custom') {
      const customFg = await text({
        message: 'Digite o código HEX da cor dos módulos (ex: #2563eb):',
        placeholder: '#000000',
        validate: (v) => {
          if (!isValidHex(v)) return 'Código HEX inválido. Use formato #RGB ou #RRGGBB.';
        }
      });
      checkCancel(customFg);
      darkColor = formatHex(customFg);
    } else {
      darkColor = colorChoice;
    }
  }

  await promptColor();

  // 5. Loop de Preview no Terminal: Permite ver e ajustar estilo/fundo/cor até ficar satisfeito!
  let configuring = true;
  while (configuring) {
    // Gera o preview no terminal refletindo exatamente o estilo e fundo escolhidos
    const previewQr = await generateTerminal(content, {
      style,
      darkColor,
      lightColor: hasBackground ? lightColor : 'transparent',
      margin: 1
    });

    console.log(`\n${pc.cyan(pc.bold('┌────────────────────────────────────────────────────────┐'))}`);
    console.log(`${pc.cyan(pc.bold('│'))}  ${pc.bold('👁️  PREVIEW DO SEU QR CODE NO TERMINAL')}                ${pc.cyan(pc.bold('│'))}`);
    console.log(`${pc.cyan(pc.bold('│'))}  ${pc.dim('Estilo:')} ${pc.bold(style.toUpperCase())}  ${pc.dim('Fundo:')} ${pc.bold(hasBackground ? lightColor : 'Transparente')}  ${pc.dim('Cor:')} ${pc.bold(darkColor)}  ${pc.cyan(pc.bold('│'))}`);
    console.log(`${pc.cyan(pc.bold('└────────────────────────────────────────────────────────┘'))}\n`);
    console.log(`${previewQr}\n`);

    const action = await select({
      message: 'O que deseja fazer com este QR Code?',
      initialValue: 'save',
      options: [
        { value: 'save', label: '✅ Está ótimo! Escolher formato e salvar', hint: 'Avançar para salvar ou exportar' },
        { value: 'change_style', label: '🔄 Alterar estilo dos módulos', hint: `Atual: ${style}` },
        { value: 'change_bg', label: '🎨 Alterar fundo (transparência / cor)', hint: `Atual: ${hasBackground ? lightColor : 'transparente'}` },
        { value: 'change_color', label: '🖌️ Alterar cor dos módulos', hint: `Atual: ${darkColor}` }
      ]
    });
    checkCancel(action);

    if (action === 'save') {
      configuring = false;
    } else if (action === 'change_style') {
      const newStyle = await select({
        message: 'Escolha o novo estilo dos módulos:',
        initialValue: style,
        options: [
          { value: 'squares', label: '⬛ Quadrados clássicos' },
          { value: 'dots', label: '🔘 Bolinhas / Pontos' },
          { value: 'rounded', label: '🔲 Cantos arredondados' }
        ]
      });
      checkCancel(newStyle);
      style = newStyle;
    } else if (action === 'change_bg') {
      await promptBackground();
    } else if (action === 'change_color') {
      await promptColor();
    }
  }

  // 6. Escolha do formato de salvamento (todas as opções já tiveram o preview exibido!)
  const destination = await select({
    message: 'Como deseja salvar o arquivo?',
    initialValue: 'png',
    options: [
      { value: 'png', label: '🖼️ Salvar como imagem PNG', hint: 'Suporta fundo transparente ou cores' },
      { value: 'svg', label: '📐 Salvar como vetor SVG', hint: 'Escalável em qualquer resolução' },
      { value: 'txt', label: '📄 Salvar como arquivo TXT', hint: 'Texto puro com caracteres UTF-8' },
      { value: 'terminal_only', label: '📺 Concluir apenas no terminal', hint: 'Sem salvar em disco' }
    ]
  });
  checkCancel(destination);

  let fileResult = null;
  if (destination !== 'terminal_only') {
    const defaultFileName = `qrcode.${destination}`;
    const fileInput = await text({
      message: 'Nome do arquivo de saída:',
      initialValue: defaultFileName,
      validate: (v) => {
        if (!v || !v.trim()) return 'Por favor, informe o nome do arquivo.';
      }
    });
    checkCancel(fileInput);
    const outputPath = fileInput.trim();

    const errorLevel = await select({
      message: 'Nível de correção de erro:',
      initialValue: 'M',
      options: [
        { value: 'M', label: 'Médio - M (~15% de recuperação)', hint: 'Recomendado' },
        { value: 'L', label: 'Baixo - L (~7% de recuperação)', hint: 'Menor densidade' },
        { value: 'Q', label: 'Alto - Q (~25% de recuperação)', hint: 'Mais redundância' },
        { value: 'H', label: 'Máximo - H (~30% de recuperação)', hint: 'Máxima tolerância' }
      ]
    });
    checkCancel(errorLevel);

    const s = spinner();
    s.start('Salvando arquivo...');

    fileResult = await saveToFile(content, outputPath, {
      style,
      width: 500,
      margin: 4,
      errorCorrectionLevel: errorLevel,
      darkColor,
      lightColor: hasBackground ? lightColor : 'transparent'
    });

    s.stop('Arquivo salvo com sucesso!');
  }

  // 7. Resumo final
  const summaryLines = [
    `${pc.bold('Conteúdo:')} ${content}`,
    `${pc.bold('Estilo:')} ${style.toUpperCase()}`,
    `${pc.bold('Fundo:')} ${hasBackground ? lightColor : 'Transparente (sem fundo)'}`,
    `${pc.bold('Cor:')} ${darkColor}`
  ];

  if (fileResult) {
    const sizeKb = (fileResult.size / 1024).toFixed(1);
    summaryLines.push(
      `${pc.bold('Arquivo salvo:')} ${fileResult.path} (${fileResult.format.toUpperCase()} - ${fileResult.size} bytes / ~${sizeKb} KB)`
    );
  }

  note(summaryLines.join('\n'), 'Resumo da Geração');
  outro(pc.green('Concluído com sucesso! 🎉'));
}
