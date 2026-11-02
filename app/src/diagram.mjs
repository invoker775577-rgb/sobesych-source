export function parseDiagram(source = '') {
  if (source.length > 12000) return null
  const nodes = new Map(); const edges = []
  const node = token => {
    const match = token.trim().match(/^([A-Za-z][\w]{0,39})(?:\["?([^\]\r\n"]{1,100})"?\])?$/)
    if (!match) throw new Error('Unsupported diagram syntax')
    if (!nodes.has(match[1]) || match[2]) nodes.set(match[1], { id: match[1], label: match[2] || match[1] })
    return match[1]
  }
  try {
    for (const raw of source.replace(/^```(?:mermaid)?\s*|```\s*$/g, '').split(/\r?\n/)) {
      const line = raw.trim().replace(/;$/, '')
      if (!line || /^(?:flowchart|graph)\s+(?:LR|TD|TB)$/i.test(line)) continue
      const parts = line.split(/\s*-->\s*/)
      if (parts.length > 1) for (let index = 1; index < parts.length; index++) edges.push({ from: node(parts[index - 1]), to: node(parts[index]) })
      else node(line)
      if (nodes.size > 24 || edges.length > 40) return null
    }
    if (!nodes.size) return null
    return { nodes: [...nodes.values()], edges }
  } catch { return null }
}
export function diagramSvg(source) {
  const graph = parseDiagram(source)
  if (!graph) throw new Error('Схема содержит неподдерживаемый синтаксис')
  const columns = Math.min(3, graph.nodes.length)
  const positions = new Map(graph.nodes.map((node, i) => [node.id, { x: 20 + i % columns * 205, y: 20 + Math.floor(i / columns) * 105 }]))
  const escape = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char])
  const edges = graph.edges.map(edge => {
    const a = positions.get(edge.from); const b = positions.get(edge.to)
    const dx = b.x - a.x; const dy = b.y - a.y
    if (!dx && !dy) return ''
    const scale = 1 / Math.max(Math.abs(dx) / 85, Math.abs(dy) / 27)
    return `<path d="M${a.x + 85 + dx * scale},${a.y + 27 + dy * scale} L${b.x + 85 - dx * scale},${b.y + 27 - dy * scale}" stroke="#8398af" stroke-width="2" fill="none" marker-end="url(#arrow)"/>`
  }).join('')
  const nodes = graph.nodes.map(node => { const { x, y } = positions.get(node.id); return `<g><rect x="${x}" y="${y}" width="170" height="54" rx="8" fill="#172a30" stroke="#578e91"/><text x="${x + 85}" y="${y + 31}" text-anchor="middle" fill="#edf4f3" font-size="12" font-family="sans-serif">${escape(node.label.length > 23 ? `${node.label.slice(0, 22)}…` : node.label)}<title>${escape(node.label)}</title></text></g>` }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${columns * 205 + 10} ${Math.ceil(graph.nodes.length / columns) * 105}"><defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="7" refY="3" orient="auto"><path d="M0,0 L0,6 L8,3 z" fill="#8398af"/></marker></defs>${edges}${nodes}</svg>`
}
