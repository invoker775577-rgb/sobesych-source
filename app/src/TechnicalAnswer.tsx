import { useEffect, useId, useRef, useState } from 'react'
import { parseAnswerSections } from './copilot.mjs'
import { parseDiagram } from './diagram.mjs'
import type { CodeLanguage, CodeResult } from './code-sandbox'

function Diagram({ source }: { source: string }) {
  const graph = parseDiagram(source)
  const [error, setError] = useState('')
  const arrowId = `arrow-${useId().replace(/[^a-z0-9]/gi, '')}`
  if (!graph) return <pre><code>{source}</code></pre>
  const columns = Math.min(3, graph.nodes.length)
  const positions = new Map(graph.nodes.map((node, index) => [node.id, { x: 20 + index % columns * 205, y: 20 + Math.floor(index / columns) * 105 }]))
  const download = async () => {
    try { const result = await window.sobesych!.exportDiagram(source); if (result.error) throw new Error(result.error); setError('') }
    catch (error) { setError(error instanceof Error ? error.message : String(error)) }
  }
  return <div className="design-diagram"><svg xmlns="http://www.w3.org/2000/svg" viewBox={`0 0 ${columns * 205 + 10} ${Math.ceil(graph.nodes.length / columns) * 105}`} role="img" aria-label="Схема архитектуры">
    <defs><marker id={arrowId} markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#8398af" /></marker></defs>
    {graph.edges.map((edge, index) => {
      const from = positions.get(edge.from)!; const to = positions.get(edge.to)!
      const dx = to.x - from.x; const dy = to.y - from.y
      if (!dx && !dy) return null
      const scale = 1 / Math.max(Math.abs(dx) / 85, Math.abs(dy) / 27)
      return <path key={index} d={`M${from.x + 85 + dx * scale},${from.y + 27 + dy * scale} L${to.x + 85 - dx * scale},${to.y + 27 - dy * scale}`} stroke="#8398af" strokeWidth="2" fill="none" markerEnd={`url(#${arrowId})`} />
    })}
    {graph.nodes.map(node => { const point = positions.get(node.id)!; return <g key={node.id}><rect x={point.x} y={point.y} width="170" height="54" rx="8" fill="#172a30" stroke="#578e91" /><text x={point.x + 85} y={point.y + 31} textAnchor="middle" fill="#edf4f3" fontSize="12" fontFamily="sans-serif">{node.label.length > 23 ? `${node.label.slice(0, 22)}…` : node.label}<title>{node.label}</title></text></g> })}
  </svg><button type="button" onClick={() => void download()}>Сохранить схему SVG</button>{error && <p role="alert">{error}</p>}</div>
}

