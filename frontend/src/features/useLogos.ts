import { useCallback, useEffect, useRef, useState } from 'react'
import { CaptureUpdateAction } from '@excalidraw/excalidraw'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'

/**
 * Banco de logos: a pasta no servidor é a fonte, e inserir traz a imagem pra
 * dentro da cena como qualquer imagem do Excalidraw. Assim o diagrama continua
 * inteiro no export e no .excalidraw, mesmo que a logo saia do banco depois.
 */

export interface LogoInfo {
  id: string
  name: string
  filename: string
  mime: string
  size: number
  updatedAt: string
  variant: string | null
}

type AnyElement = any

/** Maior lado da logo ao entrar na cena, em unidades de cena. */
export const LOGO_SIZE = 150

const newId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `logo-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`
}

/**
 * O servidor devolve o index.html em rota que não existe, e aí o `response.json()`
 * estoura com a mensagem crua do navegador ("The string did not match the
 * expected pattern"). Isso acontece de verdade quando o frontend novo roda
 * contra um servidor antigo, que é o caso de quem só recarregou a página depois
 * de atualizar o canvas.
 */
const pedirJson = async (url: string, init?: RequestInit): Promise<any> => {
  const response = await fetch(url, init)
  const tipo = response.headers.get('content-type') ?? ''
  if (!tipo.includes('application/json')) {
    if (response.status === 404 || tipo.includes('text/html')) {
      throw new Error(
        'este servidor ainda não conhece o banco de logos. Reinicie o canvas: excalidraw-canvas restart',
      )
    }
    throw new Error(`resposta inesperada do servidor (${response.status})`)
  }
  return response.json()
}

const blobToDataURL = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('falha ao ler o arquivo'))
    reader.readAsDataURL(blob)
  })

const fit = (width: number, height: number): { width: number; height: number } => {
  if (!(width > 0) || !(height > 0)) return { width: LOGO_SIZE, height: LOGO_SIZE }
  const scale = LOGO_SIZE / Math.max(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * SVG é medido lendo o próprio arquivo: muitos vêm só com `viewBox`, e nesse
 * caso o naturalWidth do navegador volta zero e a logo entraria achatada.
 */
const dimensionsFor = async (
  logo: LogoInfo,
  blob: Blob,
): Promise<{ width: number; height: number }> => {
  if (logo.mime === 'image/svg+xml') {
    const text = await blob.text()
    const width = /\swidth="([\d.]+)/.exec(text)?.[1]
    const height = /\sheight="([\d.]+)/.exec(text)?.[1]
    if (width && height) return fit(Number(width), Number(height))
    const viewBox = /viewBox="([^"]+)"/.exec(text)?.[1]
    if (viewBox) {
      const parts = viewBox.trim().split(/[\s,]+/).map(Number)
      if (parts.length === 4) return fit(parts[2], parts[3])
    }
    return { width: LOGO_SIZE, height: LOGO_SIZE }
  }

  const url = URL.createObjectURL(blob)
  try {
    const natural = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const image = new Image()
      image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight })
      image.onerror = () => reject(new Error('não consegui abrir a imagem'))
      image.src = url
    })
    return fit(natural.width, natural.height)
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * SVG entra na cena rasterizado, e não como SVG.
 *
 * O Excalidraw escurece o canvas inteiro com um filtro (`invert(93%)
 * hue-rotate(180deg)`) e, pra imagem não sair negativa, aplica o filtro
 * contrário em cima dela. Só que essa compensação exclui SVG de propósito
 * (`mimeType !== image/svg+xml` no renderElement), então uma logo vetorial
 * aparece com a luminosidade trocada no tema escuro: o laranja do Figma vira
 * salmão claro, e uma arte preta vira branca.
 *
 * Rasterizar em 4x resolve sem gambiarra de tema: a logo passa a ser tratada
 * como qualquer imagem e fica com a cor real nos dois temas, com folga de
 * resolução pra ampliar no canvas.
 */
