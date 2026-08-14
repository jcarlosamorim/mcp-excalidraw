# Projetos (salvar, abrir, recentes)

Cada projeto é uma cena inteira. O canvas mostra um projeto por vez, salva sozinho
e guarda tudo numa pasta única em vez de espalhar arquivos pela pasta Downloads.

**Pasta:** `~/Documents/Excalidraw` (muda com `EXCALIDRAW_PROJECTS_DIR`)
**Catálogo:** `~/.excalidraw-canvas/projects.db` (SQLite)

## Como usar

| Ação | Como |
|------|------|
| Ver projetos / recentes | **Cmd+O**, menu ☰ → **Projetos...**, ou clicar na etiqueta no topo direito |
| Novo projeto | Botão **Novo projeto** no painel, ou menu ☰ → Novo projeto |
| Salvar | **Cmd+S** (grava no projeto, não baixa arquivo). O auto-save já roda a cada 4s |
| Trocar de projeto | Clicar no nome dele no painel |
| Renomear / Duplicar / Apagar | Botões na linha do projeto |
| Trazer os .excalidraw de Downloads | Seção **Em Downloads** no painel |
| Importar um arquivo qualquer | **Importar arquivo** no rodapé do painel |

A etiqueta no topo direito mostra o projeto aberto e se está salvo.

## Por que arquivo + banco, e não só banco

Os `.excalidraw` na pasta são a fonte da verdade: abrem no excalidraw.com, entram
em backup, versionam em git, sobrevivem a qualquer decisão futura sobre o banco.
O SQLite é só catálogo (nome, datas, contagem, qual está aberto). Se o banco sumir,
`Reescanear pasta` reconstrói lendo os arquivos.

## Garantias que valem lembrar

- **Trocar de projeto salva o atual antes.** Nunca perde o que estava na tela.
- **Apagar move pra `.trash`** dentro da pasta de projetos, não destrói.
- **Trazer de Downloads copia**, não move: o original continua lá.
- **Auto-save de 4s** só escreve quando a cena mudou de verdade.
- **Reiniciar o servidor reabre o último projeto**, com a cena vinda do arquivo.

## Epoch: a trava que impede perda de dados

O front sincroniza a cena inteira a cada 1,2s de inatividade. Se o projeto trocar
com um sync em voo, esse sync chegaria depois e gravaria a cena **antiga** por cima
do projeto recém-aberto.

Por isso cada troca de projeto incrementa um `sceneEpoch`. O front manda o epoch que
conhece no `POST /api/elements/sync`; o servidor recusa com **409 `stale_epoch`** se
estiver velho, e o front então descarta a cena e recarrega do servidor.

Sync **sem** campo `epoch` continua aceito, para o MCP e scripts antigos não quebrarem.

## Rotas

| Método | Rota | O que faz |
|--------|------|-----------|
| GET | `/api/projects` | lista + projeto atual + pasta + epoch |
| GET | `/api/projects/current` | só o projeto atual |
| POST | `/api/projects` | cria e abre (`{name}`) |
| POST | `/api/projects/save` | grava o arquivo do projeto atual |
| POST | `/api/projects/:id/open` | salva o atual e abre esse |
| POST | `/api/projects/:id/duplicate` | copia o arquivo e cataloga |
| PATCH | `/api/projects/:id` | renomeia (renomeia o arquivo junto) |
| DELETE | `/api/projects/:id` | move pra `.trash` e abre outro se era o atual |
| POST | `/api/projects/rescan` | sincroniza catálogo com a pasta, nos dois sentidos |
| GET | `/api/projects/loose` | `.excalidraw` soltos em `~/Downloads` |
| POST | `/api/projects/loose/import` | traz os escolhidos (`{filenames}`) |
| POST | `/api/projects/import` | cria projeto a partir de conteúdo (`{name, content}`) |
| GET | `/api/projects/export` | baixa a cena atual como `.excalidraw` |

Trocar de projeto emite `project_switched` no WebSocket, então outras abas abertas
acompanham em vez de brigar pela cena.

## Arquivos

- `src/projects.ts`: catálogo, arquivos, epoch, auto-save.
- `src/types/node-sqlite.d.ts`: tipos mínimos do `node:sqlite` (o `@types/node`
  do projeto é v20 e não o conhece; o runtime é Node 24 e tem).
- `src/server.ts`: rotas, guarda de epoch no sync, boot.
- `frontend/src/features/useProjects.ts`: estado, ações, epoch do lado do front.
- `frontend/src/features/ProjectsPanel.tsx`: painel e a etiqueta do projeto.
- `frontend/src/App.tsx`: Cmd+S / Cmd+O, `project_switched`, itens de menu.

## Detalhes que não são óbvios

- **`node:sqlite` é experimental** e imprime um aviso no log a cada boot. É só ruído.
- **O `state.json` antigo continua sendo escrito** pelo `storage.ts`. Virou rede de
  segurança: se o catálogo for perdido, o boot adota a última cena como projeto.
- **Nome de projeto é único** (`Sem título`, `Sem título 2`, ...). Sem isso a lista
  de recentes vira uma fileira de nomes idênticos, impossível de escolher.
- **`loadExistingElements({replace: true})`** existe porque abrir um projeto vazio
  precisa limpar a tela; o carregamento normal ignora resposta vazia.
