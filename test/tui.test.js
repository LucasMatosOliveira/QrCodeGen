import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { stripVTControlCharacters } from 'node:util';
import stringWidth from 'string-width';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';
import {
  createTuiState,
  renderTuiScreen,
  updatePreviewCache,
  handleKeyAction,
  handlePasteAction,
  handleMouseAction,
  saveCurrentFromTui,
  TUI_BACKGROUNDS,
  TUI_ERROR_LEVELS,
  TUI_FORMATS,
  TUI_MARGINS
} from '../src/tui.js';

function verifyCompactPreview(cachedPreview, content, errorCorrectionLevel, margin, lightColor = '#ffffff') {
  const qr = QRCode.create(content, { errorCorrectionLevel });
  const modules = qr.modules;
  const count = modules.size;
  const total = count + 2 * margin;
  const expectedRows = Math.ceil(total / 2);
  const opaque = Boolean(lightColor && lightColor !== 'transparent' && lightColor !== 'none');

  const lines = cachedPreview.split('\n');
  assert.equal(lines.length, expectedRows, `Preview compacto deve ter ${expectedRows} linhas`);

  for (let rIdx = 0; rIdx < expectedRows; rIdx++) {
    const cleanLine = stripVTControlCharacters(lines[rIdx]);
    assert.equal(cleanLine.length, total, `Linha compacta ${rIdx} deve ter largura ${total}`);
    for (let cIdx = 0; cIdx < total; cIdx++) {
      const char = cleanLine[cIdx];
      const rTop = -margin + 2 * rIdx;
      const rBottom = -margin + 2 * rIdx + 1;
      const c = -margin + cIdx;

      const topDark = rTop >= 0 && rTop < count && c >= 0 && c < count && modules.get(rTop, c) === 1;
      const bottomDark =
        2 * rIdx + 1 < total &&
        rBottom >= 0 &&
        rBottom < count &&
        c >= 0 &&
        c < count &&
        modules.get(rBottom, c) === 1;

      let expectedChar;
      if (topDark && bottomDark) expectedChar = '█';
      else if (topDark) expectedChar = '▀';
      else if (bottomDark) expectedChar = '▄';
      else if (opaque && 2 * rIdx + 1 >= total) expectedChar = '▀';
      else expectedChar = ' ';

      assert.equal(
        char,
        expectedChar,
        `Célula compacta divergente em linha ${rIdx}, col ${cIdx} (top: ${topDark}, bottom: ${bottomDark})`
      );
    }
  }
}

function verifyNormalPreview(cachedPreview, content, errorCorrectionLevel, margin, style = 'squares') {
  const qr = QRCode.create(content, { errorCorrectionLevel });
  const modules = qr.modules;
  const count = modules.size;
  const total = count + 2 * margin;

  const lines = cachedPreview.split('\n');
  assert.equal(lines.length, total, `Preview normal deve ter ${total} linhas`);

  const darkChar = style === 'dots' ? '● ' : style === 'rounded' ? '▢ ' : '██';
  const lightChar = '  ';

  for (let rIdx = 0; rIdx < total; rIdx++) {
    const cleanLine = stripVTControlCharacters(lines[rIdx]);
    assert.equal(cleanLine.length, 2 * total, `Linha normal ${rIdx} deve ter largura ${2 * total}`);
    for (let cIdx = 0; cIdx < total; cIdx++) {
      const cell = cleanLine.slice(cIdx * 2, cIdx * 2 + 2);
      const r = -margin + rIdx;
      const c = -margin + cIdx;
      const isDark = r >= 0 && r < count && c >= 0 && c < count && modules.get(r, c) === 1;
      const expected = isDark ? darkChar : lightChar;
      assert.equal(cell, expected, `Célula normal divergente em linha ${rIdx}, col ${cIdx}`);
    }
  }
}

function getStateSnapshot(s) {
  return {
    tabIndex: s.tabIndex,
    fieldIndex: s.fieldIndex,
    content: s.content,
    cursorPos: s.cursorPos,
    styleIndex: s.styleIndex,
    bgIndex: s.bgIndex,
    colorIndex: s.colorIndex,
    errorIndex: s.errorIndex,
    marginIndex: s.marginIndex,
    formatIndex: s.formatIndex,
    fileName: s.fileName,
    fileCursorPos: s.fileCursorPos
  };
}

