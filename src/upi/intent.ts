import { UpiUriParams, IntentLinksResult } from './types.js';
import { UpiUriBuilder } from './uri-builder.js';

export class UpiIntentBuilder {
  /**
   * Generates app-specific deep links for direct mobile UPI apps
   */
  public static generateLinks(params: UpiUriParams): IntentLinksResult {
    // Force mode to 04 (Intent) if not explicitly set
    const intentParams: UpiUriParams = {
      ...params,
      mode: params.mode || '04',
    };

    const genericUpiUri = UpiUriBuilder.build(intentParams);
    const queryString = genericUpiUri.replace('upi://pay?', '');

    const numericAmount =
      typeof params.am === 'string' ? parseFloat(params.am) : params.am;

    return {
      genericUpiUri,
      gpayUri: `tez://upi/pay?${queryString}`,
      phonepeUri: `phonepe://pay?${queryString}`,
      paytmUri: `paytmmp://pay?${queryString}`,
      credUri: `cred://upi/pay?${queryString}`,
      bhimUri: `bhim://pay?${queryString}`,
      webIntentUrl: `intent://pay?${queryString}#Intent;scheme=upi;package=com.google.android.apps.nbu.paisa.user;end`,
      transactionRef: params.tr,
      amount: numericAmount,
    };
  }
}
