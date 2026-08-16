# Mapa mental (mindmap, estilo Whimsical)

Mapas mentais no canvas, com layout automático em árvore. Tudo é elemento nativo
do Excalidraw: não existe "objeto mapa". A raiz é um retângulo com label, cada
tópico é um texto solto, cada ligação é uma linha curva, e o parentesco mora em
`customData.mindmap`.

Consequência prática: o mapa persiste no `state.json`, entra no export de imagem,
aparece pro MCP e continua editável com as ferramentas normais do Excalidraw.

## Como usar

| Ação | Como |
|------|------|
| Criar um mapa | Tecla **M**, ou menu ☰ → **Mapa mental** |
| Nomear | A raiz já nasce em modo de edição: digite e aperte Esc |
| Novo tópico dentro deste | **Tab** (vale inclusive enquanto digita) |
| Novo tópico irmão | **Enter** (na raiz, cria um tópico dentro) |
| Subir um nível | **Shift+Tab** |
| Quebrar linha dentro do tópico | **Shift+Enter** |
| Editar um tópico | Duplo clique |
| Mover um tópico de lugar | Arraste e solte perto do novo pai |
| Reordenar entre irmãos | Arraste pra cima ou pra baixo e solte |
| Esconder/mostrar um ramo | A bolinha na saída do nó |
| Apagar um ramo | Delete, ou a lixeira na barra do nó |
| Mover o mapa inteiro | Arraste a raiz: tudo segue junto |

A barra do nó selecionado aparece à esquerda dele, em pé, com as mesmas ações.

## A bolinha de retrair

Fica no ponto onde as linhas do nó se encontram, logo à frente dele, e tem dois
estados:

- **aberta**: miolo neutro com anel na cor do ramo, pousada sobre o feixe.
- **fechada**: disco cheio na cor do ramo com a contagem de tópicos escondidos,
  ligado ao texto por um traço curto.

A raiz não tem bolinha: as linhas dela saem espalhadas pela borda em vez de
convergirem num ponto, e fechar a raiz esconderia o mapa inteiro.

## Como o mapa abre em leque

Três regras trabalham juntas pra que cada tópico novo afaste o resto em vez de
espremer:

1. **O vão entre irmãos cresce com o peso dos ramos** (`gapBetween`): a base vem
   da profundidade (ramo de primeiro nível respira mais) e o extra vem do número
   de pontas dos dois ramos vizinhos, até um teto.
2. **A altura de cada ramo é a da subárvore inteira**, então um ramo que ganhou
   netos empurra os tios.
3. **O avanço horizontal cresce com a altura do leque** (`horizontalGapFor`):
   sem isso, um ramo que sobe 300px em 92px de avanço desenha um laço em pé.

Medido na prática, num mapa com quatro ramos onde um deles tem quatro filhos: os
vãos ficam em 230, 229 e 95 pixels. Os dois ramos vizinhos do ramo gordo foram
afastados; os dois que são folha continuam próximos.

Cor: cada tópico de primeiro nível ganha uma cor da paleta e o ramo inteiro
herda dela. Mudar o pai de um tópico repinta o ramo na cor do novo dono.
Tamanho de fonte cai com a profundidade (28 na raiz, 20 no primeiro nível, 18
daí pra baixo).

## Claro e escuro

O mapa é desenhado com fundo claro e traço escuro, a mesma regra do agente de
diagramação: como o texto herda o traço da forma, o Excalidraw inverte fundo e
texto juntos e o mapa continua legível nos dois temas, sem código de tema no
desenho. A UI própria (barra do nó, bolinha de expandir) espelha o tema do canvas
via `features/theme.ts`.

## Modelo

```js
// nó (raiz, tópico)
customData.mindmap = {
  role: 'node',
  mapId: string,            // id do elemento raiz: identifica o mapa
  parentId: string | null,  // null só na raiz
  branch: number,           // índice na paleta de ramos; -1 na raiz
  collapsed: boolean,
}

// linha
customData.mindmap = { role: 'edge', mapId, parentId, childId, branch }
```

## Arquivos

- `frontend/src/features/mindmap.ts`: modelo, criação, layout, parentesco.
  Funções puras, sem React: `layoutMindmap`, `createRootElements`,
  `createChildElements`, `reparent`, `outdent`, `findDropParent`,
  `toggleCollapse`, `collectMindmapCascade`, `movedNodeIds`.
- `frontend/src/features/useMindmap.ts`: liga o layout ao `excalidrawAPI`:
  atalhos, criação, cascata de exclusão, e quando cada coisa roda.
- `frontend/src/features/MindmapOverlay.tsx`: barra do nó e bolinha de expandir,
  numa camada fixa por cima do canvas.
- `frontend/src/App.tsx`: `<MainMenu>` com o item, `onChange`, `onPointerDown` e
  `onPointerUp` plugados.

## Quando cada coisa roda

- **`onChange`** → detecta raiz arrastada e roda o layout, então o mapa inteiro
  acompanha em tempo real. Também trata nó apagado (cascata) e fim de edição de
  texto (o tópico mudou de largura e a árvore precisa reacomodar).
- **`onPointerDown`** → guarda de onde cada nó partiu.
- **`onPointerUp`** → quem se moveu procura pai novo, e o layout roda.

