import { convertToExcalidrawElements } from '@excalidraw/excalidraw'

/**
 * Card stack: colunas de cards estilo Kanban desenhadas com elementos nativos
 * do Excalidraw. Nada aqui é um componente especial. Coluna e card são
 * retângulos comuns marcados via `customData.cardStack`, então tudo persiste
 * no backend, exporta em imagem e continua visível pro MCP.
 */

export const CARD_STACK_KEY = 'cardStack'

export type StackRole = 'column' | 'title' | 'card'

export interface StackMeta {
  role: StackRole
  /** Coluna dona. `null` num card = card solto, fora de qualquer pilha. */
  columnId: string | null
}

// Geometria (unidades de cena)
export const COLUMN_WIDTH = 300
export const COLUMN_PADDING = 14
export const COLUMN_HEADER = 58
export const COLUMN_MIN_HEIGHT = 620
export const COLUMN_GAP = 40
export const CARD_WIDTH = COLUMN_WIDTH - COLUMN_PADDING * 2
export const CARD_MIN_HEIGHT = 76
export const CARD_GAP = 12
export const TITLE_FONT_SIZE = 20
export const CARD_FONT_SIZE = 16

// Mesma paleta semântica do agente de diagramação: fundo claro + traço escuro,
// pro texto herdar o traço e continuar legível quando o Excalidraw inverte o tema.
export const COLUMN_STYLE = { fill: '#e9ecef', stroke: '#868e96' }
export const TITLE_COLOR = '#212529'
export const CARD_COLORS = [
  { name: 'azul', fill: '#a5d8ff', stroke: '#0b3d66' },
  { name: 'verde', fill: '#b2f2bb', stroke: '#0c4a1c' },
  { name: 'amarelo', fill: '#ffe699', stroke: '#7a4d00' },
  { name: 'vermelho', fill: '#ffc9c9', stroke: '#7a1515' },
  { name: 'roxo', fill: '#d0bfff', stroke: '#341d66' },
  { name: 'laranja', fill: '#ffd8a8', stroke: '#7a3d00' },
] as const

export const DEFAULT_CARD_COLOR = CARD_COLORS[0]

type AnyElement = any

