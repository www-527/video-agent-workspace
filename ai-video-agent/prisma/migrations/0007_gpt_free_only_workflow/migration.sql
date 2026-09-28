-- New projects exclusively use the GPT-free/Codex Responses pipeline.
-- Existing standard records are retained as historical, read-only data.
ALTER TABLE `project` ALTER COLUMN `workflow` SET DEFAULT 'gpt-free';
