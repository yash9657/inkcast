/**
 * Tailwind v4 is configured entirely in CSS (`app/globals.css`, `@theme`).
 * There is no `tailwind.config.js` in this repo and there must never be one —
 * a JS config would create a second, competing source of truth for the design
 * tokens. See docs/DESIGN.md.
 *
 * @type {import('postcss-load-config').Config}
 */
const config = {
  plugins: {
    '@tailwindcss/postcss': {},
  },
};

export default config;
