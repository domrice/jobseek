import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-08-21',
  css: ['~/assets/css/main.css'],
  // The favicon is the same SVG the Dock icon was rendered from (public/favicon.svg is the source;
  // JobSeek.app's .icns is the baked copy), so the tab and the Dock cannot drift apart by accident.
  app: {
    head: {
      // SC 3.1.1: without this the shell renders a bare <html> and a screen reader falls back to
      // the OS voice — near-certain to be de-CH on the machines this app runs on, which would
      // mispronounce the entire English UI. The postings themselves are often German; that is
      // SC 3.1.2 and needs a `jobs.language` column, not guessable here.
      htmlAttrs: { lang: 'en' },
      // DESIGN.md, The Desktop-Only Rule: render the desktop layout scaled, never a fake mobile one.
      viewport: 'width=1024',
      // The fallback only, for Nitro's error page: every real page sets its own via `useHead`
      // (SC 2.4.2), and a posting's tab carries its title and company because triage means several
      // open at once. Spelled `Job Seek`, matching the wordmark and PRODUCT.md's pinned name.
      title: 'Job Seek',
      // Both faces are discovered two hops deep — HTML, then the stylesheet, then the woff2 — so
      // without this they start downloading after CSS has parsed and the first paint of a fifty-row
      // table is the fallback metrics. `font-display: swap` then reflows it. These two preloads
      // remove both. 400 is the body face (every cell of that table) and 600 is the wordmark, every
      // heading and every score badge, so each one swaps visibly. `crossorigin` is mandatory even same-origin
      // — fonts are fetched in CORS mode, and without it the browser makes a second,
      // uncredentialled request and the preload is wasted.
      link: [
        { rel: 'icon', type: 'image/svg+xml', href: '/favicon.svg' },
        ...['regular', '600'].map(
          w =>
            ({
              rel: 'preload',
              as: 'font',
              type: 'font/woff2',
              href: `/fonts/titillium-web-v17-latin-${w}.woff2`,
              crossorigin: '',
            }) as const,
        ),
      ],
    },
  },
  vite: { plugins: [tailwindcss()] },
  typescript: { strict: true },
})
