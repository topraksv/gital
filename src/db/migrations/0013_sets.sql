CREATE TABLE `set_items` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`tombstone_version` integer DEFAULT 0 NOT NULL,
	`set_id` text NOT NULL,
	`name` text NOT NULL,
	`quantity_milli` integer,
	`unit` text,
	`note` text,
	`position` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_set_items_set_id` ON `set_items` (`set_id`);--> statement-breakpoint
CREATE TABLE `sets` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`tombstone_version` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL
);
