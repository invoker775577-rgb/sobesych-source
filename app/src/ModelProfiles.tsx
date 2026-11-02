import { useState } from 'react'
import type { Model, Settings } from './types'

export function ModelProfiles({ config, models, onChange }: { config: Settings; models: Model[]; onChange: (settings: Settings) => void }) {
  const [input, setInput] = useState(5000); const [output, setOutput] = useState(900)
  const price = (id: string) => {
    const model = models.find(item => item.id === id)
    const incoming = Number(model?.pricing?.prompt); const outgoing = Number(model?.pricing?.completion)
    if (!model?.pricing || model.pricing.prompt == null || model.pricing.completion == null || !String(model.pricing.prompt).trim() || !String(model.pricing.completion).trim() || !Number.isFinite(incoming) || !Number.isFinite(outgoing) || incoming < 0 || outgoing < 0) return 'Цена недоступна. Загрузи каталог моделей.'
    return `$${incoming * 1e6} / $${outgoing * 1e6} за 1 млн входных / выходных токенов · оценка $${(input * incoming + output * outgoing).toFixed(6)} за запрос${model.modalities?.includes('image') ? ' · есть изображения' : ''}`
  }
  return <section className="model-profiles" aria-label="Модели по типу задачи"><h3>Модели по типу задачи</h3><p>Пустое поле использует основную модель. Смена происходит только после сохранения. Дополнительные запросы для сравнения моделей не отправляются.</p>
    <label>Модель для кода и экрана<input list="model-catalog" value={config.codeModel || ''} placeholder={config.model} onChange={event => onChange({ ...config, codeModel: event.target.value })} /></label><small>{price(config.codeModel || config.model)}</small>
    <label>Модель для system design<input list="model-catalog" value={config.designModel || ''} placeholder={config.model} onChange={event => onChange({ ...config, designModel: event.target.value })} /></label><small>{price(config.designModel || config.model)}</small>
    <div className="model-estimate"><label>Входных токенов для оценки<input type="number" min={0} max={1000000} value={input} onChange={event => setInput(Math.max(0, Number(event.target.value) || 0))} /></label><label>Выходных токенов для оценки<input type="number" min={0} max={32000} value={output} onChange={event => setOutput(Math.max(0, Number(event.target.value) || 0))} /></label></div>
    <small>Оценка по тарифу каталога. Изображения, рассуждения, кэш и повторы могут изменить расход. Фактическая стоимость остаётся в истории звонка.</small>
  </section>
}
