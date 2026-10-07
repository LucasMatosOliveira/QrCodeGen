import path from 'node:path';
import { stripVTControlCharacters } from 'node:util';
import pc from 'picocolors';
import stringWidth from 'string-width';
import QRCode from 'qrcode';
import { hexToAnsi, hexToRgba, renderTerminalMatrix, saveToFile } from './generator.js';
import { createInputDecoder, editText, graphemeBoundaries } from './tui-input.js';

// Opções com nomes concisos e sem emojis ambíguos para estabilidade de largura no terminal
export const TUI_STYLES = [
  { id: 'squares', label: 'Quadrados' },
  { id: 'dots', label: 'Bolinhas (Dots)' },
  { id: 'rounded', label: 'Arredondado' }
];

export const TUI_BACKGROUNDS = [
  { id: 'transparent', label: 'Transparente', color: 'transparent' },
  { id: '#ffffff', label: 'Branco (#fff)', color: '#ffffff' },
  { id: '#18181b', label: 'Escuro (#18181b)', color: '#18181b' },
  { id: '#dbeafe', label: 'Azul Suave', color: '#dbeafe' },
  { id: '#fef08a', label: 'Amarelo Suave', color: '#fef08a' }
];

export const TUI_COLORS = [
  { id: '#000000', label: 'Preto (#000)', color: '#000000' },
  { id: '#2563eb', label: 'Azul (#2563eb)', color: '#2563eb' },
  { id: '#7c3aed', label: 'Roxo (#7c3aed)', color: '#7c3aed' },
  { id: '#16a34a', label: 'Verde (#16a34a)', color: '#16a34a' },
  { id: '#dc2626', label: 'Vermelho (#dc2626)', color: '#dc2626' },
  { id: '#ea580c', label: 'Laranja (#ea580c)', color: '#ea580c' },
  { id: '#ffffff', label: 'Branco (#fff)', color: '#ffffff' }
];

export const TUI_ERROR_LEVELS = [
  { id: 'L', label: 'L (~7%)', desc: 'Menor densidade de módulos' },
  { id: 'M', label: 'M (~15%)', desc: 'Recomendado para uso geral' },
  { id: 'Q', label: 'Q (~25%)', desc: 'Boa tolerância a danos' },
  { id: 'H', label: 'H (~30%)', desc: 'Máxima redundância' }
];

export const TUI_FORMATS = [
  { id: 'png', label: 'PNG (.png)', ext: 'png' },
  { id: 'svg', label: 'SVG (.svg)', ext: 'svg' },
  { id: 'txt', label: 'TXT (.txt)', ext: 'txt' }
];

export const TUI_MARGINS = [
  { val: 1, label: '1 bloco' },
  { val: 2, label: '2 blocos' },
  { val: 4, label: '4 blocos' },
  { val: 0, label: 'Sem margem' }
];

export const TABS = [
  { id: 'content', title: 'Conteúdo', heading: 'CONTEÚDO' },
  { id: 'style', title: 'Estilo', heading: 'ESTILO DOS MÓDULOS' },
  { id: 'colors', title: 'Cores', heading: 'CORES & FUNDO' },
  { id: 'export', title: 'Exportar', heading: 'SALVAR & EXPORTAR' }
];

const TAB_FIELDS = [
  [
    { type: 'text', key: 'content', cursorKey: 'cursorPos', label: 'Conteúdo', placeholder: '(digite o link ou texto)' },
    { type: 'select', key: 'errorIndex', options: TUI_ERROR_LEVELS, label: 'Correção de erro' }
  ],
  [
    { type: 'select', key: 'styleIndex', options: TUI_STYLES, label: 'Módulos' },
    { type: 'select', key: 'marginIndex', options: TUI_MARGINS, label: 'Margem' }
  ],
  [
    { type: 'select', key: 'bgIndex', options: TUI_BACKGROUNDS, label: 'Fundo' },
    { type: 'select', key: 'colorIndex', options: TUI_COLORS, label: 'Cor dos módulos' }
  ],
  [
    { type: 'select', key: 'formatIndex', options: TUI_FORMATS, label: 'Formato' },
    { type: 'text', key: 'fileName', cursorKey: 'fileCursorPos', label: 'Arquivo', placeholder: '(qrcode.<formato>)' },
    { type: 'button', label: 'Salvar' }
  ]
];

