# Excalidraw Canvas — MCP Server, Agent Skill & Canvas Toolkit

[![CI](https://github.com/jcarlosamorim/mcp-excalidraw/actions/workflows/ci.yml/badge.svg)](https://github.com/jcarlosamorim/mcp-excalidraw/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Run a live Excalidraw canvas on your own machine and control it from AI agents — or from your own hands.

> **This is a fork of [yctimlin/mcp_excalidraw](https://github.com/yctimlin/mcp_excalidraw)** (MIT), kept in sync with
> everything the upstream does — MCP server, agent skill, 26 tools — and extended with a **canvas toolkit** that turns it
> into a daily-driver whiteboard: card columns, per-card documents, real project files, mind maps, a logo library, and a
> diagram agent that interviews you before drawing. See [What This Fork Adds](#what-this-fork-adds).

This repo provides:

- **Canvas app**: a private Excalidraw at `127.0.0.1`, with persistent scenes and project files on disk
- **MCP Server**: connect via Model Context Protocol (Claude Code, Claude Desktop, Cursor, Codex CLI, etc.)
- **Agent Skill**: portable skill for Claude Code, Codex CLI, and other skill-enabled agents

Keywords: Excalidraw agent skill, Excalidraw MCP server, AI diagramming, local-first whiteboard, Claude Code skill, Codex CLI skill, Claude Desktop MCP, Cursor MCP, Mermaid to Excalidraw.

## Demo

![MCP Excalidraw Demo](demo.gif)

*AI agent creates a complete architecture diagram from a single prompt (4x speed). [Watch full video on YouTube](https://youtu.be/ufW78Amq5qA)*

## Table of Contents

- [Demo](#demo)
- [What It Is](#what-it-is)
- [What This Fork Adds](#what-this-fork-adds)
- [How We Differ from the Official Excalidraw MCP](#how-we-differ-from-the-official-excalidraw-mcp)
- [What's New](#whats-new)
- [Quick Start (Local)](#quick-start-local)
- [Quick Start (Docker)](#quick-start-docker)
- [Configure MCP Clients](#configure-mcp-clients)
  - [Claude Desktop](#claude-desktop)
  - [Claude Code](#claude-code)
  - [Cursor](#cursor)
  - [Codex CLI](#codex-cli)
  - [OpenCode](#opencode)
  - [Antigravity (Google)](#antigravity-google)
- [Agent Skill (Optional)](#agent-skill-optional)
- [MCP Tools (26 Total)](#mcp-tools-26-total)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Known Issues / TODO](#known-issues--todo)
- [Development](#development)

## What It Is

This repo contains two separate processes:

- Canvas server: web UI + REST API + WebSocket updates (default `http://127.0.0.1:3000`)
- MCP server: exposes MCP tools over stdio; syncs to the canvas via `EXPRESS_SERVER_URL`

## What This Fork Adds

Upstream gives you an agent-controllable canvas. This fork also makes it a place **you** work in. Every feature below is
plain Excalidraw underneath — nothing is a special object type, so the MCP tools still see and edit everything, and the
scenes still open on excalidraw.com.

| Feature | What it does | Docs |
|---|---|---|
| **Persistent canvas** | The scene survives restarts (`~/.excalidraw-canvas/state.json`). Upstream is in-memory only. | — |
| **Projects** | Multi-scene. Real `.excalidraw` files in a folder are the source of truth; SQLite is just a rebuildable catalog. `Cmd+S` saves to the project, `Cmd+O` opens recents, 4s autosave, deletes go to `.trash`. | [PROJETOS.md](PROJETOS.md) |
| **Card stack** | Whimsical-style card columns (key `S`). Drag a card between columns and it re-stacks itself — ownership is decided by geometric overlap, not by declaration. | [CARD-STACK.md](CARD-STACK.md) |
| **Card documents** | Each card opens a Notion-style block editor: headings, lists, clickable checklists, code blocks, quotes. Stored as plain Markdown in the element's `customData`. Progress (`1/3`) shows on the card face. | [CARD-STACK.md](CARD-STACK.md) |
| **Mind maps** | `Tab` for a child, `Enter` for a sibling, fan-out layout, collapse handles. | [MINDMAP.md](MINDMAP.md) |
| **Logo library** | Key `B`. **The folder is the library** — drop a PNG/SVG in it and it's there. Search, filter by variant, insert onto the canvas. No database in the middle. | [LOGOS.md](LOGOS.md) |
| **Diagram agent** | Describe a diagram; it asks 2–7 multiple-choice questions, then draws. Runs against **any OpenAI-compatible endpoint** — a local model included — and is entirely optional. | [AGENT.md](AGENT.md) |

The feature docs are written in **Portuguese**; the code, the API and this README are in English.

## How We Differ from the Official Excalidraw MCP

Excalidraw now has an [official MCP](https://github.com/excalidraw/excalidraw-mcp) — it's great for quick, prompt-to-diagram generation rendered inline in chat. We solve a different problem.

| | Official Excalidraw MCP | This Project |
|---|---|---|
| **Approach** | Prompt in, diagram out (one-shot) | Programmatic element-level control (26 tools) |
| **State** | Stateless — each call is independent | Persistent live canvas with real-time sync |
| **Element CRUD** | No | Full create / read / update / delete per element |
| **AI sees the canvas** | No | `describe_scene` (structured text) + `get_canvas_screenshot` (image) |
| **Iterative refinement** | No — regenerate the whole diagram | Draw → look → adjust → look again, element by element |
| **Layout tools** | No | `align_elements`, `distribute_elements`, `group / ungroup` |
| **File I/O** | No | `export_scene` / `import_scene` (.excalidraw JSON) |
| **Snapshot & rollback** | No | `snapshot_scene` / `restore_snapshot` |
| **Mermaid conversion** | No | `create_from_mermaid` |
| **Shareable URLs** | Yes | Yes — `export_to_excalidraw_url` |
| **Design guide** | `read_me` cheat sheet | `read_diagram_guide` (colors, sizing, layout, anti-patterns) |
| **Viewport control** | Camera animations | `set_viewport` (zoom-to-fit, center on element, manual zoom) |
| **Live canvas UI** | Rendered inline in chat | Standalone Excalidraw app synced via WebSocket |
| **Multi-agent** | Single user | Multiple agents can draw on the same canvas concurrently |
| **Works without MCP** | No | Yes — REST API fallback via agent skill |

**TL;DR** — The official MCP generates diagrams. We give AI agents a full canvas toolkit to build, inspect, and iteratively refine diagrams — including the ability to see what they drew.

## What's New

### v2.0 — Canvas Toolkit

- 13 new MCP tools (26 total): `get_element`, `clear_canvas`, `export_scene`, `import_scene`, `export_to_image`, `duplicate_elements`, `snapshot_scene`, `restore_snapshot`, `describe_scene`, `get_canvas_screenshot`, `read_diagram_guide`, `export_to_excalidraw_url`, `set_viewport`
- **Closed feedback loop**: AI can now inspect the canvas (`describe_scene`) and see it (`get_canvas_screenshot` returns an image) — enabling iterative refinement
- **Design guide**: `read_diagram_guide` returns best-practice color palettes, sizing rules, layout patterns, and anti-patterns — dramatically improves AI-generated diagram quality
- **Shareable URLs**: `export_to_excalidraw_url` encrypts and uploads the scene to excalidraw.com, returns a shareable link anyone can open
- **Viewport control**: `set_viewport` with `scrollToContent`, `scrollToElementId`, or manual zoom/offset — agents can auto-fit diagrams after creation
- **File I/O**: export/import full `.excalidraw` JSON files
- **Snapshots**: save and restore named canvas states
- **Skill fallback**: Agent skill auto-detects MCP vs REST API mode, gracefully falls back to HTTP endpoints when MCP server isn't configured
- Fixed all previously known issues: `align_elements` / `distribute_elements` fully implemented, points type normalization, removed invalid `label` type, removed HTTP transport dead code, `ungroup_elements` now errors on failure

### v1.x

- Agent skill: `skills/excalidraw-skill/` (portable instructions + helper scripts for export/import and repeatable CRUD)
- Better testing loop: MCP Inspector CLI examples + browser screenshot checks (`agent-browser`)
- Bugfixes: batch create now preserves element ids (fixes update/delete after batch); frontend entrypoint fixed (`main.tsx`)

## Quick Start (Local)

**Prereqs: Node >= 24** and npm. (Node 24 is required, not optional: the projects catalog uses the built-in
`node:sqlite` module, which does not exist in Node 18/20 and needs a flag before 23.4.)

```bash
git clone https://github.com/jcarlosamorim/mcp-excalidraw.git
cd mcp-excalidraw
npm ci
npm run build
```

Start the canvas:
```bash
PORT=3000 npm run canvas
```

Open `http://127.0.0.1:3000`. That is the whole app — the canvas, the card stacks, the projects panel and the logo
library all live there. Nothing leaves your machine.

> **Security note:** The server binds to `127.0.0.1` only by default. If you need to expose it on a network interface
> (e.g. Docker, remote access), set `HOST=0.0.0.0` — but put network-level access controls in front of it, because the
> API has no authentication.

In a second terminal, run the MCP server (stdio) if you want AI agents to draw on that canvas:
```bash
EXPRESS_SERVER_URL=http://127.0.0.1:3000 node dist/index.js
```

In practice you don't run this by hand — your MCP client launches it. See [Configure MCP Clients](#configure-mcp-clients).

### Where your data lives

| Path | What |
|---|---|
| `~/.excalidraw-canvas/state.json` | the live scene, restored on restart |
| `~/.excalidraw-canvas/projects.db` | projects catalog — a cache, rebuildable from the folder |
| `~/Documents/Excalidraw/` | your `.excalidraw` files — **the source of truth**, openable on excalidraw.com |
| `~/.excalidraw-canvas/logos/` | the logo library (the folder *is* the library) |

All four are configurable — copy [`.env.example`](.env.example) to `.env` to see every variable.

### Optional: the diagram agent

The agent bar at the bottom of the canvas needs an OpenAI-compatible endpoint. Without one, the rest of the app works
normally. Point it at a local model (LM Studio, Ollama, vLLM) or a hosted one:

```bash
LLM_BASE_URL=http://localhost:1234/v1 LLM_MODEL=your-model LLM_NO_SCHEMA=1 PORT=3000 npm run canvas
```

`LLM_NO_SCHEMA=1` matters for local models: constrained decoding degenerates some of them into repeated labels and zero
edges. [AGENT.md](AGENT.md) has the details and the retry/repair logic.

## Quick Start (Docker)

> **Heads up:** the images below are the **upstream** ones — they do not include this fork's canvas toolkit (projects,
> card stacks, mind maps, logos, agent). To run this fork in Docker, build it yourself:
> `docker build -f Dockerfile.canvas -t excalidraw-canvas .`

Canvas server:
```bash
docker run -d -p 3000:3000 --name mcp-excalidraw-canvas ghcr.io/yctimlin/mcp_excalidraw-canvas:latest
```

MCP server (stdio) is typically launched by your MCP client (Claude Desktop/Cursor/etc.). If you want a local container for it, use the image `ghcr.io/yctimlin/mcp_excalidraw:latest` and set `EXPRESS_SERVER_URL` to point at the canvas.

## Configure MCP Clients

The MCP server runs over stdio and can be configured with any MCP-compatible client. Below are configurations for both **local** (requires cloning and building) and **Docker** (pull-and-run) setups.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `EXPRESS_SERVER_URL` | URL of the canvas server (MCP side) | `http://127.0.0.1:3000` |
| `ENABLE_CANVAS_SYNC` | Enable real-time canvas sync | `true` |
| `PORT` / `HOST` | Canvas server bind | `3000` / `127.0.0.1` |
| `CANVAS_DATA_DIR` | Scene state + projects catalog | `~/.excalidraw-canvas` |
| `EXCALIDRAW_PROJECTS_DIR` | Folder of `.excalidraw` project files | `~/Documents/Excalidraw` |
| `EXCALIDRAW_LOGOS_DIR` | Logo library folder | `$CANVAS_DATA_DIR/logos` |
| `EXCALIDRAW_DOWNLOADS_DIR` | Scanned to rescue stray `.excalidraw` files | `~/Downloads` |
| `EXCALIDRAW_EXPORT_DIR` | Where image exports are written | `~/Downloads` |
| `LLM_BASE_URL` / `LLM_MODEL` / `LLM_API_KEY` | Diagram agent endpoint (optional) | unset — agent inert |
| `LLM_NO_SCHEMA` | `1` = plain-text mode instead of JSON schema | unset |
| `LOG_LEVEL` / `LOG_FILE_PATH` / `DEBUG` | Logging | `info` / platform default / `false` |

---

### Claude Desktop

Config location:
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- Linux: `~/.config/Claude/claude_desktop_config.json`

**Local (node)**
```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-excalidraw/dist/index.js"],
      "env": {
        "EXPRESS_SERVER_URL": "http://127.0.0.1:3000",
        "ENABLE_CANVAS_SYNC": "true"
      }
    }
  }
}
```

**Docker**
```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "EXPRESS_SERVER_URL=http://host.docker.internal:3000",
        "-e", "ENABLE_CANVAS_SYNC=true",
        "ghcr.io/yctimlin/mcp_excalidraw:latest"
      ]
    }
  }
}
```

---

### Claude Code

Use the `claude mcp add` command to register the MCP server.

**Local (node)** - User-level (available across all projects):
```bash
claude mcp add excalidraw --scope user \
  -e EXPRESS_SERVER_URL=http://127.0.0.1:3000 \
  -e ENABLE_CANVAS_SYNC=true \
  -- node /absolute/path/to/mcp-excalidraw/dist/index.js
```

**Local (node)** - Project-level (shared via `.mcp.json`):
```bash
claude mcp add excalidraw --scope project \
  -e EXPRESS_SERVER_URL=http://127.0.0.1:3000 \
  -e ENABLE_CANVAS_SYNC=true \
  -- node /absolute/path/to/mcp-excalidraw/dist/index.js
```

**Docker**
```bash
claude mcp add excalidraw --scope user \
  -- docker run -i --rm \
  -e EXPRESS_SERVER_URL=http://host.docker.internal:3000 \
  -e ENABLE_CANVAS_SYNC=true \
  ghcr.io/yctimlin/mcp_excalidraw:latest
```

**Manage servers:**
```bash
claude mcp list              # List configured servers
claude mcp remove excalidraw # Remove a server
```

---

### Cursor

Config location: `.cursor/mcp.json` in your project root (or `~/.cursor/mcp.json` for global config)

**Local (node)**
```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-excalidraw/dist/index.js"],
      "env": {
        "EXPRESS_SERVER_URL": "http://127.0.0.1:3000",
        "ENABLE_CANVAS_SYNC": "true"
      }
    }
  }
}
```

**Docker**
```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "EXPRESS_SERVER_URL=http://host.docker.internal:3000",
        "-e", "ENABLE_CANVAS_SYNC=true",
        "ghcr.io/yctimlin/mcp_excalidraw:latest"
      ]
    }
  }
}
```

---

### Codex CLI

Use the `codex mcp add` command to register the MCP server.

**Local (node)**
```bash
codex mcp add excalidraw \
  --env EXPRESS_SERVER_URL=http://127.0.0.1:3000 \
  --env ENABLE_CANVAS_SYNC=true \
  -- node /absolute/path/to/mcp-excalidraw/dist/index.js
```

**Docker**
```bash
codex mcp add excalidraw \
  -- docker run -i --rm \
  -e EXPRESS_SERVER_URL=http://host.docker.internal:3000 \
  -e ENABLE_CANVAS_SYNC=true \
  ghcr.io/yctimlin/mcp_excalidraw:latest
```

**Manage servers:**
```bash
codex mcp list              # List configured servers
codex mcp remove excalidraw # Remove a server
```

---

### OpenCode

Config location: `~/.config/opencode/opencode.json` or project-level `opencode.json`

**Local (node)**
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "excalidraw": {
      "type": "local",
      "command": ["node", "/absolute/path/to/mcp-excalidraw/dist/index.js"],
      "enabled": true,
      "environment": {
        "EXPRESS_SERVER_URL": "http://127.0.0.1:3000",
        "ENABLE_CANVAS_SYNC": "true"
      }
    }
  }
}
```

**Docker**
```json
{
  "$schema": "https://opencode.ai/config.json",
  "mcp": {
    "excalidraw": {
      "type": "local",
      "command": ["docker", "run", "-i", "--rm", "-e", "EXPRESS_SERVER_URL=http://host.docker.internal:3000", "-e", "ENABLE_CANVAS_SYNC=true", "ghcr.io/yctimlin/mcp_excalidraw:latest"],
      "enabled": true
    }
  }
}
```

---

### Antigravity (Google)

Config location: `~/.gemini/antigravity/mcp_config.json`

**Local (node)**
```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "node",
      "args": ["/absolute/path/to/mcp-excalidraw/dist/index.js"],
      "env": {
        "EXPRESS_SERVER_URL": "http://127.0.0.1:3000",
        "ENABLE_CANVAS_SYNC": "true"
      }
    }
  }
}
```

**Docker**
```json
{
  "mcpServers": {
    "excalidraw": {
      "command": "docker",
      "args": [
        "run", "-i", "--rm",
        "-e", "EXPRESS_SERVER_URL=http://host.docker.internal:3000",
        "-e", "ENABLE_CANVAS_SYNC=true",
        "ghcr.io/yctimlin/mcp_excalidraw:latest"
      ]
    }
  }
}
```

---

### Notes

- **Docker networking**: Use `host.docker.internal` to reach the canvas server running on your host machine. On Linux, you may need `--add-host=host.docker.internal:host-gateway` or use `172.17.0.1`.
- **Canvas server**: Must be running before the MCP server connects. Start it with `npm run canvas` (local) or `docker run -d -p 3000:3000 ghcr.io/yctimlin/mcp_excalidraw-canvas:latest` (Docker).
- **Absolute paths**: When using local node setup, replace `/absolute/path/to/mcp-excalidraw` with the actual path where you cloned and built the repo.
- **The `ghcr.io/yctimlin/...` images are upstream's** and do not carry this fork's canvas toolkit. For the fork, use the local node setup or build the image yourself (`docker build -f Dockerfile.canvas -t excalidraw-canvas .`).
- **In-memory storage**: The canvas server stores elements in memory. Restarting the server will clear all elements. Use the export/import scripts if you need persistence.

## Agent Skill (Optional)

This repo includes a skill at `skills/excalidraw-skill/` that provides:

- **Workflow playbook** (`SKILL.md`): step-by-step guidance for drawing, refining, and exporting diagrams
- **Cheatsheet** (`references/cheatsheet.md`): MCP tool and REST API reference
- **Helper scripts** (`scripts/*.cjs`): export, import, clear, healthcheck, CRUD operations

The skill complements the MCP server by giving your AI agent structured workflows to follow.

### Install The Skill (Codex CLI example)

```bash
mkdir -p ~/.codex/skills
cp -R skills/excalidraw-skill ~/.codex/skills/excalidraw-skill
```

To update an existing installation, remove the old folder first (`rm -rf ~/.codex/skills/excalidraw-skill`) then re-copy.

### Install The Skill (Claude Code)

**User-level** (available across all your projects):
```bash
mkdir -p ~/.claude/skills
cp -R skills/excalidraw-skill ~/.claude/skills/excalidraw-skill
```

**Project-level** (scoped to a specific project, can be committed to the repo):
```bash
mkdir -p /path/to/your/project/.claude/skills
cp -R skills/excalidraw-skill /path/to/your/project/.claude/skills/excalidraw-skill
```

Then invoke the skill in Claude Code with `/excalidraw-skill`.

To update an existing installation, remove the old folder first then re-copy.

### Use The Skill Scripts

All scripts respect `EXPRESS_SERVER_URL` (default `http://127.0.0.1:3000`) or accept `--url`.

```bash
EXPRESS_SERVER_URL=http://127.0.0.1:3000 node skills/excalidraw-skill/scripts/healthcheck.cjs
EXPRESS_SERVER_URL=http://127.0.0.1:3000 node skills/excalidraw-skill/scripts/export-elements.cjs --out diagram.elements.json
EXPRESS_SERVER_URL=http://127.0.0.1:3000 node skills/excalidraw-skill/scripts/import-elements.cjs --in diagram.elements.json --mode batch
```

### When The Skill Is Useful

- Repository workflow: export elements as JSON, commit it, and re-import later.
- Reliable refactors: clear + re-import in `sync` mode to make canvas match a file.
- Automated smoke tests: create/update/delete a known element to validate a deployment.
- Repeatable diagrams: keep a library of element JSON snippets and import them.

See `skills/excalidraw-skill/SKILL.md` and `skills/excalidraw-skill/references/cheatsheet.md`.

## MCP Tools (26 Total)

| Category | Tools |
|---|---|
| **Element CRUD** | `create_element`, `get_element`, `update_element`, `delete_element`, `query_elements`, `batch_create_elements`, `duplicate_elements` |
| **Layout** | `align_elements`, `distribute_elements`, `group_elements`, `ungroup_elements`, `lock_elements`, `unlock_elements` |
| **Scene Awareness** | `describe_scene`, `get_canvas_screenshot` |
| **File I/O** | `export_scene`, `import_scene`, `export_to_image`, `export_to_excalidraw_url`, `create_from_mermaid` |
| **State Management** | `clear_canvas`, `snapshot_scene`, `restore_snapshot` |
| **Viewport** | `set_viewport` |
| **Design Guide** | `read_diagram_guide` |
| **Resources** | `get_resource` |

Full schemas are discoverable via `tools/list` or in `skills/excalidraw-skill/references/cheatsheet.md`.

## Testing

### Canvas Smoke Test (HTTP)

```bash
curl http://127.0.0.1:3000/health
```

### Local Bind Regression Test

```bash
npm run test:bind
```

### MCP Smoke Test (MCP Inspector)

List tools:
```bash
npx @modelcontextprotocol/inspector --cli \
  -e EXPRESS_SERVER_URL=http://127.0.0.1:3000 \
  -e ENABLE_CANVAS_SYNC=true -- \
  node dist/index.js --method tools/list
```

Create a rectangle:
```bash
npx @modelcontextprotocol/inspector --cli \
  -e EXPRESS_SERVER_URL=http://127.0.0.1:3000 \
  -e ENABLE_CANVAS_SYNC=true -- \
  node dist/index.js --method tools/call --tool-name create_element \
  --tool-arg type=rectangle --tool-arg x=100 --tool-arg y=100 \
  --tool-arg width=300 --tool-arg height=200
```

### Frontend Screenshots (agent-browser)

If you use `agent-browser` for UI checks:
```bash
agent-browser install
agent-browser open http://127.0.0.1:3000
agent-browser wait --load networkidle
agent-browser screenshot /tmp/canvas.png
```

## Troubleshooting

- Canvas not updating: confirm `EXPRESS_SERVER_URL` points at the running canvas server.
- Updates/deletes fail after batch creation: ensure you are on a build that includes the batch id preservation fix (merged via PR #34).

## Known Issues / TODO

- [x] ~~**Persistent storage**~~ — fixed in this fork: the scene is written to `~/.excalidraw-canvas/state.json` and
      restored on restart, and projects are real `.excalidraw` files on disk.
- [ ] **Image export requires a browser**: `export_to_image` and `get_canvas_screenshot` rely on the frontend doing the
      actual rendering, so the canvas UI must be open in a browser.
- [ ] **Scene sync is not atomic**: `POST /api/elements/sync` clears and repopulates, so a concurrent `GET` can observe
      a partial scene. Harmless for a single user; it does break automated polling tests.
- [ ] **The canvas is single-user by design.** No auth, no multiplayer. Keep it on `127.0.0.1`.

Contributions welcome!

## Development

```bash
npm run type-check     # tsc --noEmit
npm run build          # vite build (frontend) + tsc (server)
npm run dev            # tsc --watch + vite dev server
npm run test:bind      # regression test: server must not bind beyond 127.0.0.1 by default
```

**Testing UI changes:** always run against an isolated instance, never against the canvas you actually use —
otherwise the test fights your live session and overwrites real work:

```bash
PORT=3999 CANVAS_DATA_DIR=/tmp/canvas-test EXCALIDRAW_PROJECTS_DIR=/tmp/canvas-test/projects npm run canvas
```

## Credits & License

MIT — see [LICENSE](LICENSE).

Original project by **[yctimlin](https://github.com/yctimlin)** ([mcp_excalidraw](https://github.com/yctimlin/mcp_excalidraw)):
the MCP server, the 26 tools, the agent skill and the canvas foundation are theirs. This fork adds the canvas toolkit
described above and is maintained by [José Carlos Amorim](https://github.com/jcarlosamorim).

Built on [Excalidraw](https://github.com/excalidraw/excalidraw), also MIT.
