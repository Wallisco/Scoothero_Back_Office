#!/usr/bin/env node
'use strict';
// Demo: place the station on a deck photo. Scale from the rider standing next to the existing cabinet
// (about 1.80 m including helmet, pixels 405 → 877 in the original 1536 × 1024 photo).
const fs = require('fs');
const { renderStation } = require('../src/property/render');

(async () => {
  const photo = fs.readFileSync('data/demo-site-photo.jpg');
  const r = await renderStation(photo, {
    scale: { type: 'height', top: { x: 905, y: 405 }, bottom: { x: 905, y: 877 }, metres: 1.8 },
    base: { x: 1392, y: 890 },
  });
  fs.writeFileSync('data/demo-render.jpg', r.buffer);
  console.log('Wrote data/demo-render.jpg', r);
})().catch((e) => { console.error(e.message); process.exit(1); });
