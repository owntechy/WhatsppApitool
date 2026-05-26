-- AlterTable
ALTER TABLE `users` ADD COLUMN `two_factor_enabled` BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE `verification_codes` (
    `id` VARCHAR(191) NOT NULL,
    `user_id` VARCHAR(191) NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL DEFAULT '2fa',
    `expires_at` DATETIME(3) NOT NULL,
    `consumed_at` DATETIME(3) NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `verification_codes_user_id_type_idx`(`user_id`, `type`),
    INDEX `verification_codes_code_idx`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `verification_codes` ADD CONSTRAINT `verification_codes_user_id_fkey` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
