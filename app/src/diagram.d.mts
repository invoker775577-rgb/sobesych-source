export function parseDiagram(source?: string): { nodes: { id: string; label: string }[]; edges: { from: string; to: string }[] } | null
