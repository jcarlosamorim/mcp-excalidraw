# Banco de logos

Uma pasta em disco com as marcas que entram nos diagramas, e um painel pra achar
e inserir sem sair do canvas. A logo entra como imagem nativa do Excalidraw:
continua no export, no `.excalidraw` do projeto e visível pro MCP.

## Como usar

| Ação | Como |
|------|------|
| Abrir o banco | Tecla **B**, ou menu ☰ → **Banco de logos** |
| Achar uma marca | Digite no campo de busca (nome ou arquivo) |
| Filtrar por variante | Chips **brand** / **mono** ao lado da busca |
| Inserir no canvas | Clique na miniatura. Ela entra no centro da tela, já selecionada |
| Ver marca clara ou escura | Chip **fundo**: alterna o fundo das miniaturas |
| Adicionar logos | Arraste arquivos de imagem para o painel |
| Importar uma pasta inteira | Cole o caminho no campo de baixo e aperte Enter |
| Tirar do banco | Botão **×** no canto da miniatura, e clique de novo pra confirmar |
| Fechar | Esc, ou clique fora |

A logo entra com 150px no maior lado, mantendo a proporção: um wordmark largo
entra deitado, não esticado num quadrado.

## Onde ficam

`~/.excalidraw-canvas/logos` (ou `EXCALIDRAW_LOGOS_DIR`, ou a pasta `logos`
dentro de `CANVAS_DATA_DIR`). São os arquivos originais, sem banco de dados no
meio: copiar um `.png` pra lá já o coloca no banco, e o painel enxerga na
próxima abertura.

Formatos: png, jpg, jpeg, svg, gif, webp.

## Nome e variante

O rótulo sai do nome do arquivo: `googlecalendar-brand.png` vira **Googlecalendar**
com a variante **brand**. Os sufixos reconhecidos são `brand`, `mono`, `white`,
`black`, `color`, `dark` e `light`.

## API

| Rota | O que faz |
|------|-----------|
| `GET /api/logos` | catálogo e a pasta em uso |
| `GET /api/logos/:id/raw` | o arquivo, com o content-type certo |
| `POST /api/logos/import` `{dir}` | copia as imagens de uma pasta pro banco |
| `POST /api/logos/upload` `{filename, dataURL}` | guarda uma imagem enviada |
| `DELETE /api/logos/:id` | tira a logo do banco |

## Arquivos

- `src/logos.ts`: a pasta como banco. Catálogo, importação, upload e remoção.
- `src/server.ts`: as rotas acima.
- `frontend/src/features/useLogos.ts`: carregar, inserir na cena, importar,
  arrastar arquivos, atalho B.
- `frontend/src/features/LogosPanel.tsx`: o painel.
- `frontend/src/App.tsx`: item de menu e o painel montado.

## Decisões que não são óbvias

- **A miniatura é servida por URL, não por dataURL.** O painel mostra dezenas de
  logos de uma vez; com dataURL, abrir o banco significaria carregar o conteúdo
  inteiro de tudo. Por URL quem cuida do cache é o navegador, e o dataURL só é
  montado na hora de inserir.
- **O id carrega a extensão** (`claude-brand-png`). `claude-brand.png` e
  `claude-brand.svg` são duas logos do mesmo produto e as duas precisam caber no
  banco ao mesmo tempo.
- **O `fileId` da cena é derivado da logo** (`logo-<id>`): inserir a mesma marca
  duas vezes reaproveita o arquivo já embutido em vez de engordar a cena com uma
  cópia igual.
- **Inserir também faz `POST /api/files`.** O auto-sync do App manda só
  elementos; sem esse passo a imagem sumiria no próximo carregamento da cena.
- **SVG é medido lendo o arquivo**, não pelo navegador: muitos vêm só com
  `viewBox`, e aí o `naturalWidth` volta zero e a logo entraria achatada.
- **SVG entra rasterizado (4x), não como SVG.** O Excalidraw escurece o canvas
  inteiro com `invert(93%) hue-rotate(180deg)` e, pra imagem não sair negativa,
  aplica o filtro contrário em cima dela. Essa compensação exclui SVG de
  propósito (`mimeType !== image/svg+xml` no `renderElement`), então logo
  vetorial aparecia com a luminosidade trocada no tema escuro: o laranja
  `#F24E1E` do Figma virava salmão claro. Rasterizando, a logo passa a ser
  tratada como qualquer imagem e sai com a cor real nos dois temas. O 4x dá
  folga pra ampliar no canvas, e o `fileId` ganha o sufixo `-raster` pra não
  colidir com o que já tinha entrado como vetor.
- **Importar não sobrescreve.** Arquivo idêntico é pulado, arquivo de mesmo nome
  com conteúdo diferente entra com sufixo. Importar a mesma pasta duas vezes não
  duplica o banco.
- **O `id` só é aceito se corresponder a um arquivo do catálogo**, então caminho
  com `../` não sai da pasta.
- **O fundo da miniatura é alternável.** O banco tem marca preta e marca clara na
  mesma grade: qualquer fundo fixo esconde metade delas. O xadrez indica
  transparência e o chip troca entre claro e escuro.
