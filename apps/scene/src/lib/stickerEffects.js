/**
 * STICKER EFFECTS — the look an act chooses for its logo.
 * ---------------------------------------------------------------------------
 * A sticker exists to be SAVED. That single fact decides this whole module:
 * the effect has to end up in the PIXELS OF THE DOWNLOADED FILE, not only on
 * our page. A CSS filter on the tile would look right here and hand the
 * collector a plain logo, which is a lie told at the exact moment the feature
 * is supposed to pay off.
 *
 * So the original upload is never modified — `renderSticker` composites the
 * effect onto a canvas on demand, and the SAVE control turns that canvas into
 * the file. The chosen effect is a small string on the asset row, changeable
 * any time without re-uploading, and the artwork the artist gave us survives
 * every change of mind.
 *
 * ⛔⛔ EVERY EFFECT KEYS OFF THE ALPHA CHANNEL. Outline dilates the silhouette,
 * puffy lights and shadows it, metallic clips a sheen to it. A logo with no
 * transparency has no silhouette — it is a rectangle — and all three degrade
 * into a box with a border. `hasAlpha` is not a nicety, it is the gate: refuse
 * the effect and say why, rather than producing something broken and calling
 * it a style.
 *
 * ⚠ THE KEYS ARE STORED (`profile_assets.sticker_effect`). Same contract as
 * PROFILE_ASSET_TYPES: `key` is permanent once shipped, `label` is display
 * only and free to edit. ⛔ Renaming a key orphans every row already carrying
 * it, and the failure is silent — the sticker simply stops having an effect.
 */

/* ── the registry ──────────────────────────────────────────────────── */

/**
 * `pad` — how much room the effect needs OUTSIDE the artwork, as a fraction of
 * the longest edge. Outline and puffy both grow beyond the original bounds;
 * drawing them into a canvas the size of the source clips the effect against
 * its own edges, which reads as a cropping bug rather than a style.
 * ⚠ Metallic stays at 0 deliberately: it paints only INSIDE the silhouette,
 * so any padding would be transparent margin baked into everyone's download.
 */
export const STICKER_EFFECTS = [
  { key: 'NONE',     label: 'None',     pad: 0     },
  { key: 'OUTLINE',  label: 'Outline',  pad: 0.06  },
  { key: 'PUFFY',    label: 'Puffy',    pad: 0.10  },
  { key: 'METALLIC', label: 'Metallic', pad: 0     },
];

export const STICKER_EFFECT_KEYS = STICKER_EFFECTS.map(e => e.key);

export const DEFAULT_STICKER_EFFECT = 'NONE';

/**
 * ⛔ A PERFORMANCE CEILING, NOT A LOOK. The backing is built at this resolution
 * and scaled up. Dilation stamps the mask once per step and the step count
 * rises with the radius, which rises with the canvas: without this, a puffy
 * sticker at save size measured 11,169ms. The backing is a solid shape, so it
 * loses nothing meaningful by being built small.
 */
export const BACKING_MAX = 512;

/** Unknown is NOT guessed at — an unrecognised key renders the plain logo. */
export function effectByKey(key) {
  return STICKER_EFFECTS.find(e => e.key === key) || null;
}

export function isStickerEffect(key) {
  return STICKER_EFFECT_KEYS.includes(key);
}

/**
 * Padding in whole pixels for a given source size.
 * ⚠ Rounded, and floored at 0: a fractional canvas dimension is silently
 * truncated by the browser, so a 0.5px asymmetry would shift the artwork half
 * a pixel off centre and soften every edge.
 */
export function effectPadding(key, longestEdge) {
  const eff = effectByKey(key);
  if (!eff || !eff.pad) return 0;
  return Math.max(0, Math.round(longestEdge * eff.pad));
}

/* ── the alpha gate ────────────────────────────────────────────────── */

/**
 * Does this artwork have a usable silhouette?
 *
 * ⚠ NOT "is any pixel transparent". A single stray soft edge pixel would pass
 * a naive check while leaving the image effectively a rectangle. The question
 * that matters is whether a MEANINGFUL SHARE of the image is transparent, so
 * the threshold is a proportion, not a boolean.
 *
 * 2% is deliberately low. A dense logo on a transparent square can be almost
 * entirely opaque and still be a perfectly good sticker; the case being
 * excluded is the flat JPEG-style export where transparency is 0%.
 *
 * @param data Uint8ClampedArray | number[] — RGBA, 4 bytes per pixel.
 */
