import React, { useMemo, useState } from 'react'
import { paletteFor, UiTheme } from './theme'
import type { LogoInfo } from './useLogos'

/**
 * Banco de logos. Grade com busca em cima, ações de manutenção embaixo:
 * quem abre o painel quase sempre quer achar uma marca e inserir, não
 * administrar a pasta.
 */

/** Xadrez sutil atrás da logo: sem ele, marca branca some no fundo claro. */
const checkerFor = (tint: string): React.CSSProperties => ({
  backgroundImage: `linear-gradient(45deg, ${tint} 25%, transparent 25%), linear-gradient(-45deg, ${tint} 25%, transparent 25%), linear-gradient(45deg, transparent 75%, ${tint} 75%), linear-gradient(-45deg, transparent 75%, ${tint} 75%)`,
  backgroundSize: '14px 14px',
  backgroundPosition: '0 0, 0 7px, 7px -7px, -7px 0px',
})

export default function LogosPanel({
  open,
  theme,
  logos,
  dir,
  busy,
  error,
  notice,
  onClose,
  onInsert,
  onImport,
  onUpload,
  onRemove,
}: {
  open: boolean
  theme: UiTheme
  logos: LogoInfo[]
  dir: string
  busy: boolean
  error: string | null
  notice: string | null
  onClose: () => void
  onInsert: (logo: LogoInfo) => void
  onImport: (dir: string) => void
  onUpload: (files: FileList | File[]) => void
  onRemove: (id: string) => void
}): JSX.Element | null {
  const [query, setQuery] = useState('')
  const [variant, setVariant] = useState<string | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [sourceDir, setSourceDir] = useState('')
  const [dragging, setDragging] = useState(false)
  /**
   * O banco tem marca preta e marca clara na mesma grade: qualquer fundo fixo
   * some com metade delas. Começa no claro, que serve à maioria, e troca num
   * clique.
   */
  const [tile, setTile] = useState<'claro' | 'escuro'>('claro')
  const colors = paletteFor(theme)

  const variants = useMemo(() => {
    const found = new Set<string>()
    for (const logo of logos) if (logo.variant) found.add(logo.variant)
    return Array.from(found).sort()
  }, [logos])

  const filtered = useMemo(() => {
    const termo = query.trim().toLowerCase()
    return logos.filter((logo) => {
      if (variant && logo.variant !== variant) return false
      if (!termo) return true
      return (
        logo.name.toLowerCase().includes(termo) || logo.filename.toLowerCase().includes(termo)
      )
    })
  }, [logos, query, variant])

  if (!open) return null

  const chip = (ativo: boolean): React.CSSProperties => ({
    padding: '5px 10px',
    borderRadius: 999,
    border: `1px solid ${ativo ? colors.accent : colors.line}`,
    background: ativo ? colors.accent : 'transparent',
    color: ativo ? colors.accentText : colors.muted,
    fontSize: 11,
    cursor: 'pointer',
  })

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        background: colors.scrim,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '7vh',
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        onDragOver={(event) => {
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault()
          setDragging(false)
          if (event.dataTransfer?.files?.length) onUpload(event.dataTransfer.files)
        }}
        style={{
          width: 'min(860px, 94vw)',
          maxHeight: '80vh',
          colorScheme: theme,
          display: 'flex',
          flexDirection: 'column',
          background: colors.surface,
          border: `1px solid ${dragging ? colors.accent : colors.line}`,
          borderRadius: 12,
          boxShadow: colors.shadow,
          overflow: 'hidden',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          color: colors.text,
        }}
      >
        <div
          style={{
            padding: '16px 18px 12px',
            borderBottom: `1px solid ${colors.line}`,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0, flexShrink: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Banco de logos</div>
            <div
              title={dir}
              style={{
                fontSize: 11,
                color: colors.muted,
                marginTop: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                maxWidth: 260,
              }}
            >
              {logos.length} marcas em {dir.replace(/^\/Users\/[^/]+/, '~')}
            </div>
          </div>
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar marca..."
            style={{
              flex: 1,
              minWidth: 120,
              padding: '8px 12px',
              borderRadius: 8,
              border: `1px solid ${colors.line}`,
              background: colors.surfaceAlt,
              color: colors.text,
              fontSize: 13,
              outline: 'none',
            }}
          />
          <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
            <button style={chip(variant === null)} onClick={() => setVariant(null)}>
              todas
            </button>
            {variants.map((item) => (
              <button key={item} style={chip(variant === item)} onClick={() => setVariant(item)}>
                {item}
              </button>
            ))}
            <button
              title="Trocar o fundo das miniaturas"
              onClick={() => setTile(tile === 'claro' ? 'escuro' : 'claro')}
              style={{
                ...chip(false),
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                paddingLeft: 7,
              }}
            >
              <span
                style={{
                  width: 11,
                  height: 11,
                  borderRadius: 3,
                  border: `1px solid ${colors.line}`,
                  background: tile === 'claro' ? '#eef0f3' : '#2b3038',
                }}
              />
              fundo
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflowY: 'auto', padding: 14 }}>
          {filtered.length === 0 ? (
            <div style={{ padding: 30, textAlign: 'center', color: colors.muted, fontSize: 13 }}>
              {logos.length === 0
                ? 'Banco vazio. Importe uma pasta ou arraste imagens aqui.'
                : 'Nenhuma marca com esse nome.'}
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(108px, 1fr))',
                gap: 10,
              }}
            >
              {filtered.map((logo) => (
                <div
                  key={logo.id}
                  onClick={() => onInsert(logo)}
                  title={`${logo.filename} — clique para inserir`}
                  style={{
                    position: 'relative',
                    border: `1px solid ${colors.line}`,
                    borderRadius: 10,
                    overflow: 'hidden',
                    cursor: busy ? 'progress' : 'pointer',
                    background: colors.surfaceAlt,
                  }}
                >
                  <div
                    style={{
                      height: 78,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: 10,
                      background: tile === 'claro' ? '#eef0f3' : '#2b3038',
                      ...checkerFor(tile === 'claro' ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'),
                    }}
                  >
                    <img
                      src={`/api/logos/${logo.id}/raw`}
                      alt={logo.name}
                      loading="lazy"
                      style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                    />
                  </div>
                  <div
                    style={{
                      padding: '6px 8px',
                      borderTop: `1px solid ${colors.line}`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 4,
                    }}
                  >
                    <span
                      style={{
                        fontSize: 11,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {logo.name}
                    </span>
                    {logo.variant && (
                      <span style={{ fontSize: 9, color: colors.muted, flexShrink: 0 }}>
                        {logo.variant}
                      </span>
                    )}
                  </div>
                  <button
                    title={confirmingId === logo.id ? 'Confirmar remoção' : 'Remover do banco'}
                    onClick={(event) => {
                      event.stopPropagation()
                      if (confirmingId === logo.id) {
                        onRemove(logo.id)
                        setConfirmingId(null)
                        return
                      }
                      setConfirmingId(logo.id)
                    }}
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      width: 20,
                      height: 20,
                      borderRadius: '50%',
                      border: 'none',
                      background: confirmingId === logo.id ? colors.danger : colors.floatBgSoft,
                      color: confirmingId === logo.id ? '#fff' : colors.floatTextSoft,
                      fontSize: 11,
                      lineHeight: 1,
                      cursor: 'pointer',
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div
          style={{
            borderTop: `1px solid ${colors.line}`,
            padding: '10px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: colors.surfaceAlt,
          }}
        >
          <input
            value={sourceDir}
            onChange={(event) => setSourceDir(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && sourceDir.trim()) onImport(sourceDir.trim())
            }}
            placeholder="Importar de uma pasta: cole o caminho e aperte Enter"
            style={{
              flex: 1,
              padding: '7px 10px',
              borderRadius: 8,
              border: `1px solid ${colors.line}`,
              background: colors.surface,
              color: colors.text,
              fontSize: 12,
              outline: 'none',
            }}
          />
          <button
            disabled={busy || !sourceDir.trim()}
            onClick={() => onImport(sourceDir.trim())}
            style={{
              padding: '7px 12px',
              borderRadius: 8,
              border: `1px solid ${colors.line}`,
              background: colors.surface,
              color: colors.text,
              fontSize: 12,
              cursor: busy || !sourceDir.trim() ? 'default' : 'pointer',
              opacity: busy || !sourceDir.trim() ? 0.5 : 1,
            }}
          >
            Importar
          </button>
          <span style={{ fontSize: 11, color: error ? colors.danger : colors.muted }}>
            {error ?? notice ?? 'ou arraste imagens para cá'}
          </span>
        </div>
      </div>
    </div>
  )
}

/** Ícone do item de menu, no mesmo traço dos ícones nativos do Excalidraw. */
export const logosIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="3" y="4" width="8" height="7" rx="1.5" />
    <rect x="13" y="4" width="8" height="7" rx="1.5" />
    <rect x="3" y="13" width="8" height="7" rx="1.5" />
    <circle cx="17" cy="16.5" r="3.5" />
  </svg>
)