const MIN_COLS = 70;
const MIN_ROWS = 20;
const HEADER_ROWS = 4;
const FOOTER_ROWS = 4;
const VALUE_INDENT = 4;
const SAVE_LABEL = '[ Salvar arquivo (Enter) ]';
const SAVING_LABEL = '[ Salvando... ]';
const RESET = '\x1b[0m';
const CARET_ON = '\x1b[7m';
const CARET_OFF = '\x1b[27m';
const ENTER_SCREEN = '\x1b[?1049h\x1b[?25l\x1b[?1000h\x1b[?1006h\x1b[?2004h';
const LEAVE_SCREEN = '\x1b[?2004l\x1b[?1006l\x1b[?1000l\x1b[?25h\x1b[?1049l';
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
const CONTROL_CHARS_ALL = /[\u0000-\u001f\u007f-\u009f]/g;
const SGR_AT = /\x1b\[[0-9;]*m/y;
const VT_SEQUENCE_AT = /(?:\x1b\[|\x9b)[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/y;
const INVALID_FILE_NAME = 'Nome de arquivo inválido.';
const INVALID_PASTED_FILE_NAME = 'Nome de arquivo inválido: use uma única linha.';

const HELP_TEXT_FIELD = ' [Tab] Abas [↑↓] Campos [←→] Cursor [^S] Salvar [Esc] Sair';
const HELP_SELECTOR = ' [Tab] Abas [1-4] Aba [↑↓] Campo [←→] Opção [S] Salvar [Esc] Sair';
const HELP_CONFIRM = ' [Enter] Substituir [Esc] Cancelar [^C] Sair';

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

function toDimension(value) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function inRect(rect, x, y) {
  return Boolean(rect) && x >= rect.x && x < rect.x + rect.w && y >= rect.y && y < rect.y + rect.h;
}

/**
 * Geometria única da tela, usada pelo desenho e pelo hit-test do mouse.
 * Coordenadas 0-based (coluna x, linha y).
 */
function getTuiLayout(cols, rows) {
  const c = toDimension(cols);
  const r = toDimension(rows);
  if (c < MIN_COLS || r < MIN_ROWS) {
    return { small: true, cols: c, rows: r };
  }

  const bodyTop = HEADER_ROWS;
  const bodyHeight = r - HEADER_ROWS - FOOTER_ROWS;
  const leftWidth = clamp(Math.floor(c * 0.42), 34, 42);
  const rightWidth = c - leftWidth - 3;
  const leftX = 1;
  const rightX = leftWidth + 2;

  const tabs = [];
  let tabX = 2;
  TABS.forEach((tab, i) => {
    const label = `[${i + 1} ${tab.title}]`;
    const w = stringWidth(label);
    tabs.push({ x: tabX, y: 2, w, h: 1, label });
    tabX += w + 1;
  });

  const valueWidth = leftWidth - VALUE_INDENT - 1;
  const field = (line) => ({
    label: { x: leftX, y: bodyTop + line, w: leftWidth, h: 1 },
    value: { x: leftX + VALUE_INDENT, y: bodyTop + line + 1, w: valueWidth, h: 1 }
  });

  return {
    small: false,
    cols: c,
    rows: r,
    bodyTop,
    bodyHeight,
    leftX,
    leftWidth,
    rightX,
    rightWidth,
    tabs,
    fields: [field(2), field(6)],
    saveButton: { x: leftX + 3, y: bodyTop + 10, w: stringWidth(SAVE_LABEL), h: 1 },
    preview: { x: rightX + 1, y: bodyTop + 2, w: rightWidth - 2, h: bodyHeight - 2 }
  };
}

/**
 * Ajusta uma linha a exatamente `width` colunas, preservando SGR gerado pela aplicação,
 * sem partir grafemas, e fechando estilos quando há corte.
 */
function fitAnsi(str, width) {
  if (width <= 0) return '';
  let out = '';
  let used = 0;
  let styled = false;
  let truncated = false;
  let i = 0;

  while (i < str.length && !truncated) {
    if (str.charCodeAt(i) === 0x1b) {
      SGR_AT.lastIndex = i;
      const sgr = SGR_AT.exec(str);
      if (sgr) {
        out += sgr[0];
        styled = true;
        i += sgr[0].length;
      } else {
        i++;
      }
      continue;
    }
    const nextEsc = str.indexOf('\x1b', i);
    const chunk = str.slice(i, nextEsc === -1 ? str.length : nextEsc);
    for (const { segment } of graphemes.segment(chunk)) {
      const w = stringWidth(segment);
      if (used + w > width) {
        truncated = true;
        break;
      }
      out += segment;
      used += w;
    }
    i += chunk.length;
  }

  if (truncated && styled) out += RESET;
  if (used < width) out += ' '.repeat(width - used);
  return out;
}

/**
 * Representação segura em uma linha de texto externo (conteúdo, nomes, mensagens).
 */
function sanitizeLine(text) {
  return stripVTControlCharacters(String(text).replace(/\r\n|\r|\n/g, '↵').replace(/\t/g, '⇥'))
    .replace(CONTROL_CHARS_ALL, '\ufffd');
}

/**
 * Grafemas de um campo editável com sua representação segura; sequências VT ficam ocultas.
 */
function displaySegments(text) {
  const segments = [];
  let hiddenUntil = 0;
  for (const { segment, index } of graphemes.segment(text)) {
    const end = index + segment.length;
    if (index < hiddenUntil) {
      segments.push({ start: index, end, display: '', width: 0 });
      continue;
    }
    if (segment[0] === '\x1b' || segment[0] === '\x9b') {
      VT_SEQUENCE_AT.lastIndex = index;
      const vt = VT_SEQUENCE_AT.exec(text);
      if (vt) {
        hiddenUntil = index + vt[0].length;
        segments.push({ start: index, end, display: '', width: 0 });
        continue;
      }
    }
    let display = segment;
    if (segment === '\n' || segment === '\r\n' || segment === '\r') display = '↵';
    else if (segment === '\t') display = '⇥';
    else if (CONTROL_CHARS.test(segment)) display = '\ufffd';
    segments.push({ start: index, end, display, width: stringWidth(display) });
  }
  return segments;
}

/**
 * Desenha o valor de um campo de texto com janela horizontal acompanhando o caret.
 */
function renderTextValue(text, cursor, width, focused, placeholder) {
  if (!text && !focused) return pc.dim(fitAnsi(placeholder, width));
  const segments = displaySegments(text);
  let caret = segments.findIndex((s) => s.start >= cursor);
  if (caret === -1) caret = segments.length;

  let start = 0;
  if (focused) {
    let used = Math.max(1, segments[caret]?.width ?? 1);
    start = caret;
    while (start > 0 && used + segments[start - 1].width <= width) {
      start--;
      used += segments[start].width;
    }
  }

  let out = '';
  let used = 0;
  for (let k = start; k <= segments.length; k++) {
    const isCaret = focused && k === caret;
    const seg = segments[k];
    if (!seg && !isCaret) break;
    const display = seg ? seg.display : '';
    const cell = isCaret && !display ? ' ' : display;
    const w = isCaret ? Math.max(1, seg?.width ?? 1) : seg.width;
    if (used + w > width) break;
    out += isCaret ? `${CARET_ON}${cell}${CARET_OFF}` : cell;
    used += w;
  }
  out += ' '.repeat(Math.max(0, width - used));
  return focused ? pc.bold(out) : pc.dim(out);
}

function currentField(state) {
  return TAB_FIELDS[state.tabIndex]?.[state.fieldIndex];
}

function isFileNameField(state) {
  return currentField(state)?.key === 'fileName';
}

function setResult(state, type, message) {
  state.statusType = type;
  state.statusMessage = message;
}

// Edição de conteúdo/opções invalida o resultado da gravação anterior.
function markEdited(state) {
  state.statusMessage = '';
  state.statusType = 'info';
}

/**
 * Normaliza o nome do arquivo para o formato escolhido; a extensão segue o formato.
 * @returns {{ fileName: string } | { error: string }}
 */
function normalizeTuiFileName(fileName, format) {
  const name = String(fileName).trim();
  if (!name) return { fileName: `qrcode.${format}` };
  if (CONTROL_CHARS.test(name)) return { error: INVALID_PASTED_FILE_NAME };
  if (name.endsWith('/') || name.endsWith(path.sep)) return { error: INVALID_FILE_NAME };
  const base = path.basename(name);
  if (base === '.' || base === '..') return { error: INVALID_FILE_NAME };
  const ext = path.extname(base);
  if (ext.toLowerCase() === `.${format}`) return { fileName: name };
  if (!ext) return { fileName: `${name}.${format}` };
  return { fileName: `${name.slice(0, -ext.length)}.${format}` };
}

function applyFileName(state, fileName) {
  state.fileName = fileName;
  state.fileCursorPos = Math.min(state.fileCursorPos, fileName.length);
}

// Ao sair do campo de nome, aplica a extensão do formato; nome inválido mantém o foco.
function leaveFileNameField(state) {
  const result = normalizeTuiFileName(state.fileName, TUI_FORMATS[state.formatIndex].ext);
  if (result.error) {
    setResult(state, 'error', result.error);
    return false;
  }
  applyFileName(state, result.fileName);
  return true;
}

function focusField(state, tabIndex, fieldIndex) {
  if (tabIndex === state.tabIndex && fieldIndex === state.fieldIndex) return false;
  if (isFileNameField(state) && !leaveFileNameField(state)) return true;
  state.tabIndex = tabIndex;
  state.fieldIndex = fieldIndex;
  return true;
}

/**
 * Cria o estado inicial da TUI.
 */
export function createTuiState(initial = {}) {
  const content = initial.content || 'https://github.com';
  const fileName = 'qrcode.png';
  return {
    tabIndex: 0,
    fieldIndex: 0,
    content,
    cursorPos: content.length,
    styleIndex: 0,
    bgIndex: 1,
    colorIndex: 0,
    errorIndex: 1,
    marginIndex: 0,
    formatIndex: 0,
    fileName,
    fileCursorPos: fileName.length,
    statusMessage: '',
    statusType: 'info',
    cachedMatrix: null,
    cachedMatrixKey: '',
    cachedMatrixError: '',
    cachedPreview: '',
    cachedPreviewKey: '',
    previewMode: 'empty',
    previewMessage: '',
    saving: false,
    pendingOverwrite: null
  };
}

/**
 * Alterna ciclicamente o valor do seletor focado.
 * @returns {boolean}
 */
function cycleField(state, dir = 1) {
  const field = currentField(state);
  if (field?.type !== 'select') return false;
  const count = field.options.length;
  const next = (state[field.key] + dir + count) % count;
  if (field.key === 'formatIndex') {
    const result = normalizeTuiFileName(state.fileName, TUI_FORMATS[next].ext);
    if (result.error) {
      setResult(state, 'error', result.error);
      state.fieldIndex = 1;
      return true;
    }
    applyFileName(state, result.fileName);
  }
  state[field.key] = next;
  markEdited(state);
  return true;
}

function applyEdit(state, field, action) {
  const before = state[field.key];
  const result = editText(before, state[field.cursorKey], action);
  const changed = result.text !== before;
  if (!changed && result.cursor === state[field.cursorKey]) return false;
  state[field.key] = result.text;
  state[field.cursorKey] = result.cursor;
  if (changed) markEdited(state);
  return true;
}

const TEXT_ACTIONS = {
  left: 'left',
  right: 'right',
  home: 'home',
  end: 'end',
  backspace: 'backspace',
  delete: 'delete'
};

function isLocked(state, dims) {
  return state.saving || Boolean(dims && getTuiLayout(dims.cols, dims.rows).small);
}

/**
 * Interpreta uma tecla decodificada pelo readline. Altera somente estado/seleção;
 * os efeitos (gravar, sair) ficam a cargo do runtime.
 * @param {object} state
 * @param {string | undefined} str
 * @param {{ name?: string, ctrl?: boolean, meta?: boolean, shift?: boolean }} key
 * @param {{ cols: number, rows: number }} [dims] dimensões atuais; tela pequena só aceita saída
 * @returns {false | true | 'save' | 'quit' | 'confirm-overwrite' | 'cancel-overwrite'}
 */
export function handleKeyAction(state, str, key = {}, dims) {
  const name = key.name;
  if (key.ctrl && name === 'c') return 'quit';

  if (state.pendingOverwrite) {
    if (name === 'return' || name === 'enter') return 'confirm-overwrite';
    if (name === 'escape') {
      state.pendingOverwrite = null;
      setResult(state, 'info', 'Gravação cancelada; arquivo existente preservado.');
      return 'cancel-overwrite';
    }
    return false;
  }

  if (name === 'escape') return 'quit';

  const field = currentField(state);
  const typing = field?.type === 'text';
  const plainChar = !key.ctrl && !key.meta && typeof str === 'string' ? str : '';

  if (isLocked(state, dims)) {
    return !typing && (plainChar === 'q' || plainChar === 'Q') ? 'quit' : false;
  }

  if (key.ctrl && name === 's') return 'save';
  if (name === 'tab') {
    const next = (state.tabIndex + (key.shift ? -1 : 1) + TABS.length) % TABS.length;
    return focusField(state, next, 0);
  }
  if (name === 'up') return focusField(state, state.tabIndex, Math.max(0, state.fieldIndex - 1));
  if (name === 'down') {
    const last = TAB_FIELDS[state.tabIndex].length - 1;
    return focusField(state, state.tabIndex, Math.min(last, state.fieldIndex + 1));
  }

  if (typing) {
    if (TEXT_ACTIONS[name] && !key.meta) return applyEdit(state, field, { type: TEXT_ACTIONS[name] });
    if (name === 'return' || name === 'enter') return focusField(state, state.tabIndex, state.fieldIndex + 1);
    if (plainChar && !CONTROL_CHARS.test(plainChar)) {
      return applyEdit(state, field, { type: 'insert', text: plainChar });
    }
    return false;
  }

  if (['1', '2', '3', '4'].includes(plainChar)) return focusField(state, Number(plainChar) - 1, 0);
  if (plainChar === 's' || plainChar === 'S') return 'save';
  if (plainChar === 'q' || plainChar === 'Q') return 'quit';
  if (name === 'left') return cycleField(state, -1);
  if (name === 'right' || name === 'space') return cycleField(state, 1);
  if (name === 'return' || name === 'enter') {
    if (field?.type === 'button') return 'save';
    const last = TAB_FIELDS[state.tabIndex].length - 1;
    return state.fieldIndex < last ? focusField(state, state.tabIndex, state.fieldIndex + 1) : false;
  }
  return false;
}

/**
 * Insere texto colado (bracketed paste) no campo de texto focado, sem executar atalhos.
 * @returns {boolean}
 */
export function handlePasteAction(state, text, dims) {
  if (state.pendingOverwrite || isLocked(state, dims)) return false;
  const field = currentField(state);
  if (field?.type !== 'text') return false;
  const normalized = String(text).replace(/\r\n?/g, '\n');
  if (!normalized) return false;
  if (field.key === 'fileName' && CONTROL_CHARS.test(normalized)) {
    setResult(state, 'error', INVALID_PASTED_FILE_NAME);
    return true;
  }
  return applyEdit(state, field, { type: 'insert', text: normalized });
}

/**
 * Processa eventos de mouse SGR (coordenadas 1-based) sobre os retângulos desenhados.
 * @returns {boolean | 'save'}
 */
export function handleMouseAction(state, col, row, button, isRelease, dims = { cols: 90, rows: 30 }) {
  if (isRelease || state.pendingOverwrite || state.saving) return false;
  const layout = getTuiLayout(dims.cols, dims.rows);
  if (layout.small) return false;

  const base = button & ~(4 | 8 | 16);
  const x = col - 1;
  const y = row - 1;
  const fields = TAB_FIELDS[state.tabIndex];
  const hitField = () => {
    for (let i = 0; i < layout.fields.length && i < fields.length; i++) {
      if (inRect(layout.fields[i].value, x, y)) return { index: i, part: 'value' };
      if (inRect(layout.fields[i].label, x, y)) return { index: i, part: 'label' };
    }
    return null;
  };
  const focusAndCycle = (index, dir) => {
    focusField(state, state.tabIndex, index);
    if (state.fieldIndex !== index) return true;
    cycleField(state, dir);
    return true;
  };

  if (base === 64 || base === 65) {
    const hit = hitField();
    if (!hit || fields[hit.index].type !== 'select') return false;
    return focusAndCycle(hit.index, base === 64 ? -1 : 1);
  }
  if (base !== 0) return false;

  const tab = layout.tabs.findIndex((rect) => inRect(rect, x, y));
  if (tab !== -1) return focusField(state, tab, 0);

  if (state.tabIndex === 3 && inRect(layout.saveButton, x, y)) {
    focusField(state, 3, 2);
    return state.fieldIndex === 2 ? 'save' : true;
  }

  const hit = hitField();
  if (!hit) return false;
  if (hit.part === 'value' && fields[hit.index].type === 'select') {
    const rect = layout.fields[hit.index].value;
    return focusAndCycle(hit.index, x < rect.x + rect.w / 2 ? -1 : 1);
  }
  return focusField(state, state.tabIndex, hit.index);
}

/**
 * Renderiza a matriz em meio-bloco (duas linhas de módulos por linha de terminal).
 */
function renderCompactHalfBlockQr(modules, { darkColor = '#000000', lightColor = 'transparent', margin = 1 } = {}) {
  const count = modules.size;
  const end = count + margin;
  const fg = hexToAnsi(darkColor) || hexToAnsi('#000000');
  const opaque = hexToRgba(lightColor)[3] !== 0;
  const lightFg = opaque ? hexToAnsi(lightColor) : '';
  const lightBg = opaque ? hexToAnsi(lightColor, true) : '';
  const isDark = (r, c) => r >= 0 && r < count && c >= 0 && c < count && modules.get(r, c) === 1;

  const lines = [];
  for (let r = -margin; r < end; r += 2) {
    const hasBottom = r + 1 < end;
    let line = '';
    for (let c = -margin; c < end; c++) {
      const top = isDark(r, c);
      const bottom = hasBottom && isDark(r + 1, c);
      if (top && bottom) {
        line += `${fg}█${RESET}`;
      } else if (top) {
        line += opaque && hasBottom ? `${fg}${lightBg}▀${RESET}` : `${fg}▀${RESET}`;
      } else if (bottom) {
        line += opaque ? `${fg}${lightBg}▄${RESET}` : `${fg}▄${RESET}`;
      } else if (opaque) {
        line += hasBottom ? `${lightBg} ${RESET}` : `${lightFg}▀${RESET}`;
      } else {
        line += ' ';
      }
    }
    lines.push(line);
  }
  return lines;
}

/**
 * Recalcula o preview para a área útil exata do QR (colunas × linhas). Síncrono:
 * a matriz só é recriada quando conteúdo/nível mudam; chave, modo e frame são publicados juntos.
 */
function syncPreview(state, availWidth, availHeight) {
  const text = state.content.trim();
  const errorCorrectionLevel = TUI_ERROR_LEVELS[state.errorIndex].id;
  const matrixKey = JSON.stringify([text, errorCorrectionLevel]);
  if (state.cachedMatrixKey !== matrixKey) {
    let matrix = null;
    let error = '';
    if (text) {
      try {
        matrix = QRCode.create(text, { errorCorrectionLevel }).modules;
      } catch (err) {
        error = err?.message || String(err);
      }
    }
    state.cachedMatrix = matrix;
    state.cachedMatrixError = error;
    state.cachedMatrixKey = matrixKey;
  }

  const style = TUI_STYLES[state.styleIndex].id;
  const lightColor = TUI_BACKGROUNDS[state.bgIndex].color;
  const darkColor = TUI_COLORS[state.colorIndex].color;
  const margin = TUI_MARGINS[state.marginIndex].val;
  const w = toDimension(availWidth);
  const h = toDimension(availHeight);
  const frameKey = JSON.stringify([matrixKey, style, lightColor, darkColor, margin, w, h]);
  if (state.cachedPreviewKey === frameKey) return;

  let mode;
  let preview = '';
  let message = '';
  if (!text) {
    mode = 'empty';
    message = 'Digite conteúdo para gerar.';
  } else if (state.cachedMatrixError) {
    mode = 'error';
    message = `Não foi possível gerar o QR: ${sanitizeLine(state.cachedMatrixError)}`;
  } else {
    const total = state.cachedMatrix.size + 2 * margin;
    const compactRows = Math.ceil(total / 2);
    if (2 * total <= w && total <= h) {
      mode = 'normal';
      preview = renderTerminalMatrix(state.cachedMatrix, { style, margin, darkColor, lightColor });
    } else if (total <= w && compactRows <= h) {
      mode = 'compact';
      preview = renderCompactHalfBlockQr(state.cachedMatrix, { darkColor, lightColor, margin }).join('\n');
    } else {
      mode = 'unavailable';
      message = `QR requer ${total}×${compactRows} células; área atual ${w}×${h}. Amplie o terminal ou exporte o arquivo.`;
    }
  }

  state.previewMode = mode;
  state.cachedPreview = preview;
  state.previewMessage = message;
  state.cachedPreviewKey = frameKey;
}

/**
 * Atualiza o cache do preview para a área útil exata do QR (colunas × linhas).
 */
export async function updatePreviewCache(state, availWidth = 45, availHeight = 18) {
  syncPreview(state, availWidth, availHeight);
}

function getWarnings(state) {
  const warnings = [];
  const bg = TUI_BACKGROUNDS[state.bgIndex].color;
  const fg = TUI_COLORS[state.colorIndex].color;
  if (bg !== 'transparent' && bg.toLowerCase() === fg.toLowerCase()) {
    warnings.push('Módulos e fundo têm a mesma cor.');
  }
  if (bg === 'transparent') warnings.push('Transparência: teste no fundo de destino.');
  if (TUI_MARGINS[state.marginIndex].val < 4) warnings.push('Margem menor que 4: valide a leitura.');
  return warnings;
}

function getStatus(state) {
  if (state.pendingOverwrite) {
    return {
      type: 'warning',
      text: `Já existe: ${state.pendingOverwrite.displayName} — Enter: substituir | Esc: cancelar`
    };
  }
  if (state.saving) return { type: 'info', text: 'Salvando...' };
  if (state.statusMessage) return { type: state.statusType, text: state.statusMessage };
  const [warning] = getWarnings(state);
  if (warning) return { type: 'warning', text: warning };
  return { type: 'info', text: 'Pronto.' };
}

function fieldDescription(state, field) {
  switch (field.key) {
    case 'content':
      return `${graphemeBoundaries(state.content).length - 1} caracteres`;
    case 'errorIndex':
      return TUI_ERROR_LEVELS[state.errorIndex].desc;
    case 'styleIndex':
      return 'Formato de cada módulo.';
    case 'marginIndex':
      return 'Zona de respiro; ideal: 4.';
    case 'bgIndex':
      return 'Cor atrás dos módulos.';
    case 'colorIndex':
      return 'Cor dos módulos escuros.';
    case 'formatIndex':
      return TUI_FORMATS[state.formatIndex].id === 'txt'
        ? 'TXT: sem cor/transparência.'
        : 'Usa estilo, cores e margem.';
    case 'fileName':
      return 'Extensão segue o formato.';
    default:
      return '';
  }
}

function renderSelectValue(label, width, focused) {
  const inner = Math.max(0, width - 4);
  const text = sanitizeLine(label);
  const textWidth = Math.min(stringWidth(text), inner);
  const left = Math.floor((inner - textWidth) / 2);
  const body = fitAnsi(' '.repeat(left) + text, inner);
  const value = `◄ ${body} ►`;
  return focused ? pc.bold(pc.cyan(value)) : pc.dim(value);
}

function renderLeftPanel(state, layout) {
  const lines = new Array(layout.bodyHeight).fill('');
  const put = (y, text) => {
    const i = y - layout.bodyTop;
    if (i >= 0 && i < lines.length) lines[i] = text;
  };

  put(layout.bodyTop, '  ' + pc.bold(pc.yellow(TABS[state.tabIndex].heading)));

  TAB_FIELDS[state.tabIndex].forEach((field, i) => {
    const focused = state.fieldIndex === i;
    if (field.type === 'button') {
      const btn = layout.saveButton;
      const label = fitAnsi(state.saving ? SAVING_LABEL : SAVE_LABEL, btn.w);
      const marker = focused ? pc.cyan('▶ ') : '  ';
      put(btn.y, ' '.repeat(btn.x - layout.leftX - 2) + marker + (focused ? pc.inverse(pc.bold(pc.green(label))) : pc.green(label)));
      return;
    }
    const rect = layout.fields[i];
    const indent = ' '.repeat(rect.value.x - layout.leftX);
    put(rect.label.y, (focused ? pc.cyan(' ▶ ') + pc.bold(field.label) : '   ' + field.label));
    const value = field.type === 'text'
      ? renderTextValue(state[field.key], state[field.cursorKey], rect.value.w, focused, field.placeholder)
      : renderSelectValue(field.options[state[field.key]].label, rect.value.w, focused);
    put(rect.value.y, indent + value);
    const desc = fieldDescription(state, field);
    if (desc) put(rect.value.y + 1, indent + pc.dim(fitAnsi(sanitizeLine(desc), rect.value.w)));
  });

  return lines;
}

function wrapText(text, width) {
  if (width <= 0) return [];
  const lines = [];
  let line = '';
  for (const word of text.split(' ')) {
    const candidate = line ? `${line} ${word}` : word;
    if (stringWidth(candidate) <= width || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  return lines.map((l) => fitAnsi(l, width));
}

function renderRightPanel(state, layout) {
  const lines = new Array(layout.bodyHeight).fill('');
  const titles = {
    normal: ['PREVIEW ESTILIZADO', 'Representação aproximada.'],
    compact: ['PREVIEW COMPACTO', 'Estilo aplicado no arquivo.']
  };
  const [title, note] = titles[state.previewMode] ?? ['PREVIEW', ''];
  lines[0] = ' ' + pc.bold(pc.magenta(title));
  if (note) lines[1] = ' ' + pc.dim(note);

  const area = layout.preview;
  const areaRow = area.y - layout.bodyTop;
  const pad = ' '.repeat(area.x - layout.rightX);

  if (state.cachedPreview) {
    const qrLines = state.cachedPreview.split('\n');
    const qrWidth = stringWidth(qrLines[0] ?? '');
    const offset = ' '.repeat(Math.max(0, Math.floor((area.w - qrWidth) / 2)));
    qrLines.slice(0, area.h).forEach((qrLine, i) => {
      lines[areaRow + i] = pad + offset + qrLine;
    });
  } else if (state.previewMessage) {
    const color = state.previewMode === 'error' ? pc.red : state.previewMode === 'unavailable' ? pc.yellow : pc.dim;
    wrapText(sanitizeLine(state.previewMessage), area.w).slice(0, area.h).forEach((msg, i) => {
      lines[areaRow + i] = pad + color(msg);
    });
  }
  return lines;
}

function renderSmallScreen(cols, rows) {
  if (!cols || !rows) return '';
  const message = ['Terminal pequeno', `Atual: ${cols}×${rows}`, `Mínimo: ${MIN_COLS}×${MIN_ROWS}`, 'Esc: sair'];
  const needed = Math.max(...message.map((m) => stringWidth(m))) + 4;
  const lines = [];
  if (cols >= needed && rows >= message.length + 2) {
    const bar = '─'.repeat(cols - 2);
    lines.push(pc.cyan(`┌${bar}┐`));
    for (let i = 0; i < rows - 2; i++) {
      const text = fitAnsi(message[i] ? ` ${message[i]}` : '', cols - 2);
      lines.push(pc.cyan('│') + (i === 0 ? pc.bold(pc.yellow(text)) : text) + pc.cyan('│'));
    }
    lines.push(pc.cyan(`└${bar}┘`));
  } else {
    for (let i = 0; i < rows; i++) lines.push(fitAnsi(message[i] ?? '', cols));
  }
  return lines.join('\n');
}

/**
 * Renderiza a tela completa com exatamente `rows` linhas de `cols` colunas visíveis.
 */
export function renderTuiScreen(state, cols = 90, rows = 30) {
  const layout = getTuiLayout(cols, rows);
  if (layout.small) return renderSmallScreen(layout.cols, layout.rows);

  syncPreview(state, layout.preview.w, layout.preview.h);

  const { cols: c, leftWidth, rightWidth } = layout;
  const border = pc.cyan('│');
  const lines = [];

  lines.push(pc.cyan(`┌${'─'.repeat(c - 2)}┐`));
  lines.push(border + fitAnsi(' ' + pc.bold(pc.inverse(pc.cyan(' QR CODE STUDIO '))), c - 2) + border);

  let tabsBar = ' ';
  layout.tabs.forEach((rect, i) => {
    if (i > 0) tabsBar += ' ';
    tabsBar += i === state.tabIndex ? pc.inverse(pc.bold(rect.label)) : pc.dim(rect.label);
  });
  lines.push(border + fitAnsi(tabsBar, c - 2) + border);
  lines.push(pc.cyan(`├${'─'.repeat(leftWidth)}┬${'─'.repeat(rightWidth)}┤`));

  const left = renderLeftPanel(state, layout);
  const right = renderRightPanel(state, layout);
  for (let i = 0; i < layout.bodyHeight; i++) {
    lines.push(border + fitAnsi(left[i], leftWidth) + border + fitAnsi(right[i], rightWidth) + border);
  }

  lines.push(pc.cyan(`├${'─'.repeat(leftWidth)}┴${'─'.repeat(rightWidth)}┤`));

  const status = getStatus(state);
  const icons = { success: '✔', error: '✖', warning: '!', info: 'ℹ' };
  const colors = { success: pc.green, error: pc.red, warning: pc.yellow, info: pc.cyan };
  const statusText = fitAnsi(` ${icons[status.type] ?? 'ℹ'} ${sanitizeLine(status.text)}`, c - 2);
  lines.push(border + (colors[status.type] ?? pc.cyan)(pc.bold(statusText)) + border);

  const help = state.pendingOverwrite
    ? HELP_CONFIRM
    : currentField(state)?.type === 'text' ? HELP_TEXT_FIELD : HELP_SELECTOR;
  lines.push(border + pc.dim(fitAnsi(help, c - 2)) + border);
  lines.push(pc.cyan(`└${'─'.repeat(c - 2)}┘`));

  return lines.join('\n');
}

/**
 * Salva o arquivo a partir do estado atual da TUI. Sem `overwrite`, um destino existente
 * gera uma confirmação pendente (`state.pendingOverwrite`) em vez de ser substituído.
 */
export async function saveCurrentFromTui(state, { overwrite = false } = {}) {
  if (state.saving) return;
  let job = overwrite ? state.pendingOverwrite : null;
  state.pendingOverwrite = null;

  if (!job) {
    const content = state.content.trim();
    if (!content) {
      setResult(state, 'error', 'Digite um link ou texto antes de salvar.');
      return;
    }
    const name = normalizeTuiFileName(state.fileName, TUI_FORMATS[state.formatIndex].ext);
    if (name.error) {
      setResult(state, 'error', name.error);
      state.tabIndex = 3;
      state.fieldIndex = 1;
      return;
    }
    applyFileName(state, name.fileName);
    job = {
      path: path.resolve(name.fileName),
      displayName: name.fileName,
      content,
      options: {
        style: TUI_STYLES[state.styleIndex].id,
        lightColor: TUI_BACKGROUNDS[state.bgIndex].color,
        darkColor: TUI_COLORS[state.colorIndex].color,
        errorCorrectionLevel: TUI_ERROR_LEVELS[state.errorIndex].id,
        margin: TUI_MARGINS[state.marginIndex].val,
        width: 500
      }
    };
  }

  state.saving = true;
  try {
    const res = await saveToFile(job.content, job.path, { ...job.options, overwrite });
    const sizeKb = (res.size / 1024).toFixed(1);
    setResult(state, 'success', `Salvo: ${job.displayName} (${res.format.toUpperCase()} ~${sizeKb} KB)`);
  } catch (err) {
    // EEXIST também pode vir do mkdir (componente do caminho é arquivo); só o destino pede confirmação.
    if (!overwrite && err?.code === 'EEXIST' && err.syscall === 'open' && err.path === job.path) {
      state.pendingOverwrite = job;
      markEdited(state);
    } else {
      setResult(state, 'error', `Erro ao salvar: ${err?.message || err}`);
    }
  } finally {
    state.saving = false;
  }
}

/**
 * Executa a TUI interativa em tela alternativa. Resolve quando a sessão termina
 * (Q/Esc/Ctrl+C/EOF/sinal) e rejeita em falha de stream/render, sempre após restaurar o terminal.
 */
export async function runTUI(initialOptions = {}) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY || !stdout.isTTY || process.env.TERM === 'dumb') {
    throw new Error('A TUI requer stdin e stdout em um terminal interativo.');
  }

  const state = createTuiState(initialOptions);
  const wasRaw = Boolean(stdin.isRaw);
  const wasFlowing = stdin.readableFlowing === true;

  let stopping = false;
  let endSession;
  const ended = new Promise((resolve, reject) => {
    endSession = { resolve, reject };
  });
  // Rejeição observada via `await ended`; evita aviso se o setup falhar antes.
  ended.catch(() => {});
  let drawHandle = null;
  let lastFrame = null;
  let saveTask = null;
  let screenActive = false;
  let stdoutFailed = false;

  const stop = (error, exitCode) => {
    if (stopping) return;
    stopping = true;
    clearImmediate(drawHandle);
    drawHandle = null;
    if (exitCode !== undefined) process.exitCode = exitCode;
    if (error) endSession.reject(error);
    else endSession.resolve();
  };

  const dims = () => ({ cols: stdout.columns || 0, rows: stdout.rows || 0 });

  const drawNow = () => {
    drawHandle = null;
    if (stopping) return;
    try {
      const { cols, rows } = dims();
      const screen = renderTuiScreen(state, cols, rows);
      const frameKey = `${cols}x${rows}\n${screen}`;
      if (frameKey === lastFrame) return;
      lastFrame = frameKey;
      stdout.write(`\x1b[H\x1b[J${screen}`);
    } catch (err) {
      stop(err);
    }
  };

  const scheduleDraw = () => {
    if (stopping || drawHandle) return;
    drawHandle = setImmediate(drawNow);
  };

  const startSave = (overwrite) => {
    if (state.saving || stopping) return;
    saveTask = saveCurrentFromTui(state, { overwrite }).then(scheduleDraw, (err) => stop(err));
  };

  const dispatch = (result) => {
    if (stopping || !result) return;
    if (result === 'quit') {
      stop();
      return;
    }
    if (result === 'save') startSave(false);
    else if (result === 'confirm-overwrite') startSave(true);
    scheduleDraw();
  };

  const guarded = (fn) => (...args) => {
    if (stopping) return;
    try {
      dispatch(fn(...args));
    } catch (err) {
      stop(err);
    }
  };

  const decoder = createInputDecoder({
    onKey: guarded((str, key) => handleKeyAction(state, str, key ?? {}, dims())),
    onMouse: guarded(({ button, col, row, release }) => handleMouseAction(state, col, row, button, release, dims())),
    onPaste: guarded((text) => handlePasteAction(state, text, dims()))
  });

  const onData = (chunk) => {
    if (stopping) return;
    try {
      decoder.write(chunk);
    } catch (err) {
      stop(err);
    }
  };
  const onEnd = () => stop();
  const onStdinError = (err) => stop(err);
  const onStdoutError = (err) => {
    stdoutFailed = true;
    stop(err);
  };
  const onSigint = () => stop(undefined, 130);
  const onSigterm = () => stop(undefined, 143);

  try {
    stdin.on('data', onData);
    stdin.on('end', onEnd);
    stdin.on('error', onStdinError);
    stdout.on('error', onStdoutError);
    stdout.on('resize', scheduleDraw);
    process.on('SIGINT', onSigint);
    process.on('SIGTERM', onSigterm);

    stdin.setRawMode(true);
    screenActive = true;
    stdout.write(ENTER_SCREEN);
    stdin.resume();
    drawNow();

    await ended;
  } finally {
    stop();
    stdin.off('data', onData);
    stdin.off('end', onEnd);
    stdin.off('error', onStdinError);
    stdout.off('resize', scheduleDraw);
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    decoder.close();

    if (screenActive && !stdoutFailed && !stdout.destroyed && stdout.writable) {
      try {
        // Mantém o listener de erro até a escrita final concluir.
        stdout.write(LEAVE_SCREEN, () => setImmediate(() => stdout.off('error', onStdoutError)));
      } catch {
        stdout.off('error', onStdoutError);
      }
    } else {
      stdout.off('error', onStdoutError);
    }
    screenActive = false;

    try {
      stdin.setRawMode(wasRaw);
    } catch {
      // stdin já fechado: nada a restaurar.
    }
    if (!wasFlowing) stdin.pause();

    await saveTask;
  }
}
