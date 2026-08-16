import React from 'react'
import { paletteFor, UiTheme } from './theme'
import type { MindmapToggleAnchor, MindmapToolbarAnchor } from './useMindmap'

/**
 * Barra de ações do nó selecionado e a bolinha de expandir dos nós colapsados.
 * Camada fixa por cima do canvas, como o overlay do card stack: o Excalidraw
 * não deixa desenhar UI interativa dentro da cena.
 */

const icon = (path: JSX.Element, size: number): JSX.Element => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke="currentColor"
    strokeWidth="1.9"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {path}
  </svg>
)

const childGlyph = (size: number) =>
  icon(
    <>
      <path d="M4 12h6" />
      <path d="M10 12c4 0 3-6 7-6" />
      <path d="M10 12c4 0 3 6 7 6" />
      <path d="M20 6h1M20 18h1" />
    </>,
    size,
  )

const siblingGlyph = (size: number) =>
  icon(
    <>
      <path d="M4 7h16" />
      <path d="M4 17h16" />
      <path d="M12 12v-0.01" />
    </>,
    size,
  )

const outdentGlyph = (size: number) =>
  icon(
    <>
      <path d="M20 7H10" />
      <path d="M20 17H10" />
      <path d="M7 12H3" />
      <path d="M6 9l-3 3 3 3" />
    </>,
    size,
  )

const trashGlyph = (size: number) =>
  icon(
    <>
      <path d="M5 7h14" />
      <path d="M10 7V5h4v2" />
      <path d="M7 7l1 12h8l1-12" />
    </>,
    size,
  )

export default function MindmapOverlay({
  toolbar,
  toggleAnchors,
  theme,
  onAddChild,
  onAddSibling,
  onOutdent,
  onToggleCollapse,
  onDelete,
}: {
  toolbar: MindmapToolbarAnchor | null
  toggleAnchors: MindmapToggleAnchor[]
  theme: UiTheme
  onAddChild: (nodeId: string) => void
  onAddSibling: (nodeId: string) => void
  onOutdent: (nodeId: string) => void
  onToggleCollapse: (nodeId: string) => void
  onDelete: (nodeId: string) => void
}): JSX.Element | null {
  const colors = paletteFor(theme)
  if (!toolbar && toggleAnchors.length === 0) return null

  const buttonStyle = (danger = false): React.CSSProperties => ({
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 26,
    padding: 0,
    border: 'none',
    background: 'transparent',
    color: danger ? colors.danger : colors.floatText,
    borderRadius: 6,
    cursor: 'pointer',
  })

  const divider = (
    <span style={{ height: 1, width: 18, background: colors.floatBorder, opacity: 0.7 }} />
  )

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 6, pointerEvents: 'none' }}>
      {toolbar && toolbar.zoom >= 0.3 && (
        <div
          style={{
            position: 'absolute',
            left: toolbar.screenX,
            top: toolbar.screenY,
            // Coluna estreita à esquerda do nó, centrada na altura dele: cabe
            // no vão do conector sem cobrir texto nenhum, em qualquer zoom.
            transform: 'translate(-100%, -50%)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            padding: '6px 4px',
            borderRadius: 12,
            border: `1px solid ${colors.floatBorder}`,
            background: colors.floatBg,
            boxShadow: colors.shadow,
            pointerEvents: 'auto',
            backdropFilter: 'blur(6px)',
          }}
        >
          <button
            style={buttonStyle()}
            title="Novo tópico dentro deste (Tab)"
            onClick={() => onAddChild(toolbar.nodeId)}
          >
            {childGlyph(17)}
          </button>
          {!toolbar.isRoot && (
            <button
              style={buttonStyle()}
              title="Novo tópico irmão (Enter)"
              onClick={() => onAddSibling(toolbar.nodeId)}
            >
              {siblingGlyph(17)}
            </button>
          )}
          {toolbar.canOutdent && (
            <button
              style={buttonStyle()}
              title="Subir um nível (Shift+Tab)"
              onClick={() => onOutdent(toolbar.nodeId)}
            >
              {outdentGlyph(17)}
            </button>
          )}
          {divider}
          <button
            style={buttonStyle(true)}
            title="Apagar este ramo"
            onClick={() => onDelete(toolbar.nodeId)}
          >
            {trashGlyph(17)}
          </button>
        </div>
      )}

      {toggleAnchors.map((anchor) => {
        const size = anchor.collapsed
          ? Math.max(16, Math.min(30, 22 * anchor.zoom))
          : Math.max(12, Math.min(24, 17 * anchor.zoom))
        if (
          anchor.zoom < 0.3 ||
          anchor.screenX < -size ||
          anchor.screenY < -size ||
          anchor.screenX > window.innerWidth + size ||
          anchor.screenY > window.innerHeight + size
        ) {
          return null
        }

        return (
          <React.Fragment key={anchor.nodeId}>
            {anchor.collapsed && (
              // Com o ramo fechado as linhas ficam invisíveis, e sem este
              // traço a bolinha flutuaria solta longe do texto.
              <div
                style={{
                  position: 'absolute',
                  left: anchor.right,
                  top: anchor.screenY,
                  width: Math.max(0, anchor.screenX - anchor.right - size / 2 + 1),
                  height: Math.max(2, 3.5 * anchor.zoom),
                  transform: 'translateY(-50%)',
                  background: anchor.color,
                  pointerEvents: 'none',
                }}
              />
            )}
          <button
            title={
              anchor.collapsed
                ? `Mostrar ${anchor.hidden} tópico(s)`
                : 'Esconder os tópicos'
            }
            onClick={() => onToggleCollapse(anchor.nodeId)}
            style={{
              position: 'absolute',
              left: anchor.screenX,
              top: anchor.screenY,
              transform: 'translate(-50%, -50%)',
              width: size,
              height: size,
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              // Fechada: disco cheio na cor do ramo, com a contagem.
              // Aberta: miolo neutro com anel na cor do ramo, sobre o ponto em
              // que as linhas se juntam.
              border: anchor.collapsed
                ? 'none'
                : `${Math.max(2, size * 0.18)}px solid ${anchor.color}`,
              background: anchor.collapsed ? anchor.color : colors.hubFill,
              color: '#ffffff',
              fontSize: size * 0.5,
              fontWeight: 600,
              lineHeight: 1,
              cursor: 'pointer',
              pointerEvents: 'auto',
            }}
          >
            {anchor.collapsed ? anchor.hidden : null}
          </button>
          </React.Fragment>
        )
      })}
    </div>
  )
}

/** Ícone do item de menu, no mesmo traço dos ícones nativos do Excalidraw. */
export const mindmapIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="2" y="9.5" width="7" height="5" rx="1.5" />
    <rect x="15" y="3" width="7" height="4" rx="1.5" />
    <rect x="15" y="10" width="7" height="4" rx="1.5" />
    <rect x="15" y="17" width="7" height="4" rx="1.5" />
    <path d="M9 12h3M12 12V5h3M12 12h3M12 12v7h3" />
  </svg>
)
