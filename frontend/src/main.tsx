import React from 'react'
import ReactDOM from 'react-dom/client'
import { installCanvasFilterPolyfill } from './features/canvasFilterPolyfill'
import App from './App.tsx'
import '@excalidraw/excalidraw/index.css'

// Antes de qualquer render: o WKWebView do app nativo não implementa
// ctx.filter, e sem ele toda imagem sai negativa no tema escuro.
installCanvasFilterPolyfill()

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)