function CodeBlock({ language, code, interactive }: { language: string; code: string; interactive: boolean }) {
  const [editing, setEditing] = useState(false)
  const [source, setSource] = useState(code)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<CodeResult | null>(null)
  const [error, setError] = useState('')
  const request = useRef<AbortController | null>(null)
  useEffect(() => () => request.current?.abort(), [])
  const resolved = /^(?:py|python|python3)$/i.test(language) ? 'python' : /^(?:sql|sqlite)$/i.test(language) ? 'sql' : /^(?:js|javascript)$/i.test(language) ? 'javascript' : null
  const run = async () => {
    const controller = new AbortController(); request.current = controller
    setRunning(true); setError(''); setResult(null)
    try {
      const { runCode } = await import('./code-sandbox')
      const value = await runCode(resolved as CodeLanguage, source, controller.signal)
      if (request.current === controller) setResult(value)
    } catch (error) { if (request.current === controller) setError(error instanceof Error ? error.message : String(error)) }
    finally { if (request.current === controller) { setRunning(false); request.current = null } }
  }
  return <div className="code-solution"><pre><code className={language ? `language-${language}` : undefined}>{code}</code></pre>
    {interactive && <div className="code-actions"><button type="button" onClick={() => void navigator.clipboard.writeText(code).catch(() => setError('Не удалось скопировать код'))}>Копировать код</button>{resolved && <button type="button" onClick={() => setEditing(value => !value)}>{editing ? 'Скрыть проверку' : 'Проверить код'}</button>}</div>}
    {editing && <section className="code-verification" aria-label="Проверка кода"><p>Локальный запуск без Node и доступа к приложению. Добавь входные данные и проверки. SQL выполняется в новой базе SQLite в памяти. Синтаксис PostgreSQL или MySQL может потребовать другой среды.</p><textarea aria-label="Код для проверки" value={source} onChange={event => setSource(event.target.value)} disabled={running} spellCheck={false} />
      <button type="button" disabled={running} onClick={() => void run()}>{running ? 'Подготавливаю среду или выполняю…' : 'Запустить локально'}</button>{running && <button type="button" onClick={() => request.current?.abort()}>Остановить проверку</button>}
      {result && <div role="status"><strong>{result.ok ? 'Выполнено без ошибки' : 'Проверка завершилась ошибкой'}</strong><span> · {result.elapsedMs} мс</span><pre>{result.output || 'Вывода нет'}{result.error ? `\n${result.error}` : ''}</pre>{result.ok && <small>Проверены только выполненные условия и тесты. Это не подтверждает правильность для всех входных данных.</small>}</div>}
    </section>}{error && <p role="alert">{error}</p>}</div>
}
function Body({ text, interactive }: { text: string; interactive: boolean }) {
  const content = []; let cursor = 0
  for (const [index, block] of [...text.matchAll(/```([a-z0-9_-]*)\r?\n([\s\S]*?)```/gi)].entries()) {
    const start = block.index || 0
    if (text.slice(cursor, start).trim()) content.push(<p key={`text-${index}`}>{text.slice(cursor, start)}</p>)
    content.push(block[1] === 'mermaid' ? <Diagram key={`diagram-${index}`} source={block[2]} /> : <CodeBlock key={`code-${index}`} language={block[1]} code={block[2].replace(/\n$/, '')} interactive={interactive} />)
    cursor = start + block[0].length
  }
  const tail = text.slice(cursor)
  const open = tail.match(/```([a-z0-9_-]*)\r?\n([\s\S]*)$/i)
  if (open) {
    if (tail.slice(0, open.index).trim()) content.push(<p key="tail-text">{tail.slice(0, open.index)}</p>)
    content.push(<pre key="open-code"><code>{open[2]}</code></pre>)
  } else if (tail.trim()) content.push(<p key="tail">{tail}</p>)
  return <>{content}</>
}
export function TechnicalAnswer({ text, interactive = false }: { text: string; interactive?: boolean }) {
  const sections = parseAnswerSections(text)
  const scenarioLabel = sections.illustrative && <small className="scenario-label" title="Вымышленная ситуация для подготовки">Учебный сценарий</small>
  if (!sections.layered) return <>{scenarioLabel}<Body text={sections.illustrative ? sections.answer : text} interactive={interactive} /></>
  const questions = sections.questions.split('\n').map(line => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim()).filter(Boolean)
  return <div className={`technical-answer ${sections.kind}`}>
    {scenarioLabel}
    {sections.answer && <div className="spoken-answer"><Body text={sections.answer} interactive={interactive} /></div>}
    {sections.details && <details className="answer-details" open={sections.kind === 'code' || sections.kind === 'design'}><summary>{sections.kind === 'code' ? 'Решение и проверки' : sections.kind === 'design' ? 'Архитектура и расчёты' : 'Подробнее'}</summary><Body text={sections.details} interactive={interactive} /></details>}
    {questions.length > 0 && <details className="clarification-questions"><summary>Что уточнить у собеседника</summary>{questions.map((question, index) => <p key={index}>{question}</p>)}</details>}
    {sections.assumptions && <details className="answer-assumptions"><summary>Допущения для решения</summary><Body text={sections.assumptions} interactive={false} /></details>}
    {sections.diagram && <Diagram source={sections.diagram} />}
  </div>
}
