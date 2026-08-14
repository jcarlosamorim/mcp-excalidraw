// Agente de diagramação Excalidraw v3.
// Entrevista adaptativa (2-7 perguntas por complexidade, pré-preenchidas = andaime cognitivo)
// + geração de fluxos DETALHADOS e estéticos. O LLM gera só a estrutura (DSL); o dagre faz o layout.
// Gate de densidade força detalhe em pedidos técnicos. Validação + retry blindam o modelo local.
import dagre from 'dagre';
import { z } from 'zod';

// ---------- DSL v3 (aditiva) ----------
export const DiagramType = z.enum([
  'flowchart', 'architecture', 'orgchart',
  'mindmap', 'timeline', 'sequence', 'matrix', 'journey',
]).default('flowchart');

export const PaletteKey = z.enum([
  'default', 'primary', 'success', 'warning', 'danger', 'purple', 'neutral', 'accent',
]);

const DslStyle = z.object({
  roughness: z.number().min(0).max(2).optional().default(0),
  fillStyle: z.enum(['solid', 'hachure', 'cross-hatch', 'dots']).optional().default('solid'),
  audience: z.enum(['professional', 'playful', 'minimal', 'warm']).optional().default('professional'),
}).optional();

const DslNode = z.object({
  id: z.string(),
  label: z.string(),
  shape: z.enum(['rectangle', 'ellipse', 'diamond']).optional(),
  color: PaletteKey.optional(),
  level: z.number().int().min(0).optional(),
}).passthrough();

const DslEdge = z.object({
  from: z.string(),
  to: z.string(),
  label: z.string().optional(),
  strokeStyle: z.enum(['solid', 'dashed', 'dotted']).optional().default('solid'),
});

export const DslSchema = z.object({
  op: z.literal('create').optional(),
  diagramType: DiagramType.optional(),
  rankdir: z.enum(['TB', 'LR', 'BT', 'RL']).optional(),
  style: DslStyle,
  nodes: z.array(DslNode).min(1).max(28),
  edges: z.array(DslEdge).optional(),
});
export type Dsl = z.infer<typeof DslSchema>;

// ---------- paleta: fundo claro + traço escuro (texto herda o traço = legível, e bom em dark mode) ----------
export const SEMANTIC_PALETTE: Record<string, { fill: string; stroke: string }> = {
  default: { fill: '#a5d8ff', stroke: '#0b3d66' },
  primary: { fill: '#74c0fc', stroke: '#0a2e54' },
  success: { fill: '#b2f2bb', stroke: '#0c4a1c' },
  warning: { fill: '#ffe699', stroke: '#7a4d00' },
  danger: { fill: '#ffc9c9', stroke: '#7a1515' },
  purple: { fill: '#d0bfff', stroke: '#341d66' },
  neutral: { fill: '#e9ecef', stroke: '#212529' },
  accent: { fill: '#ffd8a8', stroke: '#7a3d00' },
};

const DEFAULT_COLOR = { fill: '#a5d8ff', stroke: '#0b3d66' };
export function resolveColor(key: string | undefined): { fill: string; stroke: string } {
  return SEMANTIC_PALETTE[key || 'default'] || DEFAULT_COLOR;
}

// ---------- JSON schema p/ constrained decoding (enum de tipo = só os 3 que funcionam) ----------
export const DSL_JSON_SCHEMA = {
  type: 'json_schema',
  json_schema: {
    name: 'excalidraw_dsl', strict: true,
    schema: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['create'] },
        diagramType: { type: 'string', enum: ['flowchart', 'architecture', 'orgchart'] },
        rankdir: { type: 'string', enum: ['TB', 'LR', 'BT', 'RL'] },
        nodes: {
          type: 'array', minItems: 1, maxItems: 28,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string', minLength: 1, maxLength: 14 },
              label: { type: 'string', minLength: 2, maxLength: 50 },
              shape: { type: 'string', enum: ['rectangle', 'ellipse', 'diamond'] },
              color: { type: 'string', enum: ['default', 'primary', 'success', 'warning', 'danger', 'purple', 'neutral', 'accent'] },
            },
            required: ['id', 'label'], additionalProperties: false,
          },
        },
        edges: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              from: { type: 'string', minLength: 1 },
              to: { type: 'string', minLength: 1 },
              label: { type: 'string', maxLength: 30 },
              strokeStyle: { type: 'string', enum: ['solid', 'dashed', 'dotted'] },
            },
            required: ['from', 'to'], additionalProperties: false,
          },
        },
      },
      required: ['op', 'nodes'], additionalProperties: false,
    },
  },
};

// ---------- helpers ----------
function hashCode(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) { h = (h << 5) - h + s.charCodeAt(i); h |= 0; }
  return h;
}

function lastJsonObject(text: string): string {
  let depth = 0, end = -1;
  for (let i = text.length - 1; i >= 0; i--) {
    const c = text[i];
    if (c === '}') { if (depth === 0) end = i; depth++; }
    else if (c === '{') { depth--; if (depth === 0 && end >= 0) return text.slice(i, end + 1); }
  }
  return text.trim();
}

