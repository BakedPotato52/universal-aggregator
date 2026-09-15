import { UpiUriParams } from './types.js';

export class UpiUriBuilder {
  /**
   * Builds an NPCI-compliant UPI URI (upi://pay?...)
   * Standard spec: https://www.npci.org.in/what-we-do/upi/product-overview
   */
  public static build(params: UpiUriParams): string {
    if (!params.pa) {
      throw new Error('Payee VPA (pa) is mandatory for UPI URI');
    }
    if (!params.pn) {
      throw new Error('Payee Name (pn) is mandatory for UPI URI');
    }
    if (!params.tr) {
      throw new Error('Transaction Reference ID (tr) is mandatory for UPI URI');
    }
    if (params.am === undefined || params.am === null) {
      throw new Error('Amount (am) is mandatory for UPI URI');
    }

    const numericAmount = typeof params.am === 'string' ? parseFloat(params.am) : params.am;
    if (isNaN(numericAmount) || numericAmount <= 0) {
      throw new Error(`Invalid payment amount: ${params.am}. Amount must be greater than 0.`);
    }

    const formattedAmount = numericAmount.toFixed(2);
    const queryParts: string[] = [];

    // Mandatory NPCI fields
    queryParts.push(`pa=${encodeURIComponent(params.pa.trim())}`);
    queryParts.push(`pn=${encodeURIComponent(params.pn.trim())}`);
    queryParts.push(`tr=${encodeURIComponent(params.tr.trim())}`);
    queryParts.push(`am=${formattedAmount}`);
    queryParts.push(`cu=${params.cu || 'INR'}`);

    // Optional / Contextual fields
    if (params.mc) {
      queryParts.push(`mc=${encodeURIComponent(params.mc.trim())}`);
    }
    if (params.tn) {
      queryParts.push(`tn=${encodeURIComponent(params.tn.trim())}`);
    }
    if (params.mode) {
      queryParts.push(`mode=${params.mode}`);
    } else {
      queryParts.push(`mode=02`); // Default: Dynamic QR
    }
    if (params.tid) {
      queryParts.push(`tid=${encodeURIComponent(params.tid.trim())}`);
    }
    if (params.orgid) {
      queryParts.push(`orgid=${encodeURIComponent(params.orgid.trim())}`);
    }
    if (params.url) {
      queryParts.push(`url=${encodeURIComponent(params.url.trim())}`);
    }
    if (params.mam !== undefined && params.mam !== null) {
      const minAmount = typeof params.mam === 'string' ? parseFloat(params.mam) : params.mam;
      queryParts.push(`mam=${minAmount.toFixed(2)}`);
    }
    if (params.sign) {
      queryParts.push(`sign=${encodeURIComponent(params.sign.trim())}`);
    }

    return `upi://pay?${queryParts.join('&')}`;
  }

  /**
   * Parse an existing UPI URI into structured parameters
   */
  public static parse(uri: string): UpiUriParams {
    if (!uri.startsWith('upi://pay?')) {
      throw new Error('Invalid UPI URI: Scheme must start with "upi://pay?"');
    }

    const queryString = uri.replace('upi://pay?', '');
    const urlParams = new URLSearchParams(queryString);

    const pa = urlParams.get('pa') || '';
    const pn = urlParams.get('pn') || '';
    const tr = urlParams.get('tr') || '';
    const am = urlParams.get('am') || '0';

    return {
      pa,
      pn,
      tr,
      am,
      mc: urlParams.get('mc') || undefined,
      tn: urlParams.get('tn') || undefined,
      cu: (urlParams.get('cu') as 'INR') || 'INR',
      mode: (urlParams.get('mode') as '00' | '01' | '02' | '04') || undefined,
      tid: urlParams.get('tid') || undefined,
      orgid: urlParams.get('orgid') || undefined,
      url: urlParams.get('url') || undefined,
      mam: urlParams.get('mam') || undefined,
      sign: urlParams.get('sign') || undefined,
    };
  }
}
