import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import QRCode from 'qrcode';
import {
  generateTerminal,
  renderTerminalMatrix,
  saveToFile,
  renderStyledSvg,
  renderStyledPng,
  normalizeErrorLevel,
  normalizeStyle,
  hexToRgba
} from '../src/generator.js';

test('normalizeErrorLevel valida níveis corretamente', () => {
  assert.equal(normalizeErrorLevel('l'), 'L');
  assert.equal(normalizeErrorLevel('M'), 'M');
  assert.equal(normalizeErrorLevel('q'), 'Q');
  assert.equal(normalizeErrorLevel('H'), 'H');
  assert.equal(normalizeErrorLevel(undefined), 'M');

  assert.throws(() => normalizeErrorLevel('X'), /Nível de correção inválido/);
});

test('normalizeStyle valida estilos corretamente', () => {
  assert.equal(normalizeStyle('squares'), 'squares');
  assert.equal(normalizeStyle('DOTS'), 'dots');
  assert.equal(normalizeStyle('rounded'), 'rounded');
  assert.equal(normalizeStyle(undefined), 'squares');

  assert.throws(() => normalizeStyle('invalid-style'), /Estilo inválido/);
});

test('hexToRgba converte cores e transparência', () => {
  assert.deepEqual(hexToRgba('transparent'), [0, 0, 0, 0]);
  assert.deepEqual(hexToRgba(null), [0, 0, 0, 0]);
  assert.deepEqual(hexToRgba('#000000'), [0, 0, 0, 255]);
  assert.deepEqual(hexToRgba('#ffffff'), [255, 255, 255, 255]);
  assert.deepEqual(hexToRgba('#fff'), [255, 255, 255, 255]);
});

test('generateTerminal produz string padrão e com estilo dots', async () => {
  const qrDefault = await generateTerminal('https://example.com');
  assert.ok(typeof qrDefault === 'string');
  assert.ok(qrDefault.length > 50);

  const qrDots = await generateTerminal('https://example.com', { style: 'dots' });
  assert.ok(qrDots.includes('●'));
});

test('generateTerminal aplica cores ANSI de primeiro plano e fundo no terminal', async () => {
  const qrColored = await generateTerminal('https://example.com', {
    style: 'dots',
    darkColor: '#2563eb', // RGB 37, 99, 235
    lightColor: '#ffffff' // RGB 255, 255, 255
  });
  assert.ok(qrColored.includes('\x1b[38;2;37;99;235m'));
  assert.ok(qrColored.includes('\x1b[48;2;255;255;255m'));
});

test('renderStyledSvg gera SVG com estilos e fundo transparente', () => {
  // Squares com fundo transparente
  const svgSquares = renderStyledSvg('https://example.com', {
    style: 'squares',
    lightColor: 'transparent'
  });
  assert.ok(svgSquares.includes('<svg'));
  assert.ok(svgSquares.includes('<rect'));
  // Não deve ter rect de 100% de fundo
  assert.ok(!svgSquares.includes('fill="transparent"'));

  // Dots com fundo branco
  const svgDots = renderStyledSvg('https://example.com', {
    style: 'dots',
    lightColor: '#ffffff',
    darkColor: '#2563eb'
  });
  assert.ok(svgDots.includes('<circle'));
  assert.ok(svgDots.includes('fill="#2563eb"'));

  // Rounded
  const svgRounded = renderStyledSvg('https://example.com', {
    style: 'rounded'
  });
  assert.ok(svgRounded.includes('rx="0.25"'));
});

test('renderStyledPng gera PNG com estilos dots, rounded e fundo transparente', () => {
  const bufDots = renderStyledPng('https://example.com', {
    style: 'dots',
    lightColor: 'transparent'
  });
  assert.ok(Buffer.isBuffer(bufDots));
  assert.ok(bufDots.length > 500);

  const bufRounded = renderStyledPng('https://example.com', {
    style: 'rounded',
    lightColor: '#ffffff',
    darkColor: '#7c3aed'
  });
  assert.ok(Buffer.isBuffer(bufRounded));
  assert.ok(bufRounded.length > 500);
});

