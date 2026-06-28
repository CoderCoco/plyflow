import { z } from 'zod';
export default z.object({ name: z.string(), value: z.number() });
