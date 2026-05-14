-- AlterTable
ALTER TABLE "Job" ADD COLUMN "endOfJobFormRequiredAt" TIMESTAMP(3),
ADD COLUMN "endOfJobFormSubmittedAt" TIMESTAMP(3),
ADD COLUMN "endOfJobFormResponses" JSONB;

-- AlterTable
ALTER TABLE "SystemConfig" ADD COLUMN "endOfJobForm" JSONB NOT NULL DEFAULT '{"version":1,"fields":[]}';
ALTER TABLE "SystemConfig" ADD COLUMN "endOfJobFormTrigger" JSONB NOT NULL DEFAULT '{"match":"substring","value":"End of Job Checklist"}';
