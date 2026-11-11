CREATE TABLE `job_scores` (
	`job_id` integer NOT NULL,
	`profile_id` integer NOT NULL,
	`content_hash` text NOT NULL,
	`keyword_score` real NOT NULL,
	`keyword_detail` text NOT NULL,
	`llm_score` real,
	`llm_recommendation` text,
	`llm_detail` text,
	`llm_model` text,
	`llm_prompt_version` text,
	`final_score` real NOT NULL,
	`explanation` text,
	`scored_at` integer NOT NULL,
	PRIMARY KEY(`job_id`, `profile_id`),
	FOREIGN KEY (`job_id`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`profile_id`) REFERENCES `search_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `job_scores_profile_final_score_idx` ON `job_scores` (`profile_id`,`final_score`);--> statement-breakpoint
CREATE TABLE `jobs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`source` text NOT NULL,
	`source_job_id` text NOT NULL,
	`url` text NOT NULL,
	`canonical_url` text NOT NULL,
	`title` text NOT NULL,
	`company` text,
	`location` text,
	`description` text,
	`posted_at` integer,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`content_hash` text NOT NULL,
	`duplicate_of` integer,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`duplicate_of`) REFERENCES `jobs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `jobs_content_hash_idx` ON `jobs` (`content_hash`);--> statement-breakpoint
CREATE INDEX `jobs_source_idx` ON `jobs` (`source`);--> statement-breakpoint
CREATE INDEX `jobs_company_idx` ON `jobs` (`company`);--> statement-breakpoint
CREATE INDEX `jobs_posted_at_idx` ON `jobs` (`posted_at`);--> statement-breakpoint
CREATE INDEX `jobs_duplicate_of_idx` ON `jobs` (`duplicate_of`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_source_source_job_id_unique` ON `jobs` (`source`,`source_job_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `jobs_canonical_url_unique` ON `jobs` (`canonical_url`);--> statement-breakpoint
CREATE TABLE `pipeline_runs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`summary` text,
	`errors` text DEFAULT '[]' NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `search_profiles`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `search_profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`query` text NOT NULL,
	`location` text,
	`remote_only` integer DEFAULT false NOT NULL,
	`required_keywords` text DEFAULT '[]' NOT NULL,
	`preferred_keywords` text DEFAULT '[]' NOT NULL,
	`excluded_keywords` text DEFAULT '[]' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `search_profiles_name_unique` ON `search_profiles` (`name`);