// Renders the Mermaid diagram in docs/architecture.md to
// figures/bilharz-architecture.png, in the site's colours.
//
//   node scripts/render-diagram.mjs
//
// Uses Playwright's Chromium and Mermaid from the jsDelivr CDN (network needed).
import { readFileSync } from 'node:fs'
import { chromium } from '@playwright/test'

const MERMAID = 'https://cdn.jsdelivr.net/npm/mermaid@11.17.2/dist/mermaid.esm.min.mjs'
const source = readFileSync(new URL('../../docs/architecture.md', import.meta.url), 'utf8')
const diagram = source.match(/```mermaid\n([\s\S]*?)```/)?.[1]
if (!diagram) throw new Error('no mermaid block in docs/architecture.md')
const output = new URL('../../figures/bilharz-architecture.png', import.meta.url)
const font = (file) => new URL(`../node_modules/@fontsource/inter/files/${file}`, import.meta.url).href

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  @font-face { font-family: Inter; font-weight: 400; src: url(${font('inter-latin-400-normal.woff2')}); }
  @font-face { font-family: Inter; font-weight: 600; src: url(${font('inter-latin-600-normal.woff2')}); }
  body { margin: 0; background: #ffffff; }
  #diagram { display: inline-block; padding: 32px; background: #ffffff; }
</style></head><body><div id="diagram"></div>
<script type="module">
  import mermaid from '${MERMAID}'
  await document.fonts.load('400 16px Inter')
  await document.fonts.load('600 16px Inter')
  mermaid.initialize({
    startOnLoad: false,
    theme: 'base',
    flowchart: { curve: 'basis', padding: 14, nodeSpacing: 40, rankSpacing: 56 },
    themeVariables: {
      fontFamily: 'Inter, sans-serif',
      fontSize: '15px',
      primaryColor: '#ffffff',
      primaryTextColor: '#0a0a0a',
      primaryBorderColor: '#0a0a0a',
      lineColor: '#0a0a0a',
      clusterBkg: '#f5f5f5',
      clusterBorder: '#d4d4d4',
      edgeLabelBackground: '#ffffff',
    },
  })
  const { svg } = await mermaid.render('architecture', ${JSON.stringify(diagram)})
  document.getElementById('diagram').innerHTML = svg
  // Mermaid scales the SVG to its container; draw it at its own size instead.
  const element = document.querySelector('#diagram svg')
  const [, , width, height] = element.getAttribute('viewBox').split(' ').map(Number)
  element.style.maxWidth = 'none'
  element.setAttribute('width', width)
  element.setAttribute('height', height)
  window.rendered = true
</script></body></html>`

const browser = await chromium.launch({ args: ['--allow-file-access-from-files'] })
const page = await browser.newPage({ deviceScaleFactor: 2, viewport: { width: 2000, height: 1200 } })
const file = new URL('./.render-diagram.html', import.meta.url)
const { writeFileSync, rmSync } = await import('node:fs')
writeFileSync(file, html)
try {
  await page.goto(file.href)
  await page.waitForFunction(() => window.rendered === true, null, { timeout: 30_000 })
  await page.locator('#diagram').screenshot({ path: output.pathname })
  console.log(`saved figures/bilharz-architecture.png`)
} finally {
  rmSync(file)
  await browser.close()
}
