import test from 'node:test';
import assert from 'node:assert/strict';
import { card, color, createSpinner, stripAnsi, truncateAnsi } from '../src/ui.js';

test('stripAnsi remueve secuencias de escape ANSI', () => {
  assert.equal(stripAnsi(color.bold('Hola mundo')), 'Hola mundo');
  assert.equal(stripAnsi(color.cyan(color.dim('Texto'))), 'Texto');
  assert.equal(stripAnsi('Texto sin formato'), 'Texto sin formato');
});

test('truncateAnsi recorta respetando ancho visible y códigos ANSI', () => {
  assert.equal(truncateAnsi('Texto corto', 20), 'Texto corto');
  const truncated = truncateAnsi(color.bold('Super título demasiado largo para la caja'), 15);
  assert.equal(stripAnsi(truncated).length, 15);
  assert.ok(stripAnsi(truncated).endsWith('…'));
});

test('card produce un cuadro con bordes de ancho uniforme', () => {
  const originalLog = console.log;
  const loggedLines = [];
  console.log = (line) => loggedLines.push(stripAnsi(line));

  try {
    card('Empecemos', [
      'Escribe el nombre de una canción, pega un enlace o indica un .txt.',
      'Selección inteligente: descarga audio puro (evitando videoclips).',
    ]);

    assert.ok(loggedLines.length >= 4);
    const expectedWidth = loggedLines[0].length;
    for (const line of loggedLines) {
      assert.equal(line.length, expectedWidth, `La línea "${line}" no tiene el ancho esperado de ${expectedWidth}`);
      assert.ok(line.startsWith('╭') || line.startsWith('│') || line.startsWith('╰'));
      assert.ok(line.endsWith('╮') || line.endsWith('│') || line.endsWith('╯'));
    }
  } finally {
    console.log = originalLog;
  }
});

test('card mantiene dimensiones perfectas incluso con líneas extra largas', () => {
  const originalLog = console.log;
  const loggedLines = [];
  console.log = (line) => loggedLines.push(stripAnsi(line));

  try {
    card('Título muy largo', [
      'Esta es una línea excesivamente larga '.repeat(5),
      'Línea corta',
    ]);

    assert.ok(loggedLines.length >= 4);
    const expectedWidth = loggedLines[0].length;
    for (const line of loggedLines) {
      assert.equal(line.length, expectedWidth, `La línea "${line}" tiene ancho ${line.length}, se esperaba ${expectedWidth}`);
    }
  } finally {
    console.log = originalLog;
  }
});

test('badge genera etiquetas formateadas', () => {
  assert.equal(stripAnsi(color.badge('MP3')), '[MP3]');
});

test('createSpinner gestiona texto y estado', () => {
  const spinner = createSpinner('Iniciando…');
  assert.equal(spinner.text, 'Iniciando…');
  spinner.update('Procesando…');
  assert.equal(spinner.text, 'Procesando…');
  spinner.stop();
});

test('selectItemInteractive maneja listas vacías y fallback en entornos no-TTY (5B)', async () => {
  const { selectItemInteractive } = await import('../src/ui.js');
  assert.equal(await selectItemInteractive([]), null);

  const items = [
    { title: 'Canción 1', artist: 'Artista 1' },
    { title: 'Canción 2', artist: 'Artista 2' },
  ];
  const selected = await selectItemInteractive(items, (i) => `${i.title} - ${i.artist}`, async () => '2');
  assert.deepEqual(selected, items[1]);
});
