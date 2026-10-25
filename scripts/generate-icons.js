const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const sharp = require('sharp');
const png2icons = require('png2icons');

const svgIcon = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1E293B" />
      <stop offset="50%" stop-color="#0F172A" />
      <stop offset="100%" stop-color="#090D16" />
    </linearGradient>
    <radialGradient id="glow" cx="50%" cy="46%" r="48%">
      <stop offset="0%" stop-color="#F97316" stop-opacity="0.22" />
      <stop offset="55%" stop-color="#6366F1" stop-opacity="0.10" />
      <stop offset="100%" stop-color="#0F172A" stop-opacity="0" />
    </radialGradient>
    <linearGradient id="borderGrad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#475569" stop-opacity="0.6" />
      <stop offset="100%" stop-color="#1E293B" stop-opacity="0.2" />
    </linearGradient>
    <linearGradient id="lassoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDBA74" />
      <stop offset="35%" stop-color="#F97316" />
      <stop offset="100%" stop-color="#EF4444" />
    </linearGradient>
    <linearGradient id="boltGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7DD3FC" />
      <stop offset="45%" stop-color="#38BDF8" />
      <stop offset="100%" stop-color="#6366F1" />
    </linearGradient>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="10" stdDeviation="14" flood-color="#000000" flood-opacity="0.38" />
    </filter>
  </defs>

  <!-- Rounded square background (macOS-friendly squircle look with 64px safe margin) -->
  <rect x="64" y="64" width="896" height="896" rx="200" ry="200" fill="url(#bg)" stroke="url(#borderGrad)" stroke-width="6" />
  <rect x="64" y="64" width="896" height="896" rx="200" ry="200" fill="url(#glow)" />

  <!-- Lasso Loop, Knot & Tail -->
  <g filter="url(#shadow)">
    <ellipse cx="504" cy="456" rx="276" ry="184" transform="rotate(-14 504 456)" fill="none" stroke="url(#lassoGradient)" stroke-width="60" stroke-linecap="round" />
    <circle cx="662" cy="574" r="44" fill="url(#lassoGradient)" stroke="#FFF7ED" stroke-width="6" stroke-opacity="0.35" />
    <path d="M 662 574 Q 724 692 618 796" fill="none" stroke="url(#lassoGradient)" stroke-width="50" stroke-linecap="round" />
  </g>

  <!-- API Bolt / Signal -->
  <g filter="url(#shadow)">
    <path d="M 542 268 L 406 474 L 516 474 L 468 654 L 620 432 L 510 432 Z" fill="url(#boltGradient)" stroke="#E0F2FE" stroke-width="5" stroke-linejoin="round" stroke-opacity="0.45" />
  </g>
