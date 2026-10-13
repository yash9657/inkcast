# Inkcast identity

The ink-to-play mark combines a vertical ink stroke and a forward play shape on a rounded tile. `geometry.json` is the geometry source; brand colors are read from `apps/web/app/globals.css`.

Run `node assets/brand/make-brand-assets.mjs` after changing either. It emits light/dark SVG marks, the theme-aware SVG favicon, 16/32/48/64px ICO, 180px Apple icon, 1200×630 social preview, and the renderer's generated brand constants. The app Logo component imports the geometry directly.
