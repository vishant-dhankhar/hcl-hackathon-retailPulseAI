import type { Role, Tier } from './generated/prisma/enums.js';
declare global {
  namespace Express {
    interface Request {
      actor: {
        id: string;
        name: string;
        email: string;
        role: Role;
        tier: Tier;
        storeIds: string[];
        sessionId: string;
      };
    }
  }
}
export {};
