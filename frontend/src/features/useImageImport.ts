import { useEffect, useRef } from 'react'
import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import { blobToDataURL, fitDentroDe, medirSvg, rasterizarSvg } from './svgRaster'

/**
 * Import direto de SVG (arrastar arquivo pro canvas ou colar) entra
 * rasterizado em PNG, pelo mesmo motivo do banco de logos: o contra-filtro do
 * tema escuro do Excalidraw exclui SVG, e a arte vetorial aparece negativa.
 *
 * O caminho nativo do Excalidraw continua cuidando de PNG/JPG e dos arquivos
 * .excalidraw; a interceptação só assume o evento quando há SVG no meio.
 */

/** Maior lado com que um arquivo importado entra na cena. */
const IMPORT_MAX = 400

type AnyElement = any

const newId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `img-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

const medirImagem = (blob: Blob): Promise<{ width: number; height: number }> => {
  const url = URL.createObjectURL(blob)
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve({ width: image.naturalWidth, height: image.naturalHeight })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('não consegui abrir a imagem'))
    }
    image.src = url
  })
}

interface UseImageImportParams {
  excalidrawAPI: ExcalidrawImperativeAPI | null
  /** Libera o auto-sync do App, que só dispara depois de interação do usuário. */
  markInteraction: () => void
}

export const useImageImport = ({ excalidrawAPI, markInteraction }: UseImageImportParams) => {
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  useEffect(() => {
    apiRef.current = excalidrawAPI
  }, [excalidrawAPI])

  const markRef = useRef(markInteraction)
  useEffect(() => {
    markRef.current = markInteraction
  }, [markInteraction])

  useEffect(() => {
    const inserir = async (files: File[], clientX: number | null, clientY: number | null) => {
      const api = apiRef.current
      if (!api) return

      const appState = api.getAppState() as any
      const zoom = appState?.zoom?.value ?? 1
      const scrollX = appState?.scrollX ?? 0
      const scrollY = appState?.scrollY ?? 0
      const offsetLeft = appState?.offsetLeft ?? 0
      const offsetTop = appState?.offsetTop ?? 0

      // Colar não tem posição: usa o centro da tela, como o banco de logos.
      const baseX =
        clientX !== null
          ? (clientX - offsetLeft) / zoom - scrollX
          : (appState?.width ?? window.innerWidth) / 2 / zoom - scrollX
      const baseY =
        clientY !== null
          ? (clientY - offsetTop) / zoom - scrollY
          : (appState?.height ?? window.innerHeight) / 2 / zoom - scrollY

      const novos: AnyElement[] = []
      let indice = 0
      for (const file of files) {
        try {
          const vetor = file.type === 'image/svg+xml'
          let size: { width: number; height: number }
          let dataURL: string
          if (vetor) {
            const texto = await file.text()
            const medida = medirSvg(texto) ?? { width: IMPORT_MAX, height: IMPORT_MAX }
            size = fitDentroDe(Math.min(IMPORT_MAX, Math.max(medida.width, medida.height)), medida.width, medida.height)
            dataURL = await rasterizarSvg(texto, size)
          } else {
            const medida = await medirImagem(file)
            size = fitDentroDe(Math.min(IMPORT_MAX, Math.max(medida.width, medida.height)), medida.width, medida.height)
            dataURL = await blobToDataURL(file)
          }

          const fileId = newId().replace(/-/g, '')
          const created = Date.now()
          const mimeType = vetor ? 'image/png' : file.type
          api.addFiles([{ id: fileId as any, dataURL: dataURL as any, mimeType: mimeType as any, created }])
          // O backend precisa do arquivo também: o auto-sync manda só
          // elementos, e sem isto a imagem some no próximo carregamento.
          await fetch('/api/files', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ files: [{ id: fileId, dataURL, mimeType, created }] }),
          })

          novos.push({
            type: 'image',
            id: newId(),
            x: Math.round(baseX - size.width / 2 + indice * 24),
            y: Math.round(baseY - size.height / 2 + indice * 24),
            width: size.width,
            height: size.height,
            angle: 0,
            strokeColor: 'transparent',
            backgroundColor: 'transparent',
            fillStyle: 'solid',
            strokeWidth: 1,
            strokeStyle: 'solid',
            roughness: 0,
            opacity: 100,
            groupIds: [],
            frameId: null,
            roundness: null,
            seed: Math.floor(Math.random() * 1000000),
            version: 1,
            versionNonce: Math.floor(Math.random() * 1000000),
            isDeleted: false,
            boundElements: null,
            updated: created,
            link: null,
            locked: false,
            status: 'saved',
            fileId,
            scale: [1, 1],
          })
          indice += 1
        } catch (err) {
          console.error('Import de imagem falhou:', file.name, err)
        }
      }

      if (novos.length === 0) return
      markRef.current()
      api.updateScene({
        elements: [...api.getSceneElements(), ...novos],
        appState: {
          selectedElementIds: Object.fromEntries(novos.map(el => [el.id, true])),
        },
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      })
    }

    const temSvg = (files: FileList | null): boolean =>
      !!files && Array.from(files).some(f => f.type === 'image/svg+xml')

    const onDrop = (event: DragEvent): void => {
      const files = event.dataTransfer?.files ?? null
      if (!temSvg(files)) return
      event.preventDefault()
      event.stopPropagation()
      const imagens = Array.from(files!).filter(f => f.type.startsWith('image/'))
      void inserir(imagens, event.clientX, event.clientY)
    }

    const onPaste = (event: ClipboardEvent): void => {
      const files = event.clipboardData?.files ?? null
      if (!temSvg(files)) return
      event.preventDefault()
      event.stopPropagation()
      const imagens = Array.from(files!).filter(f => f.type.startsWith('image/'))
      void inserir(imagens, null, null)
    }

    // Fase de captura: o listener do Excalidraw não pode ver o evento quando
    // há SVG, senão ele insere o vetor cru por cima do nosso.
    window.addEventListener('drop', onDrop, { capture: true })
    window.addEventListener('paste', onPaste, { capture: true })
    return () => {
      window.removeEventListener('drop', onDrop, { capture: true })
      window.removeEventListener('paste', onPaste, { capture: true })
    }
  }, [])
}