test('saveToFile exporta arquivo PNG válido com estilo dots e transparência', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qr-test-'));
  const pngPath = path.join(tmpDir, 'test-dots.png');

  try {
    const res = await saveToFile('https://example.com', pngPath, {
      style: 'dots',
      width: 300,
      lightColor: 'transparent'
    });
    assert.equal(res.format, 'png');
    assert.ok(res.size > 100);

    const stat = await fs.stat(pngPath);
    assert.ok(stat.isFile());
    assert.equal(stat.size, res.size);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('saveToFile exporta arquivo SVG válido com estilo rounded', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qr-test-'));
  const svgPath = path.join(tmpDir, 'test-rounded.svg');

  try {
    const res = await saveToFile('https://example.com', svgPath, {
      style: 'rounded',
      darkColor: '#16a34a'
    });
    assert.equal(res.format, 'svg');
    assert.ok(res.size > 100);

    const content = await fs.readFile(svgPath, 'utf8');
    assert.ok(content.includes('<svg'));
    assert.ok(content.includes('rx="0.25"'));
    assert.ok(content.includes('#16a34a'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('saveToFile exporta arquivo TXT com fidelidade para squares, dots e rounded', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qr-test-txt-'));
  const text = 'https://example.com';
  const margin = 2;
  const qr = QRCode.create(text, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  const expectedLineCount = size + 2 * margin;
  const expectedLineWidth = 2 * expectedLineCount;

  const styleDarkMap = {
    squares: '██',
    dots: '● ',
    rounded: '▢ '
  };

  try {
    for (const style of ['squares', 'dots', 'rounded']) {
      const txtPath = path.join(tmpDir, `test-${style}.txt`);
      const res = await saveToFile(text, txtPath, {
        style,
        margin,
        errorCorrectionLevel: 'M'
      });
      assert.equal(res.format, 'txt');

      const content = await fs.readFile(txtPath, 'utf8');
      assert.ok(!content.includes('\x1b'), `TXT ${style} não deve conter sequências ANSI`);

      const rawLines = content.split('\n');
      const lines = rawLines[rawLines.length - 1] === '' ? rawLines.slice(0, -1) : rawLines;
      assert.equal(lines.length, expectedLineCount);

      const darkChar = styleDarkMap[style];
      const lightChar = '  ';

      for (let r = 0; r < expectedLineCount; r++) {
        const line = lines[r];
        assert.equal(line.length, expectedLineWidth);

        const qrRow = r - margin;
        for (let c = 0; c < expectedLineCount; c++) {
          const qrCol = c - margin;
          const cell = line.slice(c * 2, c * 2 + 2);
          const isDarkModule = qrRow >= 0 && qrRow < size && qrCol >= 0 && qrCol < size
            && qr.modules.get(qrRow, qrCol) === 1;

          if (isDarkModule) {
            assert.equal(cell, darkChar, `Módulo escuro em (${qrRow}, ${qrCol}) deve ser "${darkChar}"`);
          } else {
            assert.equal(cell, lightChar, `Módulo claro/margem em (${qrRow}, ${qrCol}) deve ser "${lightChar}"`);
          }
        }
      }
    }
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('saveToFile lança erro para extensão inválida e não cria diretórios intermediários', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qr-test-'));
  const invalidPath = path.join(tmpDir, 'novo', 'sub', 'test.pdf');
  const novoDir = path.join(tmpDir, 'novo');

  try {
    await assert.rejects(
      async () => saveToFile('https://example.com', invalidPath),
      /Formato de arquivo não suportado: "\.pdf"/
    );

    await assert.rejects(
      async () => fs.stat(novoDir),
      { code: 'ENOENT' }
    );
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('saveToFile com overwrite:false rejeita arquivo existente com EEXIST e preserva bytes', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qr-test-overwrite-'));
  const targetPath = path.join(tmpDir, 'existing.png');
  const initialBytes = Buffer.from('CONTEUDO_INICIAL_PRESERVADO');

  try {
    await fs.writeFile(targetPath, initialBytes);

    await assert.rejects(
      async () => saveToFile('https://example.com', targetPath, { overwrite: false }),
      (err) => {
        assert.equal(err.code, 'EEXIST');
        return true;
      }
    );

    const preserved = await fs.readFile(targetPath);
    assert.deepEqual(preserved, initialBytes);

    const res = await saveToFile('https://example.com', targetPath);
    assert.equal(res.format, 'png');
    const replaced = await fs.readFile(targetPath);
    assert.notDeepEqual(replaced, initialBytes);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('renderTerminalMatrix possui paridade de comportamento com caminho colorido de generateTerminal', async () => {
  const text = 'https://example.com';
  const options = {
    style: 'dots',
    darkColor: '#2563eb',
    margin: 2,
    errorCorrectionLevel: 'H'
  };
  const qr = QRCode.create(text, { errorCorrectionLevel: 'H' });
  const fromMatrix = renderTerminalMatrix(qr.modules, options);
  const fromGen = await generateTerminal(text, options);
  assert.equal(fromMatrix, fromGen);
});
