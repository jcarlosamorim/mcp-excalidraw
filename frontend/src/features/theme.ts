/**
 * Paleta da UI própria (painéis, overlay), espelhando o tema do Excalidraw.
 * O canvas troca de tema pelo menu; sem isto os painéis ficavam brancos por
 * cima de um canvas escuro.
 */
export type UiTheme = 'light' | 'dark'

export interface Palette {
  /** fundo do painel */
  surface: string
  /** fundo de linha destacada / hover */
  surfaceAlt: string
  text: string
  muted: string
  line: string
  accent: string
  accentText: string
  danger: string
  success: string
  warning: string
  codeBg: string
  codeText: string
  quoteBar: string
  /** fundo do canvas, pro miolo de formas vazadas por cima dele */
  canvasBg: string
  /** miolo da bolinha de retrair do mapa mental */
  hubFill: string
  /** véu atrás do modal */
  scrim: string
  shadow: string
  /** botões flutuantes por cima do canvas */
  floatBg: string
  floatBgSoft: string
  floatBorder: string
  floatText: string
  floatTextSoft: string
}

const LIGHT: Palette = {
  surface: '#ffffff',
  surfaceAlt: '#f8f6ff',
  text: '#1f2933',
  muted: '#7b8794',
  line: '#e4e7eb',
  accent: '#5f3dc4',
  accentText: '#ffffff',
  danger: '#c92a2a',
  success: '#2f9e44',
  warning: '#f59f00',
  codeBg: '#f4f6f8',
  codeText: '#243b53',
  quoteBar: '#d0bfff',
  canvasBg: '#ffffff',
  hubFill: '#dee2e6',
  scrim: 'rgba(15, 23, 32, 0.38)',
  shadow: '0 18px 48px rgba(0,0,0,0.22)',
  floatBg: 'rgba(255,255,255,0.95)',
  floatBgSoft: 'rgba(255,255,255,0.5)',
  floatBorder: 'rgba(33,37,41,0.25)',
  floatText: '#212529',
  floatTextSoft: 'rgba(33,37,41,0.55)',
}

// Alinhado ao dark do próprio Excalidraw: canvas #121212, painéis #232329.
const DARK: Palette = {
  surface: '#232329',
  surfaceAlt: '#2d2d3a',
  text: '#e3e3e8',
  muted: '#9b9ba5',
  line: '#3a3a46',
  accent: '#b197fc',
  accentText: '#1a1a1f',
  danger: '#ff8787',
  success: '#69db7c',
  warning: '#ffd43b',
  codeBg: '#1b1b21',
  codeText: '#ced4da',
  quoteBar: '#5f3dc4',
  // O canvas em tema escuro é #121212: é essa a cor que o miolo da bolinha
  // vazada precisa ter pra esconder a linha que passa por baixo dela.
  canvasBg: '#121212',
  hubFill: '#39414d',
  scrim: 'rgba(0, 0, 0, 0.55)',
  shadow: '0 18px 48px rgba(0,0,0,0.55)',
  floatBg: 'rgba(45,45,58,0.96)',
  floatBgSoft: 'rgba(45,45,58,0.6)',
  floatBorder: 'rgba(255,255,255,0.22)',
  floatText: '#e3e3e8',
  floatTextSoft: 'rgba(227,227,232,0.6)',
}

export const paletteFor = (theme: UiTheme): Palette => (theme === 'dark' ? DARK : LIGHT)
