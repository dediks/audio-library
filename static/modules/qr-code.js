/**
 * SWARARIA AUDIO LAB - Offline ISO/IEC 18004 QR Code Canvas Renderer
 * Zero external dependencies, 100% offline-capable for FOH Stage Hotspots/LAN.
 * Supports Byte-mode QR Code Versions 1-6 (ECC Level L, up to 134 bytes).
 */

const VERSION_SPECS_L = [
  null,
  { size: 21, dataCodewords: 19, ecCodewordsPerBlock: 7, numBlocks: 1, align: [] },
  { size: 25, dataCodewords: 34, ecCodewordsPerBlock: 10, numBlocks: 1, align: [6, 18] },
  { size: 29, dataCodewords: 55, ecCodewordsPerBlock: 15, numBlocks: 1, align: [6, 22] },
  { size: 33, dataCodewords: 80, ecCodewordsPerBlock: 20, numBlocks: 1, align: [6, 26] },
  { size: 37, dataCodewords: 108, ecCodewordsPerBlock: 26, numBlocks: 1, align: [6, 30] },
  { size: 41, dataCodewords: 136, ecCodewordsPerBlock: 18, numBlocks: 2, align: [6, 34] },
];

function gfMultiply(x, y) {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < degree; j++) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) {
        result[j] ^= result[j + 1];
      }
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length);
  for (let i = 0; i < data.length; i++) {
    const factor = data[i] ^ result[0];
    result.copyWithin(0, 1);
    result[divisor.length - 1] = 0;
    for (let j = 0; j < divisor.length; j++) {
      result[j] ^= gfMultiply(divisor[j], factor);
    }
  }
  return result;
}

function encodeDataCodewords(text) {
  const utf8Bytes = new TextEncoder().encode(String(text || ''));
  let version = 1;
  while (
    version <= 6 &&
    utf8Bytes.length + 2 > VERSION_SPECS_L[version].dataCodewords
  ) {
    version++;
  }
  if (version > 6) {
    throw new Error('QR payload exceeds Version 6 capacity.');
  }

  const spec = VERSION_SPECS_L[version];
  const capacityBits = spec.dataCodewords * 8;
  const bits = [];

  function appendBits(val, len) {
    for (let i = len - 1; i >= 0; i--) {
      bits.push((val >>> i) & 1);
    }
  }

  // Byte mode indicator (0100) + 8-bit character count
  appendBits(0b0100, 4);
  appendBits(utf8Bytes.length, 8);
  for (let i = 0; i < utf8Bytes.length; i++) {
    appendBits(utf8Bytes[i], 8);
  }

  // Terminator (up to 4 zero bits)
  appendBits(0, Math.min(4, capacityBits - bits.length));

  // Pad to byte boundary
  appendBits(0, (8 - (bits.length % 8)) % 8);

  // Pad alternating 0xEC and 0x11
  for (let padByte = 0xec; bits.length < capacityBits; padByte ^= 0xec ^ 0x11) {
    appendBits(padByte, 8);
  }

  const dataBytes = new Uint8Array(spec.dataCodewords);
  for (let i = 0; i < bits.length; i++) {
    dataBytes[i >>> 3] |= bits[i] << (7 - (i & 7));
  }

  const divisor = rsDivisor(spec.ecCodewordsPerBlock);
  if (spec.numBlocks === 1) {
    const ec = rsRemainder(dataBytes, divisor);
    const full = new Uint8Array(spec.dataCodewords + spec.ecCodewordsPerBlock);
    full.set(dataBytes, 0);
    full.set(ec, spec.dataCodewords);
    return { version, spec, codewords: full };
  }

  // Interleave 2 equal blocks (Version 6-L: 2 blocks of 68 data + 18 EC codewords)
  const blockLen = spec.dataCodewords / 2;
  const block0 = dataBytes.subarray(0, blockLen);
  const block1 = dataBytes.subarray(blockLen, spec.dataCodewords);
  const ec0 = rsRemainder(block0, divisor);
  const ec1 = rsRemainder(block1, divisor);

  const interleaved = new Uint8Array(spec.dataCodewords + spec.ecCodewordsPerBlock * 2);
  let pos = 0;
  for (let i = 0; i < blockLen; i++) {
    interleaved[pos++] = block0[i];
    interleaved[pos++] = block1[i];
  }
  for (let i = 0; i < spec.ecCodewordsPerBlock; i++) {
    interleaved[pos++] = ec0[i];
    interleaved[pos++] = ec1[i];
  }
  return { version, spec, codewords: interleaved };
}

function shouldInvertMask(mask, r, c) {
  switch (mask) {
    case 0:
      return (r + c) % 2 === 0;
    case 1:
      return r % 2 === 0;
    case 2:
      return c % 3 === 0;
    case 3:
      return (r + c) % 3 === 0;
    case 4:
      return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
    case 5:
      return ((r * c) % 2) + ((r * c) % 3) === 0;
    case 6:
      return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
    case 7:
      return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
    default:
      return false;
  }
}

function computePenaltyScore(modules, size) {
  let penalty = 0;

  // Rule 1: 5+ consecutive same-color modules in row or col
  for (let r = 0; r < size; r++) {
    let runColor = modules[r][0];
    let runLen = 1;
    for (let c = 1; c < size; c++) {
      if (modules[r][c] === runColor) {
        runLen++;
        if (runLen === 5) penalty += 3;
        else if (runLen > 5) penalty += 1;
      } else {
        runColor = modules[r][c];
        runLen = 1;
      }
    }
  }
  for (let c = 0; c < size; c++) {
    let runColor = modules[0][c];
    let runLen = 1;
    for (let r = 1; r < size; r++) {
      if (modules[r][c] === runColor) {
        runLen++;
        if (runLen === 5) penalty += 3;
        else if (runLen > 5) penalty += 1;
      } else {
        runColor = modules[r][c];
        runLen = 1;
      }
    }
  }

  // Rule 2: 2x2 blocks of same color
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const color = modules[r][c];
      if (
        color === modules[r][c + 1] &&
        color === modules[r + 1][c] &&
        color === modules[r + 1][c + 1]
      ) {
        penalty += 3;
      }
    }
  }
  return penalty;
}

