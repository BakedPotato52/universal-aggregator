export class UpiValidator {
  private static readonly VPA_REGEX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9.\-_]{2,64}$/;

  /** List of well-known NPCI approved bank / PSP handles */
  public static readonly COMMON_PSP_HANDLES = new Set([
    'okhdfcbank',
    'okicici',
    'okaxis',
    'oksbi',
    'paytm',
    'ybl',
    'ibl',
    'axl',
    'upi',
    'postbank',
    'federal',
    'kotak',
    'indus',
    'barodampay',
    'aubank',
    'idfcbank',
    'hsbc',
    'citi',
    'pnb',
    'cnrb',
  ]);

  /**
   * Validates if a string is a valid UPI Virtual Payment Address (VPA)
   */
  public static isValidVpa(vpa: string): boolean {
    if (!vpa || typeof vpa !== 'string') return false;
    const trimmed = vpa.trim().toLowerCase();
    return this.VPA_REGEX.test(trimmed);
  }

  /**
   * Extract username and handle from a VPA
   */
  public static parseVpa(vpa: string): { username: string; handle: string } | null {
    if (!this.isValidVpa(vpa)) return null;
    const parts = vpa.trim().toLowerCase().split('@');
    return {
      username: parts[0],
      handle: parts[1],
    };
  }

  /**
   * Checks if the handle belongs to a verified popular PSP
   */
  public static isRecognizedHandle(handle: string): boolean {
    return this.COMMON_PSP_HANDLES.has(handle.toLowerCase());
  }
}