test('TUI: limites de enquadramento exatos e sanitização em múltiplos tamanhos', () => {
  const sizes = [
    { cols: 0, rows: 0 },
    { cols: 30, rows: 8 },
    { cols: 65, rows: 18 },
    { cols: 70, rows: 20 },
    { cols: 80, rows: 24 },
    { cols: 120, rows: 40 }
  ];

  const contents = [
    'abc\nxyz',
    '🙂👍🏽',
    '漢字テスト',
    'e\u0301',
    'A'.repeat(200)
  ];

  for (const { cols, rows } of sizes) {
    for (const content of contents) {
      const state = createTuiState({ content });
      const screen = renderTuiScreen(state, cols, rows);

      if (cols === 0 || rows === 0) {
        assert.equal(screen, '');
        continue;
      }

      const lines = screen.split('\n');
      assert.equal(lines.length, rows, `Deve renderizar exatamente ${rows} linhas para ${cols}x${rows}`);

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const stripped = stripVTControlCharacters(line);
        const w = stringWidth(stripped);
        assert.equal(
          w,
          cols,
          `Linha ${i} deve ter largura visível ${cols} para terminal ${cols}x${rows} (obtido ${w})`
        );
      }

      if (cols < 70 || rows < 20) {
        assert.equal(/[▀▄█]/.test(screen), false, `Tela pequena ${cols}x${rows} não deve desenhar blocos de QR`);
      }
    }
  }
});

test('TUI: integridade do preview do QR Code, modos normal e compacto, transparência e corrida', async () => {
  const state = createTuiState({ content: 'https://github.com' });
  const errorLevel = TUI_ERROR_LEVELS[state.errorIndex].id;
  const margin = TUI_MARGINS[state.marginIndex].val;

  // 1. Área exata para normal (total=27 -> w=54, h=27)
  await updatePreviewCache(state, 54, 27);
  assert.equal(state.previewMode, 'normal');
  verifyNormalPreview(state.cachedPreview, 'https://github.com', errorLevel, margin, 'squares');

  // 2. Uma coluna a menos que normal -> recua para compacto
  await updatePreviewCache(state, 53, 27);
  assert.equal(state.previewMode, 'compact');
  verifyCompactPreview(state.cachedPreview, 'https://github.com', errorLevel, margin);

  // 3. Uma linha a menos que normal -> recua para compacto
  await updatePreviewCache(state, 54, 26);
  assert.equal(state.previewMode, 'compact');
  verifyCompactPreview(state.cachedPreview, 'https://github.com', errorLevel, margin);

  // 4. Área exata para compacto (total=27, compactRows=14 -> w=27, h=14)
  await updatePreviewCache(state, 27, 14);
  assert.equal(state.previewMode, 'compact');
  verifyCompactPreview(state.cachedPreview, 'https://github.com', errorLevel, margin);

  // 5. Uma coluna a menos que compacto -> indisponível com cachedPreview vazio
  await updatePreviewCache(state, 26, 14);
  assert.equal(state.previewMode, 'unavailable');
  assert.equal(state.cachedPreview, '');

  // 6. Uma linha a menos que compacto -> indisponível com cachedPreview vazio
  await updatePreviewCache(state, 27, 13);
  assert.equal(state.previewMode, 'unavailable');
  assert.equal(state.cachedPreview, '');

  // 7. Fundo transparente e cor azul em compacto: sem 48;2 e metade inferior usa 38;2;37;99;235m▄
  state.bgIndex = 0; // Transparente
  state.colorIndex = 1; // Azul (#2563eb)
  await updatePreviewCache(state, 27, 14);
  assert.equal(state.previewMode, 'compact');
  assert.equal(state.cachedPreview.includes('48;2'), false, 'Compacto transparente não deve conter background 48;2');
  assert.ok(
    state.cachedPreview.includes('\x1b[38;2;37;99;235m▄'),
    'Células inferiores escuras devem usar primeiro plano azul sobre ▄'
  );

  // 8. Conteúdo vazio -> 'empty', sem matriz e sem preview
  state.content = '';
  await updatePreviewCache(state, 54, 27);
  assert.equal(state.previewMode, 'empty');
  assert.equal(state.cachedMatrix, null);
  assert.equal(state.cachedPreview, '');

  // 9. Excesso de capacidade -> 'error' com cachedPreview vazio, e recuperação com texto curto
  state.content = 'a'.repeat(3000);
  state.errorIndex = 3; // H
  await updatePreviewCache(state, 100, 100);
  assert.equal(state.previewMode, 'error');
  assert.equal(state.cachedPreview, '');
  assert.ok(state.previewMessage.length > 0);

  state.content = 'curto';
  await updatePreviewCache(state, 100, 100);
  assert.equal(state.previewMode, 'normal');
  assert.ok(state.cachedPreview.length > 0);

  // 10. Última atualização prevalece sem corrida
  state.content = 'old';
  const p1 = updatePreviewCache(state, 100, 100);
  state.content = 'new';
  const p2 = updatePreviewCache(state, 40, 16);
  await Promise.all([p1, p2]);
  assert.equal(state.previewMode, 'compact');
  verifyCompactPreview(
    state.cachedPreview,
    'new',
    TUI_ERROR_LEVELS[state.errorIndex].id,
    TUI_MARGINS[state.marginIndex].val,
    TUI_BACKGROUNDS[state.bgIndex].color
  );
});

