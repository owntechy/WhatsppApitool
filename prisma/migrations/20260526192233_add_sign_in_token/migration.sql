-- AlterTable
ALTER TABLE `verification_codes` ADD COLUMN `sign_in_token` VARCHAR(191) NULL,
    ADD COLUMN `signed_in_at` DATETIME(3) NULL;

-- CreateIndex
CREATE INDEX `verification_codes_sign_in_token_idx` ON `verification_codes`(`sign_in_token`);
