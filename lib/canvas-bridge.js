const ALIGN = { LEFT: 1, CENTER: 2, RIGHT: 4, TOP: 8, MIDDLE: 16, BOTTOM: 32, BASELINE: 64 };
const ATLAS_SIZE = 512;

/** Adapts path, text and image drawing to a host Canvas 2D context. */
function createCanvasBridge(wx, canvas, context, assets, fontNames) {
  const pictures = new Map();
  const images = [];
  const measurements = new Map();
  const textBlocks = new Map();
  const stateStack = [];
  const sprites = [];
  const spriteTiles = new Map();
  let atlas, atlasContext, atlasX = 0, atlasY = 0, atlasRow = 0;
  let atlasUnavailable = false;
  let current = { size: 14, face: 'sans:normal', paint: null };
  let fontCache = '';

  function font(size, face) {
    const family = face.startsWith('mono') ? 'monospace' : 'sans-serif';
    const weight = /:(bold|[6-9]00)$/.test(face) ? 'bold ' : '';
    const installed = fontNames[face];
    return installed ? `${size}px "${installed}", ${family}` : `${weight}${size}px ${family}`;
  }

  function setFont(value) {
    if (fontCache !== value) context.font = fontCache = value;
  }

  function textWidth(text, css) {
    const key = `${css}\n${text}`;
    if (measurements.has(key)) return measurements.get(key);
    setFont(css);
    const width = context.measureText(text).width;
    if (measurements.size >= 4096) measurements.clear();
    measurements.set(key, width);
    return width;
  }

  function textLayout(text, size, face, maxWidth, wrap) {
    // Reuse measured lines across layout and paint. Include the wrap width in the cache key.
    const css = font(size, face);
    const key = `${css}\n${wrap ? maxWidth : 'nowrap'}\n${text}`;
    if (textBlocks.has(key)) return textBlocks.get(key);
    const lines = [];
    let longest = 0;
    for (const line of text.split('\n')) {
      const width = textWidth(line, css);
      if (!wrap || maxWidth <= 0 || width <= maxWidth) {
        lines.push(line);
        longest = Math.max(longest, width);
        continue;
      }
      let part = '';
      let partWidth = 0;
      for (const character of line) {
        const advance = textWidth(character, css);
        if (partWidth > 0 && partWidth + advance > maxWidth) {
          lines.push(part);
          longest = Math.max(longest, partWidth);
          part = '';
          partWidth = 0;
        }
        part += character;
        partWidth += advance;
      }
      lines.push(part);
      longest = Math.max(longest, partWidth);
    }
    const block = { css, lines, longest, lineHeight: Math.ceil(size * 1.32) };
    if (textBlocks.size >= 1536) textBlocks.clear();
    textBlocks.set(key, block);
    return block;
  }

  function image(path) {
    if (pictures.has(path)) return pictures.get(path).id;
    if (!assets[path]) return 0;
    const img = wx.createImage ? wx.createImage() : canvas.createImage();
    const entry = { id: images.length + 1, img, loaded: false };
    pictures.set(path, entry);
    images.push(entry);
    img.onload = () => { entry.loaded = true; };
    img.onerror = () => { console.warn(`Image could not be loaded: ${path}`); };
    img.src = assets[path];
    return entry.id;
  }

  function clip(x, y, w, h) {
    context.beginPath();
    context.rect(x, y, Math.max(0, w), Math.max(0, h));
    context.clip();
  }

  function color(r, g, b, a) {
    return `rgba(${r | 0},${g | 0},${b | 0},${Math.max(0, Math.min(1, a / 255))})`;
  }

  function registerSprite(width, height, packed) {
    // Each hex-encoded run contains x, y, length, red, green, blue and alpha bytes.
    const spans = new Uint8Array(packed.length / 2);
    for (let i = 0; i < spans.length; i += 1) spans[i] = Number.parseInt(packed.slice(i * 2, i * 2 + 2), 16);
    return sprites.push({ width, height, spans });
  }

  function paintSprite(target, spans, x, y, scale, alpha) {
    for (let i = 0; i < spans.length; i += 7) {
      const left = Math.floor(spans[i] * scale + 0.01);
      const top = Math.floor(spans[i + 1] * scale + 0.01);
      const right = Math.floor((spans[i] + spans[i + 2]) * scale + 0.01);
      const bottom = Math.floor((spans[i + 1] + 1) * scale + 0.01);
      target.fillStyle = color(spans[i + 3], spans[i + 4], spans[i + 5], alpha < 0 ? spans[i + 6] : alpha);
      target.fillRect(x + left, y + top, Math.max(1, right - left), Math.max(1, bottom - top));
    }
  }

  function spriteTile(key, sprite, scale, alpha) {
    if (spriteTiles.has(key)) return spriteTiles.get(key);
    if (!atlas) {
      // WeChat returns an offscreen canvas after the display canvas has been created.
      atlas = wx.createCanvas();
      if (!atlas || atlas === canvas) throw new Error('Offscreen canvas is unavailable');
      atlas.width = atlas.height = ATLAS_SIZE;
      atlasContext = atlas.getContext('2d');
    }
    const w = Math.ceil(sprite.width * scale);
    const h = Math.ceil(sprite.height * scale);
    if (w > ATLAS_SIZE || h > ATLAS_SIZE) return undefined;
    if (atlasX + w > ATLAS_SIZE) {
      atlasX = 0;
      atlasY += atlasRow;
      atlasRow = 0;
    }
    if (atlasY + h > ATLAS_SIZE) {
      // Reclaim the atlas as a unit to keep the offscreen surface bounded.
      spriteTiles.clear();
      atlasContext.clearRect(0, 0, ATLAS_SIZE, ATLAS_SIZE);
      atlasX = atlasY = atlasRow = 0;
    }
    const tile = { x: atlasX, y: atlasY, w, h };
    paintSprite(atlasContext, sprite.spans, tile.x, tile.y, scale, alpha);
    spriteTiles.set(key, tile);
    atlasX += w;
    atlasRow = Math.max(atlasRow, h);
    return tile;
  }

  function drawSprite(id, x, y, size, alpha) {
    const sprite = sprites[id - 1];
    const scale = Math.max(1, size / sprite.width);
    current.paint = null;
    if (!atlasUnavailable) {
      try {
        const tile = spriteTile(`${id}:${scale}:${alpha}`, sprite, scale, alpha);
        if (tile) {
          context.drawImage(atlas, tile.x, tile.y, tile.w, tile.h, x, y, tile.w, tile.h);
          return;
        }
      } catch (error) {
        atlasUnavailable = true;
        spriteTiles.clear();
        atlas = atlasContext = undefined;
      }
    }
    paintSprite(context, sprite.spans, x, y, scale, alpha);
  }

  return {
    align: ALIGN,
    color,
    registerSprite,
    drawSprite,
    resetFont() { fontCache = ''; },
    measureBlock(text, size, face, maxWidth, wrap) {
      const block = textLayout(text, size, face, maxWidth ?? 0, wrap);
      return [block.longest, block.lines.length * block.lineHeight];
    },
    drawTextBlock(text, size, face, wrap, align, fill, x, y, w, h, left, top, right, bottom) {
      if (align !== 'center' && align !== 'right') align = 'left';
      const block = textLayout(text, size, face, w - left - right, wrap);
      const blockHeight = block.lines.length * block.lineHeight;
      const textX = align === 'center' ? x + w / 2 : align === 'right' ? x + w - right : x + left;
      let textY = y + top + Math.max(0, (h - top - bottom - blockHeight) / 2) + block.lineHeight / 2;
      const previousFont = fontCache;
      context.save();
      clip(x, y, w, h);
      setFont(block.css);
      context.fillStyle = fill;
      context.textAlign = align;
      context.textBaseline = 'middle';
      for (const line of block.lines) {
        context.fillText(line, textX, textY);
        textY += block.lineHeight;
      }
      context.restore();
      fontCache = previousFont;
    },
    begin(scale, pixelRatio, clear) {
      context.setTransform(1, 0, 0, 1, 0, 0);
      if (clear) context.clearRect(0, 0, canvas.width, canvas.height);
      context.setTransform(scale * pixelRatio, 0, 0, scale * pixelRatio, 0, 0);
      current = { size: 14, face: 'sans:normal', paint: null };
      context.textAlign = 'left';
      context.textBaseline = 'alphabetic';
      context.imageSmoothingEnabled = false;
    },
    measure(text, size, face) {
      return textWidth(text, font(size, face));
    },
    commands: {
      BeginPath: () => context.beginPath(),
      ClosePath: () => context.closePath(),
      Rect: (x, y, w, h) => context.rect(x, y, w, h),
      MoveTo: (x, y) => context.moveTo(x, y),
      LineTo: (x, y) => context.lineTo(x, y),
      Translate: (x, y) => context.translate(x, y),
      Save() {
        // Preserve bridge-only paint and font settings alongside the native context state.
        stateStack.push({ ...current });
        context.save();
      },
      Restore() {
        if (!stateStack.length) return;
        current = stateStack.pop();
        context.restore();
        fontCache = '';
      },
      IntersectScissor: clip,
      FillColor(fill) {
        current.paint = null;
        context.fillStyle = fill;
      },
      FillRect(x, y, w, h, fill) {
        current.paint = null;
        context.fillStyle = fill;
        context.fillRect(x, y, w, h);
      },
      BeveledRect(x, y, w, h, bevel, fill, highlight, shadow) {
        current.paint = null;
        context.fillStyle = fill;
        context.fillRect(x, y, w, h);
        if (bevel === 0) return;
        context.fillStyle = highlight;
        context.fillRect(x, y, w, bevel);
        context.fillRect(x, y + bevel, bevel, h - bevel);
        context.fillStyle = shadow;
        context.fillRect(x + bevel, y + h - bevel, w - bevel, bevel);
        context.fillRect(x + w - bevel, y + bevel, bevel, h - 2 * bevel);
      },
      StrokeRect(x, y, w, h, strokeWidth, stroke) {
        context.lineWidth = strokeWidth;
        context.strokeStyle = stroke;
        context.strokeRect(x, y, w, h);
      },
      StrokeColor: (value) => { context.strokeStyle = value; },
      StrokeWidth: (value) => { context.lineWidth = value; },
      Stroke: () => context.stroke(),
      LinearGradient: (x1, y1, x2, y2, from, to) => {
        const gradient = context.createLinearGradient(x1, y1, x2, y2);
        gradient.addColorStop(0, from);
        gradient.addColorStop(1, to);
        return { gradient };
      },
      ImagePattern: (x, y, w, h, angle, id, alpha) => ({ x, y, w, h, angle, id, alpha }),
      FillPaint(paint) {
        current.paint = paint;
        if (paint.gradient) context.fillStyle = paint.gradient;
      },
      Fill() {
        const paint = current.paint;
        if (!paint || paint.gradient) {
          context.fill();
          return;
        }
        const entry = images[paint.id - 1];
        if (!entry || !entry.loaded || paint.w <= 0 || paint.h <= 0) return;
        context.save();
        context.clip();
        context.globalAlpha = paint.alpha;
        context.imageSmoothingEnabled = false;
        context.drawImage(entry.img, paint.x, paint.y, paint.w, paint.h);
        context.restore();
      },
      FontSize: (size) => { current.size = size; },
      FontFace: (face) => { current.face = face; },
      TextAlign(flags) {
        context.textAlign = flags & ALIGN.CENTER ? 'center' : flags & ALIGN.RIGHT ? 'right' : 'left';
        context.textBaseline = flags & ALIGN.MIDDLE ? 'middle' : flags & ALIGN.TOP ? 'top' : flags & ALIGN.BOTTOM ? 'bottom' : 'alphabetic';
      },
      Text(x, y, text) {
        setFont(font(current.size, current.face));
        context.fillText(text, x, y);
      },
      CreateImage: image,
      ImageSize(id) {
        const entry = images[id - 1];
        return entry && entry.loaded ? [entry.img.width, entry.img.height] : [0, 0];
      },
    },
  };
}

module.exports = { createCanvasBridge };
