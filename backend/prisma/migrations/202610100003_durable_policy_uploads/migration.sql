-- Keep private policy uploads across serverless instances and deployments.
ALTER TABLE "KnowledgeDocument" ADD COLUMN "originalFile" BYTEA;
