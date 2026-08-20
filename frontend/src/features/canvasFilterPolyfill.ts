/**
 * Polyfill de CanvasRenderingContext2D.filter pro WKWebView (app nativo).
 *
 * O Excalidraw escurece o canvas com CSS (`invert(93%) hue-rotate(180deg)`) e,
 * pra imagem não sair negativa, seta `ctx.filter = invert(100%)
 * hue-rotate(180deg) saturate(1.25)` antes de desenhá-la. O WebKit não
 * implementa esse filtro de contexto ('filter' nem existe no prototype), a
 * atribuição vira expando inerte e TODA imagem aparece com a luminosidade
 * invertida no tema escuro dentro do app Pake/Tauri — no Chrome funciona.
 *
 * Aqui o filtro é aplicado na mão: drawImage com um filtro de invert/hue/
 * saturate ativo desenha uma cópia com a transformação feita por matemática de
 * pixel (matriz afim composta, cacheada por fonte+filtro). Filtro que não seja
 * só invert/hue-rotate/saturate não é emulado: desenha o original.
 */

type Affine = { m: number[]; b: number[] }

const IDENTITY: Affine = { m: [1, 0, 0, 0, 1, 0, 0, 0, 1], b: [0, 0, 0] }

const multiply = (a: Affine, b: Affine): Affine => {
  // resultado = a ∘ b (aplica b primeiro)
  const m = new Array(9).fill(0)
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      for (let k = 0; k < 3; k++) m[r * 3 + c] += a.m[r * 3 + k] * b.m[k * 3 + c]
    }
  }
  const off = [0, 1, 2].map(r =>
    a.m[r * 3] * b.b[0] + a.m[r * 3 + 1] * b.b[1] + a.m[r * 3 + 2] * b.b[2] + a.b[r],
  )
  return { m, b: off }
}

// Matrizes do spec de filtros CSS (feColorMatrix, espaço sRGB).
const invertMatrix = (p: number): Affine => ({
  m: [1 - 2 * p, 0, 0, 0, 1 - 2 * p, 0, 0, 0, 1 - 2 * p],
  b: [255 * p, 255 * p, 255 * p],
})

const saturateMatrix = (s: number): Affine => ({
  m: [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ],
  b: [0, 0, 0],
})

const hueRotateMatrix = (deg: number): Affine => {
  const rad = (deg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    m: [
      0.213 + cos * 0.787 - sin * 0.213, 0.715 - cos * 0.715 - sin * 0.715, 0.072 - cos * 0.072 + sin * 0.928,
      0.213 - cos * 0.213 + sin * 0.143, 0.715 + cos * 0.285 + sin * 0.140, 0.072 - cos * 0.072 - sin * 0.283,
      0.213 - cos * 0.213 - sin * 0.787, 0.715 - cos * 0.715 + sin * 0.715, 0.072 + cos * 0.928 + sin * 0.072,
    ],
    b: [0, 0, 0],
  }
}

/** null = filtro tem função que não sabemos emular; desenhar o original. */
const parseFilter = (filter: string): Affine | null => {
  let total = IDENTITY
  const re = /([a-z-]+)\(([^)]*)\)/g
  let match: RegExpExecArray | null
  let found = false
  while ((match = re.exec(filter)) !== null) {
    found = true
    const fn = match[1]
    const arg = match[2].trim()
    let step: Affine
    if (fn === 'invert') {
      const p = arg.endsWith('%') ? parseFloat(arg) / 100 : parseFloat(arg)
      if (!isFinite(p)) return null
      step = invertMatrix(p)
    } else if (fn === 'saturate') {
      const s = arg.endsWith('%') ? parseFloat(arg) / 100 : parseFloat(arg)
      if (!isFinite(s)) return null
      step = saturateMatrix(s)
    } else if (fn === 'hue-rotate') {
      const deg = parseFloat(arg)
      if (!isFinite(deg)) return null
      step = hueRotateMatrix(deg)
    } else {
      return null
    }
    // Lista CSS aplica da esquerda pra direita.
    total = multiply(step, total)
  }
  return found ? total : null
}

