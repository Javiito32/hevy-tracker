/*
  Warnings:

  - You are about to drop the column `target_volume_weekly` on the `Mesocycle` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Mesocycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATETIME NOT NULL,
    "end_date" DATETIME,
    "goal" TEXT,
    "split_description" TEXT,
    "target_sessions_weekly" INTEGER,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "final_summary" TEXT,
    "final_summary_model" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "macrocycle_id" TEXT,
    "hevy_folder_id" INTEGER,
    CONSTRAINT "Mesocycle_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Mesocycle_macrocycle_id_fkey" FOREIGN KEY ("macrocycle_id") REFERENCES "Macrocycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
-- Prisma generates this rename as a drop-and-recreate and omits the renamed
-- column from both lists, which would silently discard every mesocycle's
-- weekly session target. "target_volume_weekly" is carried into
-- "target_sessions_weekly" explicitly below — the column only ever held a
-- session count, which is why it was renamed.
INSERT INTO "new_Mesocycle" ("created_at", "end_date", "final_summary", "final_summary_model", "goal", "hevy_folder_id", "id", "macrocycle_id", "name", "notes", "split_description", "start_date", "status", "target_sessions_weekly", "updated_at", "user_id") SELECT "created_at", "end_date", "final_summary", "final_summary_model", "goal", "hevy_folder_id", "id", "macrocycle_id", "name", "notes", "split_description", "start_date", "status", "target_volume_weekly", "updated_at", "user_id" FROM "Mesocycle";
DROP TABLE "Mesocycle";
ALTER TABLE "new_Mesocycle" RENAME TO "Mesocycle";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