</svg>
`;

function createDocumentSvg(badgeLabel = 'AWJC') {
  // Pure vector letter paths for "AWJC" / "AWJ" so SVG rendering never depends on system fonts
  const letterPaths = {
    A: 'M 0 64 L 22 0 L 36 0 L 58 64 L 44 64 L 39 49 L 19 49 L 14 64 Z M 22 38 L 36 38 L 29 15 Z',
    W: 'M 0 0 L 13 0 L 22 44 L 33 0 L 45 0 L 56 44 L 65 0 L 78 0 L 62 64 L 49 64 L 39 23 L 29 64 L 16 64 Z',
    J: 'M 32 0 L 45 0 L 45 43 Q 45 65 22 65 Q 3 65 0 46 L 13 44 Q 15 53 22 53 Q 32 53 32 42 Z',
    C: 'M 54 44 Q 50 65 28 65 Q 0 65 0 32 Q 0 0 28 0 Q 50 0 54 21 L 41 23 Q 38 12 28 12 Q 14 12 14 32 Q 14 53 28 53 Q 38 53 41 42 Z',
  };

  const letters = badgeLabel.split('');
  const advances = { A: 66, W: 86, J: 55, C: 62 };
  const totalWidth =
    letters.reduce((acc, ch) => acc + (advances[ch] || 60), 0) - 8;
  let cursorX = 504 - totalWidth / 2;
  const baselineY = 784;

  const glyphPaths = letters
    .map(ch => {
      const d = letterPaths[ch];
      const x = cursorX;
      cursorX += advances[ch] || 60;
      return `<path d="${d}" transform="translate(${x.toFixed(1)}, ${baselineY})" fill="#FFFFFF" fill-rule="evenodd" />`;
    })
    .join('\n    ');

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="pageBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1E293B" />
      <stop offset="60%" stop-color="#0F172A" />
      <stop offset="100%" stop-color="#090D16" />
    </linearGradient>
    <linearGradient id="pageFold" x1="0%" y1="100%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#334155" />
      <stop offset="100%" stop-color="#64748B" />
    </linearGradient>
    <linearGradient id="pageBorder" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#64748B" stop-opacity="0.7" />
      <stop offset="100%" stop-color="#334155" stop-opacity="0.35" />
    </linearGradient>
    <linearGradient id="lassoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#FDBA74" />
      <stop offset="35%" stop-color="#F97316" />
      <stop offset="100%" stop-color="#EF4444" />
    </linearGradient>
    <linearGradient id="boltGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#7DD3FC" />
      <stop offset="45%" stop-color="#38BDF8" />
      <stop offset="100%" stop-color="#6366F1" />
    </linearGradient>
    <linearGradient id="badgeBg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#F97316" />
      <stop offset="100%" stop-color="#EA580C" />
    </linearGradient>
    <filter id="docShadow" x="-15%" y="-15%" width="130%" height="130%">
      <feDropShadow dx="0" dy="14" stdDeviation="20" flood-color="#000000" flood-opacity="0.42" />
    </filter>
    <filter id="emblemShadow" x="-20%" y="-20%" width="140%" height="140%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000000" flood-opacity="0.38" />
    </filter>
  </defs>

  <!-- Document Sheet with Folded Top-Right Corner -->
  <g filter="url(#docShadow)">
    <path d="M 220 84 L 644 84 L 844 284 L 844 884 Q 844 940 788 940 L 220 940 Q 164 940 164 884 L 164 140 Q 164 84 220 84 Z"
      fill="url(#pageBg)" stroke="url(#pageBorder)" stroke-width="6" />
    <path d="M 644 84 L 644 236 Q 644 284 692 284 L 844 284 Z"
      fill="url(#pageFold)" opacity="0.92" />
  </g>

  <!-- Center Lasso + Bolt Emblem -->
  <g filter="url(#emblemShadow)" transform="translate(0, -30)">
    <ellipse cx="496" cy="480" rx="205" ry="136" transform="rotate(-14 496 480)"
      fill="none" stroke="url(#lassoGradient)" stroke-width="46" stroke-linecap="round" />
    <circle cx="614" cy="568" r="34" fill="url(#lassoGradient)" stroke="#FFF7ED" stroke-width="5" stroke-opacity="0.35" />
    <path d="M 614 568 Q 660 650 582 726"
      fill="none" stroke="url(#lassoGradient)" stroke-width="38" stroke-linecap="round" />
    <path d="M 524 340 L 422 494 L 504 494 L 468 628 L 582 462 L 500 462 Z"
      fill="url(#boltGradient)" stroke="#E0F2FE" stroke-width="4" stroke-linejoin="round" stroke-opacity="0.45" />
  </g>

  <!-- Bottom File Extension Pill Badge -->
  <g filter="url(#emblemShadow)">
    <rect x="272" y="758" width="464" height="116" rx="34" fill="url(#badgeBg)" />
    ${glyphPaths}
  </g>
</svg>
`;
}

/**
 * Convert an RGBA buffer (width x height x 4) into a 32-bit BGRA DIB (BMP without BITMAPFILEHEADER)
 * with an AND mask (1bpp row-padded to 32-bit boundary) as expected by the Windows ICO specification.
 */
function rgbaToBmpDib(rgba, width, height) {
  const headerSize = 40;
  const xorSize = width * height * 4;
  const andRowBytes = Math.ceil(width / 32) * 4;
  const andSize = andRowBytes * height;
  const buf = Buffer.alloc(headerSize + xorSize + andSize);

  // BITMAPINFOHEADER
  buf.writeUInt32LE(headerSize, 0); // biSize
  buf.writeInt32LE(width, 4); // biWidth
  buf.writeInt32LE(height * 2, 8); // biHeight (XOR + AND combined height)
  buf.writeUInt16LE(1, 12); // biPlanes
  buf.writeUInt16LE(32, 14); // biBitCount
  buf.writeUInt32LE(0, 16); // biCompression (BI_RGB)
  buf.writeUInt32LE(xorSize + andSize, 20); // biSizeImage
  buf.writeInt32LE(0, 24); // biXPelsPerMeter
  buf.writeInt32LE(0, 28); // biYPelsPerMeter
  buf.writeUInt32LE(0, 32); // biClrUsed
  buf.writeUInt32LE(0, 36); // biClrImportant

  // XOR mask: bottom-up rows, BGRA byte order
  let dstOffset = headerSize;
  for (let y = height - 1; y >= 0; y--) {
    const rowStart = y * width * 4;
    for (let x = 0; x < width; x++) {
      const src = rowStart + x * 4;
      buf[dstOffset] = rgba[src + 2]; // B
      buf[dstOffset + 1] = rgba[src + 1]; // G
      buf[dstOffset + 2] = rgba[src]; // R
      buf[dstOffset + 3] = rgba[src + 3]; // A
      dstOffset += 4;
    }
  }

  // AND mask: 1 bit per pixel, bottom-up, 1 = transparent (alpha === 0), 0 = opaque
  const andStart = headerSize + xorSize;
  for (let y = 0; y < height; y++) {
    const srcY = height - 1 - y;
    const rowOffset = andStart + y * andRowBytes;
    for (let x = 0; x < width; x++) {
      const alpha = rgba[(srcY * width + x) * 4 + 3];
      if (alpha === 0) {
        const byteIdx = rowOffset + (x >> 3);
        const bitIdx = 7 - (x & 7);
        buf[byteIdx] |= 1 << bitIdx;
      }
    }
  }

  return buf;
}