export function generateQrMatrix(text) {
  const { version, spec, codewords } = encodeDataCodewords(text);
  const size = spec.size;

  const modules = Array.from({ length: size }, () => Array(size).fill(false));
  const isFunction = Array.from({ length: size }, () => Array(size).fill(false));

  function setFunctionModule(r, c, isDark) {
    if (r < 0 || r >= size || c < 0 || c >= size) return;
    modules[r][c] = Boolean(isDark);
    isFunction[r][c] = true;
  }

  // Finder pattern + 1-module white separator (top-left at (r, c))
  function drawFinderPattern(topR, leftC) {
    for (let dr = -1; dr <= 7; dr++) {
      for (let dc = -1; dc <= 7; dc++) {
        const r = topR + dr;
        const c = leftC + dc;
        if (r < 0 || r >= size || c < 0 || c >= size) continue;
        const inOuter =
          dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6 &&
          (dr === 0 || dr === 6 || dc === 0 || dc === 6);
        const inInner = dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4;
        setFunctionModule(r, c, inOuter || inInner);
      }
    }
  }

  drawFinderPattern(0, 0);
  drawFinderPattern(0, size - 7);
  drawFinderPattern(size - 7, 0);

  // Timing patterns
  for (let i = 0; i < size; i++) {
    if (!isFunction[6][i]) setFunctionModule(6, i, i % 2 === 0);
    if (!isFunction[i][6]) setFunctionModule(i, 6, i % 2 === 0);
  }

  // Alignment patterns (Versions 2-6 have single non-overlapping center at (size-7, size-7))
  if (spec.align.length >= 2) {
    const centerR = spec.align[1];
    const centerC = spec.align[1];
    for (let dr = -2; dr <= 2; dr++) {
      for (let dc = -2; dc <= 2; dc++) {
        const dist = Math.max(Math.abs(dr), Math.abs(dc));
        setFunctionModule(centerR + dr, centerC + dc, dist !== 1);
      }
    }
  }

  // Dark module
  setFunctionModule(4 * version + 9, 8, true);

  // Reserve Format Info slots
  function drawFormatBits(mask) {
    // ECC Level L = 0b01
    const data = (0b01 << 3) | mask;
    let rem = data;
    for (let i = 0; i < 10; i++) {
      rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    }
    const bits = ((data << 10) | rem) ^ 0x5412;
    const getBit = idx => ((bits >>> idx) & 1) !== 0;

    // Copy 1 (Top-Left)
    for (let i = 0; i <= 5; i++) setFunctionModule(i, 8, getBit(i));
    setFunctionModule(7, 8, getBit(6));
    setFunctionModule(8, 8, getBit(7));
    setFunctionModule(8, 7, getBit(8));
    for (let i = 9; i < 15; i++) setFunctionModule(8, 14 - i, getBit(i));

    // Copy 2 (Top-Right & Bottom-Left)
    for (let i = 0; i < 8; i++) setFunctionModule(8, size - 1 - i, getBit(i));
    for (let i = 8; i < 15; i++) setFunctionModule(size - 15 + i, 8, getBit(i));
  }

  // Reserve format module positions before placing data
  drawFormatBits(0);

  // Place data & ECC codewords in zig-zag order
  let bitIdx = 0;
  const totalBits = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const col = right - j;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vert : vert;
        if (!isFunction[row][col] && bitIdx < totalBits) {
          modules[row][col] =
            ((codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1) !== 0;
          bitIdx++;
        }
      }
    }
  }

  // Evaluate all 8 masks and pick the lowest penalty score
  let bestMask = 0;
  let bestPenalty = Infinity;
  let bestMatrix = null;

  for (let mask = 0; mask < 8; mask++) {
    drawFormatBits(mask);
    const candidate = modules.map((rowArr, r) =>
      rowArr.map((val, c) =>
        !isFunction[r][c] && shouldInvertMask(mask, r, c) ? !val : val
      )
    );
    const score = computePenaltyScore(candidate, size);
    if (score < bestPenalty) {
      bestPenalty = score;
      bestMask = mask;
      bestMatrix = candidate;
    }
  }

  return { size, version, mask: bestMask, modules: bestMatrix };
}

export function renderQrToCanvas(canvasEl, text, opts = {}) {
  if (!canvasEl || !text) return false;
  const ctx = canvasEl.getContext('2d');
  if (!ctx) return false;

  try {
    const { size, modules } = generateQrMatrix(text);
    const quietZone = typeof opts.margin === 'number' ? opts.margin : 3;
    const totalModules = size + quietZone * 2;
    const targetPx = typeof opts.sizePx === 'number' ? opts.sizePx : 188;
    const scale = Math.max(3, Math.floor(targetPx / totalModules));
    const actualPx = totalModules * scale;

    canvasEl.width = actualPx;
    canvasEl.height = actualPx;

    ctx.fillStyle = opts.lightColor || '#ffffff';
    ctx.fillRect(0, 0, actualPx, actualPx);

    ctx.fillStyle = opts.darkColor || '#0b0e14';
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        if (modules[r][c]) {
          ctx.fillRect(
            (c + quietZone) * scale,
            (r + quietZone) * scale,
            scale,
            scale
          );
        }
      }
    }
    return true;
  } catch (_err) {
    return false;
  }
}

