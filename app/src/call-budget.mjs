// Per-call reservations contain IDs and amounts only. Unknown usage retains
// the reservation after an error or cancellation, including across restarts.
export function createCallBudget({ load = () => ({}), save = () => {} } = {}) {
  let entries = {}; let locked = false
  try {
    entries = load()
    if (!entries || typeof entries !== 'object' || Array.isArray(entries) || Object.keys(entries).length > 1000 || Object.entries(entries).some(([id, value]) => !/^[\w-]{1,80}$/.test(id) || !Number.isFinite(value) || value < 0)) throw new Error('Invalid budget ledger')
  } catch { locked = true }
  const write = next => { save(next); entries = next }
  const amount = id => Object.hasOwn(entries, id) ? entries[id] : 0
  const status = (id, limit) => ({ limitUsd: limit, accountedUsd: amount(id), locked })
  return {
    status,
    reserve(id, limit, payload, models) {
      if (!limit) return { settle() {} }
      if (locked) throw new Error('Учёт лимита повреждён. Новые платные запросы заблокированы; сохрани диагностику.')
      if (!/^[\w-]{1,80}$/.test(id || '')) throw new Error('Для лимита нужен идентификатор звонка')
      const price = models.find(model => model.id === payload.model)?.pricing
      const rate = (source, name) => {
        if (!['number', 'string'].includes(typeof source?.[name]) || typeof source[name] === 'string' && !source[name].trim() || !Number.isFinite(Number(source[name])) || Number(source[name]) < 0) throw new Error(`Цена ${payload.model} неизвестна. Загрузи каталог или явно отключи лимит.`)
        return Number(source[name])
      }
      const tokens = new TextEncoder().encode(JSON.stringify(payload.messages)).length + 16384
      let prompt = rate(price, 'prompt'); let completion = rate(price, 'completion')
      const tiers = price.overrides ?? []
      if (!Array.isArray(tiers)) throw new Error('Тариф модели не поддерживается лимитом')
      const images = payload.messages.flatMap(message => Array.isArray(message.content) ? message.content : []).filter(part => part.type === 'image_url').length
      const webEnabled = payload.model.endsWith(':online') || payload.plugins?.some(plugin => plugin.id === 'web')
      let imageRate = 0
      for (const tier of [price, ...tiers]) {
        for (const extra of ['request', ...(webEnabled ? ['web_search'] : [])]) if (Number(tier[extra] || 0) !== 0) throw new Error(`Доплата ${extra} не поддерживается лимитом. Запрос не отправлен.`)
        for (const extra of ['internal_reasoning', ...(images ? ['image'] : [])]) if (tier[extra] != null && (!Number.isFinite(Number(tier[extra])) || Number(tier[extra]) < 0)) throw new Error('Неизвестный дополнительный тариф модели')
        completion = Math.max(completion, Number(tier.internal_reasoning || 0))
        if (images) imageRate = Math.max(imageRate, Number(tier.image || 0))
        if (tier !== price) {
          if (!Number.isSafeInteger(tier.min_prompt_tokens) || tier.min_prompt_tokens < 0) throw new Error('Неизвестный порог тарифа')
          if (tier.min_prompt_tokens <= tokens) { prompt = Math.max(prompt, rate(tier, 'prompt')); completion = Math.max(completion, rate(tier, 'completion')) }
        }
      }
      if (!Number.isSafeInteger(payload.max_tokens) || payload.max_tokens < 1) throw new Error('Для лимита нужен предел выходных токенов')
      const reserved = tokens * prompt + payload.max_tokens * completion + images * imageRate
      if (amount(id) + reserved > limit + 1e-12) throw new Error('Лимит звонка исчерпан с учётом резерва. Увеличь его в настройках или начни новый звонок.')
      if (!Object.hasOwn(entries, id) && Object.keys(entries).length >= 1000) throw new Error('Журнал лимитов заполнен. Новые платные запросы заблокированы.')
      write({ ...entries, [id]: amount(id) + reserved })
      payload.provider = { ...payload.provider, allow_fallbacks: false, require_parameters: true, max_price: { prompt: prompt * 1e6, completion: completion * 1e6, ...(images && imageRate ? { image: imageRate } : {}) } }
      let settled = false
      return { settle(usage) {
        if (settled) return
        const reported = usage?.cost ?? usage?.total_cost ?? usage?.totalCost
        if (!['number', 'string'].includes(typeof reported) || typeof reported === 'string' && !reported.trim()) return
        const cost = Number(reported)
        if (!Number.isFinite(cost) || cost < 0) return
        write({ ...entries, [id]: Math.max(0, entries[id] - reserved + cost) })
        settled = true
      } }
    },
  }
}
