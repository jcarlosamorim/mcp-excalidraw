import React from 'react'
import { paletteFor, UiTheme } from './theme'
import type { CardAnchor, ColumnAnchor } from './useCardStack'

const docGlyph = (size: number): JSX.Element => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M5 5h14M5 10h14M5 15h9" strokeLinecap="round" />
  </svg>
)

/**
 * Botão "+" de cada coluna e o botão de documento de cada card. Fica numa camada
 * fixa por cima do canvas e segue pan e zoom, porque o Excalidraw não deixa
 * desenhar UI interativa dentro da cena.
 */
export default function CardStackOverlay({
  anchors,
  cardAnchors,
  theme,
  onAddCard,
  onOpenDoc,
}: {
  anchors: ColumnAnchor[]
  cardAnchors: CardAnchor[]
  theme: UiTheme
  onAddCard: (columnElementId: string) => void
  onOpenDoc: (cardElementId: string) => void
}): JSX.Element | null {
  const colors = paletteFor(theme)
  if (anchors.length === 0 && cardAnchors.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 5,
        pointerEvents: 'none',
      }}
    >
      {anchors.map((anchor) => {
        const size = Math.max(20, Math.min(44, 30 * anchor.zoom))
        // Some quando a coluna some da tela ou o zoom deixa o botão ilegível.
        if (
          anchor.zoom < 0.35 ||
          anchor.screenX < -size ||
          anchor.screenY < -size ||
          anchor.screenX > window.innerWidth + size ||
          anchor.screenY > window.innerHeight + size
        ) {
          return null
        }

        return (
          <button
            key={anchor.id}
            title="Adicionar card"
            onClick={() => onAddCard(anchor.id)}
            style={{
              position: 'absolute',
              left: anchor.screenX,
              top: anchor.screenY,
              width: size,
              height: size,
              padding: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: '50%',
              border: `1px solid ${colors.floatBorder}`,
              background: colors.floatBg,
              color: colors.floatText,
              fontSize: size * 0.6,
              lineHeight: 1,
              cursor: 'pointer',
              pointerEvents: 'auto',
              boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
            }}
          >
            +
          </button>
        )
      })}

      {cardAnchors.map((anchor) => {
        const size = Math.max(16, Math.min(30, 20 * anchor.zoom))
        if (
          anchor.zoom < 0.45 ||
          anchor.screenX < -60 ||
          anchor.screenY < -size ||
          anchor.screenX > window.innerWidth + 60 ||
          anchor.screenY > window.innerHeight + size
        ) {
          return null
        }

        const showProgress = anchor.total > 0
        const complete = showProgress && anchor.done === anchor.total

        return (
          <button
            key={anchor.id}
            title={anchor.hasDoc ? 'Abrir o documento do card' : 'Escrever no card'}
            onClick={() => onOpenDoc(anchor.id)}
            style={{
              position: 'absolute',
              left: anchor.screenX,
              top: anchor.screenY,
              transform: 'translateY(-100%)',
              height: size,
              minWidth: size,
              padding: showProgress ? `0 ${size * 0.28}px` : 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 3,
              borderRadius: size / 2,
              border: `1px solid ${colors.floatBorder}`,
              // Card com conteúdo fica sólido; card vazio fica translúcido,
              // então dá pra ver de longe onde tem anotação.
              background: anchor.hasDoc ? colors.floatBg : colors.floatBgSoft,
              color: complete ? colors.success : anchor.hasDoc ? colors.floatText : colors.floatTextSoft,
              fontSize: size * 0.42,
              fontWeight: 600,
              lineHeight: 1,
              cursor: 'pointer',
              pointerEvents: 'auto',
              boxShadow: '0 1px 2px rgba(0,0,0,0.10)',
            }}
          >
            {docGlyph(size * 0.52)}
            {showProgress && <span>{`${anchor.done}/${anchor.total}`}</span>}
          </button>
        )
      })}
    </div>
  )
}

/** Ícone do item de menu, no mesmo traço dos ícones nativos do Excalidraw. */
export const cardStackIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <rect x="4" y="3" width="16" height="18" rx="2" />
    <rect x="7" y="6.5" width="10" height="4.5" rx="1" />
    <rect x="7" y="13.5" width="10" height="4.5" rx="1" />
  </svg>
)
