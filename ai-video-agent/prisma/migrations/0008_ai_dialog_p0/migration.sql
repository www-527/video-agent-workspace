ALTER TABLE `project`
  ADD COLUMN `projectBrief` JSON NULL,
  ADD COLUMN `briefStatus` VARCHAR(191) NOT NULL DEFAULT 'empty';

ALTER TABLE `agent_run`
  ADD COLUMN `clientRequestId` VARCHAR(191) NULL,
  ADD COLUMN `userMessageId` VARCHAR(191) NULL,
  ADD COLUMN `contextSnapshot` JSON NULL,
  ADD COLUMN `cancelRequestedAt` DATETIME(3) NULL,
  ADD COLUMN `retryOfRunId` VARCHAR(191) NULL,
  ADD COLUMN `resumeOfRunId` VARCHAR(191) NULL,
  ADD UNIQUE INDEX `agent_run_projectId_clientRequestId_key` (`projectId`, `clientRequestId`);

CREATE TABLE `project_asset` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(191) NOT NULL,
  `mimeType` VARCHAR(191) NOT NULL,
  `originalName` VARCHAR(191) NOT NULL,
  `storagePath` VARCHAR(191) NOT NULL,
  `contentHash` VARCHAR(64) NOT NULL,
  `byteLength` INTEGER NOT NULL,
  `status` VARCHAR(191) NOT NULL,
  `inferredUsage` VARCHAR(191) NULL,
  `summary` JSON NULL,
  `metadata` JSON NULL,
  `errorCode` VARCHAR(191) NULL,
  `errorMessage` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  INDEX `project_asset_projectId_status_idx` (`projectId`, `status`),
  UNIQUE INDEX `project_asset_projectId_contentHash_key` (`projectId`, `contentHash`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_change_set` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `runId` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL,
  `baseStateHash` VARCHAR(64) NOT NULL,
  `resultStateHash` VARCHAR(64) NULL,
  `scope` JSON NOT NULL,
  `operations` JSON NOT NULL,
  `impact` JSON NOT NULL,
  `summary` JSON NOT NULL,
  `checkpointId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `appliedAt` DATETIME(3) NULL,
  `revertedAt` DATETIME(3) NULL,
  INDEX `project_change_set_projectId_status_idx` (`projectId`, `status`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `project_checkpoint` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(191) NOT NULL,
  `stateHash` VARCHAR(64) NOT NULL,
  `snapshotPath` VARCHAR(191) NOT NULL,
  `snapshotHash` VARCHAR(64) NOT NULL,
  `summary` JSON NULL,
  `changeSetId` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `restoredAt` DATETIME(3) NULL,
  INDEX `project_checkpoint_projectId_createdAt_idx` (`projectId`, `createdAt`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `project_asset`
  ADD CONSTRAINT `project_asset_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `project`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_change_set`
  ADD CONSTRAINT `project_change_set_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `project`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `project_checkpoint`
  ADD CONSTRAINT `project_checkpoint_projectId_fkey` FOREIGN KEY (`projectId`) REFERENCES `project`(`uuid`) ON DELETE CASCADE ON UPDATE CASCADE;
