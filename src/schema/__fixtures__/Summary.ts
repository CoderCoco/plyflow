import { z } from 'zod';
export default z.object({ title: z.string(), points: z.array(z.string()) });
