import { z } from 'zod';
export const credentials = z
  .object({
    email: z.string().trim().toLowerCase().pipe(z.email()),
    password: z.string().min(12).max(128),
  })
  .strict();
export const registration = credentials.extend({ name: z.string().trim().min(2).max(80) });
export const profileInput = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    preferences: z
      .object({
        categories: z.array(z.string().max(40)).max(10).optional(),
        budget: z.number().positive().optional(),
        storeId: z.string().min(1).max(100).optional(),
      })
      .optional(),
  })
  .strict();