const newId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `cs-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

export const getStackMeta = (element: AnyElement): StackMeta | null => {
  const meta = element?.customData?.[CARD_STACK_KEY]
  if (!meta || typeof meta !== 'object') return null
  if (meta.role !== 'column' && meta.role !== 'title' && meta.role !== 'card') return null
  return { role: meta.role, columnId: meta.columnId ?? null }
}

export const isColumn = (element: AnyElement): boolean => getStackMeta(element)?.role === 'column'
export const isTitle = (element: AnyElement): boolean => getStackMeta(element)?.role === 'title'
export const isCard = (element: AnyElement): boolean => getStackMeta(element)?.role === 'card'
export const isStackElement = (element: AnyElement): boolean => getStackMeta(element) !== null

const withMeta = (element: AnyElement, meta: StackMeta): AnyElement => ({
  ...element,
  customData: { ...(element.customData || {}), [CARD_STACK_KEY]: meta },
})

const overlapArea = (a: AnyElement, b: AnyElement): number => {
  const dx = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const dy = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  if (dx <= 0 || dy <= 0) return 0
  return dx * dy
}

/** Retângulo de referência: onde a próxima coluna cabe sem encostar nas outras. */
export const nextColumnPosition = (elements: readonly AnyElement[]): { x: number; y: number } => {
  const columns = elements.filter(isColumn)
  if (columns.length === 0) return { x: 0, y: 0 }
  const rightmost = columns.reduce((acc, col) => (col.x > acc.x ? col : acc), columns[0])
  const topmost = columns.reduce((acc, col) => (col.y < acc.y ? col : acc), columns[0])
  return { x: rightmost.x + rightmost.width + COLUMN_GAP, y: topmost.y }
}

/**
 * Cria uma coluna vazia (retângulo + título como texto solto, editável com
 * duplo clique). Devolve os elementos já convertidos pelo Excalidraw.
 */
export const createColumnElements = (options: {
  x: number
  y: number
  title?: string
}): { elements: AnyElement[]; columnId: string } => {
  const columnId = newId()
  const title = options.title ?? 'Nova coluna'

  const skeletons: AnyElement[] = [
    {
      type: 'rectangle',
      id: columnId,
      x: options.x,
      y: options.y,
      width: COLUMN_WIDTH,
      height: COLUMN_MIN_HEIGHT,
      backgroundColor: COLUMN_STYLE.fill,
      strokeColor: COLUMN_STYLE.stroke,
      strokeWidth: 1,
      strokeStyle: 'solid',
      fillStyle: 'solid',
      roughness: 0,
      roundness: { type: 3 },
    },
    {
      type: 'text',
      id: newId(),
      x: options.x + COLUMN_PADDING,
      y: options.y + 18,
      text: title,
      fontSize: TITLE_FONT_SIZE,
      fontFamily: 2,
      strokeColor: TITLE_COLOR,
      textAlign: 'center',
      verticalAlign: 'top',
    },
  ]

  const converted = convertToExcalidrawElements(skeletons as any, { regenerateIds: false })
  const elements = converted.map((element: AnyElement) =>
    element.type === 'text'
      ? withMeta(element, { role: 'title', columnId })
      : withMeta(element, { role: 'column', columnId }),
  )

  return { elements, columnId }
}

/** Onde termina a pilha de uma coluna, em coordenada de cena. */
export const stackBottom = (elements: readonly AnyElement[], columnId: string): number => {
  const cards = elements.filter(
    (element) => isCard(element) && getStackMeta(element)?.columnId === columnId,
  )
  const column = elements.find(
    (element) => isColumn(element) && (getStackMeta(element)?.columnId ?? element.id) === columnId,
  )
  if (!column) return 0
  let cursorY = column.y + COLUMN_HEADER
  for (const card of cards.sort((a, b) => a.y - b.y)) {
    cursorY += Math.max(CARD_MIN_HEIGHT, card.height) + CARD_GAP
  }
  return cursorY
}

/**
 * Acrescenta um card no fim da pilha da coluna. Devolve a cena inteira: a coluna
 * pode precisar esticar no mesmo passo, senão o card nasceria fora dela e o
 * layout, que decide dono por sobreposição, o trataria como card solto.
 */
export const appendCardToColumn = (
  elements: readonly AnyElement[],
  columnElementId: string,
  options: { text?: string; color?: { fill: string; stroke: string } } = {},
): { elements: AnyElement[]; cardId: string } | null => {
  const column = elements.find((element) => element.id === columnElementId)
  if (!column || !isColumn(column)) return null

  const columnId = getStackMeta(column)?.columnId ?? column.id
  const cardId = newId()
  const color = options.color ?? DEFAULT_CARD_COLOR
  const top = stackBottom(elements, columnId)
  const neededHeight = top + CARD_MIN_HEIGHT + COLUMN_PADDING - column.y

  const skeleton: AnyElement = {
    type: 'rectangle',
    id: cardId,
    x: column.x + COLUMN_PADDING,
    y: top,
    width: CARD_WIDTH,
    height: CARD_MIN_HEIGHT,
    backgroundColor: color.fill,
    strokeColor: color.stroke,
    strokeWidth: 1,
    strokeStyle: 'solid',
    fillStyle: 'solid',
    roughness: 0,
    roundness: { type: 3 },
    label: {
      text: options.text ?? 'Novo card',
      fontSize: CARD_FONT_SIZE,
      fontFamily: 2,
      textAlign: 'left',
      verticalAlign: 'top',
    },
  }

  const converted = convertToExcalidrawElements([skeleton] as any, { regenerateIds: false })
  const created = converted.map((element: AnyElement) =>
    element.type === 'rectangle' ? withMeta(element, { role: 'card', columnId }) : element,
  )

  const grown = elements.map((element) =>
    element.id === column.id && element.height < neededHeight
      ? { ...element, height: neededHeight }
      : element,
  )

  return { elements: [...grown, ...created], cardId }
}

interface Patch {
  x?: number
  y?: number
  width?: number
  height?: number
  customData?: Record<string, any>
}

const nearlyEqual = (a: number, b: number): boolean => Math.abs(a - b) < 0.01

/**
 * Reempilha todas as colunas: reatribui cards pela sobreposição real (é isso que
 * faz o arrastar-entre-colunas funcionar), ordena por posição vertical, encaixa
 * com espaçamento uniforme e ajusta a altura da coluna ao conteúdo.
 *
 * Função pura: devolve a nova lista e se algo mudou de fato.
 */
export const layoutStacks = (
  elements: readonly AnyElement[],
): { elements: AnyElement[]; changed: boolean } => {
  const columns = elements.filter(isColumn)
  if (columns.length === 0) return { elements: elements as AnyElement[], changed: false }

  const patches = new Map<string, Patch>()
  const patchOf = (id: string): Patch => {
    let patch = patches.get(id)
    if (!patch) {
      patch = {}
      patches.set(id, patch)
    }
    return patch
  }

  // 1. Cada card pertence à coluna com maior sobreposição. Sem sobreposição
  //    nenhuma, o card fica solto e o layout não mexe mais nele. Em empate a
  //    coluna atual vence: colunas sobrepostas não roubam card uma da outra.
  const ownerOf = new Map<string, string | null>()
  for (const card of elements.filter(isCard)) {
    const meta = getStackMeta(card)!
    let best: AnyElement | null = null
    let bestArea = 0
    for (const column of columns) {
      const area = overlapArea(card, column)
      if (area <= 0 || area < bestArea) continue
      const isCurrent = (getStackMeta(column)?.columnId ?? column.id) === meta.columnId
      if (area > bestArea || isCurrent) {
        bestArea = area
        best = column
      }
    }
    const nextColumnId = best ? (getStackMeta(best)?.columnId ?? best.id) : null
    ownerOf.set(card.id, nextColumnId)
    if (meta.columnId !== nextColumnId) {
      patchOf(card.id).customData = {
        ...(card.customData || {}),
        [CARD_STACK_KEY]: { role: 'card', columnId: nextColumnId },
      }
    }
  }

  const titles = elements.filter(isTitle)

  // 2. Empilha cada coluna.
  for (const column of columns) {
    const columnId = getStackMeta(column)?.columnId ?? column.id
    const mine = elements
      .filter((element) => isCard(element) && ownerOf.get(element.id) === columnId)
      .sort((a, b) => a.y - b.y)

    let cursorY = column.y + COLUMN_HEADER
    for (const card of mine) {
      const height = Math.max(CARD_MIN_HEIGHT, card.height)
      const x = column.x + COLUMN_PADDING
      const patch = patchOf(card.id)
      if (!nearlyEqual(card.x, x)) patch.x = x
      if (!nearlyEqual(card.y, cursorY)) patch.y = cursorY
      if (!nearlyEqual(card.width, CARD_WIDTH)) patch.width = CARD_WIDTH
      if (!nearlyEqual(card.height, height)) patch.height = height
      cursorY += height + CARD_GAP
    }

    const needed = cursorY - column.y + COLUMN_PADDING
    const height = Math.max(COLUMN_MIN_HEIGHT, needed)
    if (!nearlyEqual(column.height, height)) patchOf(column.id).height = height

    const title = titles.find((element) => getStackMeta(element)?.columnId === columnId)
    if (title) {
      const x = column.x + (column.width - title.width) / 2
      const y = column.y + 18
      const patch = patchOf(title.id)
      if (!nearlyEqual(title.x, x)) patch.x = x
      if (!nearlyEqual(title.y, y)) patch.y = y
    }
  }

  // patchOf cria a entrada antes de saber se algo mudou: descarta as vazias,
  // senão o layout se declara "mudado" toda vez e o app entra em ciclo.
  for (const [id, patch] of patches) {
    if (Object.keys(patch).length === 0) patches.delete(id)
  }
  if (patches.size === 0) return { elements: elements as AnyElement[], changed: false }

  return { elements: applyPatches(elements, patches), changed: true }
}

/**
 * Aplica patches de posição levando junto o texto preso dentro de cada forma.
 * O bound text tem coordenadas próprias: sem isso, o card anda e o texto fica.
 */
const applyPatches = (
  elements: readonly AnyElement[],
  patches: Map<string, Patch>,
): AnyElement[] => {
  const boundTextPatches = new Map<
    string,
    { x: number; y: number; width: number; height: number }
  >()

  for (const element of elements) {
    const patch = patches.get(element.id)
    if (!patch) continue
    const boundTextId = (element.boundElements || []).find((b: any) => b?.type === 'text')?.id
    if (!boundTextId) continue

    const nextX = patch.x ?? element.x
    const nextY = patch.y ?? element.y
    const nextWidth = patch.width ?? element.width
    const nextHeight = patch.height ?? element.height
    boundTextPatches.set(boundTextId, {
      x: nextX,
      y: nextY,
      width: nextWidth,
      height: nextHeight,
    })
  }

  return elements.map((element) => {
    const containerBox = boundTextPatches.get(element.id)
    if (containerBox && element.type === 'text') {
      return { ...element, ...positionBoundText(element, containerBox) }
    }

    const patch = patches.get(element.id)
    if (!patch) return element
    return { ...element, ...patch }
  })
}

const BOUND_TEXT_PADDING = 5

/** Mesma regra do Excalidraw: alinhamento decide o canto, com padding de 5px. */
export const positionBoundText = (
  text: AnyElement,
  container: { x: number; y: number; width: number; height: number },
): { x: number; y: number } => {
  const align = text.textAlign || 'center'
  const valign = text.verticalAlign || 'middle'

  const x =
    align === 'left'
      ? container.x + BOUND_TEXT_PADDING
      : align === 'right'
        ? container.x + container.width - text.width - BOUND_TEXT_PADDING
        : container.x + (container.width - text.width) / 2

  const y =
    valign === 'top'
      ? container.y + BOUND_TEXT_PADDING
      : valign === 'bottom'
        ? container.y + container.height - text.height - BOUND_TEXT_PADDING
        : container.y + (container.height - text.height) / 2

  return { x, y }
}

// ─── título do card ───────────────────────────────────────────

const BOUND_TEXT_LINE_HEIGHT = 1.25

let measureCanvas: HTMLCanvasElement | null = null

/** Largura real do texto na fonte do card. Injetável pra poder testar sem DOM. */
export type Measurer = (text: string, fontSize: number) => number

const defaultMeasurer: Measurer = (text, fontSize) => {
  if (typeof document === 'undefined') return text.length * fontSize * 0.55
  if (!measureCanvas) measureCanvas = document.createElement('canvas')
  const context = measureCanvas.getContext('2d')
  if (!context) return text.length * fontSize * 0.55
  context.font = `${fontSize}px Helvetica, Segoe UI, sans-serif`
  return context.measureText(text).width
}

/** Quebra igual à do Excalidraw: por palavra, e corta palavra que não cabe. */
export const wrapText = (
  text: string,
  fontSize: number,
  maxWidth: number,
  measure: Measurer = defaultMeasurer,
): string[] => {
  const lines: string[] = []
  for (const paragraph of text.split('\n')) {
    if (paragraph === '') {
      lines.push('')
      continue
    }
    let current = ''
    for (const word of paragraph.split(' ')) {
      const candidate = current ? `${current} ${word}` : word
      if (measure(candidate, fontSize) <= maxWidth || current === '') {
        current = candidate
        continue
      }
      lines.push(current)
      current = word
    }
    lines.push(current)
  }
  return lines.length > 0 ? lines : ['']
}

/**
 * Troca o texto do card e refaz medida, quebra e altura. Sem isso, mudar o
 * título por fora do canvas deixa o texto cortado ou vazando da forma.
 */
export const applyCardTitle = (
  elements: readonly AnyElement[],
  cardId: string,
  title: string,
  measure: Measurer = defaultMeasurer,
): { elements: AnyElement[]; changed: boolean } => {
  const card = elements.find((element) => element.id === cardId)
  if (!card || !isCard(card)) return { elements: elements as AnyElement[], changed: false }

  const textId = (card.boundElements || []).find((b: any) => b?.type === 'text')?.id
  const textElement = textId ? elements.find((element) => element.id === textId) : undefined
  if (!textElement) return { elements: elements as AnyElement[], changed: false }

  const fontSize = textElement.fontSize || CARD_FONT_SIZE
  const maxWidth = card.width - BOUND_TEXT_PADDING * 2
  const lines = wrapText(title, fontSize, maxWidth, measure)
  const width = Math.min(
    maxWidth,
    Math.max(...lines.map((line) => measure(line, fontSize)), 0),
  )
  const height = lines.length * fontSize * BOUND_TEXT_LINE_HEIGHT
  const cardHeight = Math.max(CARD_MIN_HEIGHT, height + BOUND_TEXT_PADDING * 2)

  const nextCard = { ...card, height: cardHeight }
  const nextText = {
    ...textElement,
    text: lines.join('\n'),
    originalText: title,
    width,
    height,
    ...positionBoundText({ ...textElement, width, height }, nextCard),
  }

  return {
    elements: elements.map((element) => {
      if (element.id === card.id) return nextCard
      if (element.id === textElement.id) return nextText
      return element
    }),
    changed: true,
  }
}

/** Texto atual do card (o `originalText` do bound text). */
export const getCardTitle = (elements: readonly AnyElement[], cardId: string): string => {
  const card = elements.find((element) => element.id === cardId)
  if (!card) return ''
  const textId = (card.boundElements || []).find((b: any) => b?.type === 'text')?.id
  const textElement = textId ? elements.find((element) => element.id === textId) : undefined
  return textElement?.originalText ?? textElement?.text ?? ''
}

/** Apagar o card leva junto o texto preso nele. */
export const removeCard = (elements: readonly AnyElement[], cardId: string): AnyElement[] => {
  const card = elements.find((element) => element.id === cardId)
  if (!card) return elements as AnyElement[]
  const textId = (card.boundElements || []).find((b: any) => b?.type === 'text')?.id
  return elements.filter((element) => element.id !== cardId && element.id !== textId)
}

/**
 * Arrastar a coluna leva os cards e o título junto, em tempo real.
 * `previous` guarda a última posição conhecida de cada coluna.
 */
export const translateColumnChildren = (
  elements: readonly AnyElement[],
  previous: Map<string, { x: number; y: number }>,
): { elements: AnyElement[]; changed: boolean } => {
  const deltas = new Map<string, { dx: number; dy: number }>()

  for (const column of elements.filter(isColumn)) {
    const columnId = getStackMeta(column)?.columnId ?? column.id
    const before = previous.get(column.id)
    if (!before) continue
    const dx = column.x - before.x
    const dy = column.y - before.y
    if (nearlyEqual(dx, 0) && nearlyEqual(dy, 0)) continue
    deltas.set(columnId, { dx, dy })
  }

  if (deltas.size === 0) return { elements: elements as AnyElement[], changed: false }

  const patches = new Map<string, Patch>()
  for (const element of elements) {
    const meta = getStackMeta(element)
    if (!meta || meta.role === 'column' || !meta.columnId) continue
    const delta = deltas.get(meta.columnId)
    if (!delta) continue
    patches.set(element.id, { x: element.x + delta.dx, y: element.y + delta.dy })
  }

  if (patches.size === 0) return { elements: elements as AnyElement[], changed: false }
  return { elements: applyPatches(elements, patches), changed: true }
}

export const snapshotColumnPositions = (
  elements: readonly AnyElement[],
): Map<string, { x: number; y: number }> => {
  const snapshot = new Map<string, { x: number; y: number }>()
  for (const column of elements.filter(isColumn)) {
    snapshot.set(column.id, { x: column.x, y: column.y })
  }
  return snapshot
}

/**
 * Apagar a coluna apaga o que estava dentro dela. Sem isso, os cards ficariam
 * órfãos flutuando no canvas.
 */
export const collectColumnCascade = (
  elements: readonly AnyElement[],
  columnElementIds: readonly string[],
): Set<string> => {
  const columnIds = new Set<string>()
  for (const element of elements) {
    if (!columnElementIds.includes(element.id) || !isColumn(element)) continue
    columnIds.add(getStackMeta(element)?.columnId ?? element.id)
  }

  const doomed = new Set<string>()
  if (columnIds.size === 0) return doomed

  for (const element of elements) {
    const meta = getStackMeta(element)
    if (!meta) continue
    if (meta.role === 'column' && columnIds.has(meta.columnId ?? element.id)) {
      doomed.add(element.id)
    } else if (meta.columnId && columnIds.has(meta.columnId)) {
      doomed.add(element.id)
      const boundTextId = (element.boundElements || []).find((b: any) => b?.type === 'text')?.id
      if (boundTextId) doomed.add(boundTextId)
    }
  }

  return doomed
}
