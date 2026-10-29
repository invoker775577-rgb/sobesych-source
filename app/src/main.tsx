import { Component, StrictMode } from 'react'
import type { ReactNode, ErrorInfo } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { void window.sobesych?.reportError(`${error.message}\n${info.componentStack}`) }
  render() {
    if (this.state.failed) return <main className="history-page"><h1>Sobesych: ошибка интерфейса</h1><p>Ошибка записана в лог.</p><button onClick={() => location.reload()}>Перезапустить интерфейс</button><button onClick={() => void window.sobesych?.openLogs()}>Открыть логи</button></main>
    return this.props.children
  }
}
window.addEventListener('unhandledrejection', event => { void window.sobesych?.reportError(String(event.reason)) })
window.addEventListener('error', event => { void window.sobesych?.reportError(event.message) })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary><App /></ErrorBoundary>
  </StrictMode>,
)