test('TUI: edição de texto, movimentação do cursor, grafemas e atalhos via handleKeyAction', () => {
  // 'abc' + left + 'X' -> 'abXc' cursor 3
  const state = createTuiState({ content: 'abc' });
  assert.equal(state.cursorPos, 3);
  handleKeyAction(state, undefined, { name: 'left' });
  assert.equal(state.cursorPos, 2);
  handleKeyAction(state, 'X', {});
  assert.equal(state.content, 'abXc');
  assert.equal(state.cursorPos, 3);

  // Backspace remove grafema inteiro composto '👍🏽'
  state.content = '👍🏽';
  state.cursorPos = state.content.length;
  handleKeyAction(state, undefined, { name: 'backspace' });
  assert.equal(state.content, '');
  assert.equal(state.cursorPos, 0);

  // Home / End / Delete
  state.content = 'abcdef';
  state.cursorPos = 3;
  handleKeyAction(state, undefined, { name: 'home' });
  assert.equal(state.cursorPos, 0);
  handleKeyAction(state, undefined, { name: 'delete' });
  assert.equal(state.content, 'bcdef');
  assert.equal(state.cursorPos, 0);
  handleKeyAction(state, undefined, { name: 'end' });
  assert.equal(state.cursorPos, state.content.length);

  // Texto longo com cursor no meio exibe caret em vídeo reverso (\x1b[7m) na linha 7 em 80x24
  const longContent = 'A'.repeat(100) + 'Z' + 'B'.repeat(99);
  state.content = longContent;
  state.cursorPos = 100; // posicionado sobre 'Z'
  state.tabIndex = 0;
  state.fieldIndex = 0;
  const screen = renderTuiScreen(state, 80, 24);
  const lines = screen.split('\n');
  const row7 = lines[7];
  assert.ok(
    row7.includes('\x1b[7mZ'),
    'Linha de valor do conteúdo (linha 7) deve conter o caret reverso e o caractere focado'
  );

  // Teclas 'S' e '1' dentro do campo de texto são inseridas como caracteres literais
  const lenBeforeS = state.content.length;
  const resS = handleKeyAction(state, 'S', {});
  assert.equal(resS, true);
  assert.equal(state.content.length, lenBeforeS + 1);

  const lenBefore1 = state.content.length;
  const res1 = handleKeyAction(state, '1', {});
  assert.equal(res1, true);
  assert.equal(state.content.length, lenBefore1 + 1);

  // Em campo de seleção, 'S' aciona salvar e '1' alterna de aba
  state.fieldIndex = 1; // errorIndex (seletor na aba 0)
  const resSave = handleKeyAction(state, 'S', {});
  assert.equal(resSave, 'save');

  state.tabIndex = 1; // aba Estilo
  state.fieldIndex = 0; // seletor Módulos
  const resTab = handleKeyAction(state, '1', {});
  assert.equal(resTab, true);
  assert.equal(state.tabIndex, 0); // retornou à aba Conteúdo
});

