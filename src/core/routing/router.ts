import { BankCode, BankHealthMetrics, PaymentRequest, RoutingDecision } from '../types.js';

export class SmartRouter {
  private bankHealth: Map<BankCode, BankHealthMetrics> = new Map();
  private defaultBank: BankCode;

  constructor(defaultBank: BankCode = 'MOCK') {
    this.defaultBank = defaultBank;
    this.initDefaultHealthMetrics();
  }

  private initDefaultHealthMetrics(): void {
    const banks: BankCode[] = ['MOCK', 'HDFC', 'ICICI', 'AXIS'];
    for (const bank of banks) {
      this.bankHealth.set(bank, {
        bankCode: bank,
        isHealthy: true,
        successRate24h: 99.2,
        avgLatencyMs: 180,
        activeIncidents: 0,
      });
    }
  }

  /**
   * Updates health metrics for a bank (e.g. from circuit breaker or health checker)
   */
  public updateHealth(bankCode: BankCode, updates: Partial<BankHealthMetrics>): void {
    const current = this.bankHealth.get(bankCode);
    if (current) {
      this.bankHealth.set(bankCode, { ...current, ...updates });
    }
  }

  /**
   * Determine the optimal Acquiring Bank for a payment request
   */
  public route(request: PaymentRequest): RoutingDecision {
    // 1. If explicit preferred bank requested by client and it is healthy
    if (request.preferredBank) {
      const metrics = this.bankHealth.get(request.preferredBank);
      if (metrics && metrics.isHealthy) {
        const fallbacks = this.getFallbackChain(request.preferredBank);
        return {
          selectedBank: request.preferredBank,
          reason: `Client requested specific bank [${request.preferredBank}] and health check passed`,
          fallbackBanks: fallbacks,
        };
      }
    }

    // 2. If configured to use a static default bank (e.g. MOCK in dev)
    if (this.defaultBank !== 'MOCK') {
      const defaultMetrics = this.bankHealth.get(this.defaultBank);
      if (defaultMetrics && defaultMetrics.isHealthy) {
        return {
          selectedBank: this.defaultBank,
          reason: `Default configured bank [${this.defaultBank}] active and healthy`,
          fallbackBanks: this.getFallbackChain(this.defaultBank),
        };
      }
    }

    // 3. Dynamic Smart Routing: Score banks based on Success Rate (70%) and Latency (30%)
    const candidates = Array.from(this.bankHealth.values())
      .filter((b) => b.isHealthy)
      .sort((a, b) => {
        // High success rate preferred; lower latency preferred
        const scoreA = a.successRate24h * 0.7 - (a.avgLatencyMs / 100) * 0.3;
        const scoreB = b.successRate24h * 0.7 - (b.avgLatencyMs / 100) * 0.3;
        return scoreB - scoreA;
      });

    if (candidates.length === 0) {
      // Fallback to MOCK if all bank channels report down
      return {
        selectedBank: 'MOCK',
        reason: 'All live bank connectors reported degraded; falling back to emergency sandbox',
        fallbackBanks: [],
      };
    }

    const primary = candidates[0].bankCode;
    const fallbacks = candidates.slice(1).map((c) => c.bankCode);

    return {
      selectedBank: primary,
      reason: `Smart routing selected [${primary}] with highest composite score (Success: ${candidates[0].successRate24h}%, Latency: ${candidates[0].avgLatencyMs}ms)`,
      fallbackBanks: fallbacks,
    };
  }

  private getFallbackChain(excludeBank: BankCode): BankCode[] {
    return Array.from(this.bankHealth.keys()).filter(
      (b) => b !== excludeBank && this.bankHealth.get(b)?.isHealthy
    );
  }

  public getHealthMetrics(): BankHealthMetrics[] {
    return Array.from(this.bankHealth.values());
  }
}
