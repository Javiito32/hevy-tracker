-- CreateTable
CREATE TABLE "ExerciseTemplateAlias" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "exercise_template_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "ExerciseTemplateAlias_user_id_title_idx" ON "ExerciseTemplateAlias"("user_id", "title");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseTemplateAlias_user_id_exercise_template_id_key" ON "ExerciseTemplateAlias"("user_id", "exercise_template_id");
