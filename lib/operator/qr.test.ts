import jsQR from "jsqr";
import { PNG } from "pngjs";
import { describe, expect, test } from "vitest";
import { QR_IMAGE_SIZE_PX, QR_QUIET_ZONE_MODULES, renderQrPng } from "./qr";

const URL = "https://virtual-queue-system.netlify.app/s/kedai-ali";

function decode(png: Buffer) {
  const image = PNG.sync.read(png);
  const pixels = new Uint8ClampedArray(image.data.buffer, image.data.byteOffset, image.data.length);
  return { image, code: jsQR(pixels, image.width, image.height) };
}

/** Whether every pixel in the rectangle is white. */
function allWhite(image: PNG, x0: number, y0: number, x1: number, y1: number) {
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (image.data[(y * image.width + x) * 4] !== 255) return false;
    }
  }
  return true;
}

describe("renderQrPng", () => {
  test("is a 1024×1024 PNG", () => {
    const { image } = decode(renderQrPng(URL));

    expect([image.width, image.height]).toEqual([QR_IMAGE_SIZE_PX, QR_IMAGE_SIZE_PX]);
  });

  test("stays 1024×1024 whatever the symbol's version", () => {
    // Longer slugs need bigger symbols, whose module counts do not divide 1024.
    for (const slug of ["abc", "kedai-gunting-rambut-ali-bandar-baru-bangi", "a".repeat(40)]) {
      const { image } = decode(renderQrPng(`https://virtual-queue-system.netlify.app/s/${slug}`));
      expect([image.width, image.height]).toEqual([QR_IMAGE_SIZE_PX, QR_IMAGE_SIZE_PX]);
    }
  });

  test("scans back to the URL it was given", () => {
    const { code } = decode(renderQrPng(URL));

    expect(code?.data).toBe(URL);
  });

  test("uses error correction level M", () => {
    // The 52-byte URL needs version 3 at L, 4 at M, 5 at Q and 6 at H, so the
    // version the scanner reports tells the levels apart.
    const { code } = decode(renderQrPng(URL));

    expect(code?.version).toBe(4);
  });

  test("leaves a quiet zone of 4 modules around the symbol", () => {
    const { image, code } = decode(renderQrPng(URL));
    // Version 4 is 33 modules; with 4 either side that is 41 cells across 1024 px,
    // so the symbol occupies cells 4 to 36 and the pixels those cells start at.
    expect(code?.version).toBe(4);
    const cells = 33 + 2 * QR_QUIET_ZONE_MODULES;
    const pxOf = (cell: number) => Math.ceil((cell * QR_IMAGE_SIZE_PX) / cells);
    const [start, end] = [pxOf(QR_QUIET_ZONE_MODULES), pxOf(cells - QR_QUIET_ZONE_MODULES)];
    const size = QR_IMAGE_SIZE_PX;

    expect(allWhite(image, 0, 0, size, start)).toBe(true);
    expect(allWhite(image, 0, 0, start, size)).toBe(true);
    expect(allWhite(image, end, 0, size, size)).toBe(true);
    expect(allWhite(image, 0, end, size, size)).toBe(true);
    // ...and the finder pattern begins on the very next pixel.
    expect(image.data[(start * size + start) * 4]).toBe(0);
  });
});
