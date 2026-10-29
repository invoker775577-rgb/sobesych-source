import { test } from 'node:test'
import assert from 'node:assert/strict'
import { sameTextSource } from '../scripts/source-bytes.mjs'

test('source verification permits only Windows Git CRLF/LF normalization', () => {
  const source = 'const value = 1\nconsole.log(value)\n'
  assert.equal(sameTextSource(Buffer.from(source), Buffer.from(source)), true)
  assert.equal(sameTextSource(Buffer.from(source), Buffer.from(source.replaceAll('\n', '\r\n'))), true)
})
test('source verification rejects changed logic and whitespace', () => {
  assert.equal(sameTextSource(Buffer.from('const value = 1\n'), Buffer.from('const value = 2\r\n')), false)
  assert.equal(sameTextSource(Buffer.from('a b\n'), Buffer.from('a  b\r\n')), false)
  assert.equal(sameTextSource(Buffer.from('a\r'), Buffer.from('a\n')), false)
  assert.equal(sameTextSource(Buffer.from([0xef, 0xbb, 0xbf, 0x61]), Buffer.from('a')), false)
})
test('source verification never rewrites literal backslash escapes', () => {
  assert.equal(sameTextSource(Buffer.from('"\\r\\n"\n'), Buffer.from('"\\n"\r\n')), false)
})
test('different invalid UTF8 bytes cannot pass through replacement-character decoding', () => {
  assert.equal(sameTextSource(Buffer.from([0xfe]), Buffer.from([0xff])), false)
})
