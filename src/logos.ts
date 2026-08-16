// Banco de logos: uma pasta em disco com as marcas que entram nos diagramas.
// O banco é a fonte; inserir uma logo no canvas copia a imagem pra dentro da
// cena (é assim que o Excalidraw trata imagem), então apagar do banco depois
// não estraga diagrama nenhum já feito.
import fs from 'fs';
import os from 'os';
import path from 'path';
import logger from './utils/logger.js';

const LOGOS_DIR =
  process.env.EXCALIDRAW_LOGOS_DIR ||
  path.join(process.env.CANVAS_DATA_DIR || path.join(os.homedir(), '.excalidraw-canvas'), 'logos');

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

export interface LogoInfo {
  /** id estável, derivado do nome do arquivo */
  id: string;
  /** rótulo legível */
  name: string;
  filename: string;
  mime: string;
  size: number;
  updatedAt: string;
  /** sufixo de variante do arquivo: brand, mono, e por aí vai */
  variant: string | null;
}

export const getLogosDir = (): string => LOGOS_DIR;

const ensureDir = (): void => {
  fs.mkdirSync(LOGOS_DIR, { recursive: true });
};

const isImage = (filename: string): boolean =>
  Object.prototype.hasOwnProperty.call(MIME_BY_EXT, path.extname(filename).toLowerCase());

/**
 * O id carrega a extensão porque `claude-brand.png` e `claude-brand.svg` são
 * duas logos diferentes do mesmo produto e as duas precisam caber no banco.
 */
export const idFor = (filename: string): string =>
  filename
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/\./g, '-');

const VARIANTS = ['brand', 'mono', 'white', 'black', 'color', 'dark', 'light'];

const labelFor = (filename: string): { name: string; variant: string | null } => {
  const base = filename.replace(/\.[^.]+$/, '');
  const parts = base.split(/[-_]/);
  const last = (parts[parts.length - 1] || '').toLowerCase();
  const variant = VARIANTS.includes(last) && parts.length > 1 ? last : null;
  const words = variant ? parts.slice(0, -1) : parts;
  const name = words
    .filter((word) => word.length > 0)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
  return { name: name || base, variant };
};

const infoFor = (filename: string): LogoInfo | null => {
  const full = path.join(LOGOS_DIR, filename);
  let stat: fs.Stats;
  try {
    stat = fs.statSync(full);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  const ext = path.extname(filename).toLowerCase();
  const { name, variant } = labelFor(filename);
  return {
    id: idFor(filename),
    name,
    filename,
    mime: MIME_BY_EXT[ext] || 'application/octet-stream',
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    variant,
  };
};

export const listLogos = (): LogoInfo[] => {
  ensureDir();
  let names: string[];
  try {
    names = fs.readdirSync(LOGOS_DIR);
  } catch (err) {
    logger.error('Falha ao ler o banco de logos:', err);
    return [];
  }
  return names
    .filter((name) => !name.startsWith('.') && isImage(name))
    .map(infoFor)
    .filter((logo): logo is LogoInfo => logo !== null)
    .sort((a, b) => a.name.localeCompare(b.name) || a.filename.localeCompare(b.filename));
};

/** Caminho do arquivo, recusando qualquer id que tente sair da pasta. */
export const pathFor = (id: string): { path: string; info: LogoInfo } | null => {
  const logo = listLogos().find((candidate) => candidate.id === id);
  if (!logo) return null;
  const full = path.join(LOGOS_DIR, logo.filename);
  if (path.dirname(path.resolve(full)) !== path.resolve(LOGOS_DIR)) return null;
  return { path: full, info: logo };
};

const uniqueName = (filename: string): string => {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = filename;
  let counter = 2;
  while (fs.existsSync(path.join(LOGOS_DIR, candidate))) {
    candidate = `${base}-${counter}${ext}`;
    counter += 1;
  }
  return candidate;
};

export interface ImportResult {
  imported: string[];
  /** já estava no banco com o mesmo conteúdo */
  skipped: string[];
  errors: string[];
}

/**
 * Copia as imagens de uma pasta pro banco. Arquivo idêntico é ignorado, arquivo
 * de mesmo nome e conteúdo diferente entra com sufixo: importar duas vezes não
 * duplica o banco nem sobrescreve o que já estava lá.
 */
export const importFromDir = (sourceDir: string): ImportResult => {
  ensureDir();
  const result: ImportResult = { imported: [], skipped: [], errors: [] };

  let entries: string[];
  try {
    entries = fs.readdirSync(sourceDir);
  } catch (err) {
    result.errors.push(`não consegui ler ${sourceDir}: ${(err as Error).message}`);
    return result;
  }

  for (const entry of entries) {
    if (entry.startsWith('.') || !isImage(entry)) continue;
    const from = path.join(sourceDir, entry);
    try {
      if (!fs.statSync(from).isFile()) continue;
      const source = fs.readFileSync(from);
      const target = path.join(LOGOS_DIR, entry);

      if (fs.existsSync(target)) {
        if (fs.readFileSync(target).equals(source)) {
          result.skipped.push(entry);
          continue;
        }
        const renamed = uniqueName(entry);
        fs.writeFileSync(path.join(LOGOS_DIR, renamed), source);
        result.imported.push(renamed);
        continue;
      }

      fs.writeFileSync(target, source);
      result.imported.push(entry);
    } catch (err) {
      result.errors.push(`${entry}: ${(err as Error).message}`);
    }
  }

  logger.info(
    `Banco de logos: ${result.imported.length} importada(s), ${result.skipped.length} já estava(m), ${result.errors.length} erro(s)`,
  );
  return result;
};

/** Guarda uma logo enviada pela interface (arrastar arquivo pro painel). */
export const saveLogo = (filename: string, dataURL: string): LogoInfo | null => {
  ensureDir();
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataURL);
  if (!match) return null;
  const [, mime, base64] = match;
  const ext =
    Object.entries(MIME_BY_EXT).find(([, value]) => value === mime)?.[0] ||
    path.extname(filename).toLowerCase();
  if (!ext || !Object.prototype.hasOwnProperty.call(MIME_BY_EXT, ext)) return null;

  const safe = path.basename(filename).replace(/[^a-zA-Z0-9._-]+/g, '-');
  const base = safe.replace(/\.[^.]+$/, '') || 'logo';
  const target = uniqueName(`${base}${ext}`);
  fs.writeFileSync(path.join(LOGOS_DIR, target), Buffer.from(base64 ?? '', 'base64'));
  return infoFor(target);
};

export const removeLogo = (id: string): boolean => {
  const found = pathFor(id);
  if (!found) return false;
  try {
    fs.unlinkSync(found.path);
    return true;
  } catch (err) {
    logger.error(`Falha ao remover a logo ${id}:`, err);
    return false;
  }
};