// ---------- layout (denso) ----------
const NODE_W = 200, NODE_H = 72, DIAMOND_W = 170, DIAMOND_H = 100, ELLIPSE_W = 170, ELLIPSE_H = 64;

function dimsOf(shape?: string): { w: number; h: number } {
  if (shape === 'diamond') return { w: DIAMOND_W, h: DIAMOND_H };
  if (shape === 'ellipse') return { w: ELLIPSE_W, h: ELLIPSE_H };
  return { w: NODE_W, h: NODE_H };
}

// ---------- O DIAGRAMA QUE ACUSA ----------
// Segunda passada em puro JS (zero LLM) sobre a DSL: não caça erro de sintaxe, caça
// pontos onde o usuário terceirizou o pensamento. Materializa o "Gargalo Soberano":
// só aponta, o usuário decide (deletar = aceitei delegar; editar = assumi o julgamento).
// Calibração conservadora: no máximo 3 acusações, ou o ruído mata o valor.
const AUDIT_W = 240, AUDIT_H = 44, AUDIT_COLOR = '#e8590c';

export function auditDsl(dsl: Dsl, g: any): any[] {
  const nodes = dsl.nodes;
  const edges = dsl.edges || [];
  const inDeg: Record<string, number> = {}, outDeg: Record<string, number> = {};
  nodes.forEach(n => { inDeg[n.id] = 0; outDeg[n.id] = 0; });
  edges.forEach(e => {
    if (e.from in outDeg) outDeg[e.from] = (outDeg[e.from] ?? 0) + 1;
    if (e.to in inDeg) inDeg[e.to] = (inDeg[e.to] ?? 0) + 1;
  });

  type Acc = { nodeId?: string; msg: string; global?: boolean; pri: number };
  const acc: Acc[] = [];
  const diamonds = nodes.filter(n => n.shape === 'diamond');

  // Padrão 3 (global, pri 0): processo com 6+ nós e ZERO decisão = execução pura, sem julgamento.
  if (diamonds.length === 0 && nodes.length >= 6) {
    acc.push({ global: true, pri: 0, msg: 'Fluxo inteiro sem nenhuma decisão. Onde entra o teu julgamento?' });
  }
  // Padrão 2 (pri 1): losango que não ramifica (1 saída) = decisão fingida pra te agradar.
  for (const d of diamonds) {
    if ((outDeg[d.id] ?? 0) <= 1) acc.push({ nodeId: d.id, pri: 1, msg: 'Decisão sem alternativa. O que muda conforme a resposta?' });
  }
  // Padrão 1 (pri 2): passo de processo que ninguém alimenta. Pula o 1o nó (raiz) e ellipses (início/fim).
  const raizId = nodes[0]?.id;
  for (const n of nodes) {
    if (n.id === raizId || n.shape === 'ellipse') continue;
    if ((inDeg[n.id] ?? 0) === 0 && (outDeg[n.id] ?? 0) > 0)
      acc.push({ nodeId: n.id, pri: 2, msg: 'De onde vem isto? Nenhum passo leva aqui.' });
  }

  const top = acc.sort((a, b) => a.pri - b.pri).slice(0, 3);
  const out: any[] = [];
  top.forEach((a, i) => {
    let x: number, y: number;
    if (a.global) { x = 50; y = -78; }
    else { const p = g.node(a.nodeId); x = (p?.x ?? 0) + 95; y = (p?.y ?? 0) - 22; }
    out.push({
      id: `audit_${i}_${Math.abs(hashCode(a.msg + (a.nodeId || ''))).toString(36)}`,
      type: 'text',
      x: +x.toFixed(1), y: +y.toFixed(1), width: AUDIT_W, height: AUDIT_H,
      text: '⚠ ' + a.msg,
      fontSize: 16, fontFamily: 1, strokeColor: AUDIT_COLOR, backgroundColor: 'transparent',
    });
  });
  return out;
}

