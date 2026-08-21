ACTIVATE TRACKER v14.00 — COLLAPSIBLE LEVELS TEST

Upload these files to the ROOT of the existing GitHub Pages repository, replacing index.html and sw.js:

- index.html
- sw.js
- typography-v1400.css
- levels-accordion-v1400.js

Do not delete the existing app.js, style.css, JSON files, icons or older typography files.

What this test changes:
- Levels: rooms collapse/expand.
- Levels: co-op games collapse/expand inside each room.
- Level rows and game/room headings are larger and more touch-friendly.
- Room headers show a compact progress summary.
- Open rooms/games stay open while filters/re-renders update the page.
- Recent Achievements text/rows are larger.
- Fold portrait menu is much wider and larger.
- Fold landscape menu uses a wider two-column layout rather than shrinking the labels.

After GitHub Pages deploys, fully close/reopen the installed PWA once if the old service worker is still visible.
