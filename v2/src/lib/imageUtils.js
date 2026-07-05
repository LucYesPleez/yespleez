// Read EXIF orientation tag from JPEG file (first 64 KB is enough)
export function readExifOrientation(file) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = e => {
      try {
        const view = new DataView(e.target.result);
        if (view.getUint16(0, false) !== 0xFFD8) { resolve(1); return; }
        let offset = 2;
        while (offset + 4 < view.byteLength) {
          const marker = view.getUint16(offset, false);
          if (marker === 0xFFE1) {
            if (view.getUint32(offset + 4, false) !== 0x45786966) { resolve(1); return; }
            const little = view.getUint16(offset + 10, false) === 0x4949;
            const ifdOff = view.getUint32(offset + 14, little);
            const tags   = view.getUint16(offset + 10 + ifdOff, little);
            for (let i = 0; i < tags; i++) {
              const tagOff = offset + 10 + ifdOff + 2 + i * 12;
              if (view.getUint16(tagOff, little) === 0x0112) {
                resolve(view.getUint16(tagOff + 8, little)); return;
              }
            }
            resolve(1); return;
          }
          if (marker === 0xFFDA) break; // start of scan
          const len = view.getUint16(offset + 2, false);
          offset += 2 + len;
        }
      } catch (_) {}
      resolve(1);
    };
    reader.readAsArrayBuffer(file.slice(0, 65536));
  });
}

// Load a File, auto-rotate by EXIF, return an HTMLCanvasElement
export function loadCorrectedCanvas(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      URL.revokeObjectURL(url);
      const orientation = await readExifOrientation(file);
      // orientations 5-8 swap width/height
      const swapped = orientation >= 5 && orientation <= 8;
      const cw = swapped ? img.naturalHeight : img.naturalWidth;
      const ch = swapped ? img.naturalWidth  : img.naturalHeight;

      const canvas = document.createElement('canvas');
      canvas.width  = cw;
      canvas.height = ch;
      const ctx = canvas.getContext('2d');

      switch (orientation) {
        case 2: ctx.transform(-1,  0,  0,  1, cw,  0); break;
        case 3: ctx.transform(-1,  0,  0, -1, cw, ch); break;
        case 4: ctx.transform( 1,  0,  0, -1,  0, ch); break;
        case 5: ctx.transform( 0,  1,  1,  0,  0,  0); break;
        case 6: ctx.transform( 0,  1, -1,  0, ch,  0); break;
        case 7: ctx.transform( 0, -1, -1,  0, ch, cw); break;
        case 8: ctx.transform( 0, -1,  1,  0,  0, cw); break;
        default: break;
      }
      ctx.drawImage(img, 0, 0);
      resolve(canvas);
    };
    img.onerror = reject;
    img.src = url;
  });
}

// Resize a canvas to new dimensions
export function resizeCanvas(src, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d').drawImage(src, 0, 0, w, h);
  return c;
}

// Convert canvas to Blob (WebP preferred, JPEG fallback)
const _webpOk = (function () {
  try { return document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp'); }
  catch (_) { return false; }
})();

export function canvasToBlob(canvas, quality = 0.85) {
  return new Promise((resolve, reject) => {
    const type = _webpOk ? 'image/webp' : 'image/jpeg';
    canvas.toBlob(b => b ? resolve({ blob: b, ext: _webpOk ? 'webp' : 'jpg', type }) : reject(new Error('toBlob failed')), type, quality);
  });
}