export function hasAlpha(data, { threshold = 0.02, cutoff = 250 } = {}) {
  if (!data || data.length < 4) return false;
  const pixels = Math.floor(data.length / 4);
  let transparent = 0;
  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < cutoff) transparent++;
  }
  return transparent / pixels >= threshold;
}

/* ── dilation ──────────────────────────────────────────────────────── */

/**
 * The offsets used to grow a silhouette outwards.
 *
 * There is no dilate primitive in canvas 2D, so the silhouette is stamped
 * repeatedly around a circle and the union of those stamps IS the dilation.
 *
 * ⚠ THE STEP COUNT IS NOT COSMETIC. Too few stamps and a large radius produces
 * a visibly polygonal outline — the classic "why is my circle a heptagon"
 * artefact. The gap between neighbouring stamps grows with the radius, so the
 * count has to scale WITH it rather than being a constant: enough stamps that
 * consecutive ones land under ~1px apart, clamped so a huge radius cannot cost
 * an unbounded number of draws.
 *
 * ⛔ A single ring is not enough on its own for thick outlines — the interior
 * between the ring and the artwork can stay unfilled where the shape is
 * concave. Two rings (full radius and half) close that without the cost of a
 * filled disc.
 *
 * ⚠ THE CAP WAS 96 AND THAT WAS A BUG the tests caught: at radius 40 it left
 * 2.6px gaps, which is exactly the polygonal outline this scaling exists to
 * prevent. ⛔ Do not lower it back to a constant that "looks fine" on one logo.
 */
export function dilationOffsets(radius, { maxSteps = 512 } = {}) {
  const r = Math.max(0, Math.round(radius));
  if (r === 0) return [];

  const steps = Math.min(maxSteps, Math.max(8, Math.ceil(2 * Math.PI * r)));
  const out = [];
  for (const ring of [r, r / 2]) {
    if (ring < 1) continue;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      out.push([
        Math.round(Math.cos(a) * ring * 1000) / 1000,
        Math.round(Math.sin(a) * ring * 1000) / 1000,
      ]);
    }
  }
  return out;
}

/* ── the fill colour ───────────────────────────────────────────────── */

/**
 * ⚠ A resolution ceiling for reading the source back. A 4000px upload is 16
 * million pixels to scan, and the only question being asked of them — is this
 * artwork light or dark — survives a smaller copy intact.
 */
export const PROBE_MAX = 512;

/**
 * The rim around the sticker.
 *
 * ⭐⭐ THE RULE, STATED BY THE OWNER (2026-09-03): "the background and outline
 * need to be opposite contrast of the white of the logo. If it was any other
 * colour the outline would be white." The rim follows the SAME contrast
 * decision as the body — both are the ground the logo is read against, so they
 * move together. A white logo gets a dark body and a black rim; anything
 * darker gets a white body and a white rim.
 *
 * ⛔ NOT A CONSTANT. It was one, and that shipped a black rim onto every dark
 * logo — correct for the light case that had been reviewed and wrong for
 * everything else.
 *
 * ⚠ THE DARK PAIR IS NOT IDENTICAL: the body is #14141c and the rim is pure
 * black, so the rim reads as an edge against the body rather than vanishing
 * into it. There is no equivalent trick on the light side — nothing is whiter
 * than white — so a dark logo's rim and body are the same colour and the
 * sticker is simply one white backing. That asymmetry is deliberate.
 */
export function rimColourFor(artworkIsLight) {
  return artworkIsLight ? '#000000' : '#ffffff';
}

