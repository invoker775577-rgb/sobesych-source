import { useEffect, useRef, useState } from 'react'
import type { ContextDocument } from './types'
import { selectContextPassages } from './copilot.mjs'

export function ContextPanel({ documents, selected, onChange, onSelected, onLoading, locked, warning, disabled }: { documents: ContextDocument[]; selected: string[]; onChange: (value: ContextDocument[]) => void; onSelected: (ids: string[]) => void; onLoading: (loading: boolean) => void; locked: boolean; warning: string; disabled: boolean }) {
  const [loading, setLoading] = useState(false); const [error, setError] = useState('')
  const [previewQuestion, setPreviewQuestion] = useState('')
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onLoading(false) } }, [onLoading])
  const characters = documents.reduce((total, doc) => total + doc.text.length, 0)
  const importFiles = async (files: File[]) => {
    setLoading(true); onLoading(true); setError('')
    try {
      if (documents.length + files.length > 8) throw new Error('Можно добавить до восьми материалов')
      const { readContextFile } = await import('./read-context-file')
      const added = []
      for (const file of files) added.push({ id: crypto.randomUUID(), title: file.name, text: await readContextFile(file) })
      if (documents.length + added.length > 8 || characters + added.reduce((sum, doc) => sum + doc.text.length, 0) > 20000) throw new Error('Доступно до восьми материалов и 20 000 символов суммарно')
      if (mounted.current) { onChange([...documents, ...added]); onSelected([...selected, ...added.map(doc => doc.id)]) }
    } catch (error) { if (mounted.current) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (mounted.current) { setLoading(false); onLoading(false) } }
  }
  return <section className="context-panel" aria-label="Материалы для ответов"><h3>Материалы для ответов</h3><p>Необязательно. Выбери, что использовать в этом разговоре. Файлы хранятся зашифрованными на компьютере. При запросе подходящие фрагменты отправляются выбранному провайдеру.</p>
    {warning && <p role="alert">{warning}</p>}
    <p>{characters.toLocaleString('ru-RU')} / 20 000 символов · выбрано {selected.length}</p>
    <fieldset disabled={loading || disabled} aria-label="Редактирование материалов"><div className="context-actions"><button type="button" disabled={disabled || locked || documents.length >= 8} onClick={() => onChange([...documents, { id: crypto.randomUUID(), title: 'Новый материал', text: '' }])}>Добавить текст</button>
      <label className="file-import">{loading ? 'Читаю документы…' : 'Загрузить документы'}<input aria-label="Загрузить материалы" type="file" multiple accept=".txt,.md,.pdf,.docx,.json,.csv,.sql,.py,.js" disabled={loading || disabled || locked} onChange={event => { const files = [...(event.target.files || [])]; event.target.value = ''; void importFiles(files) }} /></label>
      {selected.length > 0 && <button type="button" disabled={disabled} onClick={() => onSelected([])}>Не использовать материалы</button>}
    </div>
    {documents.map(doc => <details className="context-document" key={doc.id}><summary>{doc.title || 'Материал'} · {doc.text.length} символов{selected.includes(doc.id) ? ' · используется' : ''}</summary>
      <label className="inline-check"><input type="checkbox" checked={selected.includes(doc.id)} disabled={disabled} onChange={event => onSelected(event.target.checked ? [...selected, doc.id] : selected.filter(id => id !== doc.id))} />Использовать в ответах</label>
      <label>Название материала<input value={doc.title} maxLength={120} disabled={disabled || locked} onChange={event => onChange(documents.map(item => item.id === doc.id ? { ...item, title: event.target.value } : item))} /></label>
      <label>Текст материала<textarea aria-label={`Текст ${doc.title}`} value={doc.text} maxLength={20000} disabled={disabled || locked} onChange={event => onChange(documents.map(item => item.id === doc.id ? { ...item, text: event.target.value } : item))} /></label>
      <button type="button" disabled={disabled || locked} onClick={() => { onChange(documents.filter(item => item.id !== doc.id)); onSelected(selected.filter(id => id !== doc.id)) }}>Удалить материал</button>
    </details>)}</fieldset>
    {selected.length > 0 && <details><summary>Какие фрагменты получит модель</summary><label>Пробный вопрос<input value={previewQuestion} onChange={event => setPreviewQuestion(event.target.value)} placeholder="Можно на русском или английском" /></label><small>Локальный подбор без API. Если совпадений нет, передаются ограниченные выдержки выбранных документов. Для снимка передаются все явно выбранные материалы до 20 000 символов.</small>{selectContextPassages(documents, selected, previewQuestion).map((part, index) => <details key={`${part.id}-${index}`}><summary>{part.title} · {part.text.length} символов</summary><pre>{part.text}</pre></details>)}</details>}
    {error && <p role="alert">{error}</p>}<small>Материалы и их выбор применятся после сохранения настроек. Новые файлы не загружаются автоматически.</small>
  </section>
}
