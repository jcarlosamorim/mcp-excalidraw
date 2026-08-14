# Card stack (colunas de cards, estilo Whimsical)

Colunas de cards no canvas, com arrastar-e-soltar entre colunas. Tudo é elemento
nativo do Excalidraw: não existe "objeto coluna" especial. Coluna é um retângulo,
card é um retângulo com label, e o vínculo mora em `customData.cardStack`.

Consequência prática: a pilha persiste no `state.json`, entra no export de imagem,
aparece pro MCP e continua editável com as ferramentas normais do Excalidraw.

## Como usar

| Ação | Como |
|------|------|
| Criar coluna | Tecla **S**, ou menu ☰ → **Coluna de cards** |
| Nomear a coluna | Ela já nasce em modo de edição: digite e aperte Esc |
| Adicionar card | Botão **+** no topo da coluna |
| Escrever no card | O card também nasce em edição; depois, duplo clique |
| Abrir o documento do card | Botão no canto inferior esquerdo do card |
| Mover card | Arraste. Ao soltar dentro de outra coluna ele encaixa e a pilha se reorganiza |
| Reordenar na coluna | Arraste pra cima ou pra baixo: a ordem final é a ordem vertical em que você soltou |
| Tirar card da pilha | Arraste pra fora de qualquer coluna: vira um retângulo solto |
| Mover a coluna | Arraste a coluna: título e cards vão junto |
| Apagar a coluna | Delete: título e cards vão junto |

Cor do card: cada novo card pega a próxima cor da paleta. Pra mudar, use o seletor
de cor normal do Excalidraw.

## Documento do card

Cada card guarda um documento próprio: título, parágrafos, títulos de seção,
listas, checklist clicável e blocos de código. É markdown puro por baixo.

| No documento | Como |
|--------------|------|
| Abrir | Botão no canto inferior esquerdo do card |
| Inserir bloco | `/` e escolher (Texto, Título, Lista, Checklist, Código, Citação, Divisória) |
| Atalhos direto | `# `, `## `, `- `, `1. `, `[] `, `> `, ` ``` `, `---` |
| Novo bloco | Enter. Dentro de código, Enter quebra linha |
| Sair do bloco | Esc |
| Voltar o bloco pra texto | Backspace no começo da linha |
| Marcar tarefa | Clicar no checkbox, sem precisar editar |
| Renomear o card | Editar o título no topo do painel |

O documento abre centralizado na tela e segue o tema do canvas (claro/escuro).
O card mostra o progresso da checklist (`1/3`) na base, e o botão fica sólido
quando há conteúdo escrito. Salva sozinho, com folga de 450ms.

## Modelo

```js
customData.cardStack = { role: 'column' | 'title' | 'card', columnId: string | null }
customData.cardDoc   = { markdown: string, updatedAt: string }   // só em card
```

`cardDoc` fica FORA de `cardStack` de propósito: o layout reescreve o objeto
`cardStack` quando o card muda de coluna e levaria o texto junto.

`columnId` é o id do retângulo da coluna. Card com `columnId: null` é um card solto,
que o layout ignora.

## Arquivos

- `frontend/src/features/cardStack.ts`: modelo, criação e layout. Funções puras,
  sem React: `layoutStacks`, `translateColumnChildren`, `appendCardToColumn`,
  `collectColumnCascade`, `positionBoundText`, `applyCardTitle`, `wrapText`.
- `frontend/src/features/cardDoc.ts`: markdown ↔ blocos, comandos do `/`,
  progresso da checklist. Puro, sem React.
- `frontend/src/features/CardDocPanel.tsx`: o editor de blocos.
- `frontend/src/features/useCardStack.ts`: liga o layout ao `excalidrawAPI`:
  atalho S, criação, cascata de exclusão, e quando cada coisa roda.
- `frontend/src/features/CardStackOverlay.tsx`: os botões "+", numa camada fixa
  por cima do canvas (o Excalidraw não desenha UI interativa dentro da cena).
- `frontend/src/App.tsx`: `<MainMenu>` com o item, `onChange`/`onPointerUp` plugados.

## Quando cada coisa roda

- **`onChange`** → `translateColumnChildren`: arrastar a coluna leva filhos junto, em
  tempo real. Também detecta coluna apagada (cascata) e fim de edição de texto.
- **`onPointerUp`** → `layoutStacks`: reatribui cards por sobreposição e reempilha.
  É aqui que o drop entre colunas acontece.

## Decisões que não são óbvias

- **Dono do card é geometria, não declaração.** `layoutStacks` decide a coluna pela
  maior área de sobreposição. É isso que faz o arrastar funcionar sem código de
  drag-and-drop. Em empate, a coluna atual vence: colunas sobrepostas não roubam
  card uma da outra.
- **Card nasce dentro da coluna** (`appendCardToColumn` cresce a coluna no mesmo
  passo). Se nascesse fora, a regra acima o trataria como card solto na hora.
- **`layoutStacks` devolve `changed`** e precisa ser idempotente: o layout roda
  dentro do `onChange`, e um `changed` falso-positivo vira ciclo de `updateScene`.
- **`markInteraction()` antes de `applyScene`.** O `onChange` do `updateScene` é
  síncrono e o auto-sync do App só agenda se a interação já estiver marcada. Fora
  de ordem, a coluna criada não persistia até a próxima ação do usuário.
- **Texto preso na forma tem coordenada própria.** Mover o card sem mover o bound
  text deixa o texto pra trás, daí `applyPatches` tratar os dois juntos.
- **O textarea do editor é NÃO controlado.** Com `value` controlado, um setState
  atrasado reverte o DOM e come caracteres digitados rápido. Toda escrita
  programática precisa atualizar o DOM também (`setEditorValue`).
- **`flushSync` antes de focar bloco novo.** Com o foco caindo um frame depois, o
  primeiro caractere após o Enter ia pro vazio: "## Passos" virava "# Passos".
- **Trocar o título pelo painel remede e requebra o texto** (`applyCardTitle`).
  Sem isso o texto fica cortado ou vaza do card, porque quem mede a fonte é o
  Excalidraw e ele não é chamado nessa via.
- **O atalho S fica mudo por 900ms depois de criar card ou coluna.** Entre a
  criação e o editor de texto assumir o teclado, as teclas caem no canvas:
  digitar "Acessar" criava duas colunas fantasma, uma por "s" da palavra.
- **A UI própria espelha o tema do canvas** (`features/theme.ts`). O `colorScheme`
  no container é o que faz checkbox e barra de rolagem nativos acompanharem.
- **`positionBoundText` respeita alinhamento.** O `App.tsx` antes centralizava todo
  bound text no reload, o que jogava o texto do card (topo/esquerda) pro meio.

## Testes

Não há runner no projeto. Os testes usados no desenvolvimento (lógica pura com stub
do Excalidraw, e integração por CDP dirigindo a UI) ficaram fora do repo.
**Teste de UI sempre contra uma instância isolada** (`PORT`, `CANVAS_DATA_DIR`,
`EXCALIDRAW_PROJECTS_DIR` próprios): rodar contra o canvas de uso real faz o teste
brigar com a sessão aberta e sobrescrever trabalho de verdade.
Pra repetir: a lógica de `cardStack.ts` é testável em Node com esbuild + `--alias`
apontando `@excalidraw/excalidraw` pra um stub de `convertToExcalidrawElements`.
