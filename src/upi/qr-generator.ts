import QRCode from 'qrcode';
import { DynamicQrOptions, DynamicQrResult } from './types.js';
import { UpiUriBuilder } from './uri-builder.js';

export class UpiQrGenerator {
  /**
   * Generate dynamic QR code in multiple formats (PNG Data URL, SVG, ASCII)
   */
  public static async generate(options: DynamicQrOptions): Promise<DynamicQrResult> {
    const rawUri = UpiUriBuilder.build(options.params);

    const qrSize = options.size || 300;
    const errorCorrectionLevel = options.errorCorrectionLevel || 'M';
    const margin = options.margin !== undefined ? options.margin : 2;
    const darkColor = options.color?.dark || '#000000';
    const lightColor = options.color?.light || '#ffffff';

    // 1. Generate PNG Data URL (Base64)
    const qrDataUrl = await QRCode.toDataURL(rawUri, {
      width: qrSize,
      errorCorrectionLevel,
      margin,
      color: {
        dark: darkColor,
        light: lightColor,
      },
    });

    // 2. Generate SVG String
    const qrSvg = await QRCode.toString(rawUri, {
      type: 'svg',
      width: qrSize,
      errorCorrectionLevel,
      margin,
      color: {
        dark: darkColor,
        light: lightColor,
      },
    });

    // 3. Generate Terminal ASCII representation
    const qrAscii = await QRCode.toString(rawUri, {
      type: 'terminal',
      small: true,
    });

    const numericAmount =
      typeof options.params.am === 'string'
        ? parseFloat(options.params.am)
        : options.params.am;

    // Default expiration: 15 minutes from now
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

    return {
      rawUri,
      qrDataUrl,
      qrSvg,
      qrAscii,
      transactionRef: options.params.tr,
      payeeVpa: options.params.pa,
      amount: numericAmount,
      currency: 'INR',
      expiresAt,
    };
  }
}
