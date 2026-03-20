import { z } from 'zod';
const schema = z.object({
  createdAt: z.coerce.string().catch(() => new Date().toISOString()),
});
console.log(schema.safeParse({}).data);