/**
 * What colour to fill the sticker's interior with.
 *
 * ⭐⭐ IT MUST CONTRAST WITH THE ARTWORK, and that is the whole reason this
 * function exists. Filling the interior white looked correct in theory and
 * erased the logo in practice: the app's hand mark is white line art, so a
 * white interior with white strokes drawn on top is a blank blob. The fill is
 * the ground the logo is read against, so it has to be the opposite of it.
 *
 * ⚠ Rec. 709 luma, not a flat RGB mean: the eye is far more sensitive to green
 * than to blue, so a flat mean calls a saturated blue logo "dark" and a
 * saturated green one "light" when they read alike.
 *
 * ⚠ Opaque pixels only. Transparent pixels carry no colour, and averaging them
 * in drags every logo toward whatever the unused RGB happens to be.
 *
 * ⚠ THE PIVOT IS BIASED TOWARD THE LIGHT FILL. White is the sticker idiom and
 * a dark interior is the exception, so this does not simply maximise contrast
 * — that would hand a dark fill to every mid-tone logo. It switches only where
 * white genuinely stops working: a saturated green sits at luma 0.617, and a
 * white fill behind it is a contrast ratio of about 1.6, which is not a
 * background.
 */
export function contrastFill(data, { cutoff = 8, pivot = 0.55 } = {}) {
  if (!data || data.length < 4) return { color: '#ffffff', artworkIsLight: false };
  let sum = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] <= cutoff) continue;
    sum += (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255;
    n++;
  }
  if (!n) return { color: '#ffffff', artworkIsLight: false };
  const light = (sum / n) > pivot;
  /* ⛔ Not pure black. A dead-black interior behind a dark-but-not-black logo
     reads as a hole punched through the sticker; #14141c is the app's own
     darkest surface. */
  return { color: light ? '#14141c' : '#ffffff', artworkIsLight: light };
}

