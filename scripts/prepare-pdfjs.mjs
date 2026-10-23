import { cp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const packageRoot = dirname(require.resolve('pdfjs-dist/package.json'))
const { version } = JSON.parse(await readFile(join(packageRoot, 'package.json'), 'utf8'))
const destination = join(workspace, 'public', 'pdfjs', version)
await mkdir(destination, { recursive: true })
for (const directory of ['cmaps', 'standard_fonts', 'wasm', 'iccs']) {
  await cp(join(packageRoot, directory), join(destination, directory), { recursive: true })
}
await cp(join(packageRoot, 'web', 'images'), join(destination, 'images'), { recursive: true })
await cp(join(packageRoot, 'build', 'pdf.worker.min.mjs'), join(destination, 'pdf.worker.min.mjs'))
await cp(join(packageRoot, 'LICENSE'), join(destination, 'LICENSE'))
await writeFile(join(destination, 'version.json'), `${JSON.stringify({ version })}\n`)
console.log(`Prepared PDF.js ${version} assets.`)
