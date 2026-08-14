import React, { useState } from 'react'
import { paletteFor, UiTheme } from './theme'
import type { LooseScene, Project, SaveState } from './useProjects'

const relativeTime = (iso: string): string => {
  const diff = Date.now() - new Date(iso).getTime()
  const min = Math.round(diff / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const hours = Math.round(min / 60)
  if (hours < 24) return `há ${hours}h`
  const days = Math.round(hours / 24)
  if (days < 30) return `há ${days}d`
  return new Date(iso).toLocaleDateString('pt-BR')
}

const iconButtonFor = (colors: ReturnType<typeof paletteFor>): React.CSSProperties => ({
  padding: '4px 8px',
  border: `1px solid ${colors.line}`,
  borderRadius: 6,
  background: colors.surface,
  color: colors.muted,
  fontSize: 11,
  cursor: 'pointer',
})

/**
 * Painel de projetos. Recentes primeiro (é o que se usa 90% do tempo); ações
 * destrutivas só aparecem no hover; o resgate da pasta Downloads fica embaixo,
 * fora do caminho de quem só quer trocar de projeto.
 */
export default function ProjectsPanel({
  open,
  theme,
  projects,
  current,
  dir,
  loose,
  error,
  saveState,
  onClose,
  onOpenProject,
  onCreate,
  onRename,
  onDelete,
  onDuplicate,
  onRescan,
  onImportLoose,
  onImportContent,
  onSave,
}: {
  open: boolean
  theme: UiTheme
  projects: Project[]
  current: Project | null
  dir: string
  loose: LooseScene[]
  error: string | null
  saveState: SaveState
  onClose: () => void
  onOpenProject: (id: string) => void
  onCreate: (name?: string) => void
  onRename: (id: string, name: string) => void
  onDelete: (id: string) => void
  onDuplicate: (id: string) => void
  onRescan: () => void
  onImportLoose: (filenames: string[]) => void
  onImportContent: (name: string, content: string) => void
  onSave: () => void
}): JSX.Element | null {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [draftName, setDraftName] = useState('')
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [showLoose, setShowLoose] = useState(false)
  const colors = paletteFor(theme)
  const iconButton = iconButtonFor(colors)

  if (!open) return null

  const commitRename = (id: string): void => {
    const name = draftName.trim()
    setEditingId(null)
    if (name) onRename(id, name)
  }

  const pendentes = loose.filter((scene) => !scene.alreadyImported)

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 3000,
        background: colors.scrim,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        paddingTop: '8vh',
      }}
    >
      <div
        onClick={(event) => event.stopPropagation()}
        style={{
          width: 'min(620px, 92vw)',
          maxHeight: '78vh',
          colorScheme: theme,
          display: 'flex',
          flexDirection: 'column',
          background: colors.surface,
          border: `1px solid ${colors.line}`,
          borderRadius: 12,
          boxShadow: colors.shadow,
          overflow: 'hidden',
          fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          color: colors.text,
        }}
      >
        {/* Cabeçalho: identidade e a única ação primária */}
        <div
          style={{
            padding: '16px 18px 12px',
            borderBottom: `1px solid ${colors.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>Projetos</div>
            <div
              title={dir}
              style={{
                fontSize: 11,
                color: colors.muted,
                marginTop: 2,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {dir.replace(/^\/Users\/[^/]+/, '~')}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
            <button
              onClick={onSave}
              style={{
                ...iconButton,
                fontSize: 12,
                padding: '8px 12px',
                color: saveState === 'saved' ? colors.success : colors.muted,
              }}
            >
              {saveState === 'saving' ? 'Salvando...' : saveState === 'saved' ? 'Salvo' : 'Salvar'}
            </button>
            <button
              onClick={() => onCreate()}
              style={{
                padding: '8px 14px',
                border: 'none',
                borderRadius: 6,
                background: colors.accent,
                color: colors.accentText,
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Novo projeto
            </button>
          </div>
        </div>

        {error && (
          <div style={{ padding: '10px 18px', background: colors.surfaceAlt, color: colors.danger, fontSize: 12 }}>
            {error}
          </div>
        )}

        {/* Recentes: o caminho de sempre. minHeight impede que a seção de
            Downloads, quando aberta, esmague a lista até sumir. */}
        <div style={{ overflowY: 'auto', flex: 1, minHeight: 160 }}>
          {projects.length === 0 && (
            <div style={{ padding: 28, textAlign: 'center', color: colors.muted, fontSize: 13 }}>
              Nenhum projeto ainda. Crie o primeiro.
            </div>
          )}

          {projects.map((project) => {
            const isCurrent = current?.id === project.id
            return (
              <div
                key={project.id}
                className="project-row"
                style={{
                  padding: '11px 18px',
                  borderBottom: `1px solid ${colors.line}`,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  background: isCurrent ? colors.surfaceAlt : colors.surface,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  {editingId === project.id ? (
                    <input
                      autoFocus
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={() => commitRename(project.id)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitRename(project.id)
                        if (event.key === 'Escape') setEditingId(null)
                      }}
                      style={{
                        width: '100%',
                        padding: '5px 8px',
                        border: `1px solid ${colors.accent}`,
                        borderRadius: 6,
                        fontSize: 13,
                        outline: 'none',
                      }}
                    />
                  ) : (
                    <button
                      onClick={() => !isCurrent && onOpenProject(project.id)}
                      title={isCurrent ? 'Projeto aberto' : 'Abrir este projeto'}
                      style={{
                        padding: 0,
                        border: 'none',
                        background: 'none',
                        font: 'inherit',
                        fontSize: 13,
                        fontWeight: isCurrent ? 600 : 500,
                        color: colors.text,
                        cursor: isCurrent ? 'default' : 'pointer',
                        textAlign: 'left',
                        width: '100%',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {project.name}
                      {isCurrent && (
                        <span style={{ marginLeft: 8, fontSize: 10, color: colors.accent, fontWeight: 600 }}>
                          ABERTO
                        </span>
                      )}
                    </button>
                  )}
                  <div style={{ fontSize: 11, color: colors.muted, marginTop: 3 }}>
                    {project.element_count} elementos · editado {relativeTime(project.updated_at)}
                  </div>
                </div>

                {confirmingId === project.id ? (
                  <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => {
                        setConfirmingId(null)
                        onDelete(project.id)
                      }}
                      style={{ ...iconButton, color: colors.danger, borderColor: colors.danger }}
                    >
                      Apagar
                    </button>
                    <button onClick={() => setConfirmingId(null)} style={iconButton}>
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="project-actions" style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                    <button
                      onClick={() => {
                        setDraftName(project.name)
                        setEditingId(project.id)
                      }}
                      style={iconButton}
                    >
                      Renomear
                    </button>
                    <button onClick={() => onDuplicate(project.id)} style={iconButton}>
                      Duplicar
                    </button>
                    <button onClick={() => setConfirmingId(project.id)} style={iconButton}>
                      Apagar
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Resgate: o que o Ctrl+S do Excalidraw largou em Downloads */}
        <div style={{ borderTop: `1px solid ${colors.line}`, background: colors.surfaceAlt }}>
          <button
            onClick={() => setShowLoose((value) => !value)}
            style={{
              width: '100%',
              padding: '10px 18px',
              border: 'none',
              background: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 12,
              color: colors.muted,
              cursor: 'pointer',
            }}
          >
            <span>
              Em Downloads
              {pendentes.length > 0 && (
                <span
                  style={{
                    marginLeft: 8,
                    padding: '1px 7px',
                    borderRadius: 10,
                    background: colors.accent,
                    color: colors.accentText,
                    fontSize: 10,
                    fontWeight: 600,
                  }}
                >
                  {pendentes.length}
                </span>
              )}
            </span>
            <span>{showLoose ? '▾' : '▸'}</span>
          </button>

          {showLoose && (
            <div style={{ padding: '0 18px 12px', maxHeight: 260, overflowY: 'auto' }}>
              {loose.length === 0 && (
                <div style={{ fontSize: 12, color: colors.muted, paddingBottom: 8 }}>
                  Nenhum .excalidraw solto em Downloads.
                </div>
              )}
              {pendentes.length > 1 && (
                <button
                  onClick={() => onImportLoose(pendentes.map((scene) => scene.filename))}
                  style={{ ...iconButton, marginBottom: 8, color: colors.accent, borderColor: colors.accent }}
                >
                  Trazer todos os {pendentes.length}
                </button>
              )}
              {loose.map((scene) => (
                <div
                  key={scene.filename}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '6px 0',
                    fontSize: 12,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        color: scene.alreadyImported ? colors.muted : colors.text,
                      }}
                    >
                      {scene.filename}
                    </div>
                    <div style={{ fontSize: 10, color: colors.muted }}>
                      {scene.elementCount} elementos · {relativeTime(scene.modifiedAt)}
                    </div>
                  </div>
                  {scene.alreadyImported ? (
                    <span style={{ fontSize: 10, color: colors.muted }}>já importado</span>
                  ) : (
                    <button onClick={() => onImportLoose([scene.filename])} style={iconButton}>
                      Trazer
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Rodapé: manutenção, longe do fluxo principal */}
        <div
          style={{
            padding: '10px 18px',
            borderTop: `1px solid ${colors.line}`,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={onRescan} style={iconButton} title="Procura arquivos novos na pasta">
              Reescanear pasta
            </button>
            <label style={{ ...iconButton, display: 'inline-block' }}>
              Importar arquivo
              <input
                type="file"
                accept=".excalidraw,application/json"
                style={{ display: 'none' }}
                onChange={async (event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  const content = await file.text()
                  onImportContent(file.name.replace(/\.excalidraw$/i, ''), content)
                  event.target.value = ''
                }}
              />
            </label>
          </div>
          <button onClick={onClose} style={{ ...iconButton, padding: '6px 14px' }}>
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

/** Etiqueta com o projeto aberto. Clicar abre o painel. */
export function ProjectPill({
  name,
  theme,
  saveState,
  onClick,
}: {
  name: string
  theme: UiTheme
  saveState: SaveState
  onClick: () => void
}): JSX.Element {
  const colors = paletteFor(theme)
  const label =
    saveState === 'saving' ? 'salvando' : saveState === 'error' ? 'erro ao salvar' : 'salvo'
  return (
    <button
      onClick={onClick}
      title="Projetos (Cmd+O)"
      style={{
        position: 'fixed',
        top: 12,
        right: 200,
        zIndex: 6,
        maxWidth: 260,
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '9px 14px',
        border: `1px solid ${colors.line}`,
        borderRadius: 10,
        background: colors.surface,
        boxShadow: '0 1px 4px rgba(0,0,0,0.18)',
        cursor: 'pointer',
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: 13,
        color: colors.text,
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          flexShrink: 0,
          background:
            saveState === 'saving' ? colors.warning : saveState === 'error' ? colors.danger : colors.success,
        }}
      />
      <span
        style={{
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          fontWeight: 500,
        }}
      >
        {name}
      </span>
      <span style={{ fontSize: 10, color: colors.muted, flexShrink: 0 }}>{label}</span>
    </button>
  )
}

export const projectsIcon = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M3 7.5A1.5 1.5 0 0 1 4.5 6h4l2 2.5h9A1.5 1.5 0 0 1 21 10v7.5A1.5 1.5 0 0 1 19.5 19h-15A1.5 1.5 0 0 1 3 17.5z" />
  </svg>
)
