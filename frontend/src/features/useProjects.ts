import { useCallback, useEffect, useRef, useState } from 'react'

export interface Project {
  id: string
  name: string
  filename: string
  created_at: string
  updated_at: string
  opened_at: string
  element_count: number
  isCurrent: boolean
  path: string
}

export interface LooseScene {
  filename: string
  path: string
  modifiedAt: string
  bytes: number
  elementCount: number
  alreadyImported: boolean
}

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface UseProjectsParams {
  /** Chamado quando o projeto aberto muda: o App recarrega a cena do servidor. */
  onSceneSwitched: () => void | Promise<void>
}

const jsonFetch = async (url: string, init?: RequestInit): Promise<any> => {
  const response = await fetch(url, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok || data?.success === false) {
    throw new Error(data?.error || `Falha em ${url}`)
  }
  return data
}

export const useProjects = ({ onSceneSwitched }: UseProjectsParams) => {
  const [list, setList] = useState<Project[]>([])
  const [current, setCurrent] = useState<Project | null>(null)
  const [dir, setDir] = useState<string>('')
  const [loose, setLoose] = useState<LooseScene[]>([])
  const [panelOpen, setPanelOpen] = useState(false)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  /**
   * Versão da cena aberta. Vai junto no sync; o servidor recusa sync de epoch
   * velho, o que impede a cena antiga de sobrescrever o projeto recém-aberto.
   */
  const epochRef = useRef<number>(0)

  const refresh = useCallback(async (): Promise<void> => {
    try {
      const data = await jsonFetch('/api/projects')
      setList(data.projects || [])
      setCurrent(data.current || null)
      setDir(data.dir || '')
      if (typeof data.epoch === 'number') epochRef.current = data.epoch
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    }
  }, [])

  const refreshLoose = useCallback(async (): Promise<void> => {
    try {
      const data = await jsonFetch('/api/projects/loose')
      setLoose(data.scenes || [])
    } catch {
      setLoose([])
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const save = useCallback(async (): Promise<void> => {
    setSaveState('saving')
    try {
      const data = await jsonFetch('/api/projects/save', { method: 'POST', body: '{}' })
      setCurrent((previous) => (previous ? { ...previous, ...data.project } : data.project))
      setSaveState('saved')
      setTimeout(() => setSaveState('idle'), 1600)
    } catch (err) {
      setError((err as Error).message)
      setSaveState('error')
    }
  }, [])

  /** Toda troca de cena passa por aqui: atualiza epoch e manda o App recarregar. */
  const adoptSwitch = useCallback(
    async (epoch?: number): Promise<void> => {
      if (typeof epoch === 'number') epochRef.current = epoch
      await onSceneSwitched()
      await refresh()
    },
    [onSceneSwitched, refresh],
  )

  const create = useCallback(
    async (name?: string): Promise<void> => {
      try {
        const data = await jsonFetch('/api/projects', {
          method: 'POST',
          body: JSON.stringify({ name }),
        })
        await adoptSwitch(data.epoch)
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [adoptSwitch],
  )

  const open = useCallback(
    async (id: string): Promise<void> => {
      try {
        const data = await jsonFetch(`/api/projects/${id}/open`, { method: 'POST', body: '{}' })
        await adoptSwitch(data.epoch)
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [adoptSwitch],
  )

  const rename = useCallback(
    async (id: string, name: string): Promise<void> => {
      try {
        await jsonFetch(`/api/projects/${id}`, {
          method: 'PATCH',
          body: JSON.stringify({ name }),
        })
        await refresh()
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [refresh],
  )

  const remove = useCallback(
    async (id: string): Promise<void> => {
      try {
        const data = await jsonFetch(`/api/projects/${id}`, { method: 'DELETE' })
        // Só recarrega a cena se o projeto apagado era o que estava aberto.
        if (data.current && data.epoch !== epochRef.current) {
          await adoptSwitch(data.epoch)
        } else {
          await refresh()
        }
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [adoptSwitch, refresh],
  )

  const duplicate = useCallback(
    async (id: string): Promise<void> => {
      try {
        await jsonFetch(`/api/projects/${id}/duplicate`, { method: 'POST', body: '{}' })
        await refresh()
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [refresh],
  )

  const rescan = useCallback(async (): Promise<void> => {
    try {
      await jsonFetch('/api/projects/rescan', { method: 'POST', body: '{}' })
      await Promise.all([refresh(), refreshLoose()])
    } catch (err) {
      setError((err as Error).message)
    }
  }, [refresh, refreshLoose])

  const importLoose = useCallback(
    async (filenames: string[]): Promise<void> => {
      try {
        await jsonFetch('/api/projects/loose/import', {
          method: 'POST',
          body: JSON.stringify({ filenames }),
        })
        await Promise.all([refresh(), refreshLoose()])
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [refresh, refreshLoose],
  )

  const importContent = useCallback(
    async (name: string, content: string): Promise<void> => {
      try {
        await jsonFetch('/api/projects/import', {
          method: 'POST',
          body: JSON.stringify({ name, content }),
        })
        await refresh()
      } catch (err) {
        setError((err as Error).message)
      }
    },
    [refresh],
  )

  const openPanel = useCallback((): void => {
    setPanelOpen(true)
    void refresh()
    void refreshLoose()
  }, [refresh, refreshLoose])

  return {
    list,
    current,
    dir,
    loose,
    error,
    saveState,
    epochRef,
    panelOpen,
    openPanel,
    closePanel: () => setPanelOpen(false),
    refresh,
    refreshLoose,
    adoptSwitch,
    save,
    create,
    open,
    rename,
    remove,
    duplicate,
    rescan,
    importLoose,
    importContent,
  }
}
