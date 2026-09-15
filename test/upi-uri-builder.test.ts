import { describe, it, expect } from 'vitest';
import { UpiUriBuilder } from '../src/upi/uri-builder.js';

describe('UpiUriBuilder', () => {
  it('should generate a valid NPCI compliant UPI URI with mandatory fields', () => {
    const uri = UpiUriBuilder.build({
      pa: 'merchant@hdfcbank',
      pn: 'Universal Store',
      tr: 'TXN12345678',
      am: 150.5,
    });

    expect(uri).toContain('upi://pay?');
    expect(uri).toContain('pa=merchant%40hdfcbank');
    expect(uri).toContain('pn=Universal%20Store');
    expect(uri).toContain('tr=TXN12345678');
    expect(uri).toContain('am=150.50');
    expect(uri).toContain('cu=INR');
    expect(uri).toContain('mode=02');
  });

  it('should format decimal amount strictly to two decimal places', () => {
    const uri = UpiUriBuilder.build({
      pa: 'merchant@icici',
      pn: 'Test Merchant',
      tr: 'TXN999',
      am: '500',
    });

    expect(uri).toContain('am=500.00');
  });

  it('should throw error if mandatory fields are missing', () => {
    expect(() =>
      UpiUriBuilder.build({
        pa: '',
        pn: 'Test',
        tr: 'TXN1',
        am: 100,
      })
    ).toThrowError(/Payee VPA/);

    expect(() =>
      UpiUriBuilder.build({
        pa: 'test@vpa',
        pn: '',
        tr: 'TXN1',
        am: 100,
      })
    ).toThrowError(/Payee Name/);

    expect(() =>
      UpiUriBuilder.build({
        pa: 'test@vpa',
        pn: 'Test',
        tr: '',
        am: 100,
      })
    ).toThrowError(/Transaction Reference ID/);
  });

  it('should parse an existing UPI URI back into structured parameters', () => {
    const originalUri =
      'upi://pay?pa=store%40axisbank&pn=SuperStore&tr=TXN555&am=299.00&cu=INR&mode=02&mc=5411';
    const parsed = UpiUriBuilder.parse(originalUri);

    expect(parsed.pa).toBe('store@axisbank');
    expect(parsed.pn).toBe('SuperStore');
    expect(parsed.tr).toBe('TXN555');
    expect(parsed.am).toBe('299.00');
    expect(parsed.mc).toBe('5411');
    expect(parsed.mode).toBe('02');
  });
});
