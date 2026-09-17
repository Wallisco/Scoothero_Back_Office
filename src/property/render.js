'use strict';
/**
 * To-scale swap station render on a site photo.
 *
 * The PSAL marks a scale reference on the photo, then taps where the station's base should sit.
 *   scale: { type: 'bay',    a: {x,y}, b: {x,y}, metres: 2.5 }   // two front corners of a parking bay
 *   scale: { type: 'height', top: {x,y}, bottom: {x,y}, metres }  // anything upright of known height (door 2.1 m)
 *   base:  { x, y }   // centre of the station's front bottom edge, in photo pixels
 *
 * Station: 1.80 m tall × 1.05 m wide × 0.85 m deep (front face drawn at 1.05 × 1.80).
 * This is a flat, front-on overlay at true size for that spot in the photo. It does not correct for perspective,
 * so mark the scale reference close to where the station will stand.
 */
const path = require('path');
const sharp = require('sharp');

const STATION = Object.freeze({ heightM: 1.8, widthM: 1.05, depthM: 0.85, image: path.join(__dirname, '../../assets/swap-station.png') });

const dist = (p, q) => Math.hypot(q.x - p.x, q.y - p.y);

function pixelsPerMetre(scale) {
  if (!scale || !(scale.metres > 0)) throw new Error('Scale reference needs a length in metres.');
  if (scale.type === 'bay') return dist(scale.a, scale.b) / scale.metres;
  if (scale.type === 'height') return dist(scale.top, scale.bottom) / scale.metres;
  throw new Error(`Unknown scale type "${scale.type}"`);
}

/**
 * @param {Buffer|string} photo  site photo (JPEG/PNG/HEIC as supported by sharp)
 * @param {{scale: object, base: {x:number,y:number}}} marks  coordinates in the photo's own pixels (after EXIF rotation)
 * @returns {Promise<{buffer: Buffer, pxPerMetre: number, stationPx: {width:number,height:number,left:number,top:number}}>}
 */
async function renderStation(photo, marks, { station = STATION, quality = 85, maxWidth = 2400 } = {}) {
  const src = sharp(photo).rotate(); // apply EXIF orientation so phone photos are upright
  const meta = await src.metadata();
  const upright = [6, 8, 5, 7].includes(meta.orientation);
  const W = upright ? meta.height : meta.width;
  const H = upright ? meta.width : meta.height;

  const ppm = pixelsPerMetre(marks.scale);
  const width = Math.round(station.widthM * ppm);
  const height = Math.round(station.heightM * ppm);
  if (width < 20 || height < 20) throw new Error('Station would be under 20 px. Mark a larger scale reference.');
  if (width > W * 1.5 || height > H * 1.5) throw new Error('Station would be larger than the photo. Check the scale marks.');

  const left = Math.round(marks.base.x - width / 2);
  const top = Math.round(marks.base.y - height);

  // Contact shadow: a soft ellipse the width of the station's depth footprint.
  const shW = Math.round(width * 1.15);
  const shH = Math.max(6, Math.round(station.depthM * ppm * 0.35));
  const shadow = Buffer.from(
    `<svg width="${shW}" height="${shH * 2}" xmlns="http://www.w3.org/2000/svg">
       <defs><radialGradient id="g"><stop offset="0%" stop-color="#000" stop-opacity="0.45"/><stop offset="100%" stop-color="#000" stop-opacity="0"/></radialGradient></defs>
       <ellipse cx="${shW / 2}" cy="${shH}" rx="${shW / 2}" ry="${shH}" fill="url(#g)"/>
     </svg>`);

  const stationPng = await sharp(station.image).resize(width, height, { fit: 'fill' }).png().toBuffer();

  // Clip overlays to the photo so a station near the edge doesn't throw.
  const layers = [];
  const clip = async (buf, l, t, w, h) => {
    const x0 = Math.max(0, -l), y0 = Math.max(0, -t);
    const x1 = Math.min(w, W - l), y1 = Math.min(h, H - t);
    if (x1 <= x0 || y1 <= y0) return;
    const part = (x0 || y0 || x1 < w || y1 < h) ? await sharp(buf).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).toBuffer() : buf;
    layers.push({ input: part, left: Math.max(0, l), top: Math.max(0, t) });
  };
  await clip(await sharp(shadow).png().toBuffer(), Math.round(marks.base.x - shW / 2), Math.round(marks.base.y - shH), shW, shH * 2);
  await clip(stationPng, left, top, width, height);

  let out = sharp(await src.toBuffer()).composite(layers);
  if (W > maxWidth) out = sharp(await out.jpeg({ quality: 95 }).toBuffer()).resize({ width: maxWidth });
  const buffer = await out.jpeg({ quality, mozjpeg: true }).toBuffer();

  return { buffer, pxPerMetre: Math.round(ppm * 10) / 10, stationPx: { width, height, left, top } };
}

module.exports = { renderStation, pixelsPerMetre, STATION };
