-- CreateEnum
CREATE TYPE "SalespersonKind" AS ENUM ('REP', 'MANAGER');

-- AlterTable
ALTER TABLE "Salesperson" ADD COLUMN "kind" "SalespersonKind" NOT NULL DEFAULT 'REP';

-- CreateTable
CREATE TABLE "CommissionPlan" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommissionPlan_year_key" ON "CommissionPlan"("year");
