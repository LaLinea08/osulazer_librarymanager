const { mkdirSync, writeFileSync } = require("node:fs");
const { dirname, resolve } = require("node:path");
const { deflateSync } = require("node:zlib");

const size = 512;
const pixels = Buffer.alloc(size * size * 4);

const clamp = (value, low = 0, high = 1) =>
  Math.max(low, Math.min(high, value));
const mix = (left, right, amount) => left + (right - left) * amount;
const smoothCoverage = (distance, feather = 1.25) =>
  clamp(0.5 - distance / feather);

function composite(index, red, green, blue, alpha) {
  const sourceAlpha = clamp(alpha);
  const destinationAlpha = pixels[index + 3] / 255;
  const outputAlpha = sourceAlpha + destinationAlpha * (1 - sourceAlpha);
  if (outputAlpha === 0) return;
  pixels[index] = Math.round(
    (red * sourceAlpha + pixels[index] * destinationAlpha * (1 - sourceAlpha)) /
      outputAlpha,
  );
  pixels[index + 1] = Math.round(
    (green * sourceAlpha +
      pixels[index + 1] * destinationAlpha * (1 - sourceAlpha)) /
      outputAlpha,
  );
  pixels[index + 2] = Math.round(
    (blue * sourceAlpha +
      pixels[index + 2] * destinationAlpha * (1 - sourceAlpha)) /
      outputAlpha,
  );
  pixels[index + 3] = Math.round(outputAlpha * 255);
}

function roundedRectDistance(x, y, centerX, centerY, width, height, radius) {
  const qx = Math.abs(x - centerX) - width / 2 + radius;
  const qy = Math.abs(y - centerY) - height / 2 + radius;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) +
    Math.min(Math.max(qx, qy), 0) -
    radius
  );
}

function segmentDistance(x, y, startX, startY, endX, endY) {
  const dx = endX - startX;
  const dy = endY - startY;
  const amount = clamp(
    ((x - startX) * dx + (y - startY) * dy) / (dx * dx + dy * dy),
  );
  return Math.hypot(
    x - mix(startX, endX, amount),
    y - mix(startY, endY, amount),
  );
}

for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    const index = (y * size + x) * 4;
    const shellDistance = roundedRectDistance(
      x + 0.5,
      y + 0.5,
      256,
      256,
      480,
      480,
      112,
    );
    const shell = smoothCoverage(shellDistance);
    if (shell <= 0) continue;

    const backgroundAmount = clamp((x * 0.38 + y * 0.62 - 16) / 480);
    const red = mix(27, 9, backgroundAmount);
    const green = mix(30, 10, backgroundAmount);
    const blue = mix(42, 15, backgroundAmount);
    composite(index, red, green, blue, shell);

    const topGlow =
      Math.exp(-Math.hypot(x - 360, y - 148) / 155) * 0.19 * shell;
    composite(index, 255, 95, 159, topGlow);

    const border = smoothCoverage(Math.abs(shellDistance + 2) - 1.5);
    composite(index, 255, 255, 255, border * 0.08);

    const radius = Math.hypot(x - 256, y - 256);
    const ringGlow = Math.exp(-Math.pow((radius - 145) / 18, 2)) * 0.19;
    composite(index, 255, 95, 159, ringGlow * shell);

    const ring = smoothCoverage(Math.abs(radius - 145) - 12);
    const ringAmount = clamp((x + y - 190) / 650);
    composite(
      index,
      mix(255, 173, ringAmount),
      mix(133, 92, ringAmount),
      mix(188, 255, ringAmount),
      ring * shell,
    );

    const innerRing = smoothCoverage(Math.abs(radius - 112) - 1);
    composite(index, 255, 255, 255, innerRing * 0.075 * shell);

    const beamDistance = segmentDistance(x, y, 159, 340, 355, 177);
    const beam = smoothCoverage(beamDistance - 11);
    const beamAmount = clamp((x + y - 330) / 260);
    composite(
      index,
      mix(255, 190, beamAmount),
      mix(95, 92, beamAmount),
      mix(159, 255, beamAmount),
      beam * shell,
    );

    const highlight = smoothCoverage(
      segmentDistance(x, y, 177, 356, 372, 193) - 2,
    );
    composite(index, 255, 255, 255, highlight * 0.17 * shell);

    const dotDistance = Math.hypot(x - 389, y - 369);
    const dotGlow = Math.exp(-Math.pow(dotDistance / 31, 2)) * 0.32;
    composite(index, 255, 255, 255, dotGlow * shell);
    composite(index, 255, 255, 255, smoothCoverage(dotDistance - 19) * shell);
    composite(index, 255, 228, 240, smoothCoverage(dotDistance - 8) * shell);
  }
}

const crcTable = new Uint32Array(256);
for (let number = 0; number < 256; number += 1) {
  let current = number;
  for (let bit = 0; bit < 8; bit += 1) {
    current =
      (current & 1) === 1 ? 0xedb88320 ^ (current >>> 1) : current >>> 1;
  }
  crcTable[number] = current >>> 0;
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data = Buffer.alloc(0)) {
  const name = Buffer.from(type, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(size, 0);
header.writeUInt32BE(size, 4);
header[8] = 8;
header[9] = 6;

const rows = Buffer.alloc((size * 4 + 1) * size);
for (let y = 0; y < size; y += 1) {
  const rowStart = y * (size * 4 + 1);
  rows[rowStart] = 0;
  pixels.copy(rows, rowStart + 1, y * size * 4, (y + 1) * size * 4);
}

const destination = resolve("build", "icon.png");
const png = Buffer.concat([
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(rows, { level: 9 })),
  chunk("IEND"),
]);
mkdirSync(dirname(destination), { recursive: true });
writeFileSync(destination, png);
console.log(`Generated ${destination} (${size}x${size}, ${png.length} bytes)`);
