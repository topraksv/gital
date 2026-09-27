CREATE TABLE `list_members` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`tombstone_version` integer DEFAULT 0 NOT NULL,
	`list_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`seen_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_list_members_list_id` ON `list_members` (`list_id`);--> statement-breakpoint
ALTER TABLE `items` ADD `added_by` text;--> statement-breakpoint
ALTER TABLE `items` ADD `checked_by` text;