import { useState } from 'react'

// Barra multi-fase. Entrevista adaptativa (2-7 perguntas por complexidade), pré-preenchida
// no default (andaime cognitivo, nunca campo vazio), com escape "desenha já" sempre visível.
type Fase = 'input' | 'carregandoEntrevista' | 'entrevista' | 'gerando' | 'resultado'
interface Pergunta { id: string; eixo: string; pergunta: string; opcoes: string[] }
const DELEGATE = '__DELEGATE__'

const SEEDS = [
  'fluxo de agente com system prompt, tools, envio whatsapp e CRM',
  'arquitetura de um app web com API, cache e fila',
  'fluxo de login com validação, 2FA e bloqueio',
  'organograma do time de produto com squads',
]

export default function AgentChatBar() {
  const [text, setText] = useState(SEEDS[0])
  const [fase, setFase] = useState<Fase>('input')
  const [log, setLog] = useState<string[]>([])
  const [perguntas, setPerguntas] = useState<Pergunta[]>([])
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [steps, setSteps] = useState<string[]>([])
  const [, setComplexidade] = useState<string>('SIMPLES')
  const [minimizado, setMinimizado] = useState(true)
  const addLog = (m: string) => setLog(l => [...l, m])

  // Pré-preenche cada pergunta com a 1ª opção (andaime cognitivo, nunca campo vazio)
  const preencherAndaime = (pgs: Pergunta[]): Record<string, string> => {
    const pre: Record<string, string> = {}
    pgs.forEach(q => { pre[q.id] = q.opcoes[0] })
    return pre
  }

  const iniciar = async () => {
    const message = text.trim(); if (!message || fase !== 'input') return
    setFase('carregandoEntrevista'); setPerguntas([]); setAnswers({}); setSteps([])
    addLog(`→ ${message}`)
    try {
      const res = await fetch('/api/agent/interview', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message }),
      })
      const data = await res.json()
      if (data.success && data.perguntas?.length) {
        setPerguntas(data.perguntas)
        setAnswers(preencherAndaime(data.perguntas))
        setComplexidade(data.complexidade || 'SIMPLES')
        setFase('entrevista')
      } else { addLog('↷ gerando direto'); await gerar(message, [], {}) }
    } catch { addLog('↷ gerando direto'); await gerar(message, [], {}) }
  }

  const responder = (id: string, op: string) => setAnswers(a => ({ ...a, [id]: op }))
  const delegar = (id: string) => setAnswers(a => ({ ...a, [id]: DELEGATE }))
  const delegarTudo = () => {
    const all: Record<string, string> = {}; perguntas.forEach(q => all[q.id] = DELEGATE)
    setAnswers(all); setTimeout(() => gerar(text.trim(), perguntas, all), 150)
  }
  // "desenha já": desenha com o que tem agora (o andaime já preencheu tudo)
  const desenharJa = () => gerar(text.trim(), perguntas, answers)
  const confirmar = () => gerar(text.trim(), perguntas, answers)

  const gerar = async (message: string, pgs: Pergunta[], ans: Record<string, string>) => {
    setFase('gerando'); setSteps(['Começando...'])
    try {
      const body: any = { message }
      if (pgs.length) { body.perguntas = pgs; body.answers = ans }
      const res = await fetch('/api/agent/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (data.success) {
        setSteps(data.steps || [])
        addLog(`✓ ${(data.actions || ['pronto']).join('; ')}`)
        setFase('resultado')
      } else { addLog(`✗ ${data.error || 'erro'}`); setFase('input') }
    } catch (e: any) { addLog(`✗ ${e.message}`); setFase('input') }
  }

  const reset = () => {
    setText(SEEDS[0]); setFase('input'); setPerguntas([]); setAnswers({}); setSteps([])
  }

  const pill = (active: boolean) => ({
    padding: '7px 12px', borderRadius: 20, fontSize: 13, cursor: 'pointer', transition: 'all .12s',
    border: `1.5px solid ${active ? '#5f3dc4' : '#dee2e6'}`,
    background: active ? '#5f3dc4' : '#fff',
    color: active ? '#fff' : '#333', fontWeight: active ? 700 : 500,
  } as const)

  const escapeBtn = {
    padding: '8px 16px', border: 'none', borderRadius: 8,
    background: '#2f9e44', color: '#fff', fontSize: 13, fontWeight: 600,
    cursor: 'pointer', flexShrink: 0,
  } as const

  // Estado padrão: minimizado. A barra fica escondida e sobra só um ponto discreto
  // no canto, quase imperceptível sobre fundo escuro — fica opaco só no hover.
  if (minimizado) {
    return (
      <button onClick={() => setMinimizado(false)} title="Abrir agente de diagramas" aria-label="Abrir agente de diagramas"
        onMouseEnter={e => { e.currentTarget.style.opacity = '1' }}
        onMouseLeave={e => { e.currentTarget.style.opacity = '0.22' }}
        style={{ position: 'fixed', bottom: 8, right: 8, zIndex: 2000, width: 22, height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, border: '1px solid rgba(255,255,255,0.14)', borderRadius: '50%', background: 'rgba(127,127,127,0.16)', color: 'rgba(255,255,255,0.7)', fontSize: 11, lineHeight: 1, cursor: 'pointer', opacity: 0.22, transition: 'opacity .15s' }}>
        ✎
      </button>
    )
  }

  return (
    <div style={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 2000, background: '#fff', borderTop: '1px solid #e3e3e3', boxShadow: '0 -2px 10px rgba(0,0,0,.06)' }}>
      {/* Aba pra minimizar a barra e devolver o espaço ao canvas */}
      <button onClick={() => setMinimizado(true)} title="Minimizar"
        style={{ position: 'absolute', top: -28, right: 14, zIndex: 1, display: 'flex', alignItems: 'center', gap: 6, padding: '4px 12px', border: '1px solid #e3e3e3', borderBottom: 'none', borderRadius: '8px 8px 0 0', background: '#fff', color: '#666', fontSize: 12, cursor: 'pointer', boxShadow: '0 -2px 8px rgba(0,0,0,.05)' }}>
        ▾ minimizar
      </button>
      {log.length > 0 && (
        <div style={{ padding: '4px 14px', maxHeight: 60, overflowY: 'auto', fontSize: 11, fontFamily: 'monospace', lineHeight: 1.5, borderBottom: '1px solid #f0f0f0' }}>
          {log.slice(-3).map((l, i) => <div key={i} style={{ color: l.startsWith('✗') ? '#e03131' : l.startsWith('✓') ? '#2f9e44' : '#888' }}>{l}</div>)}
        </div>
      )}

      {fase === 'input' && (
        <div style={{ padding: '10px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {SEEDS.map(s => <button key={s} style={pill(text === s)} onClick={() => setText(s)}>{s}</button>)}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') iniciar() }}
              placeholder="escolha acima ou descreva..." autoFocus
              style={{ flex: 1, padding: '10px 12px', border: '1px solid #ccc', borderRadius: 8, fontSize: 14, outline: 'none' }} />
            <button onClick={iniciar} disabled={!text.trim()}
              style={{ padding: '10px 22px', border: 'none', borderRadius: 8, background: !text.trim() ? '#adb5bd' : '#5f3dc4', color: '#fff', fontSize: 14, fontWeight: 600, cursor: !text.trim() ? 'default' : 'pointer' }}>Criar</button>
          </div>
        </div>
      )}

      {fase === 'carregandoEntrevista' && (
        <div style={{ padding: 14, textAlign: 'center', color: '#888', fontSize: 13 }}>analisando o pedido e preparando as perguntas...</div>
      )}

      {fase === 'entrevista' && (
        <div style={{ padding: '12px 14px', maxHeight: '55vh', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, paddingBottom: 8, borderBottom: '1px solid #f0f0f0' }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#333' }}>ajuste o que quiser, ou já desenhe</span>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={delegarTudo} style={{ padding: '6px 12px', border: '1.5px dashed #5f3dc4', borderRadius: 6, background: 'transparent', color: '#5f3dc4', fontSize: 12, cursor: 'pointer', fontStyle: 'italic' }}>deixa tudo comigo</button>
              <button onClick={desenharJa} style={escapeBtn}>ja entendi, desenha</button>
            </div>
          </div>
          {perguntas.map((q, idx) => (
            <div key={q.id} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, color: '#aaa', fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', marginBottom: 4 }}>
                Pergunta {idx + 1} de {perguntas.length}
              </div>
              <div style={{ fontSize: 14, fontWeight: 500, color: '#1a1a1a', marginBottom: 8 }}>{q.pergunta}</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {q.opcoes.map((op, i) => (
                  <button key={i} style={pill(answers[q.id] === op)} onClick={() => responder(q.id, op)}>{op}</button>
                ))}
              </div>
              <button onClick={() => delegar(q.id)}
                style={{ marginTop: 6, padding: '4px 10px', background: answers[q.id] === DELEGATE ? '#f3f0ff' : 'transparent', border: answers[q.id] === DELEGATE ? '1px solid #5f3dc4' : '1px dashed #ccc', borderRadius: 6, color: answers[q.id] === DELEGATE ? '#5f3dc4' : '#aaa', fontSize: 11, cursor: 'pointer', fontStyle: 'italic' }}>
                {answers[q.id] === DELEGATE ? '✓ deixou com o agente' : '↳ deixa comigo'}
              </button>
            </div>
          ))}
          <div style={{ paddingTop: 8, borderTop: '1px solid #f0f0f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <button onClick={desenharJa} style={{ ...escapeBtn, background: 'transparent', color: '#2f9e44', border: '1.5px solid #2f9e44' }}>ja entendi, desenha agora</button>
            <button onClick={confirmar} style={{ padding: '10px 24px', border: 'none', borderRadius: 8, background: '#5f3dc4', color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>Desenhar agora</button>
          </div>
        </div>
      )}

      {fase === 'gerando' && (
        <div style={{ padding: '12px 14px', fontSize: 11, fontFamily: 'monospace', lineHeight: 1.8 }}>
          {steps.map((s, i) => <div key={i} style={{ color: i === steps.length - 1 ? '#5f3dc4' : '#aaa' }}>{i === steps.length - 1 ? '▶ ' : '✓ '}{s}</div>)}
          <div style={{ color: '#aaa', marginTop: 6 }}>(modelo local, pode levar até 90s para fluxos densos. qualidade importa, latência não)</div>
        </div>
      )}

      {fase === 'resultado' && (
        <div style={{ padding: '10px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 13, color: '#2f9e44' }}>Diagrama criado</span>
          <button onClick={reset} style={{ padding: '8px 16px', border: 'none', borderRadius: 8, background: '#5f3dc4', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>Criar outro</button>
        </div>
      )}
    </div>
  )
}
