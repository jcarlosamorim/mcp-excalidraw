import { useCallback, useEffect, useRef, useState } from 'react'
import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import {
  ROOT_HEIGHT,
  ROOT_WIDTH,
  anyRootMoved,
  childrenOf,
  collectMindmapCascade,
  createChildElements,
  createRootElements,
  depthOf,
  descendantsOf,
  findDropParent,
  getNodeMeta,
  hubColorOf,
  hubPointOf,
  isMindmapNode,
  isMindmapRoot,
  layoutMindmap,
  movedNodeIds,
  nextMapPosition,
  outdent,
  reparent,
  snapshotNodePositions,
  snapshotRootPositions,
  toggleCollapse,
} from './mindmap'

type AnyElement = any

/** Barra de ações do nó selecionado, no lugar da barra do Whimsical. */
export interface MindmapToolbarAnchor {
  nodeId: string
  screenX: number
  screenY: number
  zoom: number
  isRoot: boolean
  hasChildren: boolean
  collapsed: boolean
  canOutdent: boolean
}

/**
 * Bolinha de retrair, no ponto onde as linhas do nó se encontram. Cheia com a
 * contagem quando o ramo está escondido; vazada quando está aberto, e aí só
 * aparece com o ponteiro por perto, pra não poluir o mapa.
 */
export interface MindmapToggleAnchor {
  nodeId: string
  screenX: number
  screenY: number
  zoom: number
  collapsed: boolean
  hidden: number
  color: string
  /** área do nó em coordenadas de tela, pro hover */
  left: number
  top: number
  right: number
  bottom: number
}

interface UseMindmapParams {
  excalidrawAPI: ExcalidrawImperativeAPI | null
  /** Libera o auto-sync do App, que só dispara depois de interação do usuário. */
  markInteraction: () => void
}

const isTypingInField = (target: EventTarget | null): boolean => {
  const element = target as HTMLElement | null
  if (!element) return false
  const tag = element.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || element.isContentEditable
}

/** Nó em edição no canvas. Na raiz quem edita é o texto preso, não a forma. */
const editingNodeId = (appState: any): string | null => {
  const editing = appState?.editingTextElement
  if (!editing) return null
  return editing.containerId ?? editing.id ?? null
}

const selectedNodeId = (elements: readonly AnyElement[], appState: any): string | null => {
  const selection = appState?.selectedElementIds ?? {}
  const selected = elements.filter((element) => selection[element.id] && isMindmapNode(element))
  return selected.length === 1 ? selected[0].id : null
}

export const useMindmap = ({ excalidrawAPI, markInteraction }: UseMindmapParams) => {
  const [toolbar, setToolbar] = useState<MindmapToolbarAnchor | null>(null)
  const [toggleAnchors, setToggleAnchors] = useState<MindmapToggleAnchor[]>([])

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  useEffect(() => {
    apiRef.current = excalidrawAPI
  }, [excalidrawAPI])

  const applyingRef = useRef<boolean>(false)
  const rootPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const dragStartRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const wasEditingRef = useRef<boolean>(false)
  const pendingLayoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Janela em que os atalhos ficam mudos. Entre criar um nó e o editor de texto
   * assumir o teclado, as teclas caem no canvas: é o mesmo problema que fazia a
   * letra "s" do card stack criar colunas fantasma.
   */
  const muteUntilRef = useRef<number>(0)

  const applyScene = useCallback((elements: AnyElement[], capture: any): void => {
    const api = apiRef.current
    if (!api) return
    applyingRef.current = true
    api.updateScene({ elements, captureUpdate: capture })
    // Solta no próximo tick: o updateScene reentra em onChange de forma síncrona.
    setTimeout(() => {
      applyingRef.current = false
    }, 0)
  }, [])

  const refreshAnchors = useCallback((elements: readonly AnyElement[], appState: any): void => {
    const zoom = appState?.zoom?.value ?? 1
    const scrollX = appState?.scrollX ?? 0
    const scrollY = appState?.scrollY ?? 0
    const offsetLeft = appState?.offsetLeft ?? 0
    const offsetTop = appState?.offsetTop ?? 0
    const toScreen = (x: number, y: number) => ({
      screenX: (x + scrollX) * zoom + offsetLeft,
      screenY: (y + scrollY) * zoom + offsetTop,
    })

    const visible = elements.filter((element) => !element.isDeleted)

    const nodeId = appState?.editingTextElement ? null : selectedNodeId(visible, appState)
    const node = nodeId ? visible.find((element) => element.id === nodeId) : undefined
    const meta = getNodeMeta(node)
    const nextToolbar: MindmapToolbarAnchor | null =
      node && meta
        ? {
            nodeId: node.id,
            // Ancora à esquerda do nó, no vão do conector. Acima do nó ficava
            // o texto do irmão anterior e a barra roubava o clique dele; aqui
            // só passa a linha, que é travada e nem recebe clique.
            ...toScreen(node.x - 10, node.y + node.height / 2),
            zoom,
            isRoot: meta.parentId === null,
            hasChildren: childrenOf(visible, node.id).length > 0,
            collapsed: meta.collapsed,
            canOutdent: depthOf(visible, node.id) >= 2,
          }
        : null

    setToolbar((previous) => {
      if (previous === null && nextToolbar === null) return previous
      if (
        previous &&
        nextToolbar &&
        previous.nodeId === nextToolbar.nodeId &&
        previous.collapsed === nextToolbar.collapsed &&
        previous.hasChildren === nextToolbar.hasChildren &&
        previous.canOutdent === nextToolbar.canOutdent &&
        Math.abs(previous.screenX - nextToolbar.screenX) < 0.5 &&
        Math.abs(previous.screenY - nextToolbar.screenY) < 0.5 &&
        Math.abs(previous.zoom - nextToolbar.zoom) < 0.001
      ) {
        return previous
      }
      return nextToolbar
    })

    const nextToggles: MindmapToggleAnchor[] = visible
      .filter((element) => {
        const nodeMeta = getNodeMeta(element)
        if (!nodeMeta) return false
        // Nó escondido dentro de um ramo fechado não ganha bolinha própria.
        if (element.opacity === 0) return false
        // Na raiz as linhas saem espalhadas pela borda em vez de convergirem
        // num ponto, então não há feixe onde pousar a bolinha. Fechar a raiz
        // também esconderia o mapa inteiro, que não é um gesto útil.
        if (nodeMeta.parentId === null) return false
        return childrenOf(visible, element.id).length > 0
      })
      .map((element) => {
        const hub = hubPointOf(element)
        const topLeft = toScreen(element.x, element.y)
        const bottomRight = toScreen(element.x + element.width, element.y + element.height)
        return {
          nodeId: element.id,
          ...toScreen(hub.x, hub.y),
          zoom,
          collapsed: Boolean(getNodeMeta(element)?.collapsed),
          hidden: descendantsOf(visible, element.id).length,
          color: hubColorOf(element),
          left: topLeft.screenX,
          top: topLeft.screenY,
          right: bottomRight.screenX,
          bottom: bottomRight.screenY,
        }
      })

    setToggleAnchors((previous) => {
      if (previous.length === nextToggles.length) {
        const same = previous.every((anchor, index) => {
          const candidate = nextToggles[index]
          return (
            anchor.nodeId === candidate.nodeId &&
            anchor.hidden === candidate.hidden &&
            anchor.collapsed === candidate.collapsed &&
            anchor.color === candidate.color &&
            Math.abs(anchor.screenX - candidate.screenX) < 0.5 &&
            Math.abs(anchor.screenY - candidate.screenY) < 0.5 &&
            Math.abs(anchor.zoom - candidate.zoom) < 0.001
          )
        })
        if (same) return previous
      }
      return nextToggles
    })
  }, [])


  const runLayout = useCallback((): void => {
    const api = apiRef.current
    if (!api) return
    const elements = api.getSceneElements()
    if (!elements.some(isMindmapNode)) return

    const result = layoutMindmap(elements)
    if (!result.changed) return
    // Antes do applyScene: o onChange do updateScene é síncrono e o auto-sync
    // do App só agenda se a interação já estiver marcada.
    markInteraction()
    applyScene(result.elements, CaptureUpdateAction.NEVER)
    rootPositionsRef.current = snapshotRootPositions(result.elements)
  }, [applyScene, markInteraction])

  const scheduleLayout = useCallback((): void => {
    if (pendingLayoutRef.current) clearTimeout(pendingLayoutRef.current)
    pendingLayoutRef.current = setTimeout(() => {
      pendingLayoutRef.current = null
      runLayout()
    }, 30)
  }, [runLayout])

  /** Seleciona o nó e pede ao Excalidraw pra abrir a edição de texto. */
  const focusForEditing = useCallback((elementId: string): void => {
    const api = apiRef.current
    if (!api) return
    muteUntilRef.current = Date.now() + 400
    api.updateScene({
      appState: { selectedElementIds: { [elementId]: true } },
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    setTimeout(() => {
      const canvas = document.querySelector('.excalidraw canvas.interactive') as HTMLElement | null
      const target = canvas ?? document.body
      const event = new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true })
      // Marca o evento: sem isto o próprio atalho de Enter o trataria como
      // "criar irmão" e cada nó novo geraria outro, em cascata.
      ;(event as any).__mindmapSynthetic = true
      target.dispatchEvent(event)
    }, 60)
  }, [])

  const createMap = useCallback((): void => {
    const api = apiRef.current
    if (!api) return
    const elements = api.getSceneElements()
    const appState = api.getAppState() as any
    const zoom = appState?.zoom?.value ?? 1
    const width = appState?.width ?? window.innerWidth
    const height = appState?.height ?? window.innerHeight
    const center = {
      x: Math.round(width / 2 / zoom - (appState?.scrollX ?? 0) - ROOT_WIDTH / 2),
      y: Math.round(height / 2 / zoom - (appState?.scrollY ?? 0) - ROOT_HEIGHT / 2),
    }

    const { elements: created, rootId } = createRootElements(nextMapPosition(elements, center))
    const next = [...elements, ...created]
    markInteraction()
    applyScene(next, CaptureUpdateAction.IMMEDIATELY)
    rootPositionsRef.current = snapshotRootPositions(next)
    focusForEditing(rootId)
  }, [applyScene, focusForEditing, markInteraction])

  const addChild = useCallback(
    (nodeElementId: string): void => {
      const api = apiRef.current
      if (!api) return
      const created = createChildElements(api.getSceneElements(), nodeElementId)
      if (!created) return
      const laid = layoutMindmap(created.elements)
      markInteraction()
      applyScene(laid.changed ? laid.elements : created.elements, CaptureUpdateAction.IMMEDIATELY)
      rootPositionsRef.current = snapshotRootPositions(laid.elements)
      focusForEditing(created.nodeId)
    },
    [applyScene, focusForEditing, markInteraction],
  )

  const addSibling = useCallback(
    (nodeElementId: string): void => {
      const api = apiRef.current
      if (!api) return
      const elements = api.getSceneElements()
      const meta = getNodeMeta(elements.find((element) => element.id === nodeElementId))
      if (!meta) return
      // Na raiz não existe irmão: o gesto natural ali é abrir mais um tópico.
      if (!meta.parentId) {
        addChild(nodeElementId)
        return
      }
      const created = createChildElements(elements, meta.parentId, { insertAfterId: nodeElementId })
      if (!created) return
      const laid = layoutMindmap(created.elements)
      markInteraction()
      applyScene(laid.changed ? laid.elements : created.elements, CaptureUpdateAction.IMMEDIATELY)
      rootPositionsRef.current = snapshotRootPositions(laid.elements)
      focusForEditing(created.nodeId)
    },
    [addChild, applyScene, focusForEditing, markInteraction],
  )

  const outdentNode = useCallback(
    (nodeElementId: string): void => {
      const api = apiRef.current
      if (!api) return
      const result = outdent(api.getSceneElements(), nodeElementId)
      if (!result.changed) return
      const laid = layoutMindmap(result.elements)
      markInteraction()
      applyScene(laid.changed ? laid.elements : result.elements, CaptureUpdateAction.IMMEDIATELY)
      rootPositionsRef.current = snapshotRootPositions(laid.elements)
    },
    [applyScene, markInteraction],
  )

  const toggleCollapseNode = useCallback(
    (nodeElementId: string): void => {
      const api = apiRef.current
      if (!api) return
      const result = toggleCollapse(api.getSceneElements(), nodeElementId)
      if (!result.changed) return
      const laid = layoutMindmap(result.elements)
      markInteraction()
      applyScene(laid.changed ? laid.elements : result.elements, CaptureUpdateAction.IMMEDIATELY)
      rootPositionsRef.current = snapshotRootPositions(laid.elements)
    },
    [applyScene, markInteraction],
  )

  const deleteBranch = useCallback(
    (nodeElementId: string): void => {
      const api = apiRef.current
      if (!api) return
      const elements = api.getSceneElements()
      const doomed = collectMindmapCascade(elements, [nodeElementId])
      if (doomed.size === 0) return
      const remaining = elements.filter((element) => !doomed.has(element.id))
      const laid = layoutMindmap(remaining)
      markInteraction()
      applyScene(laid.changed ? laid.elements : remaining, CaptureUpdateAction.IMMEDIATELY)
      rootPositionsRef.current = snapshotRootPositions(laid.elements)
      setToolbar(null)
    },
    [applyScene, markInteraction],
  )

  /** Nó apagado leva o ramo, os textos presos e as linhas junto. */
  const cascadeDeletions = (elements: readonly AnyElement[]): AnyElement[] | null => {
    const deleted = elements
      .filter((element) => element.isDeleted && isMindmapNode(element))
      .map((element) => element.id)
    if (deleted.length === 0) return null

    const doomed = collectMindmapCascade(elements, deleted)
    let touched = false
    const next = elements.map((element) => {
      if (!doomed.has(element.id) || element.isDeleted) return element
      touched = true
      return { ...element, isDeleted: true }
    })
    return touched ? next : null
  }

  const handleChange = useCallback(
    (elements: readonly AnyElement[], appState: any): void => {
      refreshAnchors(elements, appState)
      if (applyingRef.current) return

      // Fim da edição: o texto mudou de largura e a árvore precisa reacomodar.
      const editing = Boolean(appState?.editingTextElement)
      if (wasEditingRef.current && !editing) scheduleLayout()
      wasEditingRef.current = editing

      const alive = elements.filter((element) => !element.isDeleted)
      if (!alive.some(isMindmapNode)) {
        rootPositionsRef.current = new Map()
        return
      }

      const cascaded = cascadeDeletions(elements)
      if (cascaded) {
        applyScene(cascaded, CaptureUpdateAction.NEVER)
        return
      }

      // Arrastar a raiz move o mapa inteiro em tempo real. Nó comum só se
      // acomoda ao soltar, senão o layout o puxaria de volta no meio do gesto
      // e reparentar por arraste seria impossível.
      const rootMoved = anyRootMoved(elements, rootPositionsRef.current)
      rootPositionsRef.current = snapshotRootPositions(elements)
      if (rootMoved) runLayout()
    },
    [applyScene, refreshAnchors, runLayout, scheduleLayout],
  )

  const handlePointerDown = useCallback((): void => {
    const api = apiRef.current
    if (!api) return
    dragStartRef.current = snapshotNodePositions(api.getSceneElements())
  }, [])

  const handlePointerUp = useCallback((): void => {
    const api = apiRef.current
    if (!api) return
    const elements = api.getSceneElements()
    if (!elements.some(isMindmapNode)) return

    // Quem foi arrastado procura pai novo. Sem candidato por perto o layout
    // devolve o nó pro lugar: arrastar nunca solta um tópico do mapa.
    const moved = movedNodeIds(elements, dragStartRef.current).filter((id) => {
      const node = elements.find((element) => element.id === id)
      return node && !isMindmapRoot(node)
    })
    dragStartRef.current = new Map()

    let current: AnyElement[] = elements as AnyElement[]
    let relinked = false
    for (const nodeId of moved) {
      const parentId = findDropParent(current, nodeId)
      if (!parentId) continue
      const result = reparent(current, nodeId, parentId)
      if (result.changed) {
        current = result.elements
        relinked = true
      }
    }

    const laid = layoutMindmap(current)
    if (!laid.changed && !relinked) return
    markInteraction()
    applyScene(laid.changed ? laid.elements : current, CaptureUpdateAction.IMMEDIATELY)
    rootPositionsRef.current = snapshotRootPositions(laid.elements)
  }, [applyScene, markInteraction])

  // Atalhos: M abre um mapa, Tab desce um nível, Enter cria irmão,
  // Shift+Tab sobe um nível. Os três últimos valem inclusive digitando.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event as any).__mindmapSynthetic) return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (Date.now() < muteUntilRef.current) return

      const api = apiRef.current
      if (!api) return
      const appState = api.getAppState() as any
      const elements = api.getSceneElements()
      const editingId = editingNodeId(appState)

      // Digitando fora do canvas (painel de projetos, documento do card) as
      // teclas são do campo, não do mapa.
      if (!editingId && isTypingInField(event.target)) return

      if (!editingId && (event.key === 'm' || event.key === 'M') && !event.shiftKey) {
        event.preventDefault()
        createMap()
        return
      }

      const targetId = editingId ?? selectedNodeId(elements, appState)
      if (!targetId) return
      const node = elements.find((element) => element.id === targetId)
      if (!isMindmapNode(node)) return

      const isTab = event.key === 'Tab'
      const isEnter = event.key === 'Enter' && !event.shiftKey
      if (!isTab && !isEnter) return

      event.preventDefault()
      event.stopPropagation()

      const action = isTab
        ? event.shiftKey
          ? () => outdentNode(targetId)
          : () => addChild(targetId)
        : () => addSibling(targetId)

      if (!editingId) {
        action()
        return
      }

      // Fecha o editor antes de agir: o texto digitado só entra na cena quando
      // a edição termina, e o nó novo precisa nascer depois disso.
      muteUntilRef.current = Date.now() + 200
      const canvas = document.querySelector('.excalidraw canvas.interactive') as HTMLElement | null
      const escape = new KeyboardEvent('keydown', {
        key: 'Escape',
        code: 'Escape',
        bubbles: true,
      })
      ;(escape as any).__mindmapSynthetic = true
      ;(canvas ?? document.body).dispatchEvent(escape)
      setTimeout(action, 90)
    }

    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [addChild, addSibling, createMap, outdentNode])

  useEffect(() => {
    return () => {
      if (pendingLayoutRef.current) clearTimeout(pendingLayoutRef.current)
    }
  }, [])

  return {
    toolbar,
    toggleAnchors,
    createMap,
    addChild,
    addSibling,
    outdentNode,
    toggleCollapseNode,
    deleteBranch,
    handleChange,
    handlePointerDown,
    handlePointerUp,
  }
}
