import fs from 'node:fs/promises';
import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import QRCode from 'qrcode';
import { PNG } from 'pngjs';

export const VALID_ERROR_LEVELS = ['L', 'M', 'Q', 'H'];
export const VALID_STYLES = ['squares', 'dots', 'rounded'];

/**
 * Valida e normaliza o estilo do QR code.
 * @param {string} [style='squares']
 * @returns {'squares' | 'dots' | 'rounded'}
 */
export function normalizeStyle(style) {
  if (!style) return 'squares';
  const lower = String(style).trim().toLowerCase();
  if (!VALID_STYLES.includes(lower)) {
    throw new Error(
      `Estilo inválido: "${style}". Estilos disponíveis: squares, dots, rounded.`
    );
  }
  return lower;
}

/**
 * Valida e normaliza o nível de correção de erro.
 * @param {string} [level='M']
 * @returns {'L' | 'M' | 'Q' | 'H'}
 */
export function normalizeErrorLevel(level) {
  if (!level) return 'M';
  const upper = String(level).trim().toUpperCase();
  if (!VALID_ERROR_LEVELS.includes(upper)) {
    throw new Error(
      `Nível de correção inválido: "${level}". Use L (~7%), M (~15%), Q (~25%) ou H (~30%).`
    );
  }
  return upper;
}

/**
 * Converte cor hex (#RGB, #RRGGBB, #RRGGBBAA) para array [r, g, b, a].
 * Retorna [0, 0, 0, 0] se for nulo ou 'transparent'.
 * @param {string|null} hex
 * @returns {[number, number, number, number]}
 */
export function hexToRgba(hex) {
  if (!hex || hex === 'transparent' || hex === 'none') {
    return [0, 0, 0, 0];
  }
  let clean = String(hex).replace('#', '').trim();
  if (clean.length === 3) {
    clean = clean.split('').map((c) => c + c).join('') + 'ff';
  } else if (clean.length === 6) {
    clean += 'ff';
  } else if (clean.length !== 8) {
    return [0, 0, 0, 255];
  }
  const num = parseInt(clean, 16);
  if (isNaN(num)) return [0, 0, 0, 255];
  return [
    (num >> 24) & 255,
    (num >> 16) & 255,
    (num >> 8) & 255,
    num & 255
  ];
}

/**
 * Converte cor hex para código ANSI RGB (24-bit truecolor).
 * @param {string} hex
 * @param {boolean} [isBackground=false]
 * @returns {string}
 */
export function hexToAnsi(hex, isBackground = false) {
  const [r, g, b, a] = hexToRgba(hex);
  if (a === 0) return '';
  const type = isBackground ? 48 : 38;
  return `\x1b[${type};2;${r};${g};${b}m`;
}

/**
 * Gera a string do QR Code para exibição no terminal com suporte completo
 * a estilos (squares, dots, rounded), cores de módulos e cor/transparência de fundo.
 * @param {string} text
 * @param {object} [options={}]
 * @returns {Promise<string>}
 */
export async function generateTerminal(text, options = {}) {
  const {
    style = 'squares',
    small = true,
    inverse = false,
    errorCorrectionLevel = 'M',
    margin = 1,
    darkColor = null,
    lightColor = null
  } = options;

  const validStyle = normalizeStyle(style);
  const validLevel = normalizeErrorLevel(errorCorrectionLevel);

  // Se for estilo padrão squares, sem cor customizada de fundo ou módulo e modo small
  // usa o gerador nativo do qrcode para máxima compatibilidade
  if (
    validStyle === 'squares' &&
    !darkColor &&
    (!lightColor || lightColor === 'transparent') &&
    small
  ) {
    return await QRCode.toString(text, {
      type: 'terminal',
      small: true,
      inverse,
      errorCorrectionLevel: validLevel,
      margin
    });
  }

  // Renderizador ANSI 24-bit com suporte a dots, rounded, squares, fundo e primeiro plano
  const qr = QRCode.create(text, { errorCorrectionLevel: validLevel });
  return renderTerminalMatrix(qr.modules, {
    style: validStyle,
    inverse,
    margin,
    darkColor,
    lightColor
  });
}

/**
 * Renderiza uma matriz de módulos já calculada (BitMatrix de `QRCode.create(...).modules`)
 * como texto ANSI, com dois caracteres por módulo e uma linha por linha da matriz.
 * @param {{ size: number, get(row: number, col: number): number }} modules
 * @param {object} [options={}]
 * @returns {string}
 */
