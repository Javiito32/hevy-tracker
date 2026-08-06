-- AlterTable
ALTER TABLE "AiMessage" ADD COLUMN "input_tokens" INTEGER;
ALTER TABLE "AiMessage" ADD COLUMN "output_tokens" INTEGER;

-- CreateTable
CREATE TABLE "AiModelPrice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "model" TEXT NOT NULL,
    "input_per_1m" REAL NOT NULL,
    "output_per_1m" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "AiModelPrice_model_key" ON "AiModelPrice"("model");

-- CreateIndex
CREATE INDEX "AiMessage_created_at_idx" ON "AiMessage"("created_at");
