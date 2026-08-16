import { convertToExcalidrawElements } from '@excalidraw/excalidraw'
import { positionBoundText } from './cardStack'

/**
 * Mindmap estilo Whimsical desenhado com elementos nativos do Excalidraw.
 * Mesma regra do card stack: não existe "objeto mapa mental". A raiz é um
 * retângulo com label, cada tópico é um texto solto, cada ligação é uma linha
 * curva, e o parentesco mora em `customData.mindmap`.
 *
 * Consequência prática: o mapa persiste no state.json, exporta em imagem,
 * aparece pro MCP e continua editável com as ferramentas normais do canvas.
 *
 * Layout: a raiz é a âncora (o usuário arrasta ela e o mapa inteiro segue).
 * Todo o resto é derivado, então nó nenhum guarda posição própria de verdade.
 */

export const MINDMAP_KEY = 'mindmap'

export interface NodeMeta {
  role: 'node'
  /** id do elemento raiz: identifica o mapa. */
  mapId: string
  /** id do elemento pai. `null` só na raiz. */
  parentId: string | null
  /** índice na paleta de ramos, herdado do ancestral de nível 1. -1 na raiz. */
  branch: number
  /** filhos escondidos (ficam invisíveis e travados, nunca apagados). */
  collapsed: boolean
}

export interface EdgeMeta {
  role: 'edge'
  mapId: string
  parentId: string
  childId: string
  branch: number
}

export type MindmapMeta = NodeMeta | EdgeMeta

// Geometria (unidades de cena)
export const ROOT_WIDTH = 280
export const ROOT_HEIGHT = 92
export const ROOT_FONT_SIZE = 28
/** filhos diretos da raiz */
export const TOPIC_FONT_SIZE = 20
/** nível 2 pra baixo */
export const LEAF_FONT_SIZE = 18
/** distância horizontal mínima entre o fim do pai e o começo do filho */
export const H_GAP = 92
/**
 * Quanto mais alto o leque, mais longe os filhos ficam. Sem isto a curva de um
 * ramo que sobe 300px em 92px de avanço vira um laço em pé, colado no pai.
 */
export const H_SPREAD_FACTOR = 0.28
export const H_GAP_MAX_EXTRA = 170

export const horizontalGapFor = (spread: number, nodeHeight: number): number =>
  H_GAP + Math.min(H_GAP_MAX_EXTRA, Math.max(0, spread - nodeHeight) * H_SPREAD_FACTOR)
/** folga entre a ponta da linha e o texto, pra curva não encostar na palavra */
export const EDGE_GAP = 8
/**
 * Ponto onde as linhas de um mesmo pai se juntam, à direita dele. É daqui que
 * o leque abre, e é aqui que mora a bolinha de retrair.
 */
export const HUB_OFFSET = 26

/**
 * Respiro vertical entre irmãos, por profundidade do filho. Ramo de primeiro
 * nível recebe mais folga: é o que faz o mapa abrir em leque em vez de virar
 * uma lista grudada.
 */
export const V_GAP_BY_DEPTH = [40, 72, 46, 34] as const
/** Cada folha a mais num ramo empurra os vizinhos mais um tanto. */
export const FAN_STEP = 12
export const FAN_MAX = 140
/** respiro base, usado da profundidade 3 pra baixo */
export const V_GAP = V_GAP_BY_DEPTH[V_GAP_BY_DEPTH.length - 1]

/**
 * Vão entre dois irmãos: base da profundidade mais um extra proporcional ao
 * tamanho dos dois ramos. Assim cada tópico novo dentro de um ramo afasta os
 * ramos vizinhos, em vez de só empurrar o suficiente pra não colidir.
 */
export const gapBetween = (depth: number, leavesA: number, leavesB: number): number => {
  const base = V_GAP_BY_DEPTH[Math.min(Math.max(depth, 0), V_GAP_BY_DEPTH.length - 1)]
  const extra = Math.min(FAN_MAX, FAN_STEP * (Math.max(0, leavesA - 1) + Math.max(0, leavesB - 1)))
  return base + extra
}
/** raio de captura ao soltar um nó em cima de outro */
export const DROP_RADIUS = 320

/**
 * Fundo claro e traço escuro, a mesma regra do agente de diagramação: o texto
 * herda o traço, e no tema escuro o Excalidraw inverte fundo e texto juntos.
 * Cor chapada e escura aqui viraria texto ilegível num dos dois temas.
 */
export const ROOT_STYLE = { fill: '#f1f3f5', stroke: '#343a40' }

export const BRANCH_COLORS = [
  { name: 'roxo', line: '#7048e8', text: '#4c1d95' },
  { name: 'azul', line: '#1c7ed6', text: '#0b3d66' },
  { name: 'verde', line: '#2f9e44', text: '#0c4a1c' },
  { name: 'laranja', line: '#e8590c', text: '#7a3d00' },
  { name: 'rosa', line: '#c2255c', text: '#7a1040' },
  { name: 'ciano', line: '#0c8599', text: '#0b4f5c' },
] as const

