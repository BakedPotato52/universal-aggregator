import { BankCode } from '../core/types.js';
import { IBankAdapter } from './base.adapter.js';
import { MockBankAdapter } from './mock/mock.adapter.js';
import { HdfcBankAdapter } from './hdfc/hdfc.adapter.js';
import { IciciBankAdapter } from './icici/icici.adapter.js';
import { AxisBankAdapter } from './axis/axis.adapter.js';

export class BankAdapterRegistry {
  private static adapters: Map<BankCode, IBankAdapter> = new Map();

  static {
    this.register(new MockBankAdapter());
    this.register(new HdfcBankAdapter());
    this.register(new IciciBankAdapter());
    this.register(new AxisBankAdapter());
  }

  public static register(adapter: IBankAdapter): void {
    this.adapters.set(adapter.bankCode, adapter);
  }

  public static get(bankCode: BankCode): IBankAdapter {
    const adapter = this.adapters.get(bankCode);
    if (!adapter) {
      throw new Error(`Bank adapter for [${bankCode}] is not registered`);
    }
    return adapter;
  }

  public static listAvailable(): BankCode[] {
    return Array.from(this.adapters.keys());
  }
}

export * from './base.adapter.js';
export * from './mock/mock.adapter.js';
export * from './hdfc/hdfc.adapter.js';
export * from './icici/icici.adapter.js';
export * from './axis/axis.adapter.js';
