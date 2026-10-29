import { Download, RefreshCw, RotateCw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { UpdateState } from './types'

export function UpdatePanel({ version, busy, beforeInstall }: { version: string; busy: boolean; beforeInstall: () => Promise<boolean> }) {
  const [state, setState] = useState<UpdateState>({ phase: 'disabled', currentVersion: version })
  const [error, setError] = useState('')
  useEffect(() => {
    let alive = true
    const api = window.sobesych
    void api?.getUpdateState().then(value => { if (alive) setState(value) }).catch(() => {})
    const unsubscribe = api?.onUpdateState(value => setState(value))
    return () => { alive = false; unsubscribe?.() }
  }, [])
  async function action(kind: 'check' | 'download' | 'install') {
    setError('')
    try {
      const api = window.sobesych!
      if (kind === 'install') {
        if (busy || !await beforeInstall()) return
        const result = await api.installUpdate()
        if (result.error) setError(result.error)
      } else setState(await (kind === 'check' ? api.checkUpdate() : api.downloadUpdate()))
    } catch { setError('Обновление недоступно. Повтори попытку') }
  }
  return <section className="update-panel" aria-label="Обновление приложения">
    <div className="update-heading"><h3>Обновления</h3><small>Версия {version}</small></div>
    <p role="status" aria-live="polite">{state.phase === 'disabled' ? 'Обновления доступны в установленной версии' : state.phase === 'checking' ? 'Проверяю обновления…' : state.phase === 'available' ? `Доступна версия ${state.version}` : state.phase === 'downloading' ? `Скачиваю ${state.version} · ${state.percent ?? 0}%` : state.phase === 'downloaded' ? `Версия ${state.version} готова к установке` : state.phase === 'installing' ? 'Запускаю установку…' : state.phase === 'error' ? state.error : state.checked ? `Обновлений нет · версия ${state.currentVersion || version}` : 'Проверка ещё не выполнена'}</p>
    {state.phase === 'downloading' && <progress max="100" value={state.percent ?? 0} aria-label="Скачивание обновления" />}
    <div className="update-actions">
      {['idle', 'error'].includes(state.phase) && <button onClick={() => void action('check')}><RefreshCw size={16} />Проверить обновления</button>}
      {state.phase === 'available' && <button onClick={() => void action('download')}><Download size={16} />Скачать обновление</button>}
      {state.phase === 'downloaded' && <button disabled={busy} onClick={() => void action('install')}><RotateCw size={16} />Перезапустить и обновить</button>}
      <a href="https://github.com/invoker775577-rgb/sobesych-releases/releases/latest" target="_blank" rel="noreferrer">Страница версий</a>
    </div>
    {state.phase === 'downloaded' && busy && <small>Установка доступна после завершения текущей работы</small>}
    {error && <p role="alert">{error}</p>}
  </section>
}