type Drawable = HTMLImageElement | HTMLCanvasElement | ImageBitmap

const sourceSize = (img: Drawable): { width: number; height: number } => {
  const anyImg = img as any
  return {
    width: anyImg.naturalWidth || anyImg.width || 0,
    height: anyImg.naturalHeight || anyImg.height || 0,
  }
}

export const installCanvasFilterPolyfill = (): void => {
  if (typeof CanvasRenderingContext2D === 'undefined') return
  const proto = CanvasRenderingContext2D.prototype as any
  if ('filter' in proto) return // Chromium e afins: nativo, não mexe.

  const FILTER = Symbol('pfFilter')
  const STACK = Symbol('pfFilterStack')
  // cache: fonte -> (string do filtro -> canvas já filtrado)
  const filteredCache = new WeakMap<object, Map<string, HTMLCanvasElement>>()
  const affineCache = new Map<string, Affine | null>()

  Object.defineProperty(proto, 'filter', {
    configurable: true,
    get(this: any) {
      return this[FILTER] ?? 'none'
    },
    set(this: any, value: string) {
      this[FILTER] = String(value)
    },
  })

  const origSave = proto.save
  proto.save = function (this: any) {
    if (!this[STACK]) this[STACK] = []
    this[STACK].push(this[FILTER] ?? 'none')
    return origSave.call(this)
  }

  const origRestore = proto.restore
  proto.restore = function (this: any) {
    if (this[STACK] && this[STACK].length > 0) {
      this[FILTER] = this[STACK].pop()
    }
    return origRestore.call(this)
  }

  const filteredCopy = (
    img: Drawable,
    filter: string,
    affine: Affine,
    cacheable: boolean,
  ): HTMLCanvasElement | null => {
    let byFilter = cacheable ? filteredCache.get(img) : undefined
    if (byFilter?.has(filter)) return byFilter.get(filter) ?? null

    const { width, height } = sourceSize(img)
    if (!(width > 0) || !(height > 0)) return null
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0)
    let data: ImageData
    try {
      data = ctx.getImageData(0, 0, width, height)
    } catch {
      return null // canvas tainted: melhor a imagem negativa do que nenhuma
    }
    const px = data.data
    const { m, b } = affine
    for (let i = 0; i < px.length; i += 4) {
      const r = px[i]
      const g = px[i + 1]
      const bl = px[i + 2]
      px[i] = m[0] * r + m[1] * g + m[2] * bl + b[0]
      px[i + 1] = m[3] * r + m[4] * g + m[5] * bl + b[1]
      px[i + 2] = m[6] * r + m[7] * g + m[8] * bl + b[2]
    }
    ctx.putImageData(data, 0, 0)
    if (cacheable) {
      if (!byFilter) {
        byFilter = new Map()
        filteredCache.set(img, byFilter)
      }
      byFilter.set(filter, canvas)
    }
    return canvas
  }

  const origDrawImage = proto.drawImage
  proto.drawImage = function (this: any, image: any, ...rest: any[]) {
    const filter: string = this[FILTER] ?? 'none'
    if (
      filter !== 'none' &&
      filter !== '' &&
      (image instanceof HTMLImageElement ||
        image instanceof HTMLCanvasElement ||
        (typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap))
    ) {
      let affine = affineCache.get(filter)
      if (affine === undefined) {
        affine = parseFilter(filter)
        affineCache.set(filter, affine)
      }
      if (affine) {
        // Canvas de origem pode ser redesenhado depois; só imagem decodificada
        // e ImageBitmap são estáveis o bastante pra ir pro cache.
        const cacheable = !(image instanceof HTMLCanvasElement)
        const copy = filteredCopy(image, filter, affine, cacheable)
        if (copy) return origDrawImage.call(this, copy, ...rest)
      }
    }
    return origDrawImage.call(this, image, ...rest)
  }
}