function layoutDagre(dsl: Dsl, prefix: string, rankdir: 'TB' | 'LR' | 'BT' | 'RL'): any[] {
  const g = new dagre.graphlib.Graph();
  const n = dsl.nodes.length;
  const dense = n > 10;
  g.setGraph({
    rankdir: dsl.rankdir || rankdir,
    nodesep: dense ? 60 : 70,
    ranksep: dense ? 100 : 90,
    marginx: 70, marginy: 70,
    ranker: 'network-simplex', // minimiza cruzamento de setas em grafos densos
  });
  g.setDefaultEdgeLabel(() => ({}));
  const idmap: Record<string, string> = {};
  const seed = Math.abs(hashCode(JSON.stringify(dsl.nodes.map(x => x.id))));
  dsl.nodes.forEach(node => {
    idmap[node.id] = `${prefix}_${seed.toString(36)}_${node.id}`;
    const { w, h } = dimsOf(node.shape);
    g.setNode(node.id, { width: w, height: h });
  });
  const valid = new Set(dsl.nodes.map(x => x.id));
  const edges = (dsl.edges || []).filter(e => valid.has(e.from) && valid.has(e.to));
  edges.forEach(e => g.setEdge(e.from, e.to));
  dagre.layout(g);

  const roughness = dsl.style?.roughness ?? 0;
  const fillStyle = dsl.style?.fillStyle ?? 'solid';
  const out: any[] = [];

  dsl.nodes.forEach(node => {
    const p = g.node(node.id); const { w: W, h: H } = dimsOf(node.shape);
    const { fill, stroke } = resolveColor(node.color);
    out.push({
      id: idmap[node.id], type: node.shape || 'rectangle',
      x: +(p.x - W / 2).toFixed(1), y: +(p.y - H / 2).toFixed(1), width: W, height: H,
      backgroundColor: fill, strokeColor: stroke, strokeWidth: 2, fillStyle, roughness,
      roundness: (node.shape === 'ellipse' || node.shape === 'diamond') ? null : { type: 3 },
      label: { text: node.label },
    });
  });
  edges.forEach(e => {
    const a = g.node(e.from);
    const el: any = {
      type: 'arrow', x: +a.x.toFixed(1), y: +a.y.toFixed(1),
      start: { id: idmap[e.from] }, end: { id: idmap[e.to] },
      strokeColor: '#343a40', strokeWidth: 2, strokeStyle: e.strokeStyle || 'solid', roughness,
    };
    if (e.label) el.label = { text: e.label };
    out.push(el);
  });
  out.push(...auditDsl(dsl, g)); // o Diagrama que Acusa: marca onde o julgamento foi terceirizado
  return out;
}

export function dslToElementData(dsl: Dsl, prefix = 'ag'): any[] {
  switch (dsl.diagramType || 'flowchart') {
    case 'flowchart': return layoutDagre(dsl, prefix, 'TB');
    case 'architecture': return layoutDagre(dsl, prefix, 'LR');
    case 'orgchart': return layoutDagre(dsl, prefix, 'TB');
    case 'mindmap': case 'timeline': case 'sequence': case 'matrix': case 'journey':
      console.warn(`[agent] diagramType=${dsl.diagramType} usa dagre (motor próprio = incremento futuro)`);
      return layoutDagre(dsl, prefix, dsl.rankdir || 'TB');
    default: return layoutDagre(dsl, prefix, 'TB');
  }
}

