import sharp from 'sharp';
import fs from 'fs';
import path from 'path';

const outDir = path.resolve('public/icons');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Crisp SVG template for SpendCoach
function createSvg(size, isMaskable = false) {
  // Maskable icons need ~10-15% safe padding around core content
  const scale = isMaskable ? 0.72 : 0.88;
  const padding = (size * (1 - scale)) / 2;

  return `
  <svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bgGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#064e3b" />
        <stop offset="50%" stop-color="#022c22" />
        <stop offset="100%" stop-color="#041f18" />
      </linearGradient>
      <linearGradient id="symbolGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#34d399" />
        <stop offset="100%" stop-color="#10b981" />
      </linearGradient>
      <linearGradient id="accentGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#6ee7b7" />
        <stop offset="100%" stop-color="#059669" />
      </linearGradient>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="${size * 0.02}" result="blur" />
        <feComposite in="SourceGraphic" in2="blur" operator="over" />
      </filter>
    </defs>

    <!-- Background: solid for maskable, rounded squircle for standard -->
    <rect width="${size}" height="${size}" ${isMaskable ? '' : `rx="${size * 0.22}"`} fill="url(#bgGrad)" />

    <!-- Subtle inner border -->
    <rect x="${size * 0.02}" y="${size * 0.02}" width="${size * 0.96}" height="${size * 0.96}" ${isMaskable ? '' : `rx="${size * 0.20}"`} fill="none" stroke="#10b981" stroke-width="${size * 0.015}" stroke-opacity="0.3" />

    <!-- Content group with padding/centering -->
    <g transform="translate(${padding}, ${padding}) scale(${scale})">
      <!-- Glow effect behind symbol -->
      <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.35}" fill="#10b981" opacity="0.12" filter="url(#glow)" />

      <!-- Minimalist sleek coach indicator ring -->
      <circle cx="${size / 2}" cy="${size / 2}" r="${size * 0.38}" fill="none" stroke="url(#accentGrad)" stroke-width="${size * 0.025}" stroke-dasharray="${size * 0.2} ${size * 0.08}" stroke-linecap="round" />

      <!-- Indian Rupee Currency Symbol (₹) -->
      <text x="${size / 2}" y="${size * 0.62}" font-family="-apple-system, BlinkMacSystemFont, 'SF Pro Display', 'Segoe UI', Roboto, sans-serif" font-size="${size * 0.44}" font-weight="800" fill="url(#symbolGrad)" text-anchor="middle" filter="url(#glow)">₹</text>
    </g>
  </svg>
  `;
}

async function generateIcons() {
  console.log('Generating SpendCoach app icons...');

  const targets = [
    { file: 'public/icons/icon-192.png', size: 192, maskable: false },
    { file: 'public/icons/icon-512.png', size: 512, maskable: false },
    { file: 'public/icons/icon-maskable-512.png', size: 512, maskable: true },
    { file: 'public/apple-touch-icon.png', size: 180, maskable: false },
  ];

  for (const target of targets) {
    const svg = Buffer.from(createSvg(target.size, target.maskable));
    await sharp(svg)
      .resize(target.size, target.size)
      .png()
      .toFile(path.resolve(target.file));
    console.log(`✓ Generated ${target.file} (${target.size}x${target.size})`);
  }

  console.log('All icons generated successfully!');
}

generateIcons().catch((err) => {
  console.error('Error generating icons:', err);
  process.exit(1);
});