test('TUI: colagem segura via handlePasteAction em texto, seletores e nome de arquivo', () => {
  const state = createTuiState({ content: 'abc' });
  state.cursorPos = 1; // entre 'a' e 'b'

  // Colagem 'x\r4' no campo de conteúdo normaliza para 'x\n4' na posição do cursor
  const resPaste = handlePasteAction(state, 'x\r4');
  assert.equal(resPaste, true);
  assert.equal(state.content, 'ax\n4bc');
  assert.equal(state.cursorPos, 4);
  assert.equal(state.tabIndex, 0);
  assert.equal(state.fieldIndex, 0);

  // Colagem em seletor é ignorada sem alterar estado
  state.fieldIndex = 1;
  const contentBefore = state.content;
  const resPasteSel = handlePasteAction(state, 'ignorar');
  assert.equal(resPasteSel, false);
  assert.equal(state.content, contentBefore);

  // Colagem com quebra de linha no campo de nome de arquivo é rejeitada integralmente
  state.tabIndex = 3;
  state.fieldIndex = 1; // fileName
  const origFileName = state.fileName;
  const resPasteFile = handlePasteAction(state, 'teste\narquivo.png');
  assert.equal(resPasteFile, true);
  assert.equal(state.fileName, origFileName);
  assert.equal(state.statusType, 'error');
  assert.equal(state.statusMessage, 'Nome de arquivo inválido: use uma única linha.');
});