/**
 * Cor da bolinha de retrair: a cor com que as linhas daquele nó são desenhadas.
 * Na raiz cada filho tem a sua, então ali vale o traço neutro da forma.
 */
export const hubColorOf = (node: any): string => {
  const meta = node?.customData?.[MINDMAP_KEY]
  if (!meta || meta.role !== 'node') return ROOT_STYLE.stroke
  if (meta.parentId === null || typeof meta.branch !== 'number' || meta.branch < 0) {
    return ROOT_STYLE.stroke
  }
  return branchColor(meta.branch).line
}

export const branchColor = (branch: number) =>
  BRANCH_COLORS[((branch % BRANCH_COLORS.length) + BRANCH_COLORS.length) % BRANCH_COLORS.length]

type AnyElement = any

const newId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `mm-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

const nearlyEqual = (a: number, b: number): boolean => Math.abs(a - b) < 0.01

// ─── modelo ───────────────────────────────────────────────────

export const getMindmapMeta = (element: AnyElement): MindmapMeta | null => {
  const meta = element?.customData?.[MINDMAP_KEY]
  if (!meta || typeof meta !== 'object') return null
  if (meta.role === 'node') {
    return {
      role: 'node',
      mapId: meta.mapId,
      parentId: meta.parentId ?? null,
      branch: typeof meta.branch === 'number' ? meta.branch : 0,
      collapsed: Boolean(meta.collapsed),
    }
  }
  if (meta.role === 'edge') {
    return {
      role: 'edge',
      mapId: meta.mapId,
      parentId: meta.parentId,
      childId: meta.childId,
      branch: typeof meta.branch === 'number' ? meta.branch : 0,
    }
  }
  return null
}

export const getNodeMeta = (element: AnyElement): NodeMeta | null => {
  const meta = getMindmapMeta(element)
  return meta && meta.role === 'node' ? meta : null
}

export const getEdgeMeta = (element: AnyElement): EdgeMeta | null => {
  const meta = getMindmapMeta(element)
  return meta && meta.role === 'edge' ? meta : null
}

export const isMindmapNode = (element: AnyElement): boolean => getNodeMeta(element) !== null
export const isMindmapEdge = (element: AnyElement): boolean => getEdgeMeta(element) !== null
export const isMindmapElement = (element: AnyElement): boolean => getMindmapMeta(element) !== null
export const isMindmapRoot = (element: AnyElement): boolean => getNodeMeta(element)?.parentId === null

const withMeta = (element: AnyElement, meta: MindmapMeta): AnyElement => ({
  ...element,
  customData: { ...(element.customData || {}), [MINDMAP_KEY]: meta },
})

const alive = (elements: readonly AnyElement[]): AnyElement[] =>
  elements.filter((element) => !element.isDeleted)

export const childrenOf = (
  elements: readonly AnyElement[],
  parentElementId: string,
): AnyElement[] =>
  alive(elements)
    .filter((element) => getNodeMeta(element)?.parentId === parentElementId)
    .sort((a, b) => a.y - b.y)

/** Nó + tudo que pende dele. Usado por apagar, colapsar e proibir ciclo. */
export const descendantsOf = (
  elements: readonly AnyElement[],
  nodeElementId: string,
): AnyElement[] => {
  const out: AnyElement[] = []
  const queue = [nodeElementId]
  const seen = new Set<string>([nodeElementId])
  while (queue.length > 0) {
    const current = queue.shift() as string
    for (const child of childrenOf(elements, current)) {
      if (seen.has(child.id)) continue
      seen.add(child.id)
      out.push(child)
      queue.push(child.id)
    }
  }
  return out
}

export const depthOf = (elements: readonly AnyElement[], nodeElementId: string): number => {
  const byId = new Map(elements.map((element) => [element.id, element]))
  let depth = 0
  let current = byId.get(nodeElementId)
  const seen = new Set<string>()
  while (current && !seen.has(current.id)) {
    seen.add(current.id)
    const parentId = getNodeMeta(current)?.parentId
    if (!parentId) break
    depth += 1
    current = byId.get(parentId)
  }
  return depth
}

const fontSizeForDepth = (depth: number): number =>
  depth <= 1 ? TOPIC_FONT_SIZE : LEAF_FONT_SIZE

const strokeWidthForDepth = (depth: number): number => (depth <= 1 ? 4 : depth === 2 ? 3 : 2)

// ─── criação ──────────────────────────────────────────────────

/** Onde um mapa novo cabe sem cair em cima de outro. */
export const nextMapPosition = (
  elements: readonly AnyElement[],
  fallback: { x: number; y: number },
): { x: number; y: number } => {
  const roots = alive(elements).filter(isMindmapRoot)
  if (roots.length === 0) return fallback
  const lowest = roots.reduce((acc, root) => (root.y > acc.y ? root : acc), roots[0])
  const branchDepth = descendantsOf(elements, lowest.id).length
  return { x: lowest.x, y: lowest.y + ROOT_HEIGHT + 160 + branchDepth * 8 }
}

export const createRootElements = (options: {
  x: number
  y: number
  text?: string
}): { elements: AnyElement[]; rootId: string } => {
  const rootId = newId()

  const skeleton: AnyElement = {
    type: 'rectangle',
    id: rootId,
    x: options.x,
    y: options.y,
    width: ROOT_WIDTH,
    height: ROOT_HEIGHT,
    backgroundColor: ROOT_STYLE.fill,
    strokeColor: ROOT_STYLE.stroke,
    strokeWidth: 2,
    strokeStyle: 'solid',
    fillStyle: 'solid',
    roughness: 0,
    roundness: { type: 3 },
    label: {
      text: options.text ?? 'Ideia central',
      fontSize: ROOT_FONT_SIZE,
      fontFamily: 2,
      textAlign: 'center',
      verticalAlign: 'middle',
    },
  }

  const converted = convertToExcalidrawElements([skeleton] as any, { regenerateIds: false })
  const elements = converted.map((element: AnyElement) =>
    element.type === 'rectangle'
      ? withMeta(element, { role: 'node', mapId: rootId, parentId: null, branch: -1, collapsed: false })
      : element,
  )

  return { elements, rootId }
}

/** Próxima cor livre entre os filhos diretos da raiz. */
const nextBranch = (elements: readonly AnyElement[], rootElementId: string): number => {
  const used = childrenOf(elements, rootElementId).map((child) => getNodeMeta(child)!.branch)
  for (let candidate = 0; candidate < BRANCH_COLORS.length; candidate += 1) {
    if (!used.includes(candidate)) return candidate
  }
  return used.length % BRANCH_COLORS.length
}

/**
 * Cria um tópico filho. `insertAfterId` posiciona o novo nó logo abaixo de um
 * irmão específico: o layout ordena irmãos por y, então nascer meio pixel
 * abaixo já garante a posição certa na lista sem guardar índice nenhum.
 */
export const createChildElements = (
  elements: readonly AnyElement[],
  parentElementId: string,
  options: { text?: string; insertAfterId?: string } = {},
): { elements: AnyElement[]; nodeId: string } | null => {
  const parent = elements.find((element) => element.id === parentElementId)
  const parentMeta = getNodeMeta(parent)
  if (!parent || !parentMeta) return null

  const nodeId = newId()
  const isRootParent = parentMeta.parentId === null
  const branch = isRootParent ? nextBranch(elements, parent.id) : parentMeta.branch
  const depth = depthOf(elements, parent.id) + 1
  const color = branchColor(branch)

  const siblings = childrenOf(elements, parent.id)
  const anchor = options.insertAfterId
    ? siblings.find((sibling) => sibling.id === options.insertAfterId)
    : undefined
  const y = anchor
    ? anchor.y + 0.5
    : siblings.length > 0
      ? siblings[siblings.length - 1].y + 60
      : parent.y + parent.height / 2

  const skeleton: AnyElement = {
    type: 'text',
    id: nodeId,
    x: parent.x + parent.width + H_GAP,
    y,
    text: options.text ?? 'Novo tópico',
    fontSize: fontSizeForDepth(depth),
    fontFamily: 2,
    strokeColor: color.text,
    textAlign: 'left',
    verticalAlign: 'top',
  }

  const converted = convertToExcalidrawElements([skeleton] as any, { regenerateIds: false })
  const created = converted.map((element: AnyElement) =>
    withMeta(element, {
      role: 'node',
      mapId: parentMeta.mapId,
      parentId: parent.id,
      branch,
      collapsed: false,
    }),
  )

  // Um pai colapsado esconderia o filho recém-criado: abre junto.
  const opened = parentMeta.collapsed
    ? elements.map((element) =>
        element.id === parent.id
          ? withMeta(element, { ...parentMeta, collapsed: false })
          : element,
      )
    : (elements as AnyElement[])

  return { elements: [...opened, ...created], nodeId }
}

// ─── parentesco ───────────────────────────────────────────────

/** Reaplica cor e tamanho de fonte quando o nó troca de ramo ou de nível. */
const restyleBranch = (
  elements: readonly AnyElement[],
  rootOfBranchId: string,
  branch: number,
): AnyElement[] => {
  const affected = new Map<string, number>()
  affected.set(rootOfBranchId, depthOf(elements, rootOfBranchId))
  for (const node of descendantsOf(elements, rootOfBranchId)) {
    affected.set(node.id, depthOf(elements, node.id))
  }

  const color = branchColor(branch)
  return elements.map((element) => {
    const depth = affected.get(element.id)
    if (depth === undefined) return element
    const meta = getNodeMeta(element)
    if (!meta) return element
    const next: AnyElement = {
      ...withMeta(element, { ...meta, branch }),
      strokeColor: color.text,
    }
    if (element.type === 'text') next.fontSize = fontSizeForDepth(depth)
    return next
  })
}

export const canReparent = (
  elements: readonly AnyElement[],
  nodeElementId: string,
  nextParentId: string,
): boolean => {
  if (nodeElementId === nextParentId) return false
  const node = elements.find((element) => element.id === nodeElementId)
  const parent = elements.find((element) => element.id === nextParentId)
  if (!getNodeMeta(node) || !getNodeMeta(parent)) return false
  if (getNodeMeta(node)!.parentId === null) return false
  // Virar filho do próprio descendente cortaria o ramo do mapa.
  return !descendantsOf(elements, nodeElementId).some((child) => child.id === nextParentId)
}

export const reparent = (
  elements: readonly AnyElement[],
  nodeElementId: string,
  nextParentId: string,
): { elements: AnyElement[]; changed: boolean } => {
  if (!canReparent(elements, nodeElementId, nextParentId)) {
    return { elements: elements as AnyElement[], changed: false }
  }
  const node = elements.find((element) => element.id === nodeElementId)!
  const meta = getNodeMeta(node)!
  if (meta.parentId === nextParentId) return { elements: elements as AnyElement[], changed: false }

  const parent = elements.find((element) => element.id === nextParentId)!
  const parentMeta = getNodeMeta(parent)!
  const branch =
    parentMeta.parentId === null ? nextBranch(elements, parent.id) : parentMeta.branch

  const relinked = elements.map((element) =>
    element.id === nodeElementId
      ? withMeta(element, { ...meta, parentId: nextParentId, branch })
      : element.id === nextParentId && parentMeta.collapsed
        ? withMeta(element, { ...parentMeta, collapsed: false })
        : element,
  )

  return { elements: restyleBranch(relinked, nodeElementId, branch), changed: true }
}

/** Sobe o nó um nível (vira irmão do antigo pai). É o Shift+Tab do Whimsical. */
export const outdent = (
  elements: readonly AnyElement[],
  nodeElementId: string,
): { elements: AnyElement[]; changed: boolean } => {
  const node = elements.find((element) => element.id === nodeElementId)
  const meta = getNodeMeta(node)
  if (!node || !meta || !meta.parentId) return { elements: elements as AnyElement[], changed: false }
  const parent = elements.find((element) => element.id === meta.parentId)
  const parentMeta = getNodeMeta(parent)
  // Pai é a raiz: já está no primeiro nível, não há pra onde subir.
  if (!parent || !parentMeta || !parentMeta.parentId) {
    return { elements: elements as AnyElement[], changed: false }
  }
  return reparent(elements, nodeElementId, parentMeta.parentId)
}

/**
 * Melhor pai pra um nó recém-solto: o nó do mesmo mapa cuja borda direita está
 * mais perto da borda esquerda do nó movido. É o análogo do card stack, onde
 * quem manda é a geometria e não uma declaração, e é o que faz o arrastar
 * reorganizar o mapa sem código de drag-and-drop.
 */
export const findDropParent = (
  elements: readonly AnyElement[],
  nodeElementId: string,
): string | null => {
  const node = elements.find((element) => element.id === nodeElementId)
  const meta = getNodeMeta(node)
  if (!node || !meta || meta.parentId === null) return null

  const forbidden = new Set(descendantsOf(elements, nodeElementId).map((child) => child.id))
  forbidden.add(nodeElementId)

  const anchorX = node.x
  const anchorY = node.y + node.height / 2

  let best: string | null = null
  let bestDistance = DROP_RADIUS
  for (const candidate of alive(elements)) {
    const candidateMeta = getNodeMeta(candidate)
    if (!candidateMeta || candidateMeta.mapId !== meta.mapId) continue
    if (forbidden.has(candidate.id)) continue
    const dx = anchorX - (candidate.x + candidate.width)
    const dy = anchorY - (candidate.y + candidate.height / 2)
    // Pai fica à esquerda: soltar à esquerda do candidato custa caro, mas não
    // é proibido, senão arrastar um pouco pra trás soltaria o nó no vazio.
    const distance = Math.hypot(dx < 0 ? dx * 2.5 : dx, dy)
    if (distance < bestDistance) {
      bestDistance = distance
      best = candidate.id
    }
  }
  return best
}

export const toggleCollapse = (
  elements: readonly AnyElement[],
  nodeElementId: string,
): { elements: AnyElement[]; changed: boolean } => {
  const node = elements.find((element) => element.id === nodeElementId)
  const meta = getNodeMeta(node)
  if (!node || !meta) return { elements: elements as AnyElement[], changed: false }
  if (childrenOf(elements, nodeElementId).length === 0) {
    return { elements: elements as AnyElement[], changed: false }
  }
  return {
    elements: elements.map((element) =>
      element.id === nodeElementId
        ? withMeta(element, { ...meta, collapsed: !meta.collapsed })
        : element,
    ),
    changed: true,
  }
}

/** Apagar um nó leva o ramo inteiro, os textos presos e as linhas. */
export const collectMindmapCascade = (
  elements: readonly AnyElement[],
  removedElementIds: readonly string[],
): Set<string> => {
  const doomed = new Set<string>()
  const targets = removedElementIds.filter((id) => {
    const element = elements.find((candidate) => candidate.id === id)
    return Boolean(getNodeMeta(element))
  })
  if (targets.length === 0) return doomed

  for (const id of targets) {
    doomed.add(id)
    for (const child of descendantsOf(elements, id)) doomed.add(child.id)
  }

  for (const element of elements) {
    if (!doomed.has(element.id)) continue
    const boundTextId = (element.boundElements || []).find((b: any) => b?.type === 'text')?.id
    if (boundTextId) doomed.add(boundTextId)
  }

  for (const element of elements) {
    const edge = getEdgeMeta(element)
    if (edge && (doomed.has(edge.childId) || doomed.has(edge.parentId))) doomed.add(element.id)
  }

  return doomed
}

// ─── layout ───────────────────────────────────────────────────

interface Patch {
  x?: number
  y?: number
  width?: number
  height?: number
  opacity?: number
  locked?: boolean
  points?: number[][]
  strokeColor?: string
  strokeWidth?: number
  customData?: Record<string, any>
}

const applyPatches = (
  elements: readonly AnyElement[],
  patches: Map<string, Patch>,
): AnyElement[] => {
  const boundTextBoxes = new Map<string, { x: number; y: number; width: number; height: number }>()

  for (const element of elements) {
    const patch = patches.get(element.id)
    if (!patch) continue
    const boundTextId = (element.boundElements || []).find((b: any) => b?.type === 'text')?.id
    if (!boundTextId) continue
    boundTextBoxes.set(boundTextId, {
      x: patch.x ?? element.x,
      y: patch.y ?? element.y,
      width: patch.width ?? element.width,
      height: patch.height ?? element.height,
    })
  }

  return elements.map((element) => {
    const box = boundTextBoxes.get(element.id)
    if (box && element.type === 'text') {
      return { ...element, ...positionBoundText(element, box) }
    }
    const patch = patches.get(element.id)
    if (!patch) return element
    return { ...element, ...patch }
  })
}

/**
 * Reposiciona os mapas inteiros a partir da raiz e refaz as linhas.
 * Função pura, idempotente: o layout roda dentro do onChange, então um
 * `changed` falso-positivo viraria ciclo de updateScene.
 */
export const layoutMindmap = (
  elements: readonly AnyElement[],
): { elements: AnyElement[]; changed: boolean } => {
  const nodes = alive(elements).filter(isMindmapNode)
  if (nodes.length === 0) {
    const pruned = pruneOrphanEdges(elements)
    return pruned
  }

  const order = new Map(elements.map((element, index) => [element.id, index]))
  const childrenCache = new Map<string, AnyElement[]>()
  const kidsOf = (id: string): AnyElement[] => {
    let list = childrenCache.get(id)
    if (!list) {
      list = nodes
        .filter((node) => getNodeMeta(node)!.parentId === id)
        .sort((a, b) => a.y - b.y || (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
      childrenCache.set(id, list)
    }
    return list
  }

  const patches = new Map<string, Patch>()
  const patchOf = (id: string): Patch => {
    let patch = patches.get(id)
    if (!patch) {
      patch = {}
      patches.set(id, patch)
    }
    return patch
  }

  // Quantas pontas visíveis o ramo tem. É o peso que afasta os vizinhos.
  const leafCache = new Map<string, number>()
  const leafCount = (node: AnyElement, guard: Set<string>): number => {
    const cached = leafCache.get(node.id)
    if (cached !== undefined) return cached
    if (guard.has(node.id)) return 1
    guard.add(node.id)
    const meta = getNodeMeta(node)!
    const kids = meta.collapsed ? [] : kidsOf(node.id)
    const count =
      kids.length === 0 ? 1 : kids.reduce((sum, kid) => sum + leafCount(kid, guard), 0)
    leafCache.set(node.id, count)
    return count
  }

  /** Vãos entre os filhos de um nó, na ordem em que aparecem. */
  const gapsBetweenKids = (kids: AnyElement[], childDepth: number): number[] =>
    kids
      .slice(1)
      .map((kid, index) =>
        gapBetween(childDepth, leafCount(kids[index], new Set()), leafCount(kid, new Set())),
      )

  const heightCache = new Map<string, number>()
  const subtreeHeight = (node: AnyElement, depth: number, guard: Set<string>): number => {
    const cached = heightCache.get(node.id)
    if (cached !== undefined) return cached
    if (guard.has(node.id)) return node.height
    guard.add(node.id)

    const meta = getNodeMeta(node)!
    const kids = meta.collapsed ? [] : kidsOf(node.id)
    const height =
      kids.length === 0
        ? node.height
        : Math.max(
            node.height,
            kids.reduce((sum, kid) => sum + subtreeHeight(kid, depth + 1, guard), 0) +
              gapsBetweenKids(kids, depth + 1).reduce((sum, gap) => sum + gap, 0),
          )
    heightCache.set(node.id, height)
    return height
  }

  const place = (
    node: AnyElement,
    x: number,
    centerY: number,
    depth: number,
    guard: Set<string>,
  ): void => {
    if (guard.has(node.id)) return
    guard.add(node.id)

    const y = centerY - node.height / 2
    const patch = patchOf(node.id)
    if (!nearlyEqual(node.x, x)) patch.x = x
    if (!nearlyEqual(node.y, y)) patch.y = y
    if (node.opacity !== 100) patch.opacity = 100
    if (node.locked) patch.locked = false

    const meta = getNodeMeta(node)!
    const kids = kidsOf(node.id)
    if (kids.length === 0) return

    if (meta.collapsed) {
      // Escondido não é apagado: fica invisível e travado, empilhado sobre o
      // pai. Marcar isDeleted apagaria de verdade, porque o sync do App filtra
      // os deletados antes de gravar.
      for (const hidden of descendantsOf(elements, node.id)) {
        const hiddenPatch = patchOf(hidden.id)
        if (!nearlyEqual(hidden.x, x)) hiddenPatch.x = x
        if (!nearlyEqual(hidden.y, centerY)) hiddenPatch.y = centerY
        if (hidden.opacity !== 0) hiddenPatch.opacity = 0
        if (!hidden.locked) hiddenPatch.locked = true
      }
      return
    }

    const childDepth = depth + 1
    const heights = kids.map((kid) => subtreeHeight(kid, childDepth, new Set()))
    const gaps = gapsBetweenKids(kids, childDepth)
    const total =
      heights.reduce((sum, height) => sum + height, 0) + gaps.reduce((sum, gap) => sum + gap, 0)

    let cursor = centerY - total / 2
    const childX = x + node.width + horizontalGapFor(total, node.height)
    kids.forEach((kid, index) => {
      place(kid, childX, cursor + heights[index] / 2, childDepth, guard)
      cursor += heights[index] + (gaps[index] ?? 0)
    })
  }

  for (const root of nodes.filter((node) => getNodeMeta(node)!.parentId === null)) {
    place(root, root.x, root.y + root.height / 2, 0, new Set())
  }

  for (const [id, patch] of patches) {
    if (Object.keys(patch).length === 0) patches.delete(id)
  }

  const positioned = patches.size > 0 ? applyPatches(elements, patches) : (elements as AnyElement[])
  const edged = syncEdges(positioned)

  return { elements: edged.elements, changed: patches.size > 0 || edged.changed }
}

const pruneOrphanEdges = (
  elements: readonly AnyElement[],
): { elements: AnyElement[]; changed: boolean } => {
  const nodeIds = new Set(alive(elements).filter(isMindmapNode).map((node) => node.id))
  const orphans = elements.filter((element) => {
    const edge = getEdgeMeta(element)
    return edge && (!nodeIds.has(edge.childId) || !nodeIds.has(edge.parentId))
  })
  if (orphans.length === 0) return { elements: elements as AnyElement[], changed: false }
  const doomed = new Set(orphans.map((element) => element.id))
  return { elements: elements.filter((element) => !doomed.has(element.id)), changed: true }
}

/**
 * Curva em S que passa pelo hub. Como o hub é o mesmo ponto pra todos os filhos
 * de um pai, as linhas saem juntas e abrem em leque, e a bolinha de retrair
 * cai exatamente sobre esse ponto de encontro.
 */
/** trecho reto na chegada, pra linha encostar no texto na horizontal */
export const EDGE_FLAT = 28
/** amostras da curva: a linha é uma polilinha, então a curva é desenhada aqui */
const EDGE_SAMPLES = 16

const edgePoints = (dx: number, dy: number): number[][] => {
  // Reto na saída (até passar pela bolinha), curva no meio, reto na chegada.
  const reta = Math.min(HUB_OFFSET, Math.abs(dx) * 0.3)
  const flat = Math.min(EDGE_FLAT, Math.abs(dx) * 0.18)
  const inicio = reta
  const fim = dx - flat
  const vao = fim - inicio
  if (!(vao > 1)) {
    return [
      [0, 0],
      [Math.max(0, dx * 0.5), 0],
      [dx, dy],
    ]
  }

  // Bezier com os dois controles na horizontal: é o que faz a curva sair e
  // chegar deitada em vez de virar de supetão perto do texto. Vértices soltos
  // no lugar disso deixavam um trecho quase vertical no meio do caminho.
  const c1 = inicio + vao * 0.5
  const c2 = fim - vao * 0.5
  const points: number[][] = [
    [0, 0],
    [inicio, 0],
  ]
  for (let i = 1; i <= EDGE_SAMPLES; i += 1) {
    const t = i / EDGE_SAMPLES
    const mt = 1 - t
    const x = mt * mt * mt * inicio + 3 * mt * mt * t * c1 + 3 * mt * t * t * c2 + t * t * t * fim
    const y = 3 * mt * t * t * dy + t * t * t * dy
    points.push([x, y])
  }
  points.push([dx, dy])
  return points
}

/** De onde saem as linhas de um nó: é onde a bolinha de retrair fica. */
export const hubPointOf = (node: AnyElement): { x: number; y: number } => ({
  x: node.x + node.width + (node.type === 'text' ? EDGE_GAP : 0) + HUB_OFFSET,
  y: node.y + node.height / 2,
})

/**
 * Uma linha por nó não raiz, sempre derivada das posições atuais. Assim
 * reparentar só mexe no `customData` do nó: a linha se conserta sozinha no
 * próximo layout, sem binding do Excalidraw pra manter em dia.
 */
const syncEdges = (
  elements: readonly AnyElement[],
): { elements: AnyElement[]; changed: boolean } => {
  const nodes = alive(elements).filter(isMindmapNode)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const edgesByChild = new Map<string, AnyElement>()
  for (const element of elements) {
    const edge = getEdgeMeta(element)
    if (edge) edgesByChild.set(edge.childId, element)
  }

  const patches = new Map<string, Patch>()
  const created: AnyElement[] = []
  const doomed = new Set<string>()
  const keep = new Set<string>()

  for (const node of nodes) {
    const meta = getNodeMeta(node)!
    if (!meta.parentId) continue
    const parent = byId.get(meta.parentId)
    if (!parent) continue

    // Sai colado da forma da raiz (que tem borda visível) e com folga do texto
    // do tópico, senão a curva encosta na última letra da palavra.
    const x = parent.x + parent.width + (parent.type === 'text' ? EDGE_GAP : 0)
    const meio = parent.y + parent.height / 2
    // Quem sobe sai um pouco mais alto na borda, quem desce sai mais baixo,
    // limitado pela altura do pai. Numa caixa alta isso espalha as saídas e
    // evita o cruzamento; num texto fino o limite é curto e as linhas saem
    // praticamente juntas, formando o feixe.
    const bruto = node.y + node.height / 2 - meio
    const limite = parent.height * 0.3
    const y = meio + Math.max(-limite, Math.min(limite, bruto * 0.08))
    const dx = node.x - EDGE_GAP - x
    const dy = node.y + node.height / 2 - y
    const points = edgePoints(dx, dy)
    const color = branchColor(meta.branch)
    const width = strokeWidthForDepth(depthOf(elements, node.id))
    // Segue o filho: nó escondido tem linha escondida, e nunca apagada.
    const hiddenOpacity = node.opacity === 0 ? 0 : 100

    const existing = edgesByChild.get(node.id)
    if (!existing) {
      const skeleton: AnyElement = {
        type: 'line',
        id: newId(),
        x,
        y,
        width: Math.abs(dx),
        height: Math.abs(dy),
        points,
        strokeColor: color.line,
        strokeWidth: width,
        strokeStyle: 'solid',
        backgroundColor: 'transparent',
        fillStyle: 'solid',
        roughness: 0,
        roundness: { type: 2 },
        opacity: hiddenOpacity,
        locked: true,
      }
      const converted = convertToExcalidrawElements([skeleton] as any, { regenerateIds: false })
      created.push(
        ...converted.map((element: AnyElement) =>
          withMeta(
            { ...element, points, x, y, width: Math.abs(dx), height: Math.abs(dy), locked: true },
            {
              role: 'edge',
              mapId: meta.mapId,
              parentId: parent.id,
              childId: node.id,
              branch: meta.branch,
            },
          ),
        ),
      )
      continue
    }

    keep.add(existing.id)
    const patch: Patch = {}
    if (!nearlyEqual(existing.x, x)) patch.x = x
    if (!nearlyEqual(existing.y, y)) patch.y = y
    if (!nearlyEqual(existing.width, Math.abs(dx))) patch.width = Math.abs(dx)
    if (!nearlyEqual(existing.height, Math.abs(dy))) patch.height = Math.abs(dy)
    if (!samePoints(existing.points, points)) patch.points = points
    if (existing.strokeColor !== color.line) patch.strokeColor = color.line
    if (existing.strokeWidth !== width) patch.strokeWidth = width
    if (existing.opacity !== hiddenOpacity) patch.opacity = hiddenOpacity
    if (!existing.locked) patch.locked = true

    const edgeMeta = getEdgeMeta(existing)!
    if (edgeMeta.parentId !== parent.id || edgeMeta.branch !== meta.branch) {
      patch.customData = {
        ...(existing.customData || {}),
        [MINDMAP_KEY]: {
          role: 'edge',
          mapId: meta.mapId,
          parentId: parent.id,
          childId: node.id,
          branch: meta.branch,
        },
      }
    }

    if (Object.keys(patch).length > 0) patches.set(existing.id, patch)
  }

  for (const [childId, edge] of edgesByChild) {
    if (!keep.has(edge.id) && !byId.has(childId)) doomed.add(edge.id)
  }

  if (patches.size === 0 && created.length === 0 && doomed.size === 0) {
    return { elements: elements as AnyElement[], changed: false }
  }

  const patched = patches.size > 0 ? applyPatches(elements, patches) : (elements as AnyElement[])
  const withoutOrphans =
    doomed.size > 0 ? patched.filter((element) => !doomed.has(element.id)) : patched

  // Linha entra atrás dos nós: o texto nunca pode ficar coberto pela curva.
  if (created.length === 0) return { elements: withoutOrphans, changed: true }
  const firstNodeIndex = withoutOrphans.findIndex(isMindmapNode)
  const next =
    firstNodeIndex === -1
      ? [...withoutOrphans, ...created]
      : [
          ...withoutOrphans.slice(0, firstNodeIndex),
          ...created,
          ...withoutOrphans.slice(firstNodeIndex),
        ]
  return { elements: next, changed: true }
}

const samePoints = (a: any, b: number[][]): boolean => {
  if (!Array.isArray(a) || a.length !== b.length) return false
  return a.every(
    (point: number[], index: number) =>
      nearlyEqual(point[0], b[index][0]) && nearlyEqual(point[1], b[index][1]),
  )
}

// ─── arraste da raiz ──────────────────────────────────────────

export const snapshotRootPositions = (
  elements: readonly AnyElement[],
): Map<string, { x: number; y: number }> => {
  const snapshot = new Map<string, { x: number; y: number }>()
  for (const root of alive(elements).filter(isMindmapRoot)) {
    snapshot.set(root.id, { x: root.x, y: root.y })
  }
  return snapshot
}

export const snapshotNodePositions = (
  elements: readonly AnyElement[],
): Map<string, { x: number; y: number }> => {
  const snapshot = new Map<string, { x: number; y: number }>()
  for (const node of alive(elements).filter(isMindmapNode)) {
    snapshot.set(node.id, { x: node.x, y: node.y })
  }
  return snapshot
}

/**
 * Nós que o usuário arrastou de fato neste gesto. O limiar evita tratar o
 * reposicionamento do próprio layout como intenção de mover.
 */
export const movedNodeIds = (
  elements: readonly AnyElement[],
  before: Map<string, { x: number; y: number }>,
  threshold = 6,
): string[] => {
  const moved: string[] = []
  for (const node of alive(elements).filter(isMindmapNode)) {
    const previous = before.get(node.id)
    if (!previous) continue
    if (Math.hypot(node.x - previous.x, node.y - previous.y) >= threshold) moved.push(node.id)
  }
  return moved
}

export const anyRootMoved = (
  elements: readonly AnyElement[],
  previous: Map<string, { x: number; y: number }>,
): boolean => {
  for (const root of alive(elements).filter(isMindmapRoot)) {
    const before = previous.get(root.id)
    if (!before) continue
    if (!nearlyEqual(root.x, before.x) || !nearlyEqual(root.y, before.y)) return true
  }
  return false
}

/** Texto atual do nó, seja texto solto ou label preso na raiz. */
export const getNodeText = (elements: readonly AnyElement[], nodeElementId: string): string => {
  const node = elements.find((element) => element.id === nodeElementId)
  if (!node) return ''
  if (node.type === 'text') return node.originalText ?? node.text ?? ''
  const textId = (node.boundElements || []).find((b: any) => b?.type === 'text')?.id
  const bound = textId ? elements.find((element) => element.id === textId) : undefined
  return bound?.originalText ?? bound?.text ?? ''
}
