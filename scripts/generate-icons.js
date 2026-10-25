const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const sharp = require('sharp');
const png2icons = require('png2icons');

const svgIcon = `<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#1E293B" />
      <stop offset="100%" stop-color="#0F172A" />
    </linearGradient>
    <linearGradient id="lassoGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#F97316" />
      <stop offset="100%" stop-color="#EF4444" />
    </linearGradient>
    <linearGradient id="boltGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#38BDF8" />
      <stop offset="100%" stop-color="#6366F1" />
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="220" fill="url(#bg)" />
  <!-- Lasso Loop -->
  <ellipse cx="512" cy="440" rx="280" ry="185" transform="rotate(-14 512 440)" fill="none" stroke="url(#lassoGradient)" stroke-width="58" stroke-linecap="round" />
  <!-- Lasso Knot & Tail -->
  <circle cx="670" cy="560" r="40" fill="url(#lassoGradient)" />
  <path d="M 670 560 Q 730 680 620 790" fill="none" stroke="url(#lassoGradient)" stroke-width="48" stroke-linecap="round" />
  <!-- API Bolt / Signal -->
  <path d="M 545 270 L 415 470 L 520 470 L 475 645 L 620 430 L 515 430 Z" fill="url(#boltGradient)" />
</svg>
`;

async function buildIcons() {
  const iconDir = path.join(__dirname, '..', 'build');
  if (!fs.existsSync(iconDir)) {
    fs.mkdirSync(iconDir, { recursive: true });
  }

  const svgPath = path.join(iconDir, 'icon.svg');
  const pngPath = path.join(iconDir, 'icon.png');
  const icnsPath = path.join(iconDir, 'icon.icns');
  const icoPath = path.join(iconDir, 'icon.ico');

  fs.writeFileSync(svgPath, svgIcon);
  console.log('Created SVG icon.');

  const pngBuffer = await sharp(Buffer.from(svgIcon))
    .resize(1024, 1024)
    .png()
    .toBuffer();

  fs.writeFileSync(pngPath, pngBuffer);
  console.log('Created PNG icon (1024x1024).');

  if (os.platform() === 'darwin') {
    const iconsetDir = path.join(iconDir, 'icon.iconset');
    if (!fs.existsSync(iconsetDir)) fs.mkdirSync(iconsetDir);
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
      await sharp(pngBuffer)
        .resize(actual, actual)
        .png()
        .toFile(path.join(iconsetDir, filename));
    }
    execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsPath}"`);
    fs.rmSync(iconsetDir, { recursive: true, force: true });
    console.log('Created ICNS icon via iconutil (macOS, multi-resolution).');
  } else {
    const icnsBuffer = png2icons.createICNS(pngBuffer, png2icons.BICUBIC2, 0);
    if (icnsBuffer) {
      fs.writeFileSync(icnsPath, icnsBuffer);
      console.log('Created ICNS icon via png2icons (non-macOS fallback).');
    }
  }

  const icoBuffer = png2icons.createICO(pngBuffer, png2icons.BICUBIC2, 0, false, true);
  if (icoBuffer) {
    fs.writeFileSync(icoPath, icoBuffer);
    console.log('Created ICO icon (Windows).');
  }

  const sizes = [512, 256, 128, 64, 32];
  for (const size of sizes) {
    await sharp(pngBuffer)
      .resize(size, size)
      .png()
      .toFile(path.join(iconDir, `icon-${size}x${size}.png`));
    console.log(`Created PNG icon (${size}x${size}).`);
  }
}

buildIcons().catch(err => {
  console.error(err);
  process.exit(1);
});