// ---------- prompts ----------
const INTERVIEW_PROMPT = `Você é um entrevistador especialista em diagramação técnica.
Seu trabalho: fazer EXATAMENTE as perguntas necessárias para que o diagrama seja correto, detalhado e estético. NEM UMA A MAIS, NEM UMA A MENOS.

REGRA DE COMPLEXIDADE (determine ANTES de gerar as perguntas, em silêncio):
- SIMPLES: pedido genérico, tipo e escopo óbvios. Gere 2 a 3 perguntas.
- MEDIO: domínio específico, fluxo claro. Gere 3 a 5 perguntas.
- COMPLEXO: sistema técnico (agente de IA, pipeline de dados, microsserviços, fluxo multi-ator, integrações como WhatsApp, CRM, API, tool, LLM, webhook). Gere 5 a 7 perguntas.

REGRAS ABSOLUTAS:
1. Gere entre 2 e 7 perguntas. Nunca menos de 2, nunca mais de 7.
2. Cada pergunta cobre um EIXO DIFERENTE. Nunca repita eixo.
3. Cada pergunta tem EXATAMENTE 3 ou 4 opções. Sem texto livre, sem "outro", sem "depende".
4. Cada opção: máximo 6 palavras. Concreta. Mutuamente exclusiva.
5. A PRIMEIRA opção de cada pergunta é o default mais seguro para o pedido. Coloque-a primeiro de propósito.
6. Perguntas são ESPECÍFICAS ao pedido. Nunca genéricas como "qual o público?" quando o pedido é um sistema técnico.
7. Para pedidos COMPLEXOS: SEMPRE inclua os eixos PROFUNDIDADE e SUB_PASSOS.
8. Se um eixo já está EXPLÍCITO no pedido, NÃO pergunte. Troque por um contextual (PALETA ou ESTILO).
9. O eixo ESCOPO SEMPRE traz a contagem de nós no texto da opção, exemplo "(10-16 nós)".
10. Responda SOMENTE com um objeto JSON válido. Sem texto fora do JSON.

EIXOS DISPONÍVEIS:
- TIPO: formato visual (fluxograma sequencial, arquitetura de sistema, organograma, mapa conceitual)
- ESCOPO: quantidade de nós (visão geral 5-8 nós, detalhado 10-16 nós, completo com erros 17-24 nós)
- PROFUNDIDADE: granularidade (etapas de alto nível, todos os sub-passos, sub-passos com condições de erro)
- SUB_PASSOS: detalhar fases internas (cada fase vira sub-nós, uma caixa por fase)
- DECISOES: ramificações (com gateways sim/não, fluxo linear, só os pontos críticos)
- DESTAQUE: o que é visualmente grande (a entrada, os pontos de decisão, o resultado, os pontos de falha)
- ORIENTACAO: direção (cima para baixo, esquerda para direita)
- PALETA: cores (por tipo de componente, por status de fluxo, por ator, monocromático)
- ESTILO: aparência (técnico com bordas retas, esquemático com traço à mão, minimalista)
- ATORES: representar quem faz o quê (atores como grupos visuais, só o fluxo, agrupar por sistema)

EIXOS OBRIGATÓRIOS POR COMPLEXIDADE:
- SIMPLES: TIPO + ESCOPO + 1 contextual.
- MEDIO: TIPO + ESCOPO + PROFUNDIDADE + até 2 contextuais.
- COMPLEXO: ESCOPO + PROFUNDIDADE + SUB_PASSOS + DECISOES + DESTAQUE + até 2 contextuais. Se TIPO é óbvio pelo pedido, troque por PALETA ou ESTILO.

FORMATO DE SAIDA OBRIGATORIO (exemplo COMPLEXO, fluxo de agente IA com WhatsApp e CRM):
{"complexidade":"COMPLEXO","perguntas":[{"id":"q1","eixo":"ESCOPO","pergunta":"Qual o nível de detalhe do fluxo do agente?","opcoes":["Detalhado (10-16 nós)","Visão geral (5-8 nós)","Completo com erros (17-24 nós)"]},{"id":"q2","eixo":"PROFUNDIDADE","pergunta":"Detalhar cada sub-passo do agente?","opcoes":["Todos os sub-passos internos","Etapas de alto nível","Sub-passos com condições de erro"]},{"id":"q3","eixo":"SUB_PASSOS","pergunta":"Como mostrar as fases internas (tool calls, CRM)?","opcoes":["Cada fase vira sub-nós","Uma caixa por fase"]},{"id":"q4","eixo":"DECISOES","pergunta":"Incluir decisões e ramificações?","opcoes":["Sim, com gateways sim/não","Fluxo linear sem ramificação","Só os pontos críticos"]},{"id":"q5","eixo":"DESTAQUE","pergunta":"O que deve se destacar visualmente?","opcoes":["O system prompt e as tools","O envio do WhatsApp","A gravação no CRM","Os pontos de falha"]}]}

PARA MODELO LOCAL (Gemma 26B):
- O JSON começa com { e termina com }. Nunca adicione texto antes ou depois.
- Antes de terminar, verifique que todo { tem } e todo [ tem ].
- O campo "complexidade" é obrigatório: "SIMPLES", "MEDIO" ou "COMPLEXO". Não mencione a complexidade dentro das perguntas, é só para você raciocinar.`;