/**
 * Build a multi-resolution Windows .ico file directly from an SVG buffer using sharp's
 * high-quality Lanczos3 downsampler. Includes 256, 128, 96, 72, 64 (PNG-compressed)
 * and 48, 32, 24, 16 (32-bit BGRA BMP DIB) for maximum Windows Explorer, Taskbar,
 * Desktop, Titlebar, and Alt-Tab compatibility across all DPI scales.
 */
async function buildMultiResIco(svgBuffer) {
  const icoSizes = [256, 128, 96, 72, 64, 48, 32, 24, 16];
  const entries = [];

  for (const size of icoSizes) {
    if (size >= 64) {
      const png = await sharp(svgBuffer)
        .resize(size, size, { kernel: sharp.kernel.lanczos3 })
        .png({ compressionLevel: 9 })
        .toBuffer();
      entries.push({ size, data: png });
    } else {
      const { data: rgba } = await sharp(svgBuffer)
        .resize(size, size, { kernel: sharp.kernel.lanczos3 })
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const dib = rgbaToBmpDib(rgba, size, size);
      entries.push({ size, data: dib });
    }
  }

  const headerSize = 6 + entries.length * 16;
  const totalSize = headerSize + entries.reduce((sum, e) => sum + e.data.length, 0);
  const out = Buffer.alloc(totalSize);

  out.writeUInt16LE(0, 0); // Reserved
  out.writeUInt16LE(1, 2); // Type: 1 = ICO
  out.writeUInt16LE(entries.length, 4); // Image count

  let dataOffset = headerSize;
  entries.forEach((entry, i) => {
    const dirOffset = 6 + i * 16;
    out[dirOffset] = entry.size === 256 ? 0 : entry.size;
    out[dirOffset + 1] = entry.size === 256 ? 0 : entry.size;
    out[dirOffset + 2] = 0; // Color palette count
    out[dirOffset + 3] = 0; // Reserved
    out.writeUInt16LE(1, dirOffset + 4); // Color planes
    out.writeUInt16LE(32, dirOffset + 6); // Bits per pixel (32-bit RGBA)
    out.writeUInt32LE(entry.data.length, dirOffset + 8); // Image data size
    out.writeUInt32LE(dataOffset, dirOffset + 12); // Image data offset

    entry.data.copy(out, dataOffset);
    dataOffset += entry.data.length;
  });

  return out;
}

/**
 * Build a macOS multi-resolution .icns file from an SVG buffer.
 * Uses native `iconutil` on macOS (16x16 through 512x512@2x = 1024x1024) and falls back
 * to `png2icons` on Linux/Windows.
 */
