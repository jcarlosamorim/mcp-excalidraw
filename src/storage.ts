// Persistência em disco do estado do canvas.
// Sem isto o servidor guarda tudo só em memória e perde os diagramas no restart.
// Estratégia: hidratar os Maps no boot, salvar um snapshot do estado em disco
// periodicamente (só quando muda) e no shutdown. Escrita atômica via tmp+rename.
import fs from 'fs';
import os from 'os';
import path from 'path';
import logger from './utils/logger.js';
import {
  elements,
  files,
  snapshots,
  ServerElement,
  ExcalidrawFile,
  Snapshot,
} from './types.js';

const DATA_DIR =
  process.env.CANVAS_DATA_DIR || path.join(os.homedir(), '.excalidraw-canvas');
const STATE_FILE = path.join(DATA_DIR, 'state.json');

let lastSerialized = '';

function serialize(): string {
  return JSON.stringify({
    version: 1,
    savedAt: new Date().toISOString(),
    elements: Array.from(elements.values()),
    files: Array.from(files.entries()),
    snapshots: Array.from(snapshots.entries()),
  });
}

export function hydrateFromDisk(): void {
  try {
    if (!fs.existsSync(STATE_FILE)) {
      logger.info(`No saved canvas state at ${STATE_FILE} (fresh start)`);
      return;
    }
    const data = JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    if (Array.isArray(data.elements)) {
      for (const el of data.elements) elements.set(el.id, el as ServerElement);
    }
    if (Array.isArray(data.files)) {
      for (const [id, f] of data.files) files.set(id, f as ExcalidrawFile);
    }
    if (Array.isArray(data.snapshots)) {
      for (const [name, s] of data.snapshots) snapshots.set(name, s as Snapshot);
    }
    lastSerialized = serialize();
    logger.info(`Restored ${elements.size} element(s) from ${STATE_FILE}`);
  } catch (err) {
    logger.error('Failed to load canvas state from disk:', err);
  }
}

export function persistNow(): void {
  try {
    const json = serialize();
    if (json === lastSerialized) return; // nada mudou, evita escrita à toa
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = `${STATE_FILE}.tmp`;
    fs.writeFileSync(tmp, json);
    fs.renameSync(tmp, STATE_FILE); // troca atômica
    lastSerialized = json;
  } catch (err) {
    logger.error('Failed to persist canvas state:', err);
  }
}

export function startPersistence(intervalMs = 5000): void {
  hydrateFromDisk();
  const timer = setInterval(persistNow, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();

  const flushAndExit = (code: number) => {
    persistNow();
    process.exit(code);
  };
  process.on('SIGINT', () => flushAndExit(0));
  process.on('SIGTERM', () => flushAndExit(0));
  process.on('beforeExit', () => persistNow());
  logger.info(`Canvas persistence active → ${STATE_FILE} (every ${intervalMs}ms)`);
}