const SYSTEM_PROMPT_GENERATE = `Você é um agente de diagramação Excalidraw especializado em fluxos técnicos DETALHADOS e ESTÉTICOS. Recebe um pedido calibrado por uma entrevista e responde SOMENTE com um objeto JSON válido. Sem texto antes, sem depois, sem markdown.

FORMATO:
{"op":"create","diagramType":"flowchart","rankdir":"TB","style":{"audience":"professional","roughness":0},"nodes":[{"id":"A","label":"texto","shape":"rectangle","color":"default"}],"edges":[{"from":"A","to":"B","label":"opcional","strokeStyle":"solid"}]}

REGRAS DE COERENCIA (violar = diagrama quebrado):
1. Todo from e to em edges DEVE existir em nodes. Ids válidos são exatamente os declarados.
2. id: palavra curta sem espaço, máx 12 chars, único. Exemplo: webhook, llm_decide, crm_w.
3. label: NUNCA vazio. 2 a 6 palavras em português. Verbo no infinitivo para ação. Sem emoji.
4. shape: "rectangle" (processo ou serviço), "ellipse" (início, fim ou usuário), "diamond" (decisão).
5. Todo nó com 2 ou mais arestas SAINDO deve ser "diamond".
6. color: "default", "primary", "success", "warning", "danger", "purple", "neutral", "accent". Cor representa camada ou status, nunca decoração. Máx 5 cores.
7. NUNCA inclua x, y, width, height. O dagre calcula o layout.
8. diagramType: "flowchart" (TB), "architecture" (LR), "orgchart" (TB).

REGRAS DE DENSIDADE E DETALHE (ativam quando o pedido descreve um PROCESSO, FLUXO ou SISTEMA):
F1. MODO SEQUENCIAL: cada passo distinto (recebe X, processa Y, decide Z, envia W) vira um nó separado. NUNCA colapse 3 ou mais passos em um nó.
F2. QUANTIDADE MINIMA DE NOS:
    - flowchart de processo com 2 sistemas: mín 8 nós.
    - flowchart com 3 ou mais sistemas ou atores: mín 10 nós.
    - fluxo de agente de IA com tool use: mín 12 nós.
    - login ou formulário simples: mín 5 nós.
    HUB-AND-SPOKE (1 nó central com raios) é PROIBIDO quando o pedido descreve uma sequência. Use CADEIA LINEAR mais ramificações.
F3. ANATOMIA DO NO: cada nó é UMA ação atômica. "Receber msg WA" e não "Mensagem WhatsApp". "Chamar API CRM" e não "CRM".
F4. DECISOES: qualquer passo que muda o caminho é diamond (warning) com 2 ou mais arestas rotuladas (sim/não, sucesso/erro, tem tool/sem tool).
F5. ENTRADA e SAIDA: começa com ellipse (entrada) e termina com ellipse (saída). Se há sucesso e erro, use 2 ellipses com cores success e danger.
F6. CORES POR CAMADA: entrada=primary; LLM ou agente=purple; tool, API, CRM, WhatsApp=accent; decisão=warning (diamond); sucesso=success; erro=danger; memória ou estado=neutral.
F7. CAMINHOS: feliz=solid; erro ou alternativo=dashed; retry ou loop=dotted.
F8. SUB-PROCESSOS: se um passo encobre 2 ou mais ações, expanda. "Enviar WhatsApp" vira "formatar payload" mais "chamar API WA" mais "confirmar entrega".
F9. ANTI-COLAPSO: um nó que não é diamond com 3 ou mais arestas entrando ou saindo provavelmente colapsou sub-passos. Revise antes de responder.
F10. ORIENTACAO: 10 ou mais nós use LR (evita canvas alto); até 8 nós TB é ok; architecture com camadas sempre LR.

CONTEXTO DA ENTREVISTA:
- Escolhas EXPLICITAS do usuário são LEI. Sobrepõem sua inferência.
- ESCOPO "detalhado" significa mín 10 nós. "completo" significa mín 17 nós. "visão geral" significa máx 8 nós, sem sub-passos.
- SUB_PASSOS "cada fase vira sub-nós" significa decompor CADA fase em 2 a 4 sub-nós numerados.
- DECISOES "com gateways" significa diamond para CADA ramificação.
- Resposta "__DELEGATE__": infira a melhor escolha. Prefira DETALHE a simplificação. Não mencione a delegação.
- Eixo não perguntado: padrão flowchart, TB, professional, roughness 0, 12 a 15 nós.

=====================================================================
EXEMPLO 1 (NAO COPIE, é referência de DENSIDADE) — fluxo de agente IA com system prompt, tools, WhatsApp e CRM. 17 nós, 4 camadas de cor, múltiplas decisões:
=====================================================================
{"op":"create","diagramType":"flowchart","rankdir":"TB","style":{"audience":"professional","roughness":0},"nodes":[{"id":"user","label":"Usuário via WhatsApp","shape":"ellipse","color":"primary"},{"id":"webhook","label":"Webhook recebe mensagem","color":"primary"},{"id":"crm_lookup","label":"Buscar cliente no CRM","color":"accent"},{"id":"ctx_load","label":"Carregar histórico","color":"neutral"},{"id":"agent","label":"Agente IA com System Prompt","color":"purple"},{"id":"intent","label":"Classificar intenção","shape":"diamond","color":"warning"},{"id":"tool_faq","label":"Buscar no FAQ (RAG)","color":"accent"},{"id":"tool_book","label":"Verificar disponibilidade","color":"accent"},{"id":"tool_crm_w","label":"Salvar lead no CRM","color":"accent"},{"id":"has_result","label":"Ferramenta retornou?","shape":"diamond","color":"warning"},{"id":"draft","label":"Redigir resposta","color":"purple"},{"id":"validate","label":"Resposta dentro dos limites?","shape":"diamond","color":"warning"},{"id":"wa_send","label":"Enviar resposta no WhatsApp","color":"success"},{"id":"log","label":"Registrar interação no CRM","color":"neutral"},{"id":"escalate","label":"Escalar para humano","color":"danger"},{"id":"end_ok","label":"Conversa encerrada","shape":"ellipse","color":"success"},{"id":"end_esc","label":"Atendente assume","shape":"ellipse","color":"danger"}],"edges":[{"from":"user","to":"webhook"},{"from":"webhook","to":"crm_lookup"},{"from":"crm_lookup","to":"ctx_load"},{"from":"ctx_load","to":"agent"},{"from":"agent","to":"intent"},{"from":"intent","to":"tool_faq","label":"pergunta / FAQ"},{"from":"intent","to":"tool_book","label":"agendamento"},{"from":"intent","to":"tool_crm_w","label":"qualificação"},{"from":"intent","to":"escalate","label":"fora de escopo","strokeStyle":"dashed"},{"from":"tool_faq","to":"has_result"},{"from":"tool_book","to":"has_result"},{"from":"tool_crm_w","to":"has_result"},{"from":"has_result","to":"draft","label":"sim"},{"from":"has_result","to":"escalate","label":"não / erro","strokeStyle":"dashed"},{"from":"draft","to":"validate"},{"from":"validate","to":"wa_send","label":"sim"},{"from":"validate","to":"escalate","label":"não (risco)","strokeStyle":"dashed"},{"from":"wa_send","to":"log"},{"from":"log","to":"end_ok"},{"from":"escalate","to":"end_esc"}]}

=====================================================================
EXEMPLO 2 (NAO COPIE) — pipeline de onboarding, sub-passos numerados, 2 decisões, ramificação de erro:
=====================================================================
{"op":"create","diagramType":"flowchart","rankdir":"TB","style":{"audience":"professional","roughness":0},"nodes":[{"id":"start","label":"Novo usuário cadastrado","shape":"ellipse","color":"primary"},{"id":"s1","label":"1. Enviar e-mail de boas-vindas","color":"primary"},{"id":"s2","label":"2. Criar workspace","color":"purple"},{"id":"s3","label":"3. Importar dados iniciais","color":"accent"},{"id":"imp_ok","label":"Importação ok?","shape":"diamond","color":"warning"},{"id":"s4","label":"4. Enviar tutorial guiado","color":"primary"},{"id":"s5","label":"5. Agendar call de ativação","color":"accent"},{"id":"act","label":"Ativou em 7 dias?","shape":"diamond","color":"warning"},{"id":"s6","label":"6. Marcar Ativo no CRM","color":"success"},{"id":"s7","label":"6b. Re-engajamento","color":"danger"},{"id":"err","label":"Notificar suporte","color":"danger"},{"id":"end","label":"Onboarding concluído","shape":"ellipse","color":"success"}],"edges":[{"from":"start","to":"s1"},{"from":"s1","to":"s2"},{"from":"s2","to":"s3"},{"from":"s3","to":"imp_ok"},{"from":"imp_ok","to":"s4","label":"sim"},{"from":"imp_ok","to":"err","label":"não","strokeStyle":"dashed"},{"from":"s4","to":"s5"},{"from":"s5","to":"act"},{"from":"act","to":"s6","label":"sim"},{"from":"act","to":"s7","label":"não","strokeStyle":"dashed"},{"from":"s6","to":"end"},{"from":"s7","to":"end","strokeStyle":"dotted"}]}

=====================================================================
EXEMPLO 3 (NAO COPIE) — architecture LR, sistema de agente em produção:
=====================================================================
{"op":"create","diagramType":"architecture","rankdir":"LR","style":{"audience":"professional","roughness":0},"nodes":[{"id":"chan_wa","label":"WhatsApp Business API","color":"primary"},{"id":"gateway","label":"API Gateway","color":"default"},{"id":"orchestr","label":"Orquestrador n8n","color":"purple"},{"id":"llm","label":"Claude Sonnet (LLM)","color":"purple"},{"id":"rag","label":"RAG pgvector","color":"neutral"},{"id":"crm","label":"HubSpot CRM","color":"accent"},{"id":"calendar","label":"Google Calendar","color":"accent"},{"id":"slack","label":"Slack (handoff)","color":"danger"},{"id":"pg","label":"PostgreSQL (memória)","color":"neutral"}],"edges":[{"from":"chan_wa","to":"gateway","label":"webhook"},{"from":"gateway","to":"orchestr"},{"from":"orchestr","to":"llm","label":"system prompt + histórico"},{"from":"orchestr","to":"rag","label":"busca vetorial"},{"from":"orchestr","to":"crm","label":"lookup / write"},{"from":"orchestr","to":"calendar","label":"agendar"},{"from":"orchestr","to":"slack","label":"escalate","strokeStyle":"dashed"},{"from":"orchestr","to":"pg","label":"gravar histórico"},{"from":"llm","to":"orchestr","label":"tool_use / resposta"}]}

ANTES DE RESPONDER, verifique: (1) todo from e to existe em nodes? (2) labels específicos ao pedido, não "Etapa A"? (3) se o pedido é técnico ou processo, há 10 ou mais nós e 1 ou mais diamond? (4) todo { tem }, todo [ tem ]? Prefira 12 nós corretos a 5 com riqueza artificial. Coerência mais detalhe real superam completude inventada.
Responda SOMENTE o JSON.`;

