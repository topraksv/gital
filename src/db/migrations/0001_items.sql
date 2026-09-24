CREATE TABLE `items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`tombstone_version` integer DEFAULT 0 NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity_milli` integer,
	`unit` text,
	`sort_order` integer DEFAULT 0 NOT NULL,
	`checked_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_items_list_id` ON `items` (`list_id`);