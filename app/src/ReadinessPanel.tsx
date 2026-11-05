import type { LocalSpeech, Settings } from './types'
export function ReadinessPanel({ settings, speech, openSettings }: { settings: Settings; speech: LocalSpeech | null; openSettings: () => void }) {
  const gpu = speech?.gpuSupported && speech.cudaInstalled
  const installed = speech?.installedModels?.includes(settings.cpuSpeechModel)
  const gpuModel = speech?.installedModels?.includes('large-v3-turbo')
  return <section className="readiness-panel" aria-label="Готовность к звонку"><strong>Перед звонком</strong><ul>
    <li>{settings.hasKey ? 'Ключ сохранён. Доступность провайдера проверяется при запросе.' : 'Для подсказок добавь свой ключ OpenRouter.'}</li>
    <li>{settings.transcriptionMode !== 'local' ? 'Выбрано платное облачное распознавание.' : gpu && gpuModel ? 'Пакет NVIDIA найден. Движок проверится при запуске звонка.' : gpu && !gpuModel ? 'Пакет NVIDIA найден. Для него скачай Large turbo в настройках.' : installed ? 'Распознавание будет на CPU. Скорость зависит от модели и компьютера.' : 'Выбранная модель речи не найдена. Скачай её в настройках.'}</li>
    <li>Звук микрофона и собеседника можно проверить в настройках до звонка.</li>
  </ul><button type="button" onClick={openSettings}>Настроить и проверить звук</button><small>Здесь аудио и платные запросы не запускаются.</small></section>
}
