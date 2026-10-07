import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const execFileAsync = promisify(execFile);
const binPath = path.resolve('bin/qr.js');

test('CLI: exibe versão com -v', async () => {
  const { stdout } = await execFileAsync(process.execPath, [binPath, '-v']);
  assert.match(stdout, /v1\.0\.0/);
});

test('CLI: exibe ajuda com -h', async () => {
  const { stdout } = await execFileAsync(process.execPath, [binPath, '-h']);
  assert.match(stdout, /QR Code Studio CLI/);
  assert.match(stdout, /--transparent/);
  assert.match(stdout, /EXEMPLOS:/);
});

test('CLI: gera QR code a partir de argumento posicional', async () => {
  const { stdout } = await execFileAsync(process.execPath, [binPath, 'https://github.com']);
  assert.match(stdout, /github\.com/);
  assert.match(stdout, /Nível M/);
});

test('CLI: suporta estilo dots no terminal', async () => {
  const { stdout } = await execFileAsync(process.execPath, [
    binPath,
    'https://github.com',
    '--style',
    'dots'
  ]);
  assert.match(stdout, /●/);
  assert.match(stdout, /dots/);
});

test('CLI: exporta arquivo com -o e flag -q (quiet)', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qr-cli-test-'));
  const pngPath = path.join(tmpDir, 'cli-qr.png');

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      binPath,
      'https://github.com',
      '-o',
      pngPath,
      '-q'
    ]);
    assert.match(stdout, /QR Code salvo com sucesso!/);
    assert.match(stdout, /PNG/);

    const stat = await fs.stat(pngPath);
    assert.ok(stat.size > 100);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('CLI: exporta PNG transparente com estilo dots', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qr-cli-test-'));
  const pngPath = path.join(tmpDir, 'dots-transparent.png');

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      binPath,
      'https://github.com',
      '-o',
      pngPath,
      '--style',
      'dots',
      '--transparent',
      '-q'
    ]);
    assert.match(stdout, /QR Code salvo com sucesso!/);
    assert.match(stdout, /Transparente/);
    assert.match(stdout, /dots/);

    const stat = await fs.stat(pngPath);
    assert.ok(stat.size > 100);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('CLI: exporta SVG com estilo rounded e cor personalizada', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qr-cli-test-'));
  const svgPath = path.join(tmpDir, 'rounded.svg');

  try {
    const { stdout } = await execFileAsync(process.execPath, [
      binPath,
      'https://github.com',
      '-o',
      svgPath,
      '--style',
      'rounded',
      '--color-dark',
      '#2563eb',
      '-q'
    ]);
    assert.match(stdout, /QR Code salvo com sucesso!/);
    assert.match(stdout, /SVG/);

    const content = await fs.readFile(svgPath, 'utf8');
    assert.ok(content.includes('rx="0.25"'));
    assert.ok(content.includes('#2563eb'));
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('CLI: aceita entrada via pipe/stdin', async () => {
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'qr-pipe-test-'));
  const outPath = path.join(tmpDir, 'pipe.png');

  try {
    await new Promise((resolve, reject) => {
      const proc = execFile(process.execPath, [binPath, '-q', '-o', outPath], (err, stdout) => {
        if (err) return reject(err);
        try {
          assert.match(stdout, /QR Code salvo com sucesso!/);
          resolve();
        } catch (e) {
          reject(e);
        }
      });

      proc.stdin.write('https://link-via-pipe.com\n');
      proc.stdin.end();
    });

    const stat = await fs.stat(outPath);
    assert.ok(stat.size > 100);
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true });
  }
});

test('CLI: retorna erro para nível de correção inválido', async () => {
  await assert.rejects(
    async () => execFileAsync(process.execPath, [binPath, 'texto', '-e', 'Z']),
    (err) => {
      assert.ok(err.stderr.includes('Nível de correção inválido') || err.stdout.includes('Nível de correção inválido'));
      return true;
    }
  );
});

test('CLI: rejeita --tui sem TTY interativo', async () => {
  await assert.rejects(
    async () => execFileAsync(process.execPath, [binPath, '--tui']),
    (err) => {
      assert.notEqual(err.code, 0);
      assert.match(err.stderr, /A TUI requer stdin e stdout em um terminal interativo\./);
      assert.equal(err.stdout, '');
      assert.ok(!err.stdout.includes('\x1b[?1049h'));
      assert.ok(!err.stdout.includes('\x1b[?1000h'));
      return true;
    }
  );
});
