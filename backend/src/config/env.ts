import 'dotenv/config';
import { z } from 'zod';
// Fail early rather than starting an API with an insecure signing key or no database.
const parsed = z
  .object({
    DATABASE_URL: z.string().min(1, 'Set DATABASE_URL in backend/.env'),
    JWT_SECRET: z.string().min(48, 'JWT_SECRET must contain at least 48 characters'),
    APP_ORIGIN: z.string().url().default('http://127.0.0.1:5173'),
    NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
    PORT: z.coerce.number().default(4000),
  })
  .safeParse(process.env);
if (!parsed.success)
  throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
export const config = parsed.data;
