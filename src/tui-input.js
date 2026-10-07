import readline from 'node:readline';
import { PassThrough } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

const ESC = '\x1b';
const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';
const MOUSE_SGR = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
// Prefixos ainda incompletos de um relatório SGR de mouse (ESC, ESC[, ESC[<1;2;3 ...).
const MOUSE_PREFIX = /^\x1b(?:\[(?:<(?:\d+(?:;(?:\d+(?:;\d*)?)?)?)?)?)?$/;
const AMBIGUOUS_ESC_TIMEOUT_MS = 50;

const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Decodifica a entrada crua do terminal em teclas, cliques de mouse (SGR 1006) e
 * colagens delimitadas (bracketed paste). Mouse e colagem nunca chegam como teclas.
 * @param {{
 *   onKey?: (str: string | undefined, key: object) => void,
 *   onMouse?: (event: { button: number, col: number, row: number, release: boolean }) => void,
 *   onPaste?: (text: string) => void
 * }} handlers
 * @returns {{ write(chunk: Buffer | string): void, close(): void }}
 */
export function createInputDecoder({ onKey = () => {}, onMouse = () => {}, onPaste = () => {} } = {}) {
  const utf8 = new StringDecoder('utf8');
  const keys = new PassThrough({ encoding: 'utf8' });
  readline.emitKeypressEvents(keys);
  keys.on('keypress', onKey);

  let pending = '';
  let pasting = false;
  let pasteText = '';
  let timer = null;
  let closed = false;

  const forward = (text) => {
    if (text) keys.write(text);
  };

  const flushAmbiguous = () => {
    timer = null;
    if (closed || pasting || !pending) return;
    const text = pending;
    pending = '';
    if (text === ESC) {
      // Mesmo evento que o readline emitiria para ESC isolado, sem a espera de 500 ms dele.
      onKey(undefined, { sequence: ESC, name: 'escape', ctrl: false, meta: true, shift: false });
    } else {
      forward(text);
    }
  };

  const drain = () => {
    while (pending) {
      if (pasting) {
        const end = pending.indexOf(PASTE_END);
        if (end === -1) {
          const keep = partialSuffixLength(pending, PASTE_END);
          pasteText += pending.slice(0, pending.length - keep);
          pending = pending.slice(pending.length - keep);
          return;
        }
        pasteText += pending.slice(0, end);
        pending = pending.slice(end + PASTE_END.length);
        pasting = false;
        const text = pasteText;
        pasteText = '';
        onPaste(text);
        continue;
      }

      const escAt = pending.indexOf(ESC);
      if (escAt === -1) {
        forward(pending);
        pending = '';
        return;
      }
      if (escAt > 0) {
        forward(pending.slice(0, escAt));
        pending = pending.slice(escAt);
      }

      if (pending.startsWith(PASTE_START)) {
        pending = pending.slice(PASTE_START.length);
        pasting = true;
        pasteText = '';
        continue;
      }

      const mouse = MOUSE_SGR.exec(pending);
      if (mouse) {
        pending = pending.slice(mouse[0].length);
        onMouse({
          button: Number(mouse[1]),
          col: Number(mouse[2]),
          row: Number(mouse[3]),
          release: mouse[4] === 'm'
        });
        continue;
      }

      if (MOUSE_PREFIX.test(pending) || PASTE_START.startsWith(pending)) {
        timer = setTimeout(flushAmbiguous, AMBIGUOUS_ESC_TIMEOUT_MS);
        return;
      }

      // Outra sequência de escape: o readline a interpreta (setas, Home, Delete...).
      const nextEsc = pending.indexOf(ESC, 1);
      const cut = nextEsc === -1 ? pending.length : nextEsc;
      forward(pending.slice(0, cut));
      pending = pending.slice(cut);
    }
  };

  return {
    write(chunk) {
      if (closed) return;
      const text = typeof chunk === 'string' ? chunk : utf8.write(chunk);
      clearTimeout(timer);
      timer = null;
      pending += text;
      drain();
    },
    close() {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      timer = null;
      pending = '';
      pasting = false;
      pasteText = '';
      keys.removeAllListeners('keypress');
      keys.destroy();
    }
  };
}

function partialSuffixLength(text, marker) {
  for (let len = Math.min(text.length, marker.length - 1); len > 0; len--) {
    if (marker.startsWith(text.slice(text.length - len))) return len;
  }
  return 0;
}

/**
 * Offsets UTF-16 de todas as fronteiras de grafema, incluindo 0 e `text.length`.
 * @param {string} text
 * @returns {number[]}
 */
export function graphemeBoundaries(text) {
  const bounds = [];
  for (const { index } of graphemes.segment(text)) bounds.push(index);
  bounds.push(text.length);
  return bounds;
}

/**
 * Aplica uma ação de edição a um texto com cursor em fronteira de grafema.
 * @param {string} text
 * @param {number} cursor offset UTF-16
 * @param {{ type: 'insert', text: string } | { type: 'left' | 'right' | 'home' | 'end' | 'backspace' | 'delete' }} action
 * @returns {{ text: string, cursor: number }}
 */
export function editText(text, cursor, action) {
  const bounds = graphemeBoundaries(text);
  const at = snapIndex(bounds, cursor);
  const pos = bounds[at];

  switch (action.type) {
    case 'insert': {
      const next = text.slice(0, pos) + action.text + text.slice(pos);
      const target = pos + action.text.length;
      // A inserção pode se fundir a um grafema vizinho (ex.: acento combinante).
      const nextBounds = graphemeBoundaries(next);
      return { text: next, cursor: nextBounds.find((b) => b >= target) ?? next.length };
    }
    case 'left':
      return { text, cursor: bounds[Math.max(0, at - 1)] };
    case 'right':
      return { text, cursor: bounds[Math.min(bounds.length - 1, at + 1)] };
    case 'home':
      return { text, cursor: 0 };
    case 'end':
      return { text, cursor: text.length };
    case 'backspace': {
      if (at === 0) return { text, cursor: pos };
      const start = bounds[at - 1];
      return { text: text.slice(0, start) + text.slice(pos), cursor: start };
    }
    case 'delete': {
      if (at === bounds.length - 1) return { text, cursor: pos };
      return { text: text.slice(0, pos) + text.slice(bounds[at + 1]), cursor: pos };
    }
    default:
      return { text, cursor: pos };
  }
}

// Índice da maior fronteira <= cursor (cursor fora de fronteira recua para o início do grafema).
function snapIndex(bounds, cursor) {
  const c = Math.max(0, Math.min(Number.isFinite(cursor) ? cursor : 0, bounds[bounds.length - 1]));
  let i = 0;
  while (i + 1 < bounds.length && bounds[i + 1] <= c) i++;
  return i;
}
