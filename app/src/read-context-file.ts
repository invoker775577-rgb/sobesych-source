export async function readContextFile(file: File): Promise<string> {
  if (file.size > 8_000_000) throw new Error('Файл больше 8 МБ. Выбери небольшой документ или вставь нужный текст.')
  const extension = file.name.split('.').at(-1)?.toLowerCase()
  let text = ''
  if (extension === 'docx') {
    const { unzipSync, strFromU8 } = await import('fflate')
    const entries = unzipSync(new Uint8Array(await file.arrayBuffer()), { filter: entry => entry.name === 'word/document.xml' && entry.originalSize <= 2_000_000 })
    if (!entries['word/document.xml']) throw new Error('Не найден допустимый текст DOCX')
    const xml = strFromU8(entries['word/document.xml'])
    if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error('Документ содержит неподдерживаемый XML')
    const document = new DOMParser().parseFromString(xml, 'application/xml')
    if (document.getElementsByTagName('parsererror').length) throw new Error('Не удалось прочитать DOCX')
    text = [...document.getElementsByTagNameNS('*', 'p')].map(paragraph => [...paragraph.getElementsByTagNameNS('*', 't')].map(node => node.textContent || '').join('')).join('\n\n')
  } else if (extension === 'pdf') {
    const { getDocument, GlobalWorkerOptions } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const { default: worker } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url')
    GlobalWorkerOptions.workerSrc = worker
    const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableFontFace: true, useSystemFonts: false, useWorkerFetch: false })
    try {
      const document = await task.promise
      if (document.numPages > 40) throw new Error('В PDF больше 40 страниц. Выбери нужный фрагмент документа.')
      const pages = []
      for (let index = 1; index <= document.numPages; index++) {
        const content = await (await document.getPage(index)).getTextContent()
        pages.push(content.items.map(item => 'str' in item ? `${item.str}${item.hasEOL ? '\n' : ' '}` : '').join(''))
        if (pages.join('\n\n').length > 20000) throw new Error('В документе больше 20 000 символов. Вставь нужные фрагменты вручную.')
      }
      text = pages.join('\n\n')
    } finally { await task.destroy() }
  } else if (['txt', 'md', 'json', 'csv', 'sql', 'py', 'js'].includes(extension || '')) {
    const bytes = new Uint8Array(await file.arrayBuffer())
    const encoding = bytes[0] === 255 && bytes[1] === 254 ? 'utf-16le' : bytes[0] === 254 && bytes[1] === 255 ? 'utf-16be' : 'utf-8'
    try { text = new TextDecoder(encoding, { fatal: true }).decode(bytes) }
    catch { throw new Error('Не удалось прочитать кодировку текста. Сохрани файл в UTF-8 или вставь текст вручную.') }
  }
  else throw new Error('Поддерживаются TXT, MD, PDF, DOCX и текстовые файлы кода')
  text = text.replaceAll(String.fromCharCode(0), '').trim()
  if (!text) throw new Error('В файле нет извлекаемого текста. Для скана вставь текст вручную.')
  if (text.length > 20000) throw new Error('В документе больше 20 000 символов. Вставь нужные фрагменты вручную.')
  return text
}