/** '#14141c' → [20, 20, 28]. Accepts the 3-digit form too. */
export function hexToRgb(hex) {
  let h = String(hex || '').replace('#', '');
  if (h.length === 3) h = h.split('').map(c => c + c).join('');
  if (h.length !== 6) return [255, 255, 255];
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

/* ── the enclosed interior ─────────────────────────────────────────── */

/**
 * Transparent pixels the outside cannot reach — the holes inside a shape.
 *
 * ⭐⭐ ANYWHERE INSIDE THE STICKER'S OVERALL OUTLINE IS SOLID (owner,
 * 2026-09-03). Once the band has been drawn, the gaps between nearby strokes
 * are sealed by the band itself and become genuine enclosed pockets — and the
 * background shows through every one of them. Filling them is the whole fix.
 *
 * ⛔ IT CANNOT MOVE THE OUTLINE. Only pixels the outside cannot reach are
 * touched, so the outer contour is untouchable by construction — a pocket is
 * filled, or it was never a pocket. That is why this is safe where dilating
 * and eroding was not.
 *
 * ⚠ A gap that still opens to the outside is NOT filled, and that is correct:
 * the space between two fingers is outside the logo's overall outline, however
 * enclosed it looks to a reader.
 *
 * ⛔ Iterative, not recursive — a recursive flood blows the stack at save size.
 * ⚠ 4-connected, not 8: a diagonal leak lets the outside squeeze through a
 * one-pixel corner and drain a pocket that reads as closed.
 */
export function enclosedRegions(alpha, width, height, { cutoff = 8 } = {}) {
  const n = width * height;
  const out = new Uint8Array(n);
  if (!alpha || !n) return out;

  const outside = new Uint8Array(n);
  const stack = [];
  const clear = i => alpha[i * 4 + 3] <= cutoff;

  for (let x = 0; x < width; x++) {
    const top = x, bot = (height - 1) * width + x;
    if (clear(top) && !outside[top]) { outside[top] = 1; stack.push(top); }
    if (clear(bot) && !outside[bot]) { outside[bot] = 1; stack.push(bot); }
  }
  for (let y = 0; y < height; y++) {
    const l = y * width, r = y * width + width - 1;
    if (clear(l) && !outside[l]) { outside[l] = 1; stack.push(l); }
    if (clear(r) && !outside[r]) { outside[r] = 1; stack.push(r); }
  }

  while (stack.length) {
    const i = stack.pop();
    const x = i % width, y = (i / width) | 0;
    if (x > 0)          { const j = i - 1;     if (!outside[j] && clear(j)) { outside[j] = 1; stack.push(j); } }
    if (x < width - 1)  { const j = i + 1;     if (!outside[j] && clear(j)) { outside[j] = 1; stack.push(j); } }
    if (y > 0)          { const j = i - width; if (!outside[j] && clear(j)) { outside[j] = 1; stack.push(j); } }
    if (y < height - 1) { const j = i + width; if (!outside[j] && clear(j)) { outside[j] = 1; stack.push(j); } }
  }

  for (let i = 0; i < n; i++) if (clear(i) && !outside[i]) out[i] = 1;
  return out;
}

/* ── the metallic ramp ─────────────────────────────────────────────── */

/**
 * Chrome is not a gradient from grey to white. What reads as metal is an
 * ABRUPT light-to-dark reversal partway down — the horizon line where a
 * curved reflective surface stops reflecting the sky and starts reflecting the
 * ground. A smooth ramp reads as plastic, however shiny.
 *
 * Hence the tight pairs of stops: each near-duplicate offset is a hard edge.
 */
export function metallicStops() {
  return [
    { at: 0.00, color: 'rgba(255,255,255,0.00)' },
    { at: 0.18, color: 'rgba(255,255,255,0.55)' },
    { at: 0.34, color: 'rgba(226,232,240,0.30)' },
    { at: 0.46, color: 'rgba(255,255,255,0.85)' },  // the sky side of the horizon
    { at: 0.50, color: 'rgba(40,44,58,0.55)' },     // the ground side, abruptly
    { at: 0.64, color: 'rgba(148,163,184,0.28)' },
    { at: 0.82, color: 'rgba(255,255,255,0.62)' },
    { at: 1.00, color: 'rgba(255,255,255,0.00)' },
  ];
}

/* ── rendering ─────────────────────────────────────────────────────── */

/**
 * A white silhouette of the source, on its own canvas.
 * `source-in` keeps the fill only where the source was opaque, which is the
 * whole trick — it turns any artwork into its own mask in two operations.
 */
function silhouette(img, w, h, make, color = '#fff') {
  const c = make(w, h);
  const ctx = c.getContext('2d');
  ctx.drawImage(img, 0, 0, w, h);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  return c;
}

/**
 * Render `img` with `effectKey` onto a new canvas and return it.
 *
 * `make(w, h)` builds a blank canvas — injected rather than assumed so this
 * runs against OffscreenCanvas, a test double, or document.createElement
 * without knowing which. The caller owns the environment; this owns the look.
 *
 * ⛔ Returns a canvas, NOT a data URL or a blob. Encoding is the caller's
 * decision: the tile wants to paint it, the SAVE control wants a PNG file, and
 * baking that choice in here would force one of them through a pointless
 * round trip.
 */
export function renderSticker(img, effectKey, { make, size, width, height, padScale = 1 } = {}) {
  const makeCanvas = make || ((w, h) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  });

  const sw = size || width  || img.naturalWidth  || img.width;
  const sh = size || height || img.naturalHeight || img.height;
  /* ⚠ `padScale` EXISTS FOR THE HARNESS AND NOTHING ELSE — it multiplies the
     band width so the look can be dialled in live at /#/dev/stickers instead
     of by editing this constant and reloading. ⛔ No product surface passes
     it; whatever value settles belongs back in STICKER_EFFECTS.pad. */
  const pad = Math.round(effectPadding(effectKey, Math.max(sw, sh)) * padScale);

  const dim = Math.max(sw, sh) + pad * 2;
  const out = makeCanvas(sw + pad * 2, sh + pad * 2);
  const ctx = out.getContext('2d');
  const x = pad, y = pad;

  if (!isStickerEffect(effectKey) || effectKey === 'NONE') {
    ctx.drawImage(img, x, y, sw, sh);
    return out;
  }

  if (effectKey === 'OUTLINE' || effectKey === 'PUFFY') {
    /* ⛔⛔ THE ORDER IS THE WHOLE THING, AND GETTING IT BACKWARDS IS WHAT MADE
       EVERY EARLIER VERSION A BLOB.

       Dilating the raw artwork first bands EVERY stroke, and on line art those
       bands merge into one solid mass — measured on the hand mark, 13,612 of
       the sticker's pixels were band and only 336 were anything else. No
       amount of filling afterwards can recover a logo the band has swallowed.

       Solidify FIRST, outline SECOND:
         1. the BODY — the artwork plus its own enclosed interior, so the shape
            is "everything inside the logo's overall outline"
         2. the BAND — the body dilated, which can only trace the outer contour
            because a solid body has no interior for a halo to form in
         3. the ARTWORK on top, legible because the body behind it contrasts */

    /* 1 · THE BODY. The artwork's own pockets, filled — ⛔ not the band's. */
    const place = makeCanvas(out.width, out.height);
    place.getContext('2d').drawImage(img, x, y, sw, sh);
    const art = place.getContext('2d').getImageData(0, 0, out.width, out.height);
    const pockets = enclosedRegions(art.data, out.width, out.height);

    const scale = Math.min(1, PROBE_MAX / Math.max(sw, sh));
    const probe = makeCanvas(
      Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)));
    probe.getContext('2d').drawImage(img, 0, 0, probe.width, probe.height);
    const { color: fillColour, artworkIsLight } = contrastFill(
      probe.getContext('2d').getImageData(0, 0, probe.width, probe.height).data);
    const [fr, fg, fb] = hexToRgb(fillColour);

    /* ⭐ FILLED AGAINST THE ARTWORK. A white body under white line art is a
       blank blob — the interior is the ground the logo is read against, so it
       takes the opposite tone. See contrastFill. */
    const ad = art.data;
    for (let i = 0; i < pockets.length; i++) {
      const p = i * 4;
      if (pockets[i] || ad[p + 3] > 8) {
        ad[p] = fr; ad[p + 1] = fg; ad[p + 2] = fb; ad[p + 3] = 255;
      }
    }
    const body = makeCanvas(out.width, out.height);
    body.getContext('2d').putImageData(art, 0, 0);

    /* 2 · THE BAND, around the body. */
    const rim = silhouette(body, out.width, out.height, makeCanvas,
      rimColourFor(artworkIsLight));
    for (const [dx, dy] of dilationOffsets(pad)) {
      ctx.drawImage(rim, dx, dy);
    }
    ctx.drawImage(body, 0, 0);
  }

  if (effectKey === 'PUFFY') {
    /* The lift. A shadow under the white band (not under the artwork) is what
       separates a puffy sticker from a flat one with a border: the band is the
       object, and the object casts. Offset downward only — a centred shadow
       reads as a glow. */
    const mask = silhouette(img, sw, sh, makeCanvas);
    ctx.save();
    ctx.globalCompositeOperation = 'destination-over';
    ctx.shadowColor = 'rgba(0,0,0,0.38)';
    ctx.shadowBlur = Math.max(2, pad * 0.9);
    ctx.shadowOffsetY = Math.max(1, pad * 0.5);
    ctx.drawImage(mask, x, y, sw, sh);
    ctx.restore();
  }

  ctx.drawImage(img, x, y, sw, sh);

  if (effectKey === 'PUFFY') {
    /* Inflation is a LIGHTING cue, not a geometry one: we cannot actually
       dome the artwork, but a soft highlight falling from the top left and a
       matching darkening at the bottom right is the same information the eye
       uses to read a dome. `source-atop` keeps it off the transparent
       background. */
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    const g = ctx.createLinearGradient(0, 0, dim * 0.9, dim);
    g.addColorStop(0.00, 'rgba(255,255,255,0.42)');
    g.addColorStop(0.42, 'rgba(255,255,255,0.06)');
    g.addColorStop(0.72, 'rgba(0,0,0,0.10)');
    g.addColorStop(1.00, 'rgba(0,0,0,0.26)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.restore();
  }

  if (effectKey === 'METALLIC') {
    ctx.save();
    ctx.globalCompositeOperation = 'source-atop';
    // Diagonal, because a vertical ramp reads as a horizon on a flat card
    // while an angled one reads as a curved surface catching a light.
    const g = ctx.createLinearGradient(x, y, x + sw, y + sh);
    for (const s of metallicStops()) g.addColorStop(s.at, s.color);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.restore();
  }

  return out;
}

/* ── loading ───────────────────────────────────────────────────────── */

/**
 * Load artwork in a state the renderer can actually read back.
 *
 * ⛔⛔ `crossOrigin = 'anonymous'` IS NOT OPTIONAL AND MUST BE SET BEFORE `src`.
 * Anything reading pixels back from a canvas that has drawn a cross-origin
 * image without CORS hits a TAINTED canvas — the read throws a SecurityError
 * and the sticker silently fails. Assets come from Supabase storage on another
 * origin, so this is the normal path, not an edge case. Setting the attribute
 * after `src` is too late: the fetch has already begun without the CORS mode.
 */
export function loadStickerImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load that image.'));
    img.src = src;
  });
}
