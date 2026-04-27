/*
  Warnings:

  - You are about to drop the column `biceps` on the `BodyMetric` table. All the data in the column will be lost.
  - You are about to drop the column `calves` on the `BodyMetric` table. All the data in the column will be lost.
  - You are about to drop the column `thighs` on the `BodyMetric` table. All the data in the column will be lost.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BodyMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "weight" REAL,
    "body_fat_percentage" REAL,
    "neck" REAL,
    "chest" REAL,
    "waist" REAL,
    "hips" REAL,
    "left_bicep" REAL,
    "right_bicep" REAL,
    "left_bicep_relaxed" REAL,
    "right_bicep_relaxed" REAL,
    "left_forearm" REAL,
    "right_forearm" REAL,
    "hrv" REAL,
    "resting_hr" INTEGER,
    "left_thigh" REAL,
    "right_thigh" REAL,
    "left_calf" REAL,
    "right_calf" REAL,
    "shoulder" REAL,
    "abdomen" REAL,
    "lean_mass" REAL,
    "raw_data" TEXT,
    "source" TEXT NOT NULL DEFAULT 'hevy',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BodyMetric_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_BodyMetric" ("body_fat_percentage", "chest", "created_at", "date", "hips", "id", "neck", "raw_data", "source", "user_id", "waist", "weight") SELECT "body_fat_percentage", "chest", "created_at", "date", "hips", "id", "neck", "raw_data", "source", "user_id", "waist", "weight" FROM "BodyMetric";
DROP TABLE "BodyMetric";
ALTER TABLE "new_BodyMetric" RENAME TO "BodyMetric";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
