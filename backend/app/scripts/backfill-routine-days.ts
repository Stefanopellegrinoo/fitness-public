import { PrismaClient } from '@prisma/client';
import { backfillRoutineDays, verifyRoutineBackfill } from '../src/services/routine-backfill.service';

const prisma = new PrismaClient();

async function main() {
  const stats = await backfillRoutineDays(prisma);
  console.log('Backfill stats:', JSON.stringify(stats, null, 2));
  const verdict = await verifyRoutineBackfill(prisma);
  if (verdict.ok) {
    console.log('VERIFY OK');
  } else {
    console.error('VERIFY FAILED:');
    verdict.issues.forEach((issue) => console.error(` - ${issue}`));
    process.exitCode = 1;
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
