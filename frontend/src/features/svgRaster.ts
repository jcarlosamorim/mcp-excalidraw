/**
 * Rasterização de SVG pra PNG, compartilhada entre o banco de logos e o
 * import direto (drop/colar) de arquivos.
 *
 * SVG entra na cena rasterizado, e não como SVG: o Excalidraw escurece o
 * canvas inteiro com um filtro (`invert(93%) hue-rotate(180deg)`) e, pra
 * imagem não sair negativa, aplica o filtro contrário em cima dela. Só que
 * essa compensação exclui SVG de propósito (`mimeType !== image/svg+xml` no
 * renderElement), então uma arte vetorial aparece com a luminosidade trocada
 * no tema escuro: o laranja do Figma vira salmão claro, e uma arte preta vira
 * branca. Rasterizar em 4x resolve sem gambiarra de tema, com folga de
 * resolução pra ampliar no canvas.
 */

export const RASTER_SCALE = 4

export const blobToDataURL = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(reader.error ?? new Error('falha ao ler o arquivo'))
    reader.readAsDataURL(blob)
  })

export const fitDentroDe = (
  max: number,
  width: number,
  height: number,
): { width: number; height: number } => {
  if (!(width > 0) || !(height > 0)) return { width: max, height: max }
  const scale = max / Math.max(width, height)
  return { width: Math.round(width * scale), height: Math.round(height * scale) }
}

/**
 * Mede um SVG lendo o próprio texto: muitos vêm só com `viewBox`, e nesse
 * caso o naturalWidth do navegador volta zero e a arte entraria achatada.
 */
export const medirSvg = (texto: string): { width: number; height: number } | null => {
  const width = /\swidth="([\d.]+)/.exec(texto)?.[1]
  const height = /\sheight="([\d.]+)/.exec(texto)?.[1]
  if (width && height) return { width: Number(width), height: Number(height) }
  const viewBox = /viewBox="([^"]+)"/.exec(texto)?.[1]
  if (viewBox) {
    const parts = viewBox.trim().split(/[\s,]+/).map(Number)
    if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
      return { width: parts[2], height: parts[3] }
    }
  }
  return null
}

export const comDimensoes = (texto: string, width: number, height: number): string => {
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

export const rasterizarSvg = async (
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