test('TUI: eventos de mouse em diferentes dimensões, cliques em abas, seletores, scroll e botão salvar', () => {
  const state = createTuiState({ content: 'https://github.com' });

  // 1. Cliques no centro das abas em 80x24 e 120x40
  for (const { cols, rows } of [{ cols: 80, rows: 24 }, { cols: 120, rows: 40 }]) {
    const screen = renderTuiScreen(state, cols, rows);
    const lines = screen.split('\n');
    const row2 = stripVTControlCharacters(lines[2]);

    const tab2Idx = row2.indexOf('[2 Estilo]');
    assert.ok(tab2Idx !== -1);
    const tab2CenterCol = tab2Idx + Math.floor('[2 Estilo]'.length / 2) + 1; // 1-based

    state.tabIndex = 0;
    const rClickTab2 = handleMouseAction(state, tab2CenterCol, 3, 0, false, { cols, rows });
    assert.equal(rClickTab2, true);
    assert.equal(state.tabIndex, 1);
    assert.equal(state.content, 'https://github.com');
  }

  // 2. Release, botão direito, movimento e cliques fora de controles não alteram o estado
  state.tabIndex = 1;
  state.fieldIndex = 0;
  const beforeSnapshot = getStateSnapshot(state);

  const rRel = handleMouseAction(state, 20, 3, 0, true, { cols: 80, rows: 24 });
  assert.equal(rRel, false);
  assert.deepEqual(getStateSnapshot(state), beforeSnapshot);

  const rRight = handleMouseAction(state, 20, 3, 2, false, { cols: 80, rows: 24 });
  assert.equal(rRight, false);
  assert.deepEqual(getStateSnapshot(state), beforeSnapshot);

  const rMotion = handleMouseAction(state, 20, 3, 32, false, { cols: 80, rows: 24 });
  assert.equal(rMotion, false);
  assert.deepEqual(getStateSnapshot(state), beforeSnapshot);

  const rBlank = handleMouseAction(state, 10, 19, 0, false, { cols: 80, rows: 24 });
  assert.equal(rBlank, false);
  assert.deepEqual(getStateSnapshot(state), beforeSnapshot);

  // 3. Clique nas metades esquerda e direita do seletor ciclam para trás e para frente
  state.tabIndex = 1;
  state.fieldIndex = 0; // seletor Módulos (squares, dots, rounded)
  state.styleIndex = 0;

  // Em 80x24: layout.leftWidth = 34; retângulo de valor na linha 8 (y=7, 1-based=8), x de 5 a 33
  const leftCol = 12;
  const rightCol = 26;

  handleMouseAction(state, leftCol, 8, 0, false, { cols: 80, rows: 24 });
  assert.equal(state.styleIndex, 2); // ciclou para trás

  handleMouseAction(state, rightCol, 8, 0, false, { cols: 80, rows: 24 });
  assert.equal(state.styleIndex, 0); // ciclou para frente

  // 4. Clique no rótulo apenas foca sem alterar a opção
  state.fieldIndex = 1; // focado em margem
  const labelCol = 5;
  const labelRow = 7; // rótulo de estilo na linha 7 (y=6, 1-based=7)
  handleMouseAction(state, labelCol, labelRow, 0, false, { cols: 80, rows: 24 });
  assert.equal(state.fieldIndex, 0); // focou estilo
  assert.equal(state.styleIndex, 0); // não ciclou

  // 5. Scroll wheel (64/65) sobre o seletor cicla apenas o seletor sob o cursor
  state.styleIndex = 0;
  state.marginIndex = 0;
  handleMouseAction(state, leftCol, 8, 65, false, { cols: 80, rows: 24 }); // wheel down (+1)
  assert.equal(state.styleIndex, 1);
  assert.equal(state.marginIndex, 0);

  handleMouseAction(state, leftCol, 8, 64, false, { cols: 80, rows: 24 }); // wheel up (-1)
  assert.equal(state.styleIndex, 0);
  assert.equal(state.marginIndex, 0);

  // 6. Clique no botão Salvar localizado a partir do frame renderizado
  state.tabIndex = 3;
  const screenTab3 = renderTuiScreen(state, 80, 24);
  const linesTab3 = screenTab3.split('\n');
  const saveRowIdx = linesTab3.findIndex((l) => stripVTControlCharacters(l).includes('[ Salvar arquivo'));
  assert.ok(saveRowIdx !== -1, 'Botão salvar deve ser visível na aba Exportar');

  const saveLine = stripVTControlCharacters(linesTab3[saveRowIdx]);
  const saveColIdx = saveLine.indexOf('[ Salvar arquivo');
  const btnCol = saveColIdx + 5; // centro do botão
  const btnRow = saveRowIdx + 1; // coordenada 1-based

  const rSave = handleMouseAction(state, btnCol, btnRow, 0, false, { cols: 80, rows: 24 });
  assert.equal(rSave, 'save');

  // 7. Tela pequena (65x18) ignora clique (no-op)
  const rSmall = handleMouseAction(state, btnCol, btnRow, 0, false, { cols: 65, rows: 18 });
  assert.equal(rSmall, false);
});

