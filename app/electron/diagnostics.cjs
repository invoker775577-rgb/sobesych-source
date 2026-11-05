const { formatAnswerTrace } = require('./answer-trace.cjs')
function diagnosticSnapshot({ version, platform, arch, speech, settings, events }) {
  return {
    schemaVersion: 1, createdAt: new Date().toISOString(), version, platform, arch,
    speech: { running: Boolean(speech?.running), backend: ['cuda', 'cpu'].includes(speech?.backend) ? speech.backend : null, cpuModel: ['base', 'small', 'large-v3-turbo'].includes(speech?.cpuModel) ? speech.cpuModel : null, cudaInstalled: Boolean(speech?.cudaInstalled), gpuSupported: Boolean(speech?.gpuSupported) },
    settings: { hasKey: Boolean(settings?.hasKey), localTranscription: settings?.transcriptionMode === 'local', selectedDocuments: Array.isArray(settings?.contextIds) ? settings.contextIds.length : 0, budgetEnabled: Number(settings?.callBudgetUsd) > 0 },
    events: (events || []).slice(-100).flatMap(event => {
      const trace = formatAnswerTrace(event)
      if (!trace) return []
      const { requestId: _requestId, ...safe } = JSON.parse(trace)
      return [safe]
    }),
  }
}
module.exports = { diagnosticSnapshot }
