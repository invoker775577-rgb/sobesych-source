const fs = require('node:fs')
const path = require('node:path')

function normalizeDocuments(value) {
  if (!Array.isArray(value) || value.length > 8) throw new Error('Можно сохранить до восьми материалов')
  const ids = new Set(); let characters = 0
  return value.map(item => {
    if (!item || typeof item.id !== 'string' || !/^[\w-]{1,80}$/.test(item.id) || ids.has(item.id) || typeof item.title !== 'string' || !item.title.trim() || typeof item.text !== 'string' || !item.text.trim()) throw new Error('Материалы повреждены или заполнены не полностью')
    ids.add(item.id)
    const text = item.text.trim(); characters += text.length
    if (characters > 20000) throw new Error('Общий объём материалов превышает 20 000 символов. Сократи текст перед сохранением.')
    return { id: item.id, title: item.title.trim().slice(0, 120), text }
  })
}
function createContextStore(directory, encryption) {
  const file = path.join(directory, 'context-library.enc')
  let documents = []; let warning = ''; let locked = false
  try {
    const bytes = fs.readFileSync(file)
    if (bytes.length > 200000 || !encryption.isEncryptionAvailable()) throw new Error('Context storage unavailable')
    documents = normalizeDocuments(JSON.parse(encryption.decryptString(bytes)))
  } catch (error) {
    if (error.code !== 'ENOENT') { locked = true; warning = 'Материалы не удалось расшифровать или проверить. Исходный файл оставлен без изменений. Выключи их использование или восстанови доступ к файлу.' }
  }
  return {
    list: () => structuredClone(documents),
    status: () => ({ locked, warning }),
    forRequest(ids) {
      if (!ids.length) return []
      if (locked || ids.some(id => !documents.some(doc => doc.id === id))) throw new Error('Выбранные материалы недоступны. Проверь их в настройках или выключи использование материалов.')
      return structuredClone(documents.filter(doc => ids.includes(doc.id)))
    },
    save(value) {
      if (locked) throw new Error(warning)
      if (!encryption.isEncryptionAvailable()) throw new Error('Windows не может зашифровать материалы. Они не сохранены.')
      const next = normalizeDocuments(value)
      const bytes = encryption.encryptString(JSON.stringify(next))
      fs.mkdirSync(directory, { recursive: true })
      const temporary = `${file}.tmp`
      try {
        if (fs.existsSync(file)) fs.copyFileSync(file, `${file}.bak`)
        fs.writeFileSync(temporary, bytes, { mode: 0o600 }); fs.renameSync(temporary, file)
      } catch (error) { try { fs.unlinkSync(temporary) } catch { /* No temporary file. */ } throw error }
      documents = next
      return { ok: true, documents: structuredClone(documents) }
    },
  }
}
module.exports = { createContextStore, normalizeDocuments }
