import { defineConfig } from 'prisma/config';
import dotenv from 'dotenv';

dotenv.config();

export default defineConfig({
  datasource: {
    url: process.env.DATABASE_URL || 'postgresql://postgres:postgrespassword@localhost:5432/universal_aggregator?schema=public',
  },
});
