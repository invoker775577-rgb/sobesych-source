import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { planReleaseCleanup } from '../scripts/clean-releases.mjs'

test('artifact retention keeps the two latest versions, rollback baseline, explicit versions and unrelated data', t => {
  const root = mkdtempSync(join(tmpdir(), 'sobesych-clean-releases-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  for (const version of ['0.5.9', '0.5.69', '0.5.72', '0.5.77', '0.5.78', '0.5.79']) {
    writeFileSync(join(root, `Sobesych-Setup-${version}-x64.exe`), 'fixture')
    writeFileSync(join(root, `Sobesych-Setup-${version}-x64.exe.blockmap`), 'fixture')
  }
  for (const name of ['latest.yml', 'settings.json', 'other-setup.exe', 'Sobesych-Setup-0.5.2-x64.exe.zip']) writeFileSync(join(root, name), 'must stay intact')
  mkdirSync(join(root, 'Sobesych-Setup-0.5.1-x64.exe'))
  const plan = planReleaseCleanup(root, ['0.5.77'])
  assert.deepEqual([...new Set(plan.map(file => file.version))], ['0.5.69', '0.5.9'])
  assert.equal(plan.length, 4)
  assert.equal(readFileSync(join(root, 'Sobesych-Setup-0.5.69-x64.exe'), 'utf8'), 'fixture', 'Planning must not delete files')
  assert.equal(readFileSync(join(root, 'settings.json'), 'utf8'), 'must stay intact')
})
