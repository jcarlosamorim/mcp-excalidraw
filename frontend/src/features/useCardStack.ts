import { useCallback, useEffect, useRef, useState } from 'react'
import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import {
  COLUMN_PADDING,
  CARD_COLORS,
  CARD_WIDTH,
  DEFAULT_CARD_COLOR,
  appendCardToColumn,
  applyCardTitle,
  collectColumnCascade,
  createColumnElements,
  getCardTitle,
  getStackMeta,
  isCard,
  isColumn,
  layoutStacks,
  nextColumnPosition,
  removeCard,
  snapshotColumnPositions,
  translateColumnChildren,
} from './cardStack'
import { getCardDoc, todoProgress, withCardDoc } from './cardDoc'

type AnyElement = any

export interface ColumnAnchor {
  /** id do retângulo da coluna */
  id: string
  screenX: number
  screenY: number
  /** zoom atual, pro botão acompanhar a escala do canvas */
  zoom: number
}

/** Botão de documento em cada card, com o progresso da checklist. */
export interface CardAnchor {
  id: string
  screenX: number
  screenY: number
  zoom: number
  hasDoc: boolean
  done: number
  total: number
}

export interface OpenDoc {
  cardId: string
  title: string
  markdown: string
}

interface UseCardStackParams {
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

export const useCardStack = ({ excalidrawAPI, markInteraction }: UseCardStackParams) => {
  const [anchors, setAnchors] = useState<ColumnAnchor[]>([])
  const [cardAnchors, setCardAnchors] = useState<CardAnchor[]>([])
  const [openDoc, setOpenDoc] = useState<OpenDoc | null>(null)
  const columnPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map())
  const applyingRef = useRef<boolean>(false)
  const wasEditingRef = useRef<boolean>(false)
  const pendingLayoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  /**
   * Janela em que o atalho S fica mudo. Entre criar um card e o editor de texto
   * abrir, as teclas caem no canvas: digitar "Acessar" criava duas colunas
   * fantasma, uma por "s" da palavra.
   */
  const shortcutMuteUntilRef = useRef<number>(0)

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  useEffect(() => {
    apiRef.current = excalidrawAPI
  }, [excalidrawAPI])

  const refreshAnchors = useCallback((elements: readonly AnyElement[], appState: any): void => {
    const zoom = appState?.zoom?.value ?? 1
    const scrollX = appState?.scrollX ?? 0
    const scrollY = appState?.scrollY ?? 0
    const offsetLeft = appState?.offsetLeft ?? 0
    const offsetTop = appState?.offsetTop ?? 0

    const next: ColumnAnchor[] = elements
      .filter((element) => isColumn(element) && !element.isDeleted)
      .map((column) => ({
        id: column.id,
        screenX: (column.x + COLUMN_PADDING + scrollX) * zoom + offsetLeft,
        screenY: (column.y + 16 + scrollY) * zoom + offsetTop,
        zoom,
      }))

    setAnchors((previous) => {
      if (previous.length === next.length) {
        const same = previous.every((anchor, index) => {
          const candidate = next[index]
          return (
            anchor.id === candidate.id &&
            Math.abs(anchor.screenX - candidate.screenX) < 0.5 &&
            Math.abs(anchor.screenY - candidate.screenY) < 0.5 &&
            Math.abs(anchor.zoom - candidate.zoom) < 0.001
          )
        })
        if (same) return previous
      }
      return next
    })

    const nextCards: CardAnchor[] = elements
      .filter((element) => isCard(element) && !element.isDeleted)
      .map((card) => {
        const markdown = getCardDoc(card)?.markdown
        const progress = todoProgress(markdown)
        return {
          id: card.id,
          // Base esquerda do card. No topo direito o badge cobria o título,
          // que ocupa justamente o canto de cima. O componente sobe a própria
          // altura com translateY(-100%), pra não depender do zoom.
          screenX: (card.x + 8 + scrollX) * zoom + offsetLeft,
          screenY: (card.y + card.height - 8 + scrollY) * zoom + offsetTop,
          zoom,
          hasDoc: Boolean(markdown && markdown.trim()),
          done: progress.done,
          total: progress.total,
        }
      })

    setCardAnchors((previous) => {
      if (previous.length === nextCards.length) {
        const same = previous.every((anchor, index) => {
          const candidate = nextCards[index]
          return (
            anchor.id === candidate.id &&
            Math.abs(anchor.screenX - candidate.screenX) < 0.5 &&
            Math.abs(anchor.screenY - candidate.screenY) < 0.5 &&
            Math.abs(anchor.zoom - candidate.zoom) < 0.001 &&
            anchor.hasDoc === candidate.hasDoc &&
            anchor.done === candidate.done &&
            anchor.total === candidate.total
          )
        })
        if (same) return previous
      }
      return nextCards
    })
  }, [])

