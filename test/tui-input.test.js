import test from 'node:test';
import assert from 'node:assert/strict';
import { stripVTControlCharacters } from 'node:util';
import { createInputDecoder, editText, graphemeBoundaries } from '../src/tui-input.js';
import { createTuiState, handleKeyAction, handlePasteAction, renderTuiScreen } from '../src/tui.js';

test('TUI Input: bytes UTF-8 fragmentados reconstroem grafemas esperados', () => {
  const keys = [];
  const decoder = createInputDecoder({
    onKey(str) {
      if (str !== undefined) keys.push(str);
    }
  });

  const buf = Buffer.from('a🙂é', 'utf8');
  for (let i = 0; i < buf.length; i++) {
    decoder.write(buf.subarray(i, i + 1));
  }
  decoder.close();

  assert.deepEqual(keys, ['a', '🙂', 'é']);
});

test('TUI Input: relatório SGR de mouse fragmentado não emite teclas e trata release', () => {
  const keys = [];
  const mouseEvents = [];
  const decoder = createInputDecoder({
    onKey(str, key) {
      keys.push({ str, key });
    },
    onMouse(event) {
      mouseEvents.push(event);
    }
  });

  // \x1b[<0;10;3M dividido em 3 pedaços
  decoder.write('\x1b[<0;');
  decoder.write('10;');
  decoder.write('3M');

  assert.equal(keys.length, 0);
  assert.equal(mouseEvents.length, 1);
  assert.deepEqual(mouseEvents[0], {
    button: 0,
    col: 10,
    row: 3,
    release: false
  });

  // Evento de soltura indicado por 'm'
  decoder.write('\x1b[<0;10;3m');
  assert.equal(keys.length, 0);
  assert.equal(mouseEvents.length, 2);
  assert.deepEqual(mouseEvents[1], {
    button: 0,
    col: 10,
    row: 3,
    release: true
  });

  decoder.close();
});

test('TUI Input: bracketed paste fragmentado chama onPaste uma vez sem emitir teclas', () => {
  const keys = [];
  const pasted = [];
  const decoder = createInputDecoder({
    onKey(str, key) {
      keys.push({ str, key });
    },
    onPaste(text) {
      pasted.push(text);
    }
  });

  decoder.write('\x1b[20');
  decoder.write('0~x\r');
  decoder.write('4\x1b[2');
  decoder.write('01~');

  assert.equal(keys.length, 0);
  assert.deepEqual(pasted, ['x\r4']);

  decoder.close();
});

test('TUI Input: integração com tui.js preserva foco ao colar e exibe quebra segura na linha 7', () => {
  const state = createTuiState({ content: 'abc' });
  const decoder = createInputDecoder({
    onKey(str, key) {
      handleKeyAction(state, str, key);
    },
    onPaste(text) {
      handlePasteAction(state, text);
    }
  });

  decoder.write('\x1b[20');
  decoder.write('0~x\r');
  decoder.write('4\x1b[2');
  decoder.write('01~');
  decoder.close();

  assert.equal(state.content, 'abcx\n4');
  assert.equal(state.tabIndex, 0);
  assert.equal(state.fieldIndex, 0);

  const frame = renderTuiScreen(state, 80, 24);
  const lines = frame.split('\n');
  assert.equal(lines.length, 24);

  const row7Plain = stripVTControlCharacters(lines[7]);
  assert.ok(row7Plain.includes('↵'));
  assert.ok(row7Plain.includes('abcx↵4'));
});

test('TUI Input: digitação com seta e caractere via decoder insere no meio do texto', () => {
  const state = createTuiState({ content: 'abc' });
  const decoder = createInputDecoder({
    onKey(str, key) {
      handleKeyAction(state, str, key);
    }
  });

  decoder.write('\x1b[D');
  decoder.write('X');
  decoder.close();

  assert.equal(state.content, 'abXc');
  assert.equal(state.cursorPos, 3);
});

test('TUI Input: ESC isolado emite escape após timeout e close cancela evento pendente', async () => {
  const events1 = [];
  const decoder1 = createInputDecoder({
    onKey(str, key) {
      events1.push({ str, key });
    }
  });

  decoder1.write('\x1b');
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(events1.length, 1);
  assert.equal(events1[0].key?.name, 'escape');
  decoder1.close();

  const events2 = [];
  const decoder2 = createInputDecoder({
    onKey(str, key) {
      events2.push({ str, key });
    }
  });

  decoder2.write('\x1b');
  decoder2.close();
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(events2.length, 0);
});

test('TUI Input: sequência CSI desconhecida não gera inserção no campo de texto', () => {
  const state = createTuiState({ content: 'abc' });
  const decoder = createInputDecoder({
    onKey(str, key) {
      handleKeyAction(state, str, key);
    }
  });

  decoder.write('\x1b[5;9~');
  decoder.close();

  assert.equal(state.content, 'abc');
  assert.equal(state.cursorPos, 3);
});

test('TUI Input: editText trata inserção no meio, emojis complexos, acento combinante e bordas', () => {
  // 1. Inserção no meio
  const inserted = editText('ac', 1, { type: 'insert', text: 'b' });
  assert.deepEqual(inserted, { text: 'abc', cursor: 2 });

  // 2. Movimento esquerda/direita sobre par substituto (surrogate pair)
  const spText = 'a🙂b';
  const spLeft = editText(spText, 3, { type: 'left' });
  assert.equal(spLeft.cursor, 1);
  assert.equal(spLeft.text, spText);

  const spRight = editText(spText, 1, { type: 'right' });
  assert.equal(spRight.cursor, 3);
  assert.equal(spRight.text, spText);

  // Movimento esquerda/direita sobre emoji com tom de pele (skin tone)
  const stText = 'a👍🏽b';
  const stLeft = editText(stText, 5, { type: 'left' });
  assert.equal(stLeft.cursor, 1);

  const stRight = editText(stText, 1, { type: 'right' });
  assert.equal(stRight.cursor, 5);

  // Movimento esquerda/direita sobre emoji com ZWJ
  const zwjText = 'a👨‍💻b';
  const zwjLeft = editText(zwjText, 6, { type: 'left' });
  assert.equal(zwjLeft.cursor, 1);

  const zwjRight = editText(zwjText, 1, { type: 'right' });
  assert.equal(zwjRight.cursor, 6);

  // 3. Inserção de acento combinante mantém cursor na fronteira do grafema
  const combined = editText('e', 1, { type: 'insert', text: '\u0301' });
  assert.equal(combined.text, 'e\u0301');
  assert.equal(combined.cursor, 2);
  const bounds = graphemeBoundaries(combined.text);
  assert.ok(bounds.includes(combined.cursor));

  // 4. Backspace no início e delete no final são operações no-op
  const atStart = editText('abc', 0, { type: 'backspace' });
  assert.deepEqual(atStart, { text: 'abc', cursor: 0 });

  const atEnd = editText('abc', 3, { type: 'delete' });
  assert.deepEqual(atEnd, { text: 'abc', cursor: 3 });

  // Texto vazio
  assert.deepEqual(editText('', 0, { type: 'backspace' }), { text: '', cursor: 0 });
  assert.deepEqual(editText('', 0, { type: 'delete' }), { text: '', cursor: 0 });
});
