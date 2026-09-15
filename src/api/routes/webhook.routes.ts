import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { BankCode } from '../../core/types.js';
import { BankCallbackHandler } from '../../webhooks/bank-callback.handler.js';
import { OutboxService } from '../../core/outbox/outbox.service.js';

export async function webhookRoutes(server: FastifyInstance) {
  const callbackHandler = BankCallbackHandler.getInstance();
  const outbox = OutboxService.getInstance();

  /**
   * POST /api/v1/webhooks/bank/:bankCode
   * Inbound S2S callback receiver for acquiring banks
   */
  server.post(
    '/api/v1/webhooks/bank/:bankCode',
    async (req: FastifyRequest<{ Params: { bankCode: string } }>, reply: FastifyReply) => {
      const bankCode = req.params.bankCode.toUpperCase() as BankCode;
      const validBanks: BankCode[] = ['MOCK', 'HDFC', 'ICICI', 'AXIS'];

      if (!validBanks.includes(bankCode)) {
        return reply.status(400).send({
          error: 'INVALID_BANK_CODE',
          message: `Bank code [${req.params.bankCode}] is not supported`,
        });
      }

      const result = await callbackHandler.handleCallback(
        bankCode,
        req.headers,
        req.body
      );

      if (!result.success) {
        return reply.status(400).send(result.responsePayload);
      }

      return reply.status(200).send(result.responsePayload);
    }
  );

  /**
   * GET /api/v1/webhooks/delivery-logs
   * View outbound webhook attempts and delivery statuses
   */
  server.get('/api/v1/webhooks/delivery-logs', async (_req: FastifyRequest, reply: FastifyReply) => {
    const events = outbox.getEvents();
    return reply.send({
      success: true,
      data: events,
      total: events.length,
    });
  });
}