export function renderTerminalMatrix(modules, options = {}) {
  const {
    style = 'squares',
    inverse = false,
    margin = 1,
    darkColor = null,
    lightColor = null
  } = options;

  const validStyle = normalizeStyle(style);
  const count = modules.size;

  const defaultDark = inverse ? '#ffffff' : '#000000';
  const fgAnsi = hexToAnsi(darkColor || defaultDark, false);
  const bgAnsi = lightColor ? hexToAnsi(lightColor, true) : '';
  const reset = '\x1b[0m';

  let charDark = '██';
  const charLight = '  ';

  if (validStyle === 'dots') {
    charDark = '● ';
  } else if (validStyle === 'rounded') {
    charDark = '▢ ';
  }

  const lines = [];
  const effectiveMargin = Math.max(0, margin);

  for (let r = -effectiveMargin; r < count + effectiveMargin; r++) {
    let line = '';
    for (let c = -effectiveMargin; c < count + effectiveMargin; c++) {
      const isInside = r >= 0 && r < count && c >= 0 && c < count;
      let isDark = isInside ? modules.get(r, c) === 1 : false;
      if (inverse) isDark = !isDark;

      if (isDark) {
        line += `${bgAnsi}${fgAnsi}${charDark}${reset}`;
      } else {
        line += `${bgAnsi}${charLight}${reset}`;
      }
    }
    lines.push(line);
  }

  return lines.join('\n');
}

/**
 * Renderiza o QR Code em formato SVG como string.
 * @param {string} text
 * @param {object} [options={}]
 * @returns {string}
 */
export function renderStyledSvg(text, options = {}) {
  const {
    style = 'squares',
    width = 400,
    margin = 4,
    errorCorrectionLevel = 'M',
    darkColor = '#000000',
    lightColor = '#ffffff'
  } = options;

  const validStyle = normalizeStyle(style);
  const validLevel = normalizeErrorLevel(errorCorrectionLevel);

  const qr = QRCode.create(text, { errorCorrectionLevel: validLevel });
  const count = qr.modules.size;
  const total = count + margin * 2;

  let elements = [];

  const isTransparent =
    !lightColor ||
    lightColor.toLowerCase() === 'transparent' ||
    lightColor.toLowerCase() === 'none';

  if (!isTransparent) {
    elements.push(`  <rect width="${total}" height="${total}" fill="${lightColor}"/>`);
  }

  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.modules.get(r, c)) {
        const x = c + margin;
        const y = r + margin;

        if (validStyle === 'dots') {
          elements.push(
            `  <circle cx="${x + 0.5}" cy="${y + 0.5}" r="0.43" fill="${darkColor}"/>`
          );
        } else if (validStyle === 'rounded') {
          elements.push(
            `  <rect x="${x + 0.05}" y="${y + 0.05}" width="0.9" height="0.9" rx="0.25" ry="0.25" fill="${darkColor}"/>`
          );
        } else {
          elements.push(
            `  <rect x="${x}" y="${y}" width="1" height="1" fill="${darkColor}"/>`
          );
        }
      }
    }
  }

  return `<?xml version="1.0" encoding="utf-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width}" viewBox="0 0 ${total} ${total}" shape-rendering="geometricPrecision">
${elements.join('\n')}
</svg>`;
}

/**
 * Renderiza o QR Code em formato PNG puro (Buffer) com suporte a estilos e transparência.
 * @param {string} text
 * @param {object} [options={}]
 * @returns {Buffer}
 */
