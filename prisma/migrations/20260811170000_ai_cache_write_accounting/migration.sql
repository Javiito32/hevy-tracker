-- Cache WRITES, which the provider bills apart from cache reads and above the
-- standard input rate. Both columns are nullable and nothing backfills them:
-- rows written before this migration have no figure, and "not recorded" must
-- stay distinguishable from "zero tokens written".

-- AlterTable
ALTER TABLE "AiMessage" ADD COLUMN "cache_write_tokens" INTEGER;

-- AlterTable
ALTER TABLE "AiModelPrice" ADD COLUMN "cache_write_per_1m" REAL;
