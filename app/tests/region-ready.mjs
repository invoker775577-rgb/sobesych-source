export async function waitForRegionReady(selector) {
  await selector.waitForURL('**/region.html')
  await selector.locator('#box').waitFor({ state: 'attached' })
  await selector.waitForFunction(() => document.readyState === 'complete' && typeof window.region?.complete === 'function')
}
