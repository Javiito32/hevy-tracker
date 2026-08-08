-- CreateTable
CREATE TABLE "Food" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "barcode" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "external_id" TEXT,
    "serving_size_g" REAL,
    "serving_label" TEXT,
    "kcal" REAL NOT NULL,
    "protein_g" REAL NOT NULL DEFAULT 0,
    "carbs_g" REAL NOT NULL DEFAULT 0,
    "fat_g" REAL NOT NULL DEFAULT 0,
    "fiber_g" REAL,
    "sugars_g" REAL,
    "saturated_fat_g" REAL,
    "sodium_mg" REAL,
    "potassium_mg" REAL,
    "calcium_mg" REAL,
    "iron_mg" REAL,
    "magnesium_mg" REAL,
    "zinc_mg" REAL,
    "vitamin_d_ug" REAL,
    "vitamin_c_mg" REAL,
    "vitamin_b12_ug" REAL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "Food_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DietPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "DietPlan_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DietVersion" (
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
    "totals_json" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "DietVersion_diet_plan_id_fkey" FOREIGN KEY ("diet_plan_id") REFERENCES "DietPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DietMeal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "diet_version_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "time_of_day" TEXT,
    "day_type" TEXT NOT NULL DEFAULT 'all',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DietMeal_diet_version_id_fkey" FOREIGN KEY ("diet_version_id") REFERENCES "DietVersion" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "DietItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "diet_meal_id" TEXT NOT NULL,
    "food_id" TEXT,
    "food_name" TEXT NOT NULL,
    "quantity_g" REAL NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "nutrients_snapshot" TEXT NOT NULL,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "DietItem_diet_meal_id_fkey" FOREIGN KEY ("diet_meal_id") REFERENCES "DietMeal" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DietItem_food_id_fkey" FOREIGN KEY ("food_id") REFERENCES "Food" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "Food_user_id_name_idx" ON "Food"("user_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Food_user_id_barcode_key" ON "Food"("user_id", "barcode");

-- CreateIndex
CREATE INDEX "DietPlan_user_id_status_idx" ON "DietPlan"("user_id", "status");

-- CreateIndex
CREATE INDEX "DietVersion_diet_plan_id_status_idx" ON "DietVersion"("diet_plan_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "DietVersion_diet_plan_id_version_number_key" ON "DietVersion"("diet_plan_id", "version_number");

-- CreateIndex
CREATE INDEX "DietMeal_diet_version_id_order_index_idx" ON "DietMeal"("diet_version_id", "order_index");

-- CreateIndex
CREATE INDEX "DietItem_diet_meal_id_order_index_idx" ON "DietItem"("diet_meal_id", "order_index");
