/**
 * Documento interno do card. O conteúdo é markdown puro guardado em
 * `customData.cardDoc` do próprio retângulo: viaja no .excalidraw, sobrevive a
 * copiar/colar e continua legível se alguém abrir o arquivo na mão.
 *
 * Fica FORA de `customData.cardStack` de propósito: o layout reescreve aquele
 * objeto ao mudar um card de coluna e levaria o texto junto.
 */

export const CARD_DOC_KEY = 'cardDoc'

export type BlockType =
  | 'heading1'
  | 'heading2'
  | 'heading3'
  | 'paragraph'
  | 'bullet'
  | 'numbered'
  | 'todo'
  | 'quote'
  | 'code'
  | 'divider'

export interface Block {
  id: string
  type: BlockType
  text: string
  /** só em 'todo' */
  checked?: boolean
  /** só em 'code' */
  lang?: string
}

export interface CardDoc {
  markdown: string
  updatedAt?: string
}

type AnyElement = any

let seq = 0
const blockId = (): string => {
  seq += 1
  return `b${seq}_${Math.random().toString(36).slice(2, 7)}`
}

export const emptyBlock = (type: BlockType = 'paragraph'): Block => ({
  id: blockId(),
  type,
  text: '',
  ...(type === 'todo' ? { checked: false } : {}),
  ...(type === 'code' ? { lang: '' } : {}),
})

// ─── markdown ↔ blocos ────────────────────────────────────────

/** Parser de linha. Só o subconjunto que o editor sabe renderizar de volta. */
export const parseMarkdown = (markdown: string): Block[] => {
  const lines = (markdown || '').replace(/\r\n/g, '\n').split('\n')
  const blocks: Block[] = []

  let i = 0
  while (i < lines.length) {
    const line = lines[i]

    // bloco de código: consome até a cerca de fechamento
    const fence = line.match(/^```(\S*)\s*$/)
    if (fence) {
      const lang = fence[1] || ''
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // pula a cerca final
      blocks.push({ id: blockId(), type: 'code', lang, text: body.join('\n') })
      continue
    }

    if (/^---+\s*$/.test(line)) {
      blocks.push({ id: blockId(), type: 'divider', text: '' })
      i += 1
      continue
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/)
    if (heading) {
      const level = heading[1].length as 1 | 2 | 3
      blocks.push({
        id: blockId(),
        type: (`heading${level}` as BlockType),
        text: heading[2],
      })
      i += 1
      continue
    }

    const todo = line.match(/^[-*]\s+\[([ xX])\]\s?(.*)$/)
    if (todo) {
      blocks.push({
        id: blockId(),
        type: 'todo',
        checked: todo[1].toLowerCase() === 'x',
        text: todo[2],
      })
      i += 1
      continue
    }

    const bullet = line.match(/^[-*]\s+(.*)$/)
    if (bullet) {
      blocks.push({ id: blockId(), type: 'bullet', text: bullet[1] })
      i += 1
      continue
    }

    const numbered = line.match(/^\d+[.)]\s+(.*)$/)
    if (numbered) {
      blocks.push({ id: blockId(), type: 'numbered', text: numbered[1] })
      i += 1
      continue
    }

    const quote = line.match(/^>\s?(.*)$/)
    if (quote) {
      blocks.push({ id: blockId(), type: 'quote', text: quote[1] })
      i += 1
      continue
    }

    // Linha em branco só vira parágrafo vazio se estiver entre conteúdo:
    // assim o round-trip não multiplica linhas em branco a cada salvamento.
    if (line.trim() === '') {
      const previous = blocks[blocks.length - 1]
      const hasNext = lines.slice(i + 1).some((l) => l.trim() !== '')
      if (previous && previous.type !== 'paragraph' && hasNext) {
        i += 1
        continue
      }
      if (!previous || !hasNext) {
        i += 1
        continue
      }
    }

    blocks.push({ id: blockId(), type: 'paragraph', text: line })
    i += 1
  }

  return blocks.length > 0 ? blocks : [emptyBlock()]
}

export const serializeBlocks = (blocks: Block[]): string => {
  const lines: string[] = []
  blocks.forEach((block, index) => {
    switch (block.type) {
      case 'heading1':
        lines.push(`# ${block.text}`)
        break
      case 'heading2':
        lines.push(`## ${block.text}`)
        break
      case 'heading3':
        lines.push(`### ${block.text}`)
        break
      case 'bullet':
        lines.push(`- ${block.text}`)
        break
      case 'numbered': {
        // Numeração contínua dentro da mesma sequência de itens numerados.
        let n = 1
        for (let k = index - 1; k >= 0; k -= 1) {
          if (blocks[k].type !== 'numbered') break
          n += 1
        }
        lines.push(`${n}. ${block.text}`)
        break
      }
      case 'todo':
        lines.push(`- [${block.checked ? 'x' : ' '}] ${block.text}`)
        break
      case 'quote':
        lines.push(`> ${block.text}`)
        break
      case 'divider':
        lines.push('---')
        break
      case 'code':
        lines.push(`\`\`\`${block.lang || ''}`)
        lines.push(block.text)
        lines.push('```')
        break
      default:
        lines.push(block.text)
    }
  })
  return lines.join('\n')
}