  /** Coluna apagada leva junto título e cards. */
  const cascadeDeletions = (elements: readonly AnyElement[]): AnyElement[] | null => {
    const deletedColumnIds = elements
      .filter((element) => isColumn(element) && element.isDeleted)
      .map((element) => element.id)
    if (deletedColumnIds.length === 0) return null

    const doomed = collectColumnCascade(elements, deletedColumnIds)
    let touched = false
    const next = elements.map((element) => {
      if (!doomed.has(element.id) || element.isDeleted) return element
      touched = true
      return { ...element, isDeleted: true }
    })
    return touched ? next : null
  }

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

  /** Reempilhamento completo. Roda ao soltar o mouse, quando o arraste terminou. */
  const runLayout = useCallback((): void => {
    const api = apiRef.current
    if (!api) return
    const elements = api.getSceneElements()
    if (!elements.some(isColumn)) return

    const result = layoutStacks(elements)
    if (result.changed) {
      // Antes do applyScene: o onChange do updateScene é síncrono e o auto-sync
      // do App só agenda se a interação já estiver marcada.
      markInteraction()
      applyScene(result.elements, CaptureUpdateAction.NEVER)
      columnPositionsRef.current = snapshotColumnPositions(result.elements)
    }
  }, [applyScene, markInteraction])

  const scheduleLayout = useCallback((): void => {
    if (pendingLayoutRef.current) clearTimeout(pendingLayoutRef.current)
    pendingLayoutRef.current = setTimeout(() => {
      pendingLayoutRef.current = null
      runLayout()
    }, 30)
  }, [runLayout])

  /** Plugado no onChange do Excalidraw. Mantém os filhos colados na coluna. */
  const handleChange = useCallback(
    (elements: readonly AnyElement[], appState: any): void => {
      refreshAnchors(elements, appState)
      if (applyingRef.current) return

      // Fim da edição de texto: o título mudou de largura e precisa recentralizar,
      // e um card que cresceu com o texto precisa reempilhar a coluna.
      const editing = Boolean(appState?.editingTextElement)
      if (wasEditingRef.current && !editing) scheduleLayout()
      wasEditingRef.current = editing

      const alive = elements.filter((element) => !element.isDeleted)
      if (!alive.some(isColumn)) {
        columnPositionsRef.current = new Map()
        return
      }

      const cascaded = cascadeDeletions(elements)
      if (cascaded) {
        applyScene(cascaded, CaptureUpdateAction.NEVER)
        return
      }

      const translated = translateColumnChildren(elements, columnPositionsRef.current)
      columnPositionsRef.current = snapshotColumnPositions(elements)
      if (translated.changed) {
        applyScene(translated.elements, CaptureUpdateAction.NEVER)
      }
    },
    [applyScene, refreshAnchors, scheduleLayout],
  )

  const handlePointerUp = useCallback((): void => {
    if (!apiRef.current) return
    scheduleLayout()
  }, [scheduleLayout])

