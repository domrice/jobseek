ALTER TABLE `jobs` ADD `work_mode` text;--> statement-breakpoint
CREATE INDEX `jobs_work_mode_idx` ON `jobs` (`work_mode`);