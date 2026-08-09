/*
  DietMeal.day_type (all | training | rest) becomes DietMeal.weekday (1 = Monday
  … 7 = Sunday). Every weekday now holds its own independent meal list.

  This migration is STRUCTURAL ONLY. Existing meals are all seeded onto Monday,
  which leaves the database valid and the app telling the truth — "you have a
  Monday-only plan". Spreading each meal across the seven days is done by the
  `fanout_diet_weekdays` maintenance job in /admin, in TypeScript, next to
  computeVersionTotals: the fan-out has to clone DietItem rows with fresh ids,
  and SQLite has no uuid() to mint them with.

  RUN THAT JOB IMMEDIATELY AFTER THIS MIGRATION. Until it runs, a diet that used
  to be eaten every day reads as planned for Monday alone.
*/
-- CreateTable
CREATE TABLE "DietDayTarget" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "diet_version_id" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "target_kcal" REAL,
    "target_protein_g" REAL,
    "target_carbs_g" REAL,
    "target_fat_g" REAL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "DietDayTarget_diet_version_id_fkey" FOREIGN KEY ("diet_version_id") REFERENCES "DietVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_DietMeal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "diet_version_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "time_of_day" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DietMeal_diet_version_id_fkey" FOREIGN KEY ("diet_version_id") REFERENCES "DietVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
-- weekday is seeded to 1 (Monday) for every existing row: day_type carried no
-- weekday information to preserve, and ids are kept so nothing pointing at a
-- meal breaks. The fan-out job turns each of these into seven.
INSERT INTO "new_DietMeal" ("created_at", "diet_version_id", "id", "name", "weekday", "order_index", "time_of_day") SELECT "created_at", "diet_version_id", "id", "name", 1, "order_index", "time_of_day" FROM "DietMeal";
DROP TABLE "DietMeal";
ALTER TABLE "new_DietMeal" RENAME TO "DietMeal";
CREATE INDEX "DietMeal_diet_version_id_weekday_order_index_idx" ON "DietMeal"("diet_version_id", "weekday", "order_index");
CREATE TABLE "new_DietVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "diet_plan_id" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "start_date" DATETIME,
    "end_date" DATETIME,
    "change_note" TEXT,
    "target_kcal" REAL,
    "target_protein_g" REAL,
    "target_carbs_g" REAL,
    "target_fat_g" REAL,
    "total_kcal" REAL NOT NULL DEFAULT 0,
    "total_protein_g" REAL NOT NULL DEFAULT 0,
    "total_carbs_g" REAL NOT NULL DEFAULT 0,
    "total_fat_g" REAL NOT NULL DEFAULT 0,
    "planned_days" INTEGER NOT NULL DEFAULT 0,
    "totals_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "DietVersion_diet_plan_id_fkey" FOREIGN KEY ("diet_plan_id") REFERENCES "DietPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_DietVersion" ("change_note", "created_at", "diet_plan_id", "end_date", "id", "start_date", "status", "target_carbs_g", "target_fat_g", "target_kcal", "target_protein_g", "total_carbs_g", "total_fat_g", "total_kcal", "total_protein_g", "totals_json", "updated_at", "version_number") SELECT "change_note", "created_at", "diet_plan_id", "end_date", "id", "start_date", "status", "target_carbs_g", "target_fat_g", "target_kcal", "target_protein_g", "total_carbs_g", "total_fat_g", "total_kcal", "total_protein_g", "totals_json", "updated_at", "version_number" FROM "DietVersion";
DROP TABLE "DietVersion";
ALTER TABLE "new_DietVersion" RENAME TO "DietVersion";
CREATE INDEX "DietVersion_diet_plan_id_status_idx" ON "DietVersion"("diet_plan_id", "status");
CREATE UNIQUE INDEX "DietVersion_diet_plan_id_version_number_key" ON "DietVersion"("diet_plan_id", "version_number");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "DietDayTarget_diet_version_id_weekday_key" ON "DietDayTarget"("diet_version_id", "weekday");

-- Everything now sits on Monday, so a version with any food at all has exactly
-- one planned day. Left at the column default of 0 this would render as "media
-- de 0 días" in the history until the fan-out job runs; one planned day is the
-- honest reading of the state this migration actually leaves behind.
UPDATE "DietVersion" SET "planned_days" = 1
WHERE EXISTS (
  SELECT 1 FROM "DietMeal" m
  JOIN "DietItem" i ON i."diet_meal_id" = m."id"
  WHERE m."diet_version_id" = "DietVersion"."id"
);