  /** Seleciona o elemento e pede ao Excalidraw pra abrir a edição de texto. */
  const focusForEditing = (elementId: string): void => {
    const api = apiRef.current
    if (!api) return
    // Cala o atalho até o editor assumir o teclado.
    shortcutMuteUntilRef.current = Date.now() + 900
    api.updateScene({
      appState: { selectedElementIds: { [elementId]: true } },
      captureUpdate: CaptureUpdateAction.NEVER,
    })
    setTimeout(() => {
      const canvas = document.querySelector('.excalidraw canvas.interactive') as HTMLElement | null
      const target = canvas ?? document.body
      target.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }),
      )
    }, 60)
  }

  const createColumn = useCallback((): void => {
    const api = apiRef.current
    if (!api) return

    const elements = api.getSceneElements()
    const appState = api.getAppState() as any

    let position = nextColumnPosition(elements)
    if (!elements.some(isColumn)) {
      const zoom = appState?.zoom?.value ?? 1
      const width = appState?.width ?? window.innerWidth
      const height = appState?.height ?? window.innerHeight
      position = {
        x: Math.round(width / 2 / zoom - (appState?.scrollX ?? 0) - 150),
        y: Math.round(height / 2 / zoom - (appState?.scrollY ?? 0) - 310),
      }
    }

    const { elements: created } = createColumnElements(position)
    // Entra na frente do resto do canvas, mas atrás dos cards: a coluna é o
    // container, nunca deve cobrir card nenhum.
    const firstCardIndex = elements.findIndex((element) => {
      const role = getStackMeta(element)?.role
      return role === 'card' || role === 'title'
    })
    const next =
      firstCardIndex === -1
        ? [...elements, ...created]
        : [
            ...elements.slice(0, firstCardIndex),
            ...created,
            ...elements.slice(firstCardIndex),
          ]

    markInteraction()
    applyScene(next, CaptureUpdateAction.IMMEDIATELY)
    columnPositionsRef.current = snapshotColumnPositions(next)

    const title = created.find((element) => element.type === 'text')
    if (title) focusForEditing(title.id)
  }, [applyScene, markInteraction])

  const addCard = useCallback(
    (columnElementId: string): void => {
      const api = apiRef.current
      if (!api) return

      const elements = api.getSceneElements()
      const column = elements.find((element) => element.id === columnElementId)
      if (!column || !isColumn(column)) return

      const columnId = getStackMeta(column)?.columnId ?? column.id
      const existing = elements.filter(
        (element) => isCard(element) && getStackMeta(element)?.columnId === columnId,
      )
      const color = CARD_COLORS[existing.length % CARD_COLORS.length] ?? DEFAULT_CARD_COLOR

      const added = appendCardToColumn(elements, columnElementId, { color })
      if (!added) return

      const laid = layoutStacks(added.elements)
      const next = laid.changed ? laid.elements : added.elements

      markInteraction()
      applyScene(next, CaptureUpdateAction.IMMEDIATELY)
      columnPositionsRef.current = snapshotColumnPositions(next)
      focusForEditing(added.cardId)
    },
    [applyScene, markInteraction],
  )

  // ─── documento do card ──────────────────────────────────────

  const openDocFor = useCallback((cardId: string): void => {
    const api = apiRef.current
    if (!api) return
    const elements = api.getSceneElements()
    const card = elements.find((element) => element.id === cardId)
    if (!card || !isCard(card)) return
    setOpenDoc({
      cardId,
      title: getCardTitle(elements, cardId),
      markdown: getCardDoc(card)?.markdown ?? '',
    })
  }, [])

  const closeDoc = useCallback((): void => setOpenDoc(null), [])

  const saveDoc = useCallback(
    (cardId: string, markdown: string): void => {
      const api = apiRef.current
      if (!api) return
      const elements = api.getSceneElements()
      const card = elements.find((element) => element.id === cardId)
      if (!card) return
      if ((getCardDoc(card)?.markdown ?? '') === markdown) return

      const next = elements.map((element) =>
        element.id === cardId ? withCardDoc(element, markdown, new Date().toISOString()) : element,
      )
      markInteraction()
      applyScene(next, CaptureUpdateAction.NEVER)
      setOpenDoc((previous) => (previous?.cardId === cardId ? { ...previous, markdown } : previous))
    },
    [applyScene, markInteraction],
  )

  const saveTitle = useCallback(
    (cardId: string, title: string): void => {
      const api = apiRef.current
      if (!api) return
      const elements = api.getSceneElements()
      const applied = applyCardTitle(elements, cardId, title)
      if (!applied.changed) return

      // O card pode ter crescido com o título novo: reempilha a coluna.
      const laid = layoutStacks(applied.elements)
      const next = laid.changed ? laid.elements : applied.elements
      markInteraction()
      applyScene(next, CaptureUpdateAction.IMMEDIATELY)
      columnPositionsRef.current = snapshotColumnPositions(next)
      setOpenDoc((previous) => (previous?.cardId === cardId ? { ...previous, title } : previous))
    },
    [applyScene, markInteraction],
  )

  const deleteCard = useCallback(
    (cardId: string): void => {
      const api = apiRef.current
      if (!api) return
      const elements = api.getSceneElements()
      const without = removeCard(elements, cardId)
      const laid = layoutStacks(without)
      markInteraction()
      applyScene(laid.changed ? laid.elements : without, CaptureUpdateAction.IMMEDIATELY)
      setOpenDoc((previous) => (previous?.cardId === cardId ? null : previous))
    },
    [applyScene, markInteraction],
  )

  // Atalho S, como no Whimsical. Sai de cena enquanto o usuário digita.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 's' && event.key !== 'S') return
      if (event.metaKey || event.ctrlKey || event.altKey) return
      if (isTypingInField(event.target)) return
      if (Date.now() < shortcutMuteUntilRef.current) return
      const appState = apiRef.current?.getAppState() as any
      if (appState?.editingTextElement) return
      event.preventDefault()
      createColumn()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [createColumn])

  useEffect(() => {
    return () => {
      if (pendingLayoutRef.current) clearTimeout(pendingLayoutRef.current)
    }
  }, [])

  return {
    anchors,
    cardAnchors,
    openDoc,
    createColumn,
    addCard,
    openDocFor,
    closeDoc,
    saveDoc,
    saveTitle,
    deleteCard,
    handleChange,
    handlePointerUp,
  }
}
