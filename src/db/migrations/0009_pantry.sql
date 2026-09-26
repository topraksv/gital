CREATE TABLE `pantry_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`tombstone_version` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`list_id` text
);
--> statement-breakpoint
CREATE TABLE `pantry_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`tombstone_version` integer DEFAULT 0 NOT NULL,
	`pantry_item_id` text NOT NULL,
	`quantity_milli` integer NOT NULL,
	`unit` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_pantry_moves_pantry_item_id` ON `pantry_moves` (`pantry_item_id`);