// ---------- LLM ----------
interface ChatMsg { role: string; content: string }

async function callLLM(opts: {
  system: string; user: string; history?: ChatMsg[];
  temperature?: number; useSchema?: boolean;
}): Promise<any> {
  const base = process.env.LLM_BASE_URL;
  const key = process.env.LLM_API_KEY;
  const model = process.env.LLM_MODEL || 'gemma-4-26b';
  if (!base) throw new Error('LLM não configurado. Defina LLM_BASE_URL no ambiente do canvas server.');
  const url = `${base.replace(/\/$/, '')}/chat/completions`;

  const body: any = {
    model,
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.useSchema ? 4096 : 2048, // fluxos densos geram JSON grande
    messages: [{ role: 'system', content: opts.system }, ...(opts.history || []), { role: 'user', content: opts.user }],
  };
  if (opts.useSchema && process.env.LLM_NO_SCHEMA !== '1') body.response_format = DSL_JSON_SCHEMA;

  const doFetch = async (b: any) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}) }, body: JSON.stringify(b) });
    if (!res.ok) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    return res.json();
  };

  let data: any;
  try { data = await doFetch(body); }
  catch (e) {
    if (body.response_format) { delete body.response_format; data = await doFetch(body); }
    else throw e;
  }
  const msg = data?.choices?.[0]?.message || {};
  let content: string = msg.content || msg.reasoning_content || '';
  content = content.replace(/<think>[\s\S]*?<\/think>/gi, '').replace(/```(?:json)?/gi, '').trim();
  return JSON.parse(lastJsonObject(content));
}

// ---------- entrevista adaptativa ----------
export const ENTREVISTA_FALLBACK = [
  { id: 'q1', eixo: 'TIPO', pergunta: 'Que tipo de diagrama?', opcoes: ['Fluxo de passos', 'Arquitetura de sistema', 'Organograma'] },
  { id: 'q2', eixo: 'ESCOPO', pergunta: 'Quanto detalhe?', opcoes: ['Detalhado (10-16 nós)', 'Visão geral (5-8 nós)', 'Só os pontos críticos'] },
  { id: 'q3', eixo: 'DESTAQUE', pergunta: 'O que deve se destacar?', opcoes: ['O início/entrada', 'O ponto de decisão', 'O resultado final', 'O gargalo/risco'] },
];

export async function runInterviewQuestions(
  pedido: string,
): Promise<{ perguntas: Array<{ id: string; eixo: string; pergunta: string; opcoes: string[] }>; complexidade: string }> {
  try {
    const raw = await callLLM({ system: INTERVIEW_PROMPT, user: pedido, temperature: 0.4 });
    if (Array.isArray(raw?.perguntas) && raw.perguntas.length >= 2 && raw.perguntas.length <= 7)
      return { perguntas: raw.perguntas, complexidade: raw.complexidade || 'SIMPLES' };
  } catch { /* tenta de novo */ }
  try {
    const raw = await callLLM({ system: INTERVIEW_PROMPT, user: pedido + '\n\nLembrete: SOMENTE JSON, começa com { termina com }.', temperature: 0.35 });
    if (Array.isArray(raw?.perguntas) && raw.perguntas.length >= 2)
      return { perguntas: raw.perguntas, complexidade: raw.complexidade || 'SIMPLES' };
  } catch { /* fallback */ }
  return { perguntas: ENTREVISTA_FALLBACK, complexidade: 'SIMPLES' };
}

// ---------- calibração ----------
export const DELEGATE = '__DELEGATE__';

export function buildCalibratedPrompt(
  pedido: string,
  perguntas: Array<{ id: string; eixo: string; pergunta: string; opcoes: string[] }>,
  answers: Record<string, string>,
): string {
  const linhas = perguntas.map(q => {
    const r = answers[q.id];
    if (!r || r === DELEGATE) return `[${q.eixo}] ${q.pergunta} -> DELEGADO (infira do pedido)`;
    return `[${q.eixo}] ${q.pergunta} -> "${r}" (LEI: siga à risca)`;
  });
  const ctx = perguntas.length ? `\n\nDECISÕES DA ENTREVISTA:\n${linhas.join('\n')}` : '';
  return `PEDIDO:\n"${pedido}"${ctx}\n\nGere o JSON da DSL agora.`;
}

// ---------- validação de coerência + retry ----------
export interface ValErr { tipo: string; mensagem: string }

const KW_TECNICO = /\b(agente|agent|tool|api|webhook|pipeline|crm|whatsapp|microservi|integra|llm|system prompt|fluxo|workflow|orquestr)\b/i;

export function validateDslCoherence(dsl: Dsl, pedido = ''): { valido: boolean; erros: ValErr[]; warnings: ValErr[] } {
  const erros: ValErr[] = [];
  const warnings: ValErr[] = [];
  const ids = new Set<string>(); const idsArr: string[] = [];

  for (const n of dsl.nodes) {
    if (ids.has(n.id)) erros.push({ tipo: 'NO_DUPLICADO', mensagem: `O id "${n.id}" aparece mais de uma vez. Cada nó precisa de id único.` });
    else { ids.add(n.id); idsArr.push(n.id); }
    const lbl = (n.label || '').trim();
    if (lbl.length < 2) erros.push({ tipo: 'LABEL_VAZIO', mensagem: `O nó "${n.id}" tem label vazio. Escreva 2 a 6 palavras em português.` });
    if (lbl.split(/\s+/).filter(Boolean).length > 6) erros.push({ tipo: 'LABEL_LONGO', mensagem: `O nó "${n.id}" tem label longo demais: "${lbl}". Máximo 6 palavras.` });
  }

  const edges = dsl.edges || [];
  for (const e of edges) {
    if (!ids.has(e.from)) erros.push({ tipo: 'EDGE_ORFAO', mensagem: `Aresta ${e.from}->${e.to}: o nó "${e.from}" não existe. Ids válidos: [${idsArr.join(', ')}].` });
    if (!ids.has(e.to)) erros.push({ tipo: 'EDGE_ORFAO', mensagem: `Aresta ${e.from}->${e.to}: o nó "${e.to}" não existe. Ids válidos: [${idsArr.join(', ')}].` });
  }

  if (edges.length > 0) {
    const conn = new Set<string>(); edges.forEach(e => { conn.add(e.from); conn.add(e.to); });
    const isolados = idsArr.filter(id => !conn.has(id));
    isolados.forEach(id => warnings.push({ tipo: 'NO_ISOLADO', mensagem: `O nó "${id}" não tem conexão.` }));
    if (idsArr.length >= 3 && isolados.length / idsArr.length > 0.4)
      erros.push({ tipo: 'MUITOS_ISOLADOS', mensagem: `${isolados.length} de ${idsArr.length} nós estão sem conexão: [${isolados.join(', ')}]. Conecte-os ao fluxo principal.` });
  }

  // Gate de densidade: pedido técnico que virou hub-and-spoke raso é erro de geração.
  // Latência não importa; o retry é barato perto de entregar um diagrama errado.
  if (KW_TECNICO.test(pedido) && dsl.nodes.length < 10) {
    erros.push({
      tipo: 'POUCOS_NOS',
      mensagem: `O pedido descreve um sistema técnico mas o diagrama tem só ${dsl.nodes.length} nós. Expanda os sub-passos: cada fase (receber, processar, decidir, chamar tool, enviar, registrar) vira um nó separado. Mínimo 10 nós, com pelo menos 1 diamond de decisão.`,
    });
  }

  return { valido: erros.length === 0, erros, warnings };
}

function formatRetryMessage(pedido: string, erros: ValErr[]): string {
  const lista = erros.map((e, i) => `${i + 1}. [${e.tipo}] ${e.mensagem}`).join('\n');
  return `O JSON gerado tem ${erros.length} erro(s) de coerência. CORRIJA todos e responda SOMENTE com o JSON corrigido:\n\nERROS:\n${lista}\n\nPEDIDO ORIGINAL:\n${pedido}\n\nResponda SOMENTE o JSON corrigido.`;
}

function repairDsl(dsl: Dsl): Dsl {
  const valid = new Set(dsl.nodes.map(n => n.id));
  const edgesOk = (dsl.edges || []).filter(e => valid.has(e.from) && valid.has(e.to));
  const removidas = (dsl.edges || []).length - edgesOk.length;
  if (removidas > 0) console.warn(`[agent] removidas ${removidas} aresta(s) órfã(s)`);
  return { ...dsl, edges: edgesOk };
}

// ---------- turno de geração ----------
export async function runAgentTurn(
  message: string,
  history: ChatMsg[] = [],
  opts?: { perguntas?: any[]; answers?: Record<string, string> },
): Promise<{ elementData: any[]; dsl: Dsl; actions: string[]; steps: string[] }> {
  const steps: string[] = [];
  const user = (opts?.perguntas?.length && opts?.answers)
    ? (steps.push('Calibrando com as respostas da entrevista'), buildCalibratedPrompt(message, opts.perguntas, opts.answers))
    : (steps.push('Analisando o pedido'), `PEDIDO:\n"${message}"\n\nGere o JSON da DSL agora.`);

  let pedidoAtual = user;
  let dsl: Dsl | null = null;
  const MAX = 3;

  for (let i = 0; i <= MAX; i++) {
    steps.push(i === 0 ? 'Gerando o fluxo no Gemma' : `Refinando o detalhe (tentativa ${i})`);
    let raw: any;
    try { raw = await callLLM({ system: SYSTEM_PROMPT_GENERATE, user: pedidoAtual, temperature: 0.2, useSchema: true }); }
    catch { pedidoAtual = `Sua resposta não era JSON válido. Responda SOMENTE com o JSON.\n\n${user}`; continue; }

    let parsed: Dsl;
    try { parsed = DslSchema.parse(raw); }
    catch (e) { pedidoAtual = `O JSON não bate o schema: ${(e as Error).message}. Responda SOMENTE com JSON válido.\n\n${user}`; continue; }

    const v = validateDslCoherence(parsed, message);
    if (v.valido) { dsl = parsed; break; }
    if (i < MAX) pedidoAtual = formatRetryMessage(message, v.erros);
    else dsl = parsed; // esgotou: melhor esforço + repair duro abaixo
  }

  if (!dsl) throw new Error('O modelo não devolveu um diagrama válido após as tentativas.');
  dsl = repairDsl(dsl);
  steps.push('Aplicando layout');
  const elementData = dslToElementData(dsl, 'ag');
  const nN = dsl.nodes.length, nE = (dsl.edges || []).length;
  const nAudit = elementData.filter((e: any) => typeof e.id === 'string' && e.id.startsWith('audit_')).length;
  steps.push(`Injetando ${nN} nó(s) e ${nE} conexão(ões)`);
  const actions = [`criei ${nN} nó(s) e ${nE} conexão(ões)`];
  if (nAudit > 0) actions.push(`marquei ${nAudit} ponto(s) pra teu julgamento`);
  return { elementData, dsl, actions, steps };
}
