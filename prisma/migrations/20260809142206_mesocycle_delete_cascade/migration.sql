-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_MesocycleEvaluation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mesocycle_id" TEXT NOT NULL,
    "week_number" INTEGER NOT NULL,
    "evaluation_date" DATETIME NOT NULL,
    "summary" TEXT,
    "volume_trend" TEXT,
    "progress_score" INTEGER,
    "ai_analysis" TEXT,
    "ai_model" TEXT,
    "recommendations" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MesocycleEvaluation_mesocycle_id_fkey" FOREIGN KEY ("mesocycle_id") REFERENCES "Mesocycle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_MesocycleEvaluation" ("ai_analysis", "ai_model", "created_at", "evaluation_date", "id", "mesocycle_id", "progress_score", "recommendations", "summary", "volume_trend", "week_number") SELECT "ai_analysis", "ai_model", "created_at", "evaluation_date", "id", "mesocycle_id", "progress_score", "recommendations", "summary", "volume_trend", "week_number" FROM "MesocycleEvaluation";
DROP TABLE "MesocycleEvaluation";
ALTER TABLE "new_MesocycleEvaluation" RENAME TO "MesocycleEvaluation";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