test('TUI: exportação e gravação de arquivos PNG, SVG e TXT com integridade e recuperação', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tui-export-test-'));

  try {
    const state = createTuiState({ content: 'https://exemplo.com' });
    const qr = QRCode.create(state.content, { errorCorrectionLevel: 'M' });
    const size = qr.modules.size;

    // 1. PNG transparente + dots + margem 2
    state.bgIndex = 0; // Transparente
    state.styleIndex = 1; // Dots
    state.marginIndex = 1; // Margem 2
    state.formatIndex = 0; // PNG
    const pngPath = path.join(tmpDir, 'dots.png');
    state.fileName = pngPath;

    await saveCurrentFromTui(state);
    assert.equal(state.statusType, 'success');

    const pngBuffer = await fs.readFile(pngPath);
    assert.equal(pngBuffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); // assinatura PNG
    const parsedPng = PNG.sync.read(pngBuffer);

    const expectedTotal = size + 4; // size + 2*margin
    const expectedScale = Math.floor(500 / expectedTotal);
    const expectedSide = expectedTotal * expectedScale;

    assert.equal(parsedPng.width, expectedSide);
    assert.equal(parsedPng.height, expectedSide);

    // Pixel do canto tem alpha 0 (fundo transparente)
    assert.equal(parsedPng.data[3], 0);

    // Pixel central de um módulo escuro corresponde à cor preta (#000000)
    let darkR = -1;
    let darkC = -1;
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (qr.modules.get(r, c) === 1) {
          darkR = r;
          darkC = c;
          break;
        }
      }
      if (darkR !== -1) break;
    }
    assert.ok(darkR !== -1);
    const darkPx = Math.floor((darkC + 2 + 0.5) * expectedScale);
    const darkPy = Math.floor((darkR + 2 + 0.5) * expectedScale);
    const darkIdx = (expectedSide * darkPy + darkPx) * 4;
    assert.equal(parsedPng.data[darkIdx], 0);
    assert.equal(parsedPng.data[darkIdx + 1], 0);
    assert.equal(parsedPng.data[darkIdx + 2], 0);
    assert.equal(parsedPng.data[darkIdx + 3], 255);

    // 2. SVG com caminho <tmp>/dir.v1/qr selecionado via handleKeyAction na aba de formato
    state.tabIndex = 3;
    state.fieldIndex = 0;
    handleKeyAction(state, undefined, { name: 'right' }); // alterna de PNG para SVG (index 1)
    assert.equal(state.formatIndex, 1);
    assert.equal(TUI_FORMATS[state.formatIndex].id, 'svg');

    const svgBasePath = path.join(tmpDir, 'dir.v1', 'qr');
    state.fileName = svgBasePath;
    state.marginIndex = 1; // margem 2

    await saveCurrentFromTui(state);
    assert.equal(state.statusType, 'success');

    const expectedSvgPath = path.join(tmpDir, 'dir.v1', 'qr.svg');
    const svgStat = await fs.stat(expectedSvgPath);
    assert.ok(svgStat.isFile());

    const svgContent = await fs.readFile(expectedSvgPath, 'utf8');
    assert.ok(svgContent.includes(`viewBox="0 0 ${expectedTotal} ${expectedTotal}"`));

    // 3. TXT quadrados com margem 2
    state.tabIndex = 3;
    state.fieldIndex = 0;
    handleKeyAction(state, undefined, { name: 'right' }); // alterna para TXT (index 2)
    assert.equal(state.formatIndex, 2);
    assert.equal(TUI_FORMATS[state.formatIndex].id, 'txt');

    state.styleIndex = 0; // squares
    state.marginIndex = 1; // margem 2
    const txtPath = path.join(tmpDir, 'qrcode.txt');
    state.fileName = txtPath;

    await saveCurrentFromTui(state);
    assert.equal(state.statusType, 'success');

    const txtContent = await fs.readFile(txtPath, 'utf8');
    assert.equal(txtContent.includes('\x1b'), false, 'TXT gravado não deve conter sequências ANSI');

    const rawTxt = txtContent.endsWith('\n') ? txtContent.slice(0, -1) : txtContent;
    const txtLines = rawTxt.split('\n');
    assert.equal(txtLines.length, expectedTotal, 'TXT deve ter exatamente size+4 linhas');

    for (let r = 0; r < expectedTotal; r++) {
      const line = txtLines[r];
      assert.equal(stringWidth(line), 2 * expectedTotal, 'Largura visível da linha de TXT deve ser 2*(size+4)');
      const mR = r - 2;
      for (let c = 0; c < expectedTotal; c++) {
        const cell = line.slice(c * 2, c * 2 + 2);
        const mC = c - 2;
        const isDark = mR >= 0 && mR < size && mC >= 0 && mC < size && qr.modules.get(mR, mC) === 1;
        assert.equal(cell, isDark ? '██' : '  ');
      }
    }

    // 4. Divergência de extensão x.png com formato SVG gera x.svg
    state.formatIndex = 1; // SVG
    const divPath = path.join(tmpDir, 'x.png');
    state.fileName = divPath;

    await saveCurrentFromTui(state);
    assert.equal(state.statusType, 'success');

    const expectedDivSvg = path.join(tmpDir, 'x.svg');
    assert.ok(await fs.stat(expectedDivSvg).then(() => true, () => false));
    assert.equal(await fs.stat(divPath).then(() => true, () => false), false);

    // 5. Conteúdo vazio gera erro e não cria arquivo
    state.content = '';
    const emptyPath = path.join(tmpDir, 'vazio.svg');
    state.fileName = emptyPath;

    await saveCurrentFromTui(state);
    assert.equal(state.statusType, 'error');
    assert.equal(await fs.stat(emptyPath).then(() => true, () => false), false);

    // 6. Erro de gravação em destino cujo intermediário é arquivo regular, e recuperação
    const blockerFile = path.join(tmpDir, 'arquivo-bloqueador');
    await fs.writeFile(blockerFile, 'conteudo simples');

    state.content = 'https://recupera.com';
    state.fileName = path.join(blockerFile, 'sub', 'saida.svg');

    await saveCurrentFromTui(state);
    assert.equal(state.statusType, 'error');
    assert.ok(state.statusMessage.startsWith('Erro ao salvar:'));

    // Pai imediato é arquivo: mkdir falha com EEXIST, mas isso não é sobrescrita do destino
    state.fileName = path.join(blockerFile, 'saida.svg');
    await saveCurrentFromTui(state);
    assert.equal(state.statusType, 'error');
    assert.equal(state.pendingOverwrite, null);
    assert.equal(await fs.readFile(blockerFile, 'utf8'), 'conteudo simples');

    // Corrige o nome no mesmo estado e salva com sucesso
    const fixedPath = path.join(tmpDir, 'recuperado.svg');
    state.fileName = fixedPath;

    await saveCurrentFromTui(state);
    assert.equal(state.statusType, 'success');
    assert.ok(await fs.stat(fixedPath).then(() => true, () => false));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('TUI: proteção de sobrescrita, cancelamento e concorrência no salvamento', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tui-overwrite-test-'));

  try {
    const targetFile = path.join(tmpDir, 'destino.png');
    const originalBytes = Buffer.from('BYTES_ORIGINAIS_PRESERVADOS');
    await fs.writeFile(targetFile, originalBytes);

    const state = createTuiState({ content: 'https://exemplo.com' });
    state.fileName = targetFile;
    state.formatIndex = 0; // PNG

    // 1. Primeira tentativa não sobrescreve e define pendingOverwrite
    await saveCurrentFromTui(state);
    const bytesAfter1 = await fs.readFile(targetFile);
    assert.deepEqual(bytesAfter1, originalBytes);
    assert.ok(state.pendingOverwrite !== null, 'pendingOverwrite deve estar ativo');
    assert.equal(state.pendingOverwrite.path, path.resolve(targetFile));

    // 2. Escape cancela a sobrescrita e preserva os bytes
    const rEsc = handleKeyAction(state, undefined, { name: 'escape' });
    assert.equal(rEsc, 'cancel-overwrite');
    assert.equal(state.pendingOverwrite, null);
    const bytesAfterEsc = await fs.readFile(targetFile);
    assert.deepEqual(bytesAfterEsc, originalBytes);

    // 3. Nova tentativa seguida de confirmação substitui o arquivo com PNG válido
    await saveCurrentFromTui(state);
    assert.ok(state.pendingOverwrite !== null);

    await saveCurrentFromTui(state, { overwrite: true });
    assert.equal(state.statusType, 'success');
    assert.equal(state.pendingOverwrite, null);

    const bytesReplaced = await fs.readFile(targetFile);
    assert.notDeepEqual(bytesReplaced, originalBytes);
    assert.equal(bytesReplaced.subarray(0, 8).toString('hex'), '89504e470d0a1a0a'); // cabeçalho PNG

    // 4. Duas chamadas simultâneas a saveCurrentFromTui executam apenas uma gravação
    const concurrentPath = path.join(tmpDir, 'concorrente.png');
    state.fileName = concurrentPath;
    state.statusType = 'info';

    await Promise.all([
      saveCurrentFromTui(state),
      saveCurrentFromTui(state)
    ]);

    assert.equal(state.pendingOverwrite, null);
    assert.equal(state.statusType, 'success');
    const statConcurrent = await fs.stat(concurrentPath);
    assert.ok(statConcurrent.size > 0);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});
