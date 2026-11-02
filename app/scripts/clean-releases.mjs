import { lstatSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join, resolve } from 'node:path'
import semver from 'semver'

export function planReleaseCleanup(directory, keep = []) {
  const files = readdirSync(directory).flatMap(name => {
    const match = /^Sobesych-Setup-(\d+\.\d+\.\d+)-x64\.exe(?:\.blockmap)?$/.exec(name)
    if (!match || !semver.valid(match[1])) return []
    const stat = lstatSync(join(directory, name))
    return stat.isFile() ? [{ name, version: match[1], bytes: stat.size }] : []
  })
  const versions = [...new Set(files.map(file => file.version))].sort(semver.rcompare)
  const preserved = new Set([...versions.slice(0, 2), '0.5.72', ...keep])
  return files.filter(file => !preserved.has(file.version))
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2)
  if (args.some(arg => arg !== '--apply' && !/^--keep=\d+\.\d+\.\d+$/.test(arg))) throw new Error('Expected --apply or --keep=x.y.z')
  const directory = fileURLToPath(new URL('../release-installer/', import.meta.url))
  const version = JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version
  const plan = planReleaseCleanup(directory, [version, ...args.filter(arg => arg.startsWith('--keep=')).map(arg => arg.slice(7))])
  if (args.includes('--apply')) for (const file of plan) {
    const path = join(directory, file.name)
    if (!lstatSync(path).isFile()) throw new Error('Release artifact changed during cleanup')
    unlinkSync(path)
  }
  console.log(JSON.stringify({ applied: args.includes('--apply'), bytes: plan.reduce((total, file) => total + file.bytes, 0), files: plan.map(file => file.name) }, null, 2))
}
