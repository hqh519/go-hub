import { PrismaClient } from '@prisma/client';

/** 全局单例 PrismaClient（dev 热重载防连接泄漏） */
const globalForPrisma = globalThis as unknown as { __gohubPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__gohubPrisma ?? (globalForPrisma.__gohubPrisma = new PrismaClient());
