// Projetos do canvas: cada projeto é uma cena completa, num arquivo .excalidraw
// de verdade dentro de uma pasta única. O SQLite é só catálogo (recentes, nomes,
// datas): se ele sumir, `rescanProjects()` reconstrói tudo lendo a pasta.
//
// Por que arquivo e não tudo no banco: .excalidraw abre no excalidraw.com, entra
// em backup e versionamento, e sobrevive a qualquer decisão futura sobre o banco.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { DatabaseSync } from 'node:sqlite';
import logger from './utils/logger.js';
import { elements, files, ServerElement, ExcalidrawFile } from './types.js';

const DATA_DIR =
  process.env.CANVAS_DATA_DIR || path.join(os.homedir(), '.excalidraw-canvas');
const PROJECTS_DIR =
  process.env.EXCALIDRAW_PROJECTS_DIR || path.join(os.homedir(), 'Documents', 'Excalidraw');
const TRASH_DIR = path.join(PROJECTS_DIR, '.trash');
const DB_FILE = path.join(DATA_DIR, 'projects.db');
const EXT = '.excalidraw';

export interface ProjectRow {
  id: string;
  name: string;
  filename: string;
  created_at: string;
  updated_at: string;
  opened_at: string;
  element_count: number;
}

export interface ProjectInfo extends ProjectRow {
  isCurrent: boolean;
  path: string;
}

let db: DatabaseSync | null = null;

/**
 * Muda a cada troca de projeto. O front manda o epoch que ele conhece no sync;
 * se estiver velho, o sync é recusado. Sem isso, um auto-sync em voo da cena
 * antiga sobrescreve o projeto recém-aberto.
 */
let sceneEpoch = 1;
export const getSceneEpoch = (): number => sceneEpoch;

const nowIso = (): string => new Date().toISOString();

const newId = (): string =>
  `prj_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

function ensureDirs(): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

function getDb(): DatabaseSync {
  if (db) return db;
  ensureDirs();
  db = new DatabaseSync(DB_FILE);
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      filename TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      opened_at TEXT NOT NULL,
      element_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS app_state (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  return db;
}

const getState = (key: string): string | null => {
  const row = getDb().prepare('SELECT value FROM app_state WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
};

const setState = (key: string, value: string): void => {
  getDb()
    .prepare('INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value);
};

/**
 * Nome único no catálogo. Sem isto, a lista enche de "Sem título" idênticos e
 * escolher qual abrir vira adivinhação.
 */
function uniqueName(base: string, ignoreId?: string): string {
  const rows = getDb().prepare('SELECT id, name FROM projects').all() as {
    id: string;
    name: string;
  }[];
  const taken = new Set(
    rows.filter((r) => r.id !== ignoreId).map((r) => r.name.toLocaleLowerCase()),
  );
  if (!taken.has(base.toLocaleLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`.toLocaleLowerCase())) n += 1;
  return `${base} ${n}`;
}

/** Nome de arquivo legível e seguro, com sufixo numérico se já existir. */
function fileNameFor(name: string, ignoreId?: string): string {
  const base =
    name
      .trim()
      .replace(/[/\\:*?"<>|]/g, '-')
      .replace(/\s+/g, ' ')
      .slice(0, 80) || 'Sem titulo';

  let candidate = `${base}${EXT}`;
  let n = 2;
  while (true) {
    const taken = getDb()
      .prepare('SELECT id FROM projects WHERE filename = ?')
      .get(candidate) as { id: string } | undefined;
    const onDisk = fs.existsSync(path.join(PROJECTS_DIR, candidate));
    const freeInDb = !taken || taken.id === ignoreId;
    if (freeInDb && !onDisk) return candidate;
    if (freeInDb && onDisk && taken?.id === ignoreId) return candidate;
    candidate = `${base} ${n}${EXT}`;
    n += 1;
  }
}

// ─── serialização da cena ─────────────────────────────────────

const SERVER_ONLY_FIELDS = ['syncedAt', 'source', 'syncTimestamp'] as const;

function cleanForFile(element: ServerElement): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...element };
  for (const field of SERVER_ONLY_FIELDS) delete copy[field];
  return copy;
}

/** Formato oficial do .excalidraw, pro arquivo abrir em qualquer Excalidraw. */
export function serializeScene(): string {
  const filesObj: Record<string, ExcalidrawFile> = {};
  files.forEach((f, id) => {
    filesObj[id] = f;
  });
  return JSON.stringify(
    {
      type: 'excalidraw',
      version: 2,
      source: 'excalidraw-canvas',
      elements: Array.from(elements.values()).map(cleanForFile),
      appState: { viewBackgroundColor: '#ffffff', gridSize: null },
      files: filesObj,
    },
    null,
    2,
  );
}

