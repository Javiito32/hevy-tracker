-- AlterTable
ALTER TABLE "AiMessage" ADD COLUMN "cached_input_tokens" INTEGER;
ALTER TABLE "AiMessage" ADD COLUMN "latency_ms" INTEGER;
ALTER TABLE "AiMessage" ADD COLUMN "reasoning_tokens" INTEGER;
ALTER TABLE "AiMessage" ADD COLUMN "tool_calls" INTEGER;
ALTER TABLE "AiMessage" ADD COLUMN "tool_rounds" INTEGER;

-- AlterTable
ALTER TABLE "AiModelPrice" ADD COLUMN "cached_input_per_1m" REAL;
