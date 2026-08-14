import React, { useEffect, useMemo, useRef, useState } from 'react'
import { flushSync } from 'react-dom'
import { paletteFor, UiTheme } from './theme'
import {
  Block,
  BlockType,
  emptyBlock,
  filterCommands,
  markdownShortcut,
  parseInline,
  parseMarkdown,
  serializeBlocks,
  todoProgress,
} from './cardDoc'

const LIST_TYPES: BlockType[] = ['bullet', 'numbered', 'todo']

/** Blocos que continuam do mesmo tipo quando você aperta Enter. */
const continuesOnEnter = (type: BlockType): boolean => LIST_TYPES.includes(type)

const blockFont = (type: BlockType): React.CSSProperties => {
  switch (type) {
    case 'heading1':
      return { fontSize: 24, fontWeight: 700, lineHeight: 1.3 }
    case 'heading2':
      return { fontSize: 19, fontWeight: 700, lineHeight: 1.35 }
    case 'heading3':
      return { fontSize: 16, fontWeight: 700, lineHeight: 1.4 }
    case 'code':
      return {
        fontSize: 13,
        lineHeight: 1.6,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
      }
    case 'quote':
      return { fontSize: 14, lineHeight: 1.6, fontStyle: 'italic' }
    default:
      return { fontSize: 14, lineHeight: 1.65 }
  }
}

const InlineText = ({ text, colors }: { text: string; colors: ReturnType<typeof paletteFor> }): JSX.Element => {
  if (!text) return <span style={{ color: colors.muted }}>​</span>
  return (
    <>
      {parseInline(text).map((token, index) => {
        if (token.kind === 'code') {
          return (
            <code
              key={index}
              style={{
                padding: '1px 5px',
                borderRadius: 4,
                background: colors.codeBg,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                fontSize: '0.92em',
              }}
            >
              {token.text}
            </code>
          )
        }
        if (token.kind === 'bold') return <strong key={index}>{token.text}</strong>
        if (token.kind === 'italic') return <em key={index}>{token.text}</em>
        if (token.kind === 'link') {
          return (
            <a
              key={index}
              href={token.href}
              target="_blank"
              rel="noreferrer"
              style={{ color: colors.accent }}
              onClick={(event) => event.stopPropagation()}
            >
              {token.text}
            </a>
          )
        }
        return <span key={index}>{token.text}</span>
      })}
    </>
  )
}

/**
 * Documento interno do card: blocos que renderizam formatados e viram textarea
 * quando você clica neles. Sem contentEditable de propósito, que é onde esse
 * tipo de editor costuma quebrar (seleção, undo, IME, colar).
 */