function writeFileAtomic(target: string, content: string): void {
  const tmp = `${target}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, target);
}

/** Aceita o formato oficial e também um `{elements: []}` solto. */
function parseSceneFile(raw: string): { elements: any[]; files: Record<string, ExcalidrawFile> } {
  const data = JSON.parse(raw);
  const list = Array.isArray(data) ? data : Array.isArray(data.elements) ? data.elements : [];
  const fileMap =
    data && typeof data.files === 'object' && data.files !== null ? data.files : {};
  return { elements: list, files: fileMap };
}

function loadSceneIntoMemory(fullPath: string): number {
  const parsed = parseSceneFile(fs.readFileSync(fullPath, 'utf-8'));
  elements.clear();
  files.clear();
  for (const el of parsed.elements) {
    if (el && el.id) elements.set(el.id, el as ServerElement);
  }
  for (const [id, f] of Object.entries(parsed.files)) {
    if (f && (f as ExcalidrawFile).dataURL) files.set(id, f as ExcalidrawFile);
  }
  return elements.size;
}

// ─── catálogo ─────────────────────────────────────────────────

const rowById = (id: string): ProjectRow | undefined =>
  getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectRow | undefined;

export const projectPath = (row: ProjectRow): string => path.join(PROJECTS_DIR, row.filename);

export const getProjectsDir = (): string => PROJECTS_DIR;

export function getCurrentProject(): ProjectInfo | null {
  const id = getState('current_project_id');
  if (!id) return null;
  const row = rowById(id);
  if (!row) return null;
  return { ...row, isCurrent: true, path: projectPath(row) };
}

export function listProjects(): ProjectInfo[] {
  const currentId = getState('current_project_id');
  const rows = getDb()
    .prepare('SELECT * FROM projects ORDER BY opened_at DESC')
    .all() as ProjectRow[];
  return rows.map((row) => ({
    ...row,
    isCurrent: row.id === currentId,
    path: projectPath(row),
  }));
}

/** Grava a cena viva no arquivo do projeto ativo. É o auto-save. */
export function saveCurrentProject(): ProjectInfo | null {
  const current = getCurrentProject();
  if (!current) return null;
  try {
    ensureDirs();
    writeFileAtomic(current.path, serializeScene());
    const updatedAt = nowIso();
    getDb()
      .prepare('UPDATE projects SET updated_at = ?, element_count = ? WHERE id = ?')
      .run(updatedAt, elements.size, current.id);
    return { ...current, updated_at: updatedAt, element_count: elements.size };
  } catch (err) {
    logger.error('Failed to save current project:', err);
    return null;
  }
}

export function createProject(name?: string, seedFromMemory = false): ProjectInfo {
  ensureDirs();
  const finalName = uniqueName((name || '').trim() || 'Sem título');
  const filename = fileNameFor(finalName);
  const id = newId();
  const stamp = nowIso();

  if (!seedFromMemory) {
    elements.clear();
    files.clear();
  }
  writeFileAtomic(path.join(PROJECTS_DIR, filename), serializeScene());

  getDb()
    .prepare(
      'INSERT INTO projects (id, name, filename, created_at, updated_at, opened_at, element_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, finalName, filename, stamp, stamp, stamp, elements.size);
  setState('current_project_id', id);
  sceneEpoch += 1;

  const row = rowById(id)!;
  return { ...row, isCurrent: true, path: projectPath(row) };
}

/** Salva o projeto atual antes de trocar: trocar nunca pode perder trabalho. */
export function openProject(id: string): ProjectInfo {
  const row = rowById(id);
  if (!row) throw new Error(`Projeto ${id} não encontrado`);

  const target = projectPath(row);
  if (!fs.existsSync(target)) {
    throw new Error(`Arquivo do projeto não existe: ${target}`);
  }

  const current = getCurrentProject();
  if (current && current.id !== id) saveCurrentProject();

  const count = loadSceneIntoMemory(target);
  const openedAt = nowIso();
  getDb()
    .prepare('UPDATE projects SET opened_at = ?, element_count = ? WHERE id = ?')
    .run(openedAt, count, id);
  setState('current_project_id', id);
  sceneEpoch += 1;

  const fresh = rowById(id)!;
  return { ...fresh, isCurrent: true, path: projectPath(fresh) };
}

export function renameProject(id: string, name: string): ProjectInfo {
  const row = rowById(id);
  if (!row) throw new Error(`Projeto ${id} não encontrado`);
  const finalName = uniqueName(name.trim(), id);
  if (!name.trim()) throw new Error('Nome vazio');

  const nextFilename = fileNameFor(finalName, id);
  const from = projectPath(row);
  const to = path.join(PROJECTS_DIR, nextFilename);
  if (from !== to && fs.existsSync(from)) fs.renameSync(from, to);

  getDb()
    .prepare('UPDATE projects SET name = ?, filename = ?, updated_at = ? WHERE id = ?')
    .run(finalName, nextFilename, nowIso(), id);

  const fresh = rowById(id)!;
  return { ...fresh, isCurrent: getState('current_project_id') === id, path: projectPath(fresh) };
}

/**
 * Apagar move o arquivo pra .trash em vez de destruir. Se o projeto apagado era
 * o aberto, cai no mais recente que sobrou (ou cria um vazio).
 */
export function deleteProject(id: string): { deleted: ProjectRow; current: ProjectInfo | null } {
  const row = rowById(id);
  if (!row) throw new Error(`Projeto ${id} não encontrado`);

  const from = projectPath(row);
  if (fs.existsSync(from)) {
    fs.mkdirSync(TRASH_DIR, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    fs.renameSync(from, path.join(TRASH_DIR, `${stamp} ${row.filename}`));
  }
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id);

  const wasCurrent = getState('current_project_id') === id;
  if (!wasCurrent) return { deleted: row, current: getCurrentProject() };

  const next = getDb()
    .prepare('SELECT * FROM projects ORDER BY opened_at DESC LIMIT 1')
    .get() as ProjectRow | undefined;

  if (next) return { deleted: row, current: openProject(next.id) };
  return { deleted: row, current: createProject('Sem título') };
}

export function duplicateProject(id: string, name?: string): ProjectInfo {
  const row = rowById(id);
  if (!row) throw new Error(`Projeto ${id} não encontrado`);
  const finalName = uniqueName((name || `${row.name} cópia`).trim());
  const filename = fileNameFor(finalName);
  fs.copyFileSync(projectPath(row), path.join(PROJECTS_DIR, filename));

  const newProjectId = newId();
  const stamp = nowIso();
  getDb()
    .prepare(
      'INSERT INTO projects (id, name, filename, created_at, updated_at, opened_at, element_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(newProjectId, finalName, filename, stamp, stamp, stamp, row.element_count);

  const fresh = rowById(newProjectId)!;
  return { ...fresh, isCurrent: false, path: projectPath(fresh) };
}

/** Cria projeto a partir de um .excalidraw vindo de fora (Downloads, etc). */
export function importScene(name: string, rawContent: string): ProjectInfo {
  const parsed = parseSceneFile(rawContent);
  ensureDirs();
  const finalName = uniqueName((name || '').trim() || 'Importado');
  const filename = fileNameFor(finalName);
  writeFileAtomic(
    path.join(PROJECTS_DIR, filename),
    JSON.stringify(
      {
        type: 'excalidraw',
        version: 2,
        source: 'excalidraw-canvas',
        elements: parsed.elements,
        appState: { viewBackgroundColor: '#ffffff', gridSize: null },
        files: parsed.files,
      },
      null,
      2,
    ),
  );

  const id = newId();
  const stamp = nowIso();
  getDb()
    .prepare(
      'INSERT INTO projects (id, name, filename, created_at, updated_at, opened_at, element_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(id, finalName, filename, stamp, stamp, stamp, parsed.elements.length);

  const row = rowById(id)!;
  return { ...row, isCurrent: false, path: projectPath(row) };
}

/**
 * Sincroniza catálogo e pasta nos dois sentidos: registra .excalidraw que
 * apareceram por fora e remove do catálogo o que não existe mais em disco.
 */
export function rescanProjects(): { added: number; removed: number } {
  ensureDirs();
  const onDisk = fs
    .readdirSync(PROJECTS_DIR)
    .filter((f) => f.endsWith(EXT) && !f.startsWith('.'));

  const known = new Set(
    (getDb().prepare('SELECT filename FROM projects').all() as { filename: string }[]).map(
      (r) => r.filename,
    ),
  );

  let added = 0;
  for (const filename of onDisk) {
    if (known.has(filename)) continue;
    const full = path.join(PROJECTS_DIR, filename);
    let count = 0;
    try {
      count = parseSceneFile(fs.readFileSync(full, 'utf-8')).elements.length;
    } catch {
      continue; // não é cena válida, ignora
    }
    const stat = fs.statSync(full);
    getDb()
      .prepare(
        'INSERT INTO projects (id, name, filename, created_at, updated_at, opened_at, element_count) VALUES (?, ?, ?, ?, ?, ?, ?)',
      )
      .run(
        newId(),
        filename.slice(0, -EXT.length),
        filename,
        stat.birthtime.toISOString(),
        stat.mtime.toISOString(),
        stat.mtime.toISOString(),
        count,
      );
    added += 1;
  }

  const diskSet = new Set(onDisk);
  const rows = getDb().prepare('SELECT id, filename FROM projects').all() as {
    id: string;
    filename: string;
  }[];
  let removed = 0;
  for (const row of rows) {
    if (diskSet.has(row.filename)) continue;
    getDb().prepare('DELETE FROM projects WHERE id = ?').run(row.id);
    removed += 1;
  }

  return { added, removed };
}

// ─── resgate da pasta Downloads ───────────────────────────────
// O Ctrl+S do Excalidraw joga .excalidraw em Downloads. Isso traz os arquivos
// perdidos lá pra dentro da pasta de projetos, sem sair do canvas.

const DOWNLOADS_DIR = process.env.EXCALIDRAW_DOWNLOADS_DIR || path.join(os.homedir(), 'Downloads');

export interface LooseScene {
  filename: string;
  path: string;
  modifiedAt: string;
  bytes: number;
  elementCount: number;
  alreadyImported: boolean;
}

export function listLooseScenes(): LooseScene[] {
  if (!fs.existsSync(DOWNLOADS_DIR)) return [];
  const known = new Set(
    (getDb().prepare('SELECT filename FROM projects').all() as { filename: string }[]).map(
      (r) => r.filename,
    ),
  );

  const found: LooseScene[] = [];
  for (const filename of fs.readdirSync(DOWNLOADS_DIR)) {
    if (!filename.endsWith(EXT) || filename.startsWith('.')) continue;
    const full = path.join(DOWNLOADS_DIR, filename);
    try {
      const stat = fs.statSync(full);
      if (!stat.isFile()) continue;
      const count = parseSceneFile(fs.readFileSync(full, 'utf-8')).elements.length;
      found.push({
        filename,
        path: full,
        modifiedAt: stat.mtime.toISOString(),
        bytes: stat.size,
        elementCount: count,
        alreadyImported: known.has(filename),
      });
    } catch {
      // arquivo ilegível ou não é cena: ignora em silêncio
    }
  }
  return found.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt));
}

/** Copia (não move) pra pasta de projetos: o original em Downloads fica intacto. */
export function importLooseScenes(filenames: string[]): ProjectInfo[] {
  const imported: ProjectInfo[] = [];
  for (const filename of filenames) {
    const safe = path.basename(filename);
    const full = path.join(DOWNLOADS_DIR, safe);
    if (!safe.endsWith(EXT) || !fs.existsSync(full)) continue;
    try {
      imported.push(importScene(safe.slice(0, -EXT.length), fs.readFileSync(full, 'utf-8')));
    } catch (err) {
      logger.error(`Falha ao importar ${safe}:`, err);
    }
  }
  return imported;
}

/**
 * Boot. Se já existe cena em memória (o state.json de antes dos projetos) e
 * nenhum projeto ativo, adota esse conteúdo como primeiro projeto em vez de
 * descartar o que o usuário já tinha desenhado.
 */
export function initProjects(): ProjectInfo {
  ensureDirs();
  getDb();
  rescanProjects();

  const current = getCurrentProject();
  if (current && fs.existsSync(current.path)) {
    // Reabre o último projeto pra memória e disco começarem iguais.
    try {
      loadSceneIntoMemory(current.path);
      logger.info(`Projeto ativo: ${current.name} (${elements.size} elementos)`);
      return current;
    } catch (err) {
      logger.error('Falha ao abrir o projeto ativo, criando um novo:', err);
    }
  }

  if (elements.size > 0) {
    const adopted = createProject('Canvas anterior', true);
    logger.info(`Cena existente adotada como projeto "${adopted.name}"`);
    return adopted;
  }

  const first = listProjects()[0];
  if (first) return openProject(first.id);
  return createProject('Sem título');
}

let lastSaved = '';

/** Auto-save: só escreve quando a cena mudou de verdade. */
export function autoSaveTick(): void {
  const current = getCurrentProject();
  if (!current) return;
  const json = serializeScene();
  if (json === lastSaved) return;
  saveCurrentProject();
  lastSaved = json;
}

export function startProjectAutosave(intervalMs = 4000): void {
  const timer = setInterval(autoSaveTick, intervalMs);
  if (typeof timer.unref === 'function') timer.unref();
  process.on('SIGINT', () => autoSaveTick());
  process.on('SIGTERM', () => autoSaveTick());
  process.on('beforeExit', () => autoSaveTick());
  logger.info(`Projetos em ${PROJECTS_DIR} (auto-save a cada ${intervalMs}ms)`);
}