## Decisões que não são óbvias

- **A raiz é a âncora; o resto é derivado.** Nenhum tópico guarda posição
  própria de verdade: `layoutMindmap` recalcula tudo a partir da raiz. É o que
  faz arrastar a raiz mover o mapa inteiro sem uma linha de código de arraste.
- **Pai novo é geometria, não declaração** (mesma regra do card stack). Ao
  soltar, `findDropParent` elege o nó cuja borda direita está mais perto da
  borda esquerda do nó solto, dentro de um raio. Soltar à esquerda do candidato
  custa 2,5x mais: pai fica à esquerda, e sem esse peso arrastar um pouco pra
  trás roubaria o nó pro lado errado. Sem candidato por perto, o layout devolve
  o nó pro lugar: arrastar nunca solta um tópico do mapa.
- **Virar filho do próprio descendente é recusado** (`canReparent`), senão o
  ramo se desliga do mapa e o layout entra em recursão.
- **Ordem entre irmãos é a ordem vertical em que estão.** Não existe campo de
  índice: `layoutMindmap` ordena por `y` (desempatando pela ordem na cena), e o
  tópico novo nasce meio pixel abaixo do irmão anterior pra cair no lugar certo.
- **Colapsar não apaga.** Os descendentes ficam com `opacity: 0` e `locked`,
  empilhados sobre o pai. Marcar `isDeleted` apagaria de verdade, porque o sync
  do App filtra os deletados antes de gravar.
- **As linhas de um pai saem do mesmo ponto, mas a saída se espalha com a altura
  do nó.** O deslocamento é proporcional a quanto o filho sobe ou desce,
  limitado a 30% da altura do pai: numa caixa alta as saídas se distribuem pela
  borda e as curvas não se cruzam; num texto fino o limite é curto e elas saem
  praticamente juntas, formando o feixe. Com todas saindo do centro exato, o
  cruzamento desenhava um losango na borda da caixa.
- **A curva é calculada aqui, não pelo Excalidraw.** A linha é uma polilinha, e
  polilinha com poucos vértices some com o desenho que a gente quer: com os
  vértices próximos ela vira 90 graus num palmo e desenha um laço; com eles
  distantes sobra um trecho quase vertical no meio do caminho. `edgePoints`
  emite reta na saída, um bezier amostrado em 16 pontos com os dois controles
  na horizontal, e reta na chegada. É isso que faz a linha encostar deitada no
  texto, como na ferramenta de referência.
- **A bolinha aberta tem o miolo pintado** (`hubFill` no tema), pra cobrir a
  linha que passa por baixo dela e virar um ponto de parada de verdade.
- **A linha é derivada, não vinculada.** Uma linha por nó não raiz, recalculada
  a cada layout a partir das posições atuais. Assim reparentar só mexe no
  `customData` do nó: a linha se conserta sozinha, sem binding do Excalidraw pra
  manter em dia. Linhas entram atrás dos nós na ordem de desenho e nascem
  travadas, pra não atrapalhar seleção e arraste.
- **A barra do nó fica em pé, à esquerda.** Acima do nó ela caía justamente
  sobre o texto do irmão anterior e roubava o clique dele (o teste automatizado
  clicou num botão achando que clicava no tópico). À esquerda ela ocupa o vão do
  conector, onde só passa linha travada.
- **`layoutMindmap` devolve `changed`** e precisa ser idempotente: o layout roda
  dentro do `onChange`, e um `changed` falso-positivo vira ciclo de `updateScene`.
- **`markInteraction()` antes de `applyScene`**, como no card stack: o `onChange`
  do `updateScene` é síncrono e o auto-sync do App só agenda se a interação já
  estiver marcada.
- **Tab e Enter valem durante a digitação.** O atalho fecha o editor com um
  Escape sintético, espera 90ms e só então cria o nó, porque o texto digitado só
  entra na cena quando a edição termina. Os eventos que o próprio código dispara
  levam a marca `__mindmapSynthetic`: sem ela, o Enter que abre o editor seria
  lido como "criar irmão" e cada nó novo geraria outro, em cascata.
- **Enter cria irmão em vez de abrir a edição**, como no Whimsical. Pra editar,
  duplo clique. Shift+Enter continua quebrando linha dentro do tópico.
- **Texto dentro de forma tem que ser `label: {text}`** (vale pra raiz). Um
  campo `text` solto num shape é descartado pelo `convertToExcalidrawElements` e
  a forma fica vazia.

## Testes

Não há runner no projeto. Os testes usados no desenvolvimento (33 verificações
da lógica pura com stub do Excalidraw, e integração por CDP dirigindo a UI)
ficaram fora do repo, no mesmo formato do card stack: esbuild com
`--alias:@excalidraw/excalidraw=stub` roda `mindmap.ts` em Node.
**Teste de UI sempre contra uma instância isolada** (`PORT`, `CANVAS_DATA_DIR`,
`EXCALIDRAW_PROJECTS_DIR` próprios).

O roteiro de UI que cobre a feature de ponta a ponta: `M` → digitar → `Tab` →
digitar → `Tab` → digitar → `Enter` → digitar → `Esc`, arrastar um tópico pra
perto de outro pai, colapsar pela barra, recarregar a página e apagar um ramo
com Delete.
