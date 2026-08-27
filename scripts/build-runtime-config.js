'use strict';

const fs = require('fs');
const path = require('path');

const googleMapsKey = String(process.env.GOOGLE_MAPS_BROWSER_KEY || '').trim();
const metaPixelId = String(process.env.META_PIXEL_ID || '').trim();
if (googleMapsKey && !/^AIza[0-9A-Za-z_-]{20,}$/.test(googleMapsKey)) throw new Error('GOOGLE_MAPS_BROWSER_KEY has an invalid format.');

const target = path.join(__dirname, '..', 'src', 'js', 'runtime-config.js');
const output = `window.UMA_RUNTIME_CONFIG = Object.freeze({ googleMapsBrowserKey: ${JSON.stringify(googleMapsKey)}, metaPixelId: ${JSON.stringify(metaPixelId)} });\n`;
fs.writeFileSync(target, output, 'utf8');
console.log(googleMapsKey || metaPixelId ? 'Generated browser runtime configuration.' : 'Generated browser runtime configuration without configured third-party keys.');
