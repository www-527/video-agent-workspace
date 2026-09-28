ALTER TABLE `project`
  ADD COLUMN `workflow` VARCHAR(191) NOT NULL DEFAULT 'standard',
  ADD COLUMN `aiBinding` JSON NULL;
