import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// GitHub Pages serves project sites from https://<user>.github.io/<repo>/,
// so the build needs to know that subpath. In CI we read it from the
// repository name; locally we serve from root. A <user>.github.io repo is
// served from the domain root, so it keeps '/'.
function resolveBase() {
  const slug = process.env.GITHUB_REPOSITORY
  if (!slug) return '/'
  const repo = slug.split('/')[1]
  if (!repo || repo.endsWith('.github.io')) return '/'
  return `/${repo}/`
}

export default defineConfig({
  base: resolveBase(),
  plugins: [react(), tailwindcss()],
})