export default function CardDocPanel({
  open,
  theme,
  title,
  markdown,
  onChangeMarkdown,
  onChangeTitle,
  onClose,
  onDeleteCard,
}: {
  open: boolean
  theme: UiTheme
  title: string
  markdown: string
  onChangeMarkdown: (markdown: string) => void
  onChangeTitle: (title: string) => void
  onClose: () => void
  onDeleteCard: () => void
}): JSX.Element | null {
  const [blocks, setBlocks] = useState<Block[]>(() => parseMarkdown(markdown))
  const [focusedId, setFocusedId] = useState<string | null>(null)
  const [slash, setSlash] = useState<{ blockId: string; query: string; index: number } | null>(null)
  const [draftTitle, setDraftTitle] = useState(title)
  const colors = paletteFor(theme)

  const editorsRef = useRef<Map<string, HTMLTextAreaElement>>(new Map())
  const skipNextSyncRef = useRef(false)
  const loadedForRef = useRef<string>('')

  // Recarrega quando o painel abre em outro card (não a cada tecla digitada).
  const docKey = `${title}::${open}`
  useEffect(() => {
    if (!open) return
    if (loadedForRef.current === docKey) return
    loadedForRef.current = docKey
    setBlocks(parseMarkdown(markdown))
    setDraftTitle(title)
    setFocusedId(null)
    setSlash(null)
  }, [open, docKey, markdown, title])

  // Salva com folga: digitar não pode disparar um sync de cena por tecla.
  useEffect(() => {
    if (!open) return
    if (skipNextSyncRef.current) {
      skipNextSyncRef.current = false
      return
    }
    const timer = setTimeout(() => {
      onChangeMarkdown(serializeBlocks(blocks))
    }, 450)
    return () => clearTimeout(timer)
  }, [blocks, open, onChangeMarkdown])

  const progress = useMemo(() => todoProgress(serializeBlocks(blocks)), [blocks])

  if (!open) return null

  const putCaret = (id: string, caret: 'start' | 'end'): boolean => {
    const editor = editorsRef.current.get(id)
    if (!editor) return false
    editor.focus()
    const position = caret === 'start' ? 0 : editor.value.length
    editor.setSelectionRange(position, position)
    editor.style.height = 'auto'
    editor.style.height = `${editor.scrollHeight}px`
    return true
  }

  /**
   * flushSync + foco no mesmo tick. Com o foco caindo um frame depois, o
   * primeiro caractere digitado após o Enter ia pro vazio: "## Passos" chegava
   * como "# Passos" e "rodar" como "odar".
   */
  const focusBlock = (id: string, caret: 'start' | 'end' = 'end'): void => {
    flushSync(() => setFocusedId(id))
    if (putCaret(id, caret)) return
    requestAnimationFrame(() => putCaret(id, caret))
  }

  const updateBlock = (id: string, patch: Partial<Block>): void => {
    setBlocks((previous) => previous.map((b) => (b.id === id ? { ...b, ...patch } : b)))
  }

  const insertAfter = (id: string, block: Block): void => {
    flushSync(() => {
      setBlocks((previous) => {
        const index = previous.findIndex((b) => b.id === id)
        const next = [...previous]
        next.splice(index + 1, 0, block)
        return next
      })
    })
    focusBlock(block.id)
  }

  const removeBlock = (id: string): void => {
    let target: Block | undefined
    flushSync(() => {
      setBlocks((previous) => {
        if (previous.length === 1) return [emptyBlock()]
        const index = previous.findIndex((b) => b.id === id)
        const next = previous.filter((b) => b.id !== id)
        target = next[Math.max(0, index - 1)]
        return next
      })
    })
    if (target) focusBlock(target.id)
  }

  /**
   * O textarea é NÃO controlado enquanto está focado: com `value` controlado, um
   * setState que chega atrasado reverte o DOM e come caracteres digitados rápido.
   * Toda mudança programática de texto precisa escrever no DOM também.
   */
  const setEditorValue = (blockId: string, text: string): void => {
    const editor = editorsRef.current.get(blockId)
    if (!editor) return
    editor.value = text
    editor.style.height = 'auto'
    editor.style.height = `${editor.scrollHeight}px`
  }

  const applyCommand = (blockId: string, type: BlockType): void => {
    setSlash(null)
    setEditorValue(blockId, '')
    if (type === 'divider') {
      const paragraph = emptyBlock()
      flushSync(() => {
        setBlocks((previous) =>
          previous.flatMap((b) =>
            b.id === blockId ? [{ ...b, type: 'divider', text: '' }, paragraph] : [b],
          ),
        )
      })
      focusBlock(paragraph.id)
      return
    }
    updateBlock(blockId, {
      type,
      text: '',
      ...(type === 'todo' ? { checked: false } : {}),
      ...(type === 'code' ? { lang: '' } : {}),
    })
    focusBlock(blockId)
  }

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>, block: Block): void => {
    const editor = event.currentTarget
    const commands = slash?.blockId === block.id ? filterCommands(slash.query) : []

    if (slash?.blockId === block.id && commands.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setSlash({ ...slash, index: (slash.index + 1) % commands.length })
        return
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setSlash({ ...slash, index: (slash.index - 1 + commands.length) % commands.length })
        return
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        applyCommand(block.id, commands[slash.index].type)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setSlash(null)
        return
      }
    }

    if (event.key === 'Escape') {
      event.preventDefault()
      editor.blur()
      setFocusedId(null)
      return
    }

    if (event.key === 'Enter') {
      // Dentro de código, Enter é quebra de linha: é o ponto do bloco.
      if (block.type === 'code' && !event.metaKey && !event.ctrlKey) return

      event.preventDefault()
      if (continuesOnEnter(block.type) && block.text.trim() === '') {
        // Lista vazia + Enter sai da lista, como em qualquer editor.
        updateBlock(block.id, { type: 'paragraph', checked: undefined })
        focusBlock(block.id)
        return
      }
      const nextType = continuesOnEnter(block.type) ? block.type : 'paragraph'
      insertAfter(block.id, {
        ...emptyBlock(nextType),
        ...(nextType === 'todo' ? { checked: false } : {}),
      })
      return
    }

    if (event.key === 'Backspace' && editor.selectionStart === 0 && editor.selectionEnd === 0) {
      if (block.type !== 'paragraph') {
        event.preventDefault()
        updateBlock(block.id, { type: 'paragraph', checked: undefined, lang: undefined })
        return
      }
      if (block.text === '') {
        event.preventDefault()
        removeBlock(block.id)
        return
      }
    }

    if (event.key === 'ArrowUp' && editor.selectionStart === 0) {
      const index = blocks.findIndex((b) => b.id === block.id)
      if (index > 0) {
        event.preventDefault()
        focusBlock(blocks[index - 1].id)
      }
    }

    if (event.key === 'ArrowDown' && editor.selectionStart === editor.value.length) {
      const index = blocks.findIndex((b) => b.id === block.id)
      if (index < blocks.length - 1) {
        event.preventDefault()
        focusBlock(blocks[index + 1].id, 'start')
      }
    }
  }

  const handleChange = (event: React.ChangeEvent<HTMLTextAreaElement>, block: Block): void => {
    const value = event.target.value
    event.target.style.height = 'auto'
    event.target.style.height = `${event.target.scrollHeight}px`

    // "/" no começo de um bloco vazio abre o menu de comandos.
    if (block.type !== 'code' && value.startsWith('/')) {
      setSlash({ blockId: block.id, query: value.slice(1), index: 0 })
      updateBlock(block.id, { text: value })
      return
    }
    if (slash?.blockId === block.id) setSlash(null)

    // "## " vira Título 2 na hora, sem passar pelo menu.
    if (block.type !== 'code') {
      const shortcut = markdownShortcut(value)
      if (shortcut) {
        const rest = shortcut.type === 'code' ? '' : shortcut.rest
        setEditorValue(block.id, rest)
        updateBlock(block.id, {
          type: shortcut.type,
          text: rest,
          ...(shortcut.type === 'todo' ? { checked: false } : {}),
          ...(shortcut.type === 'code' ? { lang: shortcut.rest } : {}),
        })
        return
      }
    }

    updateBlock(block.id, { text: value })
  }

  const renderEditor = (block: Block): JSX.Element => (
    <textarea
      // A key força um textarea novo por bloco: o defaultValue só vale no mount.
      key={`editor-${block.id}`}
      ref={(node) => {
        if (node) {
          editorsRef.current.set(block.id, node)
          if (node.value !== block.text && document.activeElement !== node) {
            node.value = block.text
          }
        } else {
          editorsRef.current.delete(block.id)
        }
      }}
      defaultValue={block.text}
      onChange={(event) => handleChange(event, block)}
      onKeyDown={(event) => handleKeyDown(event, block)}
      onBlur={() => {
        if (focusedId === block.id) setFocusedId(null)
        setSlash(null)
      }}
      rows={1}
      placeholder={
        block.type === 'code' ? 'código, um comando por linha' : 'digite, ou "/" para blocos'
      }
      style={{
        ...blockFont(block.type),
        width: '100%',
        border: 'none',
        outline: 'none',
        resize: 'none',
        overflow: 'hidden',
        padding: 0,
        margin: 0,
        background: 'transparent',
        color: block.type === 'code' ? colors.codeText : colors.text,
        fontFamily: blockFont(block.type).fontFamily || 'inherit',
      }}
    />
  )

  const renderContent = (block: Block): JSX.Element => {
    const editing = focusedId === block.id
    if (block.type === 'divider') {
      return <hr style={{ border: 'none', borderTop: `1px solid ${colors.line}`, margin: '10px 0' }} />
    }

    if (block.type === 'code') {
      const lines = block.text.split('\n')
      return (
        <div
          style={{
            background: colors.codeBg,
            border: `1px solid ${colors.line}`,
            borderRadius: 8,
            padding: '10px 12px',
            display: 'flex',
            gap: 10,
          }}
        >
          {!editing && (
            <div
              style={{
                ...blockFont('code'),
                color: colors.muted,
                textAlign: 'right',
                userSelect: 'none',
                minWidth: 16,
              }}
            >
              {lines.map((_, index) => (
                <div key={index}>{index + 1}</div>
              ))}
            </div>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {editing ? (
              renderEditor(block)
            ) : (
              <pre style={{ ...blockFont('code'), margin: 0, whiteSpace: 'pre-wrap', color: colors.codeText }}>
                {block.text || ' '}
              </pre>
            )}
          </div>
        </div>
      )
    }

    if (editing) return renderEditor(block)

    const content = <InlineText text={block.text} colors={colors} />
    if (block.type === 'quote') {
      return (
        <div
          style={{
            ...blockFont('quote'),
            borderLeft: `3px solid ${colors.quoteBar}`,
            paddingLeft: 12,
            color: colors.muted,
          }}
        >
          {content}
        </div>
      )
    }
    return <div style={blockFont(block.type)}>{content}</div>
  }

  const commands = slash ? filterCommands(slash.query) : []

  return (
    <div
      // Clicar fora fecha, mas só no véu: clique dentro do documento não conta.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2500,
        background: colors.scrim,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '5vh 4vw',
      }}
    >
    <div
      style={{
        width: 'min(880px, 94vw)',
        maxHeight: '90vh',
        // Altura mínima pro modal não pular de tamanho conforme o texto cresce.
        minHeight: 'min(520px, 74vh)',
        // colorScheme deixa checkbox, barra de rolagem e campos nativos seguirem
        // o tema; sem isso o checkbox continua branco no escuro.
        colorScheme: theme,
        borderRadius: 14,
        overflow: 'hidden',
        background: colors.surface,
        border: `1px solid ${colors.line}`,
        boxShadow: colors.shadow,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        color: colors.text,
      }}
    >
      <div
        style={{
          padding: '14px 20px',
          borderBottom: `1px solid ${colors.line}`,
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div style={{ flex: 1, fontSize: 11, color: colors.muted }}>
          {progress.total > 0 ? `${progress.done}/${progress.total} concluído` : 'Card'}
        </div>
        <button
          onClick={onDeleteCard}
          title="Apagar este card"
          style={{
            padding: '5px 10px',
            border: `1px solid ${colors.line}`,
            borderRadius: 6,
            background: colors.surface,
            color: colors.muted,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Apagar card
        </button>
        <button
          onClick={onClose}
          title="Fechar (Esc)"
          style={{
            padding: '5px 10px',
            border: `1px solid ${colors.line}`,
            borderRadius: 6,
            background: colors.surface,
            color: colors.muted,
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          Fechar
        </button>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '22px 30px 26vh' }}>
        <input
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={() => {
            const clean = draftTitle.trim()
            if (clean && clean !== title) onChangeTitle(clean)
            else setDraftTitle(title)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') event.currentTarget.blur()
            if (event.key === 'Escape') {
              setDraftTitle(title)
              event.currentTarget.blur()
            }
          }}
          placeholder="Sem título"
          style={{
            width: '100%',
            border: 'none',
            outline: 'none',
            padding: 0,
            marginBottom: 18,
            fontSize: 27,
            fontWeight: 700,
            color: colors.text,
            background: 'transparent',
          }}
        />

        {blocks.map((block) => (
          <div
            key={block.id}
            data-block={block.type}
            data-block-id={block.id}
            onClick={() => {
              if (focusedId !== block.id && block.type !== 'divider') focusBlock(block.id)
            }}
            style={{
              position: 'relative',
              display: 'flex',
              alignItems: 'flex-start',
              gap: 8,
              padding: '3px 0',
              cursor: 'text',
            }}
          >
            {block.type === 'todo' && (
              <input
                type="checkbox"
                checked={Boolean(block.checked)}
                onChange={(event) => {
                  event.stopPropagation()
                  updateBlock(block.id, { checked: event.target.checked })
                }}
                onClick={(event) => event.stopPropagation()}
                style={{ marginTop: 4, width: 15, height: 15, cursor: 'pointer', accentColor: colors.accent }}
              />
            )}
            {block.type === 'bullet' && (
              <span style={{ marginTop: 6, fontSize: 13, color: colors.muted, userSelect: 'none' }}>•</span>
            )}
            {block.type === 'numbered' && (
              <span style={{ marginTop: 1, fontSize: 13, color: colors.muted, userSelect: 'none' }}>
                {blocks.slice(0, blocks.findIndex((b) => b.id === block.id) + 1).reduce((acc, b, index, list) => {
                  if (b.id !== block.id) return acc
                  let n = 1
                  for (let k = index - 1; k >= 0; k -= 1) {
                    if (list[k].type !== 'numbered') break
                    n += 1
                  }
                  return n
                }, 1)}
                .
              </span>
            )}
            <div
              style={{
                flex: 1,
                minWidth: 0,
                textDecoration:
                  block.type === 'todo' && block.checked ? 'line-through' : undefined,
                color: block.type === 'todo' && block.checked ? colors.muted : undefined,
              }}
            >
              {renderContent(block)}
            </div>

            {slash?.blockId === block.id && commands.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: '100%',
                  left: 0,
                  zIndex: 10,
                  width: 260,
                  maxHeight: 280,
                  overflowY: 'auto',
                  background: colors.surface,
                  border: `1px solid ${colors.line}`,
                  borderRadius: 8,
                  boxShadow: colors.shadow,
                  padding: 4,
                }}
              >
                {commands.map((command, index) => (
                  <button
                    key={command.type}
                    onMouseDown={(event) => {
                      event.preventDefault()
                      applyCommand(block.id, command.type)
                    }}
                    style={{
                      width: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '7px 9px',
                      border: 'none',
                      borderRadius: 6,
                      background: index === slash.index ? colors.accent : 'transparent',
                      color: index === slash.index ? colors.accentText : colors.text,
                      fontSize: 13,
                      textAlign: 'left',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ flex: 1 }}>{command.label}</span>
                    <span
                      style={{
                        fontSize: 10,
                        opacity: 0.7,
                        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                      }}
                    >
                      {command.markdownHint}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}

        <button
          onClick={() => {
            const block = emptyBlock()
            setBlocks((previous) => [...previous, block])
            focusBlock(block.id)
          }}
          style={{
            marginTop: 10,
            padding: '6px 0',
            border: 'none',
            background: 'none',
            color: colors.muted,
            fontSize: 13,
            cursor: 'text',
            width: '100%',
            textAlign: 'left',
          }}
        >
          + escrever
        </button>
      </div>
    </div>
    </div>
  )
}
