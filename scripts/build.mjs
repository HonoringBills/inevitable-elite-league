import { cp, mkdir, rm } from 'node:fs/promises'

const files = [
  'index.html',
  'styles.css',
  'original-iel-theme.css',
  'match-reporting.css',
  'app.js',
]

await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })

for (const file of files) {
  await cp(file, `dist/${file}`)
}

await cp('js', 'dist/js', { recursive: true })

console.log('Built IEL static assets into ./dist')
