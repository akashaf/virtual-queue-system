import { PNG } from "pngjs";
import { create as createQrCode } from "qrcode";

/** The poster size backend.md §8 promises the Operator: 1024×1024 pixels. */
export const QR_IMAGE_SIZE_PX = 1024;

/** The blank border a scanner needs to find the symbol: 4 modules per the QR spec. */
export const QR_QUIET_ZONE_MODULES = 4;

/**
 * The PNG bytes of the poster QR code for `url`.
 *
 * Every pixel is mapped onto the module grid by integer arithmetic, so the image
 * is exactly 1024×1024 whatever the symbol's version. `qrcode`'s own `width`
 * option floors a fractional scale and can come out a pixel short, and a module
 * that is 22 px in one column and 23 px in the next scans just as well as a
 * uniform one.
 *
 * Error correction M: the poster is printed once and lives on a shop wall, so it
 * should survive some wear without growing so dense that a phone across the
 * counter struggles with it.
 */
export function renderQrPng(url: string): Buffer {
  const { modules } = createQrCode(url, { errorCorrectionLevel: "M" });
  const cells = modules.size + 2 * QR_QUIET_ZONE_MODULES;

  // Which module each pixel row (and column) falls in; negative or past the end
  // means the quiet zone.
  const moduleAt = Array.from(
    { length: QR_IMAGE_SIZE_PX },
    (_, px) => Math.floor((px * cells) / QR_IMAGE_SIZE_PX) - QR_QUIET_ZONE_MODULES,
  );
  const inSymbol = (m: number) => m >= 0 && m < modules.size;

  const png = new PNG({ width: QR_IMAGE_SIZE_PX, height: QR_IMAGE_SIZE_PX });
  let offset = 0;
  for (let y = 0; y < QR_IMAGE_SIZE_PX; y++) {
    const row = moduleAt[y];
    for (let x = 0; x < QR_IMAGE_SIZE_PX; x++) {
      const col = moduleAt[x];
      const dark = inSymbol(row) && inSymbol(col) && modules.get(row, col) === 1;
      const shade = dark ? 0 : 255;
      png.data[offset++] = shade;
      png.data[offset++] = shade;
      png.data[offset++] = shade;
      png.data[offset++] = 255;
    }
  }

  // Greyscale on disk: the same picture at a quarter of the bytes.
  return PNG.sync.write(png, { colorType: 0 });
}