export function renderStyledPng(text, options = {}) {
  const {
    style = 'squares',
    width = 400,
    margin = 4,
    errorCorrectionLevel = 'M',
    darkColor = '#000000',
    lightColor = '#ffffff'
  } = options;

  const validStyle = normalizeStyle(style);
  const validLevel = normalizeErrorLevel(errorCorrectionLevel);

  const qr = QRCode.create(text, { errorCorrectionLevel: validLevel });
  const count = qr.modules.size;
  const totalCount = count + margin * 2;
  const scale = Math.max(1, Math.floor(width / totalCount));
  const finalSize = totalCount * scale;

  const png = new PNG({ width: finalSize, height: finalSize });
  const [bgR, bgG, bgB, bgA] = hexToRgba(lightColor);
  const [fgR, fgG, fgB, fgA] = hexToRgba(darkColor);

  for (let y = 0; y < finalSize; y++) {
    for (let x = 0; x < finalSize; x++) {
      const idx = (finalSize * y + x) << 2;
      png.data[idx] = bgR;
      png.data[idx + 1] = bgG;
      png.data[idx + 2] = bgB;
      png.data[idx + 3] = bgA;
    }
  }

  const radius = (scale / 2) * 0.86;
  const rSq = radius * radius;
  const roundCorner = Math.max(1, scale * 0.28);

  for (let r = 0; r < count; r++) {
    for (let c = 0; c < count; c++) {
      if (qr.modules.get(r, c)) {
        const startX = (c + margin) * scale;
        const startY = (r + margin) * scale;

        if (validStyle === 'squares') {
          for (let py = startY; py < startY + scale; py++) {
            for (let px = startX; px < startX + scale; px++) {
              const idx = (finalSize * py + px) << 2;
              png.data[idx] = fgR;
              png.data[idx + 1] = fgG;
              png.data[idx + 2] = fgB;
              png.data[idx + 3] = fgA;
            }
          }
        } else if (validStyle === 'dots') {
          const cx = startX + scale / 2;
          const cy = startY + scale / 2;
          for (let py = startY; py < startY + scale; py++) {
            for (let px = startX; px < startX + scale; px++) {
              const dx = px + 0.5 - cx;
              const dy = py + 0.5 - cy;
              if (dx * dx + dy * dy <= rSq) {
                const idx = (finalSize * py + px) << 2;
                png.data[idx] = fgR;
                png.data[idx + 1] = fgG;
                png.data[idx + 2] = fgB;
                png.data[idx + 3] = fgA;
              }
            }
          }
        } else if (validStyle === 'rounded') {
          for (let py = startY; py < startY + scale; py++) {
            for (let px = startX; px < startX + scale; px++) {
              const relX = px - startX;
              const relY = py - startY;

              let inBounds = true;
              const inCornerTL = relX < roundCorner && relY < roundCorner;
              const inCornerTR = relX >= scale - roundCorner && relY < roundCorner;
              const inCornerBL = relX < roundCorner && relY >= scale - roundCorner;
              const inCornerBR = relX >= scale - roundCorner && relY >= scale - roundCorner;

              if (inCornerTL) {
                const dx = relX - roundCorner;
                const dy = relY - roundCorner;
                if (dx * dx + dy * dy > roundCorner * roundCorner) inBounds = false;
              } else if (inCornerTR) {
                const dx = relX - (scale - 1 - roundCorner);
                const dy = relY - roundCorner;
                if (dx * dx + dy * dy > roundCorner * roundCorner) inBounds = false;
              } else if (inCornerBL) {
                const dx = relX - roundCorner;
                const dy = relY - (scale - 1 - roundCorner);
                if (dx * dx + dy * dy > roundCorner * roundCorner) inBounds = false;
              } else if (inCornerBR) {
                const dx = relX - (scale - 1 - roundCorner);
                const dy = relY - (scale - 1 - roundCorner);
                if (dx * dx + dy * dy > roundCorner * roundCorner) inBounds = false;
              }

              if (inBounds) {
                const idx = (finalSize * py + px) << 2;
                png.data[idx] = fgR;
                png.data[idx + 1] = fgG;
                png.data[idx + 2] = fgB;
                png.data[idx + 3] = fgA;
              }
            }
          }
        }
      }
    }
  }

  return PNG.sync.write(png);
}

/**
 * Salva o QR Code em um arquivo (PNG, SVG ou TXT).
 * Suporta opções de estilo, cores e transparência.
 * Com `overwrite: false`, a gravação falha com `EEXIST` se o destino já existir.
 * @param {string} text
 * @param {string} outputPath
 * @param {object} [options={}]
 * @returns {Promise<{ path: string, format: string, size: number }>}
 */
export async function saveToFile(text, outputPath, options = {}) {
  const resolvedPath = path.resolve(outputPath);
  const ext = path.extname(resolvedPath).toLowerCase();
  const dir = path.dirname(resolvedPath);

  const {
    style = 'squares',
    width = 400,
    margin = 4,
    errorCorrectionLevel = 'M',
    darkColor = '#000000',
    lightColor = '#ffffff',
    overwrite = true
  } = options;

  let format = 'png';
  if (ext === '.svg') {
    format = 'svg';
  } else if (ext === '.txt' || ext === '.ans' || ext === '.utf8') {
    format = 'txt';
  } else if (ext === '.png') {
    format = 'png';
  } else if (!ext) {
    format = 'png';
  } else {
    throw new Error(
      `Formato de arquivo não suportado: "${ext}". Formatos suportados: .png, .svg, .txt`
    );
  }

  const finalPath = ext ? resolvedPath : `${resolvedPath}.png`;

  let data;
  if (format === 'svg') {
    data = renderStyledSvg(text, {
      style,
      width,
      margin,
      errorCorrectionLevel,
      darkColor,
      lightColor
    });
  } else if (format === 'png') {
    data = renderStyledPng(text, {
      style,
      width,
      margin,
      errorCorrectionLevel,
      darkColor,
      lightColor
    });
  } else {
    // TXT não transporta cores nem transparência: só a geometria de estilo e margem.
    const qr = QRCode.create(text, { errorCorrectionLevel: normalizeErrorLevel(errorCorrectionLevel) });
    const ansi = renderTerminalMatrix(qr.modules, { style: normalizeStyle(style), margin });
    data = `${stripVTControlCharacters(ansi)}\n`;
  }

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(finalPath, data, {
    encoding: typeof data === 'string' ? 'utf8' : undefined,
    flag: overwrite ? 'w' : 'wx'
  });

  const stats = await fs.stat(finalPath);

  return {
    path: finalPath,
    format,
    size: stats.size
  };
}