const RASTER_SCALE = 4

const comDimensoes = (texto: string, width: number, height: number): string => {
  let svg = texto
  if (!/xmlns=/i.test(svg)) {
    svg = svg.replace(/<svg\b/i, '<svg xmlns="http://www.w3.org/2000/svg"')
  }
  // Sem width/height explícitos o navegador rasteriza no tamanho que quiser,
  // e a maioria dos ícones traz só o viewBox.
  return svg.replace(/<svg\b([^>]*)>/i, (_tag, attrs: string) => {
    const limpo = attrs.replace(/\swidth="[^"]*"/i, '').replace(/\sheight="[^"]*"/i, '')
    return `<svg${limpo} width="${Math.round(width)}" height="${Math.round(height)}">`
  })
}

const rasterizarSvg = async (
  texto: string,
  size: { width: number; height: number },
): Promise<string> => {
  const largura = Math.max(1, Math.round(size.width * RASTER_SCALE))
  const altura = Math.max(1, Math.round(size.height * RASTER_SCALE))
  const blob = new Blob([comDimensoes(texto, largura, altura)], {
    type: 'image/svg+xml;charset=utf-8',
  })
  const url = URL.createObjectURL(blob)
  try {
    const imagem = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      img.onload = () => resolve(img)
      img.onerror = () => reject(new Error('não consegui desenhar o SVG'))
      img.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = largura
    canvas.height = altura
    const contexto = canvas.getContext('2d')
    if (!contexto) throw new Error('canvas indisponível')
    contexto.drawImage(imagem, 0, 0, largura, altura)
    return canvas.toDataURL('image/png')
  } finally {
    URL.revokeObjectURL(url)
  }
}

interface UseLogosParams {
  excalidrawAPI: ExcalidrawImperativeAPI | null
  /** Libera o auto-sync do App, que só dispara depois de interação do usuário. */
  markInteraction: () => void
}