async function buildMultiResIcns(svgBuffer, png1024Buffer, icnsPath, tempName = 'icon.iconset') {
  const iconDir = path.dirname(icnsPath);
  if (os.platform() === 'darwin') {
    const iconsetDir = path.join(iconDir, tempName);
    if (!fs.existsSync(iconsetDir)) fs.mkdirSync(iconsetDir, { recursive: true });
    const iconsetSizes = [
      { logical: 16, scale: 1 },
      { logical: 16, scale: 2 },
      { logical: 32, scale: 1 },
      { logical: 32, scale: 2 },
      { logical: 128, scale: 1 },
      { logical: 128, scale: 2 },
      { logical: 256, scale: 1 },
      { logical: 256, scale: 2 },
      { logical: 512, scale: 1 },
      { logical: 512, scale: 2 },
    ];
    for (const { logical, scale } of iconsetSizes) {
      const actual = logical * scale;
      const filename =
        scale === 1
          ? `icon_${logical}x${logical}.png`
          : `icon_${logical}x${logical}@2x.png`;
      await sharp(svgBuffer)
        .resize(actual, actual, { kernel: sharp.kernel.lanczos3 })
        .png({ compressionLevel: 9 })
        .toFile(path.join(iconsetDir, filename));
    }
    execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`);
    fs.rmSync(iconsetDir, { recursive: true, force: true });
    return 'iconutil';
  } else {
    const icnsBuffer = png2icons.createICNS(png1024Buffer, png2icons.BICUBIC2, 0);
    if (icnsBuffer) {
      fs.writeFileSync(icnsPath, icnsBuffer);
    }
    return 'png2icons';
  }
}

async function buildIcons() {
  const iconDir = path.join(__dirname, '..', 'build');
  const hicolorIconsDir = path.join(iconDir, 'icons');
  if (!fs.existsSync(iconDir)) {
    fs.mkdirSync(iconDir, { recursive: true });
  }
  if (!fs.existsSync(hicolorIconsDir)) {
    fs.mkdirSync(hicolorIconsDir, { recursive: true });
  }

  const svgPath = path.join(iconDir, 'icon.svg');
  const pngPath = path.join(iconDir, 'icon.png');
  const icnsPath = path.join(iconDir, 'icon.icns');
  const icoPath = path.join(iconDir, 'icon.ico');

  const svgBuffer = Buffer.from(svgIcon);
  fs.writeFileSync(svgPath, svgIcon);
  console.log('Created SVG app icon (build/icon.svg).');

  const pngBuffer = await sharp(svgBuffer)
    .resize(1024, 1024, { kernel: sharp.kernel.lanczos3 })
    .png({ compressionLevel: 9 })
    .toBuffer();

  fs.writeFileSync(pngPath, pngBuffer);
  console.log('Created PNG app icon (1024x1024 -> build/icon.png).');

  const icnsMethod = await buildMultiResIcns(svgBuffer, pngBuffer, icnsPath, 'icon.iconset');
  console.log(`Created ICNS app icon via ${icnsMethod} (build/icon.icns).`);

  const icoBuffer = await buildMultiResIco(svgBuffer);
  fs.writeFileSync(icoPath, icoBuffer);
  console.log('Created multi-resolution ICO app icon (16..256 -> build/icon.ico).');

  // Generate full set of PNG sizes in both build/icon-{size}x{size}.png and build/icons/{size}x{size}.png
  const sizes = [1024, 512, 256, 128, 64, 48, 32, 24, 16];
  for (const size of sizes) {
    const resizedBuf = await sharp(svgBuffer)
      .resize(size, size, { kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9 })
      .toBuffer();

    fs.writeFileSync(path.join(iconDir, `icon-${size}x${size}.png`), resizedBuf);
    fs.writeFileSync(path.join(hicolorIconsDir, `${size}x${size}.png`), resizedBuf);
    console.log(`Created PNG icon (${size}x${size}).`);
  }

  // Generate dedicated document icons for .awjc and .awj collection files
  const docSpecs = [
    { ext: 'awjc', label: 'AWJC' },
    { ext: 'awj', label: 'AWJ' },
  ];

  for (const { ext, label } of docSpecs) {
    const docSvg = createDocumentSvg(label);
    const docSvgBuffer = Buffer.from(docSvg);
    const docSvgPath = path.join(iconDir, `${ext}.svg`);
    const docPngPath = path.join(iconDir, `${ext}.png`);
    const docIcnsPath = path.join(iconDir, `${ext}.icns`);
    const docIcoPath = path.join(iconDir, `${ext}.ico`);

    fs.writeFileSync(docSvgPath, docSvg);
    const docPngBuffer = await sharp(docSvgBuffer)
      .resize(1024, 1024, { kernel: sharp.kernel.lanczos3 })
      .png({ compressionLevel: 9 })
      .toBuffer();
    fs.writeFileSync(docPngPath, docPngBuffer);

    await buildMultiResIcns(docSvgBuffer, docPngBuffer, docIcnsPath, `${ext}.iconset`);
    const docIcoBuffer = await buildMultiResIco(docSvgBuffer);
    fs.writeFileSync(docIcoPath, docIcoBuffer);
    console.log(`Created .${ext} file association icons (build/${ext}.{svg,png,icns,ico}).`);
  }
}

buildIcons().catch(err => {
  console.error(err);
  process.exit(1);
});
