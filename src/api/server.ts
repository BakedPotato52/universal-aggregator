import fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import path from 'path';
import { fileURLToPath } from 'url';
import { paymentRoutes } from './routes/payment.routes.js';
import { webhookRoutes } from './routes/webhook.routes.js';
import { reconciliationRoutes } from './routes/reconciliation.routes.js';
import { simulatorRoutes } from './routes/simulator.routes.js';
import { storeRoutes } from './routes/store.routes.js';
import { config } from '../config/index.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function buildServer(): FastifyInstance {
  const server = fastify({
    logger: {
      level: config.nodeEnv === 'test' ? 'silent' : 'info',
    },
    disableRequestLogging: config.nodeEnv === 'test',
  });

  // Enable CORS
  server.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  });

  // Serve static files for demo and store
  const publicDir = path.join(__dirname, '../../public');
  server.register(fastifyStatic, {
    root: publicDir,
    prefix: '/',
  });

  // Root redirects for intuitive navigation
  server.get('/', async (_req, reply) => {
    return reply.redirect('/store/index.html');
  });

  server.get('/demo', async (_req, reply) => {
    return reply.redirect('/index.html');
  });

  server.get('/store', async (_req, reply) => {
    return reply.redirect('/store/index.html');
  });

  // Health check endpoint
  server.get('/health', async () => {
    return {
      status: 'UP',
      engine: 'Universal Aggregator & E-Commerce Store Engine',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };
  });

  // Register API routes
  server.register(paymentRoutes);
  server.register(webhookRoutes);
  server.register(reconciliationRoutes);
  server.register(simulatorRoutes);
  server.register(storeRoutes);

  // Global Error Handler
  server.setErrorHandler((error, _request, reply) => {
    server.log.error(error);
    reply.status(error.statusCode || 500).send({
      error: error.name || 'INTERNAL_SERVER_ERROR',
      message: error.message || 'An unexpected error occurred',
    });
  });

  return server;
}
