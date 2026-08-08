-- AlterTable
ALTER TABLE "Mesocycle" ADD COLUMN "hevy_folder_id" INTEGER;

-- CreateTable
CREATE TABLE "MesocycleWeek" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mesocycle_id" TEXT NOT NULL,
    "week_number" INTEGER NOT NULL,
    "is_deload" BOOLEAN NOT NULL DEFAULT false,
    "target_rir" REAL,
    "volume_multiplier" REAL NOT NULL DEFAULT 1,
    "notes" TEXT,
    CONSTRAINT "MesocycleWeek_mesocycle_id_fkey" FOREIGN KEY ("mesocycle_id") REFERENCES "Mesocycle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlannedSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mesocycle_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "day_of_week" INTEGER,
    "notes" TEXT,
    "hevy_routine_id" TEXT,
    "pushed_at" DATETIME,
    CONSTRAINT "PlannedSession_mesocycle_id_fkey" FOREIGN KEY ("mesocycle_id") REFERENCES "Mesocycle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PlannedExercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "planned_session_id" TEXT NOT NULL,
    "exercise_template_id" TEXT,
    "name" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "target_sets" INTEGER NOT NULL DEFAULT 3,
    "rep_min" INTEGER,
    "rep_max" INTEGER,
    "target_rir" REAL,
    "rest_seconds" INTEGER,
    "progression_scheme" TEXT NOT NULL DEFAULT 'double_progression',
    "notes" TEXT,
    CONSTRAINT "PlannedExercise_planned_session_id_fkey" FOREIGN KEY ("planned_session_id") REFERENCES "PlannedSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExerciseTemplate" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "primary_muscle_group" TEXT NOT NULL,
    "secondary_muscle_groups" TEXT NOT NULL DEFAULT '[]',
    "equipment_category" TEXT,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "user_id" TEXT,
    "synced_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "ExerciseMuscleOverride" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "exercise_name" TEXT NOT NULL,
    "primary_muscle_group" TEXT NOT NULL,
    "secondary_muscle_groups" TEXT NOT NULL DEFAULT '[]',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "WorkoutExercise" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workout_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "exercise_template_id" TEXT,
    "name" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "superset_id" INTEGER,
    "working_sets" INTEGER NOT NULL DEFAULT 0,
    "total_sets" INTEGER NOT NULL DEFAULT 0,
    "total_volume" REAL NOT NULL DEFAULT 0,
    "best_e1rm" REAL,
    "top_set_weight" REAL,
    "top_set_reps" INTEGER,
    "avg_rpe" REAL,
    CONSTRAINT "WorkoutExercise_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "Workout" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "WorkoutExercise_exercise_template_id_fkey" FOREIGN KEY ("exercise_template_id") REFERENCES "ExerciseTemplate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ExerciseSet" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workout_exercise_id" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL DEFAULT 0,
    "set_type" TEXT NOT NULL DEFAULT 'normal',
    "weight_kg" REAL,
    "reps" INTEGER,
    "rpe" REAL,
    "distance_meters" REAL,
    "duration_seconds" INTEGER,
    "e1rm" REAL,
    CONSTRAINT "ExerciseSet_workout_exercise_id_fkey" FOREIGN KEY ("workout_exercise_id") REFERENCES "WorkoutExercise" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "TrainingAlert" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subject_kind" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "payload_json" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "detected_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "resolved_at" DATETIME,
    "dismissed_at" DATETIME,
    CONSTRAINT "TrainingAlert_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PersonalRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "exercise_template_id" TEXT,
    "exercise_name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "value" REAL NOT NULL,
    "previous_value" REAL,
    "at_weight" REAL,
    "workout_id" TEXT,
    "achieved_at" DATETIME NOT NULL,
    CONSTRAINT "PersonalRecord_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "PersonalRecord_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "Workout" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MaintenanceJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "user_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "progress_current" INTEGER NOT NULL DEFAULT 0,
    "progress_total" INTEGER NOT NULL DEFAULT 0,
    "message" TEXT,
    "result_json" TEXT,
    "error" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" DATETIME,
    "finished_at" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "MesocycleWeek_mesocycle_id_week_number_key" ON "MesocycleWeek"("mesocycle_id", "week_number");

-- CreateIndex
CREATE INDEX "PlannedSession_mesocycle_id_order_index_idx" ON "PlannedSession"("mesocycle_id", "order_index");

-- CreateIndex
CREATE INDEX "PlannedExercise_planned_session_id_order_index_idx" ON "PlannedExercise"("planned_session_id", "order_index");

-- CreateIndex
CREATE INDEX "ExerciseTemplate_user_id_idx" ON "ExerciseTemplate"("user_id");

-- CreateIndex
CREATE INDEX "ExerciseTemplate_primary_muscle_group_idx" ON "ExerciseTemplate"("primary_muscle_group");

-- CreateIndex
CREATE INDEX "ExerciseTemplate_title_idx" ON "ExerciseTemplate"("title");

-- CreateIndex
CREATE UNIQUE INDEX "ExerciseMuscleOverride_user_id_exercise_name_key" ON "ExerciseMuscleOverride"("user_id", "exercise_name");

-- CreateIndex
CREATE INDEX "WorkoutExercise_user_id_exercise_template_id_date_idx" ON "WorkoutExercise"("user_id", "exercise_template_id", "date");

-- CreateIndex
CREATE INDEX "WorkoutExercise_user_id_name_date_idx" ON "WorkoutExercise"("user_id", "name", "date");

-- CreateIndex
CREATE INDEX "WorkoutExercise_workout_id_order_index_idx" ON "WorkoutExercise"("workout_id", "order_index");

-- CreateIndex
CREATE INDEX "ExerciseSet_workout_exercise_id_order_index_idx" ON "ExerciseSet"("workout_exercise_id", "order_index");

-- CreateIndex
CREATE INDEX "TrainingAlert_user_id_status_detected_at_idx" ON "TrainingAlert"("user_id", "status", "detected_at");

-- CreateIndex
CREATE UNIQUE INDEX "TrainingAlert_user_id_type_subject_key" ON "TrainingAlert"("user_id", "type", "subject");

-- CreateIndex
CREATE INDEX "PersonalRecord_user_id_exercise_name_type_achieved_at_idx" ON "PersonalRecord"("user_id", "exercise_name", "type", "achieved_at");

-- CreateIndex
CREATE INDEX "PersonalRecord_user_id_achieved_at_idx" ON "PersonalRecord"("user_id", "achieved_at");

-- CreateIndex
CREATE INDEX "MaintenanceJob_kind_created_at_idx" ON "MaintenanceJob"("kind", "created_at");

-- CreateIndex
CREATE INDEX "MaintenanceJob_status_idx" ON "MaintenanceJob"("status");

-- CreateIndex
CREATE INDEX "Workout_user_id_date_idx" ON "Workout"("user_id", "date");
