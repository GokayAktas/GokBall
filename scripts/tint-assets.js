import sharp from 'sharp';
import path from 'path';
import fs from 'fs';

const assets = [
  'public/assets/logo.png',
  'public/assets/starball.png'
];

async function tint(src, dest, color){
  try {
    await sharp(src)
      .tint(color)
      .toFile(dest);
    console.log('Wrote', dest);
  } catch (err) {
    console.error('Error tinting', src, err.message);
  }
}

(async()=>{
  const root = process.cwd();
  for(const a of assets){
    const src = path.join(root, a);
    if(!fs.existsSync(src)){
      console.warn('Asset not found:', src);
      continue;
    }
    const dst = src.replace('.png', '_themed.png');
    await tint(src, dst, '#1565C0');
  }
})();
