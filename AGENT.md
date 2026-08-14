# Agente de diagramação (barra de chat + LLM)

Linguagem natural na barra inferior do canvas vira diagrama. O LLM gera só a estrutura (DSL);
o Express calcula a geometria com dagre. Tirar coordenadas do modelo elimina bugs de layout e setas.

## Fluxo
barra (browser) → POST /api/agent/chat {message} → Express:
broadcast agent_lock → callLLM (gera DSL) → valida (Zod) → dslToElementData (dagre + resolveArrowBindings)
→ store + broadcast batch → agent_unlock → render no <Excalidraw>.

## Arquivos
- `src/agent.ts`: DSL (Zod), dagre layout, callLLM agnóstico, runAgentTurn.
- `src/server.ts`: rotas `POST /api/agent/diagram` (DSL crua, sem LLM) e `POST /api/agent/chat` (NL via LLM); helper `injectAgentElements`.
- `frontend/src/components/AgentChatBar.tsx`: a barra fixa no rodapé.
- `frontend/src/App.tsx`: cases `agent_lock`/`agent_unlock` (reusam `suppressAutoSyncCountRef`), monta a barra.
- `frontend/index.html`: `.canvas-container` height `calc(100vh - 72px)` pra a barra.

## Configurar o LLM (env do LaunchAgent)
No plist `~/Library/LaunchAgents/com.ze.excalidraw-canvas.plist`, dentro de EnvironmentVariables:

Gemma local (LM Studio) — modo atual:
- `LLM_BASE_URL=http://localhost:1234/v1`
- `LLM_MODEL=google/gemma-4-26b-a4b`
- (sem LLM_JSON_MODE: usa modo texto + extração, o LM Studio recusa json_object)

Claude (qualidade, recomendado) — trocar para:
- `LLM_BASE_URL=https://api.anthropic.com/v1`
- `LLM_API_KEY=<sua chave Anthropic>`
- `LLM_MODEL=claude-sonnet-4-5` (ou o id atual)
- `LLM_JSON_MODE=json_object`

Aplicar mudança de env: `launchctl bootout gui/$(id -u)/com.ze.excalidraw-canvas` e `launchctl bootstrap gui/$(id -u)/com.ze.excalidraw-canvas <plist>`. (Só rebuild de código usa `kickstart -k`.)

## Observado
- Gemma 4 26B-A4B no Mac: ~18s por diagrama simples (thinking on gera tokens extras). Claude seria ~2-4s.
- Gemma cria flowchart simples bem, mas simplifica nuance (perde edges de volta tipo "se erro retorna").
- Teste sem LLM: `curl -X POST localhost:3838/api/agent/diagram -d @dsl.json`.
