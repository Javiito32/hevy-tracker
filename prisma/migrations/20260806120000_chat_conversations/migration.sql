-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_AiConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "context_type" TEXT NOT NULL DEFAULT 'general',
    "context_id" TEXT,
    "title" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiConversation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_AiConversation" ("context_id", "context_type", "created_at", "id", "user_id") SELECT "context_id", "context_type", "created_at", "id", "user_id" FROM "AiConversation";
DROP TABLE "AiConversation";
ALTER TABLE "new_AiConversation" RENAME TO "AiConversation";
CREATE INDEX "AiConversation_user_id_context_type_updated_at_idx" ON "AiConversation"("user_id", "context_type", "updated_at");
CREATE TABLE "new_AiMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tokens_used" INTEGER,
    "model_used" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiMessage_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "AiConversation" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_AiMessage" ("content", "conversation_id", "created_at", "id", "model_used", "role", "tokens_used") SELECT "content", "conversation_id", "created_at", "id", "model_used", "role", "tokens_used" FROM "AiMessage";
DROP TABLE "AiMessage";
ALTER TABLE "new_AiMessage" RENAME TO "AiMessage";
CREATE INDEX "AiMessage_conversation_id_created_at_idx" ON "AiMessage"("conversation_id", "created_at");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- Backfill updated_at from actual last activity. Without this every existing
-- conversation shares the CURRENT_TIMESTAMP default and their relative order is
-- arbitrary — which is precisely the ordering this migration exists to fix.
UPDATE "AiConversation"
SET "updated_at" = COALESCE(
    (SELECT MAX("created_at") FROM "AiMessage" WHERE "AiMessage"."conversation_id" = "AiConversation"."id"),
    "created_at"
);

-- Backfill titles for existing chat conversations from their first user message
-- so the sidebar isn't a wall of "Sin título".
UPDATE "AiConversation"
SET "title" = (
    SELECT SUBSTR("content", 1, 60) FROM "AiMessage"
    WHERE "AiMessage"."conversation_id" = "AiConversation"."id" AND "role" = 'user'
    ORDER BY "created_at" ASC LIMIT 1
)
WHERE "context_type" = 'general' AND "title" IS NULL;