// ─── leitura e escrita no elemento ────────────────────────────

export const getCardDoc = (element: AnyElement): CardDoc | null => {
  const doc = element?.customData?.[CARD_DOC_KEY]
  if (!doc || typeof doc.markdown !== 'string') return null
  return doc as CardDoc
}

export const withCardDoc = (element: AnyElement, markdown: string, updatedAt: string): AnyElement => ({
  ...element,
  customData: {
    ...(element.customData || {}),
    [CARD_DOC_KEY]: { markdown, updatedAt },
  },
})

export const hasContent = (markdown: string | undefined | null): boolean =>
  Boolean(markdown && markdown.trim().length > 0)

/** Progresso da checklist, o "2/5" que aparece na frente do card. */
export const todoProgress = (markdown: string | undefined | null): { done: number; total: number } => {
  if (!markdown) return { done: 0, total: 0 }
  let done = 0
  let total = 0
  for (const line of markdown.split('\n')) {
    const match = line.match(/^[-*]\s+\[([ xX])\]/)
    if (!match) continue
    total += 1
    if (match[1].toLowerCase() === 'x') done += 1
  }
  return { done, total }
}

/** Primeira linha com texto: serve de resumo quando o card está fechado. */
export const docSummary = (markdown: string | undefined | null): string => {
  if (!markdown) return ''
  for (const raw of markdown.split('\n')) {
    const line = raw
      .replace(/^#{1,3}\s+/, '')
      .replace(/^[-*]\s+\[[ xX]\]\s?/, '')
      .replace(/^[-*]\s+/, '')
      .replace(/^\d+[.)]\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^```.*$/, '')
      .trim()
    if (line) return line.slice(0, 120)
  }
  return ''
}

// ─── menu de comandos ("/") ───────────────────────────────────

export interface SlashCommand {
  type: BlockType
  label: string
  hint: string
  /** o que o usuário digitaria em markdown puro */
  markdownHint: string
  keywords: string[]
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { type: 'paragraph', label: 'Texto', hint: 'Parágrafo simples', markdownHint: '', keywords: ['texto', 'paragrafo', 'paragraph', 'p'] },
  { type: 'heading1', label: 'Título 1', hint: 'Seção principal', markdownHint: '#', keywords: ['titulo', 'h1', 'heading'] },
  { type: 'heading2', label: 'Título 2', hint: 'Subseção', markdownHint: '##', keywords: ['titulo', 'h2', 'heading', 'sub'] },
  { type: 'heading3', label: 'Título 3', hint: 'Subseção menor', markdownHint: '###', keywords: ['titulo', 'h3', 'heading'] },
  { type: 'bullet', label: 'Lista', hint: 'Item com marcador', markdownHint: '-', keywords: ['lista', 'bullet', 'item', 'ul'] },
  { type: 'numbered', label: 'Lista numerada', hint: 'Passo a passo', markdownHint: '1.', keywords: ['numerada', 'numbered', 'ol', 'passo'] },
  { type: 'todo', label: 'Checklist', hint: 'Caixa pra marcar', markdownHint: '- [ ]', keywords: ['checklist', 'todo', 'tarefa', 'check'] },
  { type: 'code', label: 'Código', hint: 'Bloco monoespaçado', markdownHint: '```', keywords: ['codigo', 'code', 'comando', 'shell'] },
  { type: 'quote', label: 'Citação', hint: 'Trecho destacado', markdownHint: '>', keywords: ['citacao', 'quote', 'nota'] },
  { type: 'divider', label: 'Divisória', hint: 'Linha separadora', markdownHint: '---', keywords: ['divisoria', 'linha', 'divider', 'hr'] },
]

export const filterCommands = (query: string): SlashCommand[] => {
  const q = query.trim().toLocaleLowerCase()
  if (!q) return SLASH_COMMANDS
  return SLASH_COMMANDS.filter(
    (command) =>
      command.label.toLocaleLowerCase().includes(q) ||
      command.keywords.some((keyword) => keyword.includes(q)),
  )
}

/**
 * Atalhos de markdown enquanto digita: "## " vira Título 2 na hora, como no
 * editor das referências. Devolve null quando não há transformação.
 */
export const markdownShortcut = (text: string): { type: BlockType; rest: string } | null => {
  const table: Array<[RegExp, BlockType]> = [
    [/^#\s(.*)$/, 'heading1'],
    [/^##\s(.*)$/, 'heading2'],
    [/^###\s(.*)$/, 'heading3'],
    [/^[-*]\s\[\]\s?(.*)$/, 'todo'],
    [/^\[\]\s(.*)$/, 'todo'],
    [/^[-*]\s(.*)$/, 'bullet'],
    [/^\d+[.)]\s(.*)$/, 'numbered'],
    [/^>\s(.*)$/, 'quote'],
    [/^```(.*)$/, 'code'],
    [/^---$/, 'divider'],
  ]
  for (const [pattern, type] of table) {
    const match = text.match(pattern)
    if (match) return { type, rest: match[1] ?? '' }
  }
  return null
}

// ─── inline (negrito, itálico, código, link) ──────────────────

export interface InlineToken {
  kind: 'text' | 'bold' | 'italic' | 'code' | 'link'
  text: string
  href?: string
}

const escapeRegExpNothing = 0
void escapeRegExpNothing

/** Tokenizador inline mínimo, sem HTML: o render monta os nós React. */
export const parseInline = (text: string): InlineToken[] => {
  const tokens: InlineToken[] = []
  const pattern = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*]+\*)|(\[[^\]]+\]\([^)]+\))/g
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: 'text', text: text.slice(lastIndex, match.index) })
    }
    const piece = match[0]
    if (piece.startsWith('`')) {
      tokens.push({ kind: 'code', text: piece.slice(1, -1) })
    } else if (piece.startsWith('**')) {
      tokens.push({ kind: 'bold', text: piece.slice(2, -2) })
    } else if (piece.startsWith('*')) {
      tokens.push({ kind: 'italic', text: piece.slice(1, -1) })
    } else {
      const link = piece.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
      if (link) tokens.push({ kind: 'link', text: link[1], href: link[2] })
      else tokens.push({ kind: 'text', text: piece })
    }
    lastIndex = match.index + piece.length
  }

  if (lastIndex < text.length) {
    tokens.push({ kind: 'text', text: text.slice(lastIndex) })
  }
  return tokens
}