export const useLogos = ({ excalidrawAPI, markInteraction }: UseLogosParams) => {
  const [logos, setLogos] = useState<LogoInfo[]>([])
  const [dir, setDir] = useState<string>('')
  const [panelOpen, setPanelOpen] = useState<boolean>(false)
  const [busy, setBusy] = useState<boolean>(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null)
  useEffect(() => {
    apiRef.current = excalidrawAPI
  }, [excalidrawAPI])

  const load = useCallback(async (): Promise<void> => {
    try {
      const result = await pedirJson('/api/logos')
      if (!result.success) throw new Error(result.error || 'falha ao listar')
      setLogos(result.logos ?? [])
      setDir(result.dir ?? '')
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const openPanel = useCallback((): void => {
    setNotice(null)
    setPanelOpen(true)
    void load()
  }, [load])

  const closePanel = useCallback((): void => setPanelOpen(false), [])

  const insert = useCallback(
    async (logo: LogoInfo): Promise<void> => {
      const api = apiRef.current
      if (!api) return
      setBusy(true)
      try {
        const response = await fetch(`/api/logos/${logo.id}/raw`)
        if (!response.ok) {
          throw new Error(
            response.status === 404
              ? 'a logo saiu do banco, ou o servidor precisa ser reiniciado'
              : 'não consegui baixar a logo',
          )
        }
        const blob = await response.blob()
        const size = await dimensionsFor(logo, blob)

        // SVG vira PNG aqui: no tema escuro o Excalidraw não compensa o filtro
        // dele e a logo sairia com a luminosidade trocada.
        const vetor = logo.mime === 'image/svg+xml'
        const dataURL = vetor
          ? await rasterizarSvg(await blob.text(), size)
          : await blobToDataURL(blob)
        const mimeType = vetor ? 'image/png' : logo.mime

        // Id derivado da logo: inserir a mesma marca duas vezes reaproveita o
        // arquivo já embutido, em vez de engordar a cena com uma cópia igual.
        // O sufixo separa o rasterizado do que já entrou como vetor antes.
        const fileId = vetor ? `logo-${logo.id}-raster` : `logo-${logo.id}`
        const created = Date.now()
        api.addFiles([{ id: fileId, dataURL, mimeType: mimeType as any, created }])
        // O backend precisa do arquivo também: o auto-sync manda só elementos,
        // e sem isto a imagem sumiria no próximo carregamento da cena.
        await fetch('/api/files', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ files: [{ id: fileId, dataURL, mimeType, created }] }),
        })

        const appState = api.getAppState() as any
        const zoom = appState?.zoom?.value ?? 1
        const width = appState?.width ?? window.innerWidth
        const height = appState?.height ?? window.innerHeight
        const element: AnyElement = {
          type: 'image',
          id: newId(),
          x: Math.round(width / 2 / zoom - (appState?.scrollX ?? 0) - size.width / 2),
          y: Math.round(height / 2 / zoom - (appState?.scrollY ?? 0) - size.height / 2),
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
          customData: { logo: { id: logo.id, name: logo.name } },
        }

        markInteraction()
        api.updateScene({
          elements: [...api.getSceneElements(), element],
          appState: { selectedElementIds: { [element.id]: true } },
          captureUpdate: CaptureUpdateAction.IMMEDIATELY,
        })
        // Fecha: o painel cobre o canvas e a logo entra selecionada, pronta
        // pra arrastar.
        setPanelOpen(false)
        setNotice(`${logo.name} entrou no canvas`)
        setError(null)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [markInteraction],
  )

  const importFrom = useCallback(
    async (sourceDir: string): Promise<void> => {
      setBusy(true)
      try {
        const result = await pedirJson('/api/logos/import', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dir: sourceDir }),
        })
        if (!result.success) throw new Error(result.error || 'falha ao importar')
        setLogos(result.logos ?? [])
        const partes = [
          `${result.imported.length} importada(s)`,
          result.skipped.length > 0 ? `${result.skipped.length} já estava(m)` : null,
          result.errors.length > 0 ? `${result.errors.length} com erro` : null,
        ].filter(Boolean)
        setNotice(partes.join(', '))
        setError(result.errors.length > 0 ? result.errors[0] : null)
      } catch (err) {
        setError((err as Error).message)
      } finally {
        setBusy(false)
      }
    },
    [],
  )

  const upload = useCallback(async (files: FileList | File[]): Promise<void> => {
    setBusy(true)
    try {
      let contagem = 0
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue
        const dataURL = await blobToDataURL(file)
        const result = await pedirJson('/api/logos/upload', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: file.name, dataURL }),
        })
        if (result.success) {
          setLogos(result.logos ?? [])
          contagem += 1
        }
      }
      setNotice(contagem > 0 ? `${contagem} logo(s) adicionada(s)` : 'nenhuma imagem reconhecida')
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }, [])

  const remove = useCallback(async (id: string): Promise<void> => {
    try {
      const result = await pedirJson(`/api/logos/${id}`, { method: 'DELETE' })
      if (!result.success) throw new Error(result.error || 'falha ao remover')
      setLogos(result.logos ?? [])
      setNotice('logo removida do banco')
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  // Atalho B, no mesmo espírito do S do card stack e do M do mapa mental.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return

      if (event.key === 'Escape' && panelOpen) {
        event.preventDefault()
        setPanelOpen(false)
        return
      }

      if (event.key !== 'b' && event.key !== 'B') return
      const target = event.target as HTMLElement | null
      const tag = target?.tagName
      // Digitando (inclusive na busca do próprio painel) a tecla é do campo.
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) {
        return
      }
      const appState = apiRef.current?.getAppState() as any
      if (appState?.editingTextElement) return
      event.preventDefault()
      setNotice(null)
      setPanelOpen(true)
      void load()
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [load, panelOpen])

  return {
    logos,
    dir,
    panelOpen,
    busy,
    error,
    notice,
    openPanel,
    closePanel,
    load,
    insert,
    importFrom,
    upload,
    remove,
  }
}
