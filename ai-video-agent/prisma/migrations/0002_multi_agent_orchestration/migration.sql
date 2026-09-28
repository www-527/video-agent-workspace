-- Persist internal multi-agent runs without changing the public Project JSON contracts.
CREATE TABLE `agent_run` (
  `id` VARCHAR(191) NOT NULL,
  `projectId` VARCHAR(191) NOT NULL,
  `kind` VARCHAR(191) NOT NULL,
  `inputHash` VARCHAR(64) NOT NULL,
  `status` VARCHAR(191) NOT NULL,
  `summary` JSON NULL,
  `requestedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `startedAt` DATETIME(3) NULL,
  `finishedAt` DATETIME(3) NULL,
  `cancelledAt` DATETIME(3) NULL,

  INDEX `agent_run_projectId_kind_status_idx`(`projectId`, `kind`, `status`),
  INDEX `agent_run_inputHash_idx`(`inputHash`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `agent_task` (
  `id` VARCHAR(191) NOT NULL,
  `runId` VARCHAR(191) NOT NULL,
  `taskKey` VARCHAR(191) NOT NULL,
  `role` VARCHAR(191) NOT NULL,
  `frameId` VARCHAR(191) NULL,
  `status` VARCHAR(191) NOT NULL,
  `dependencies` JSON NULL,
  `inputHash` VARCHAR(64) NOT NULL,
  `artifact` JSON NULL,
  `diagnostics` JSON NULL,
  `attempt` INTEGER NOT NULL DEFAULT 0,
  `maxAttempts` INTEGER NOT NULL DEFAULT 1,
  `errorCode` VARCHAR(191) NULL,
  `errorMessage` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `startedAt` DATETIME(3) NULL,
  `finishedAt` DATETIME(3) NULL,

  UNIQUE INDEX `agent_task_runId_taskKey_key`(`runId`, `taskKey`),
  INDEX `agent_task_runId_status_idx`(`runId`, `status`),
  INDEX `agent_task_role_inputHash_idx`(`role`, `inputHash`),
  PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `agent_run`
  ADD CONSTRAINT `agent_run_projectId_fkey`
  FOREIGN KEY (`projectId`) REFERENCES `project`(`uuid`)
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `agent_task`
  ADD CONSTRAINT `agent_task_runId_fkey`
  FOREIGN KEY (`runId`) REFERENCES `agent_run`(`id`)
  ON DELETE CASCADE ON UPDATE CASCADE;
