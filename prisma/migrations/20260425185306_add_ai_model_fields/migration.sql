-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "hevy_api_key" TEXT,
    "height" REAL,
    "sex" TEXT,
    "birth_date" DATETIME,
    "injuries_notes" TEXT,
    "last_login_at" DATETIME,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "BodyMetric" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "weight" REAL,
    "body_fat_percentage" REAL,
    "neck" REAL,
    "chest" REAL,
    "waist" REAL,
    "hips" REAL,
    "biceps" REAL,
    "thighs" REAL,
    "calves" REAL,
    "raw_data" TEXT,
    "source" TEXT NOT NULL DEFAULT 'hevy',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BodyMetric_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Macrocycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "goal" TEXT,
    "start_date" DATETIME NOT NULL,
    "end_date" DATETIME,
    "notes" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "Macrocycle_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Mesocycle" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" DATETIME NOT NULL,
    "end_date" DATETIME,
    "goal" TEXT,
    "split_description" TEXT,
    "target_volume_weekly" INTEGER,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "final_summary" TEXT,
    "final_summary_model" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    "macrocycle_id" TEXT,
    CONSTRAINT "Mesocycle_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Mesocycle_macrocycle_id_fkey" FOREIGN KEY ("macrocycle_id") REFERENCES "Macrocycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Workout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "hevy_id" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "start_time" DATETIME,
    "end_time" DATETIME,
    "duration" INTEGER,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "total_volume" REAL,
    "total_tonnage" REAL,
    "rpe_avg" REAL,
    "exercises_summary" TEXT,
    "raw_data" TEXT,
    "notes" TEXT,
    "ai_analysis" TEXT,
    "ai_model" TEXT,
    "mesocycle_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "Workout_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "Workout_mesocycle_id_fkey" FOREIGN KEY ("mesocycle_id") REFERENCES "Mesocycle" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "SessionNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "workout_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "ai_feedback" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SessionNote_workout_id_fkey" FOREIGN KEY ("workout_id") REFERENCES "Workout" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MesocycleEvaluation" (
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
    CONSTRAINT "MesocycleEvaluation_mesocycle_id_fkey" FOREIGN KEY ("mesocycle_id") REFERENCES "Mesocycle" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MesocycleNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "mesocycle_id" TEXT NOT NULL,
    "date" DATETIME NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MesocycleNote_mesocycle_id_fkey" FOREIGN KEY ("mesocycle_id") REFERENCES "Mesocycle" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiConversation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "context_type" TEXT NOT NULL DEFAULT 'general',
    "context_id" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiConversation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AiMessage" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "conversation_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tokens_used" INTEGER,
    "model_used" TEXT,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AiMessage_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "AiConversation" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Workout_user_id_hevy_id_key" ON "Workout"("user_id", "hevy_id");
