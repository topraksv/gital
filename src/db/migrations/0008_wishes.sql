CREATE TABLE `wish_links` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`tombstone_version` integer DEFAULT 0 NOT NULL,
	`list_id` text NOT NULL,
	`wish_id` text NOT NULL,
	`url` text NOT NULL,
	`price_minor` integer
);
--> statement-breakpoint
CREATE INDEX `idx_wish_links_wish_id` ON `wish_links` (`wish_id`);--> statement-breakpoint
CREATE TABLE `wishes` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`tombstone_version` integer DEFAULT 0 NOT NULL,
	`list_id` text NOT NULL,
	`name` text NOT NULL,
	`note` text,
	`priority` integer DEFAULT 1 NOT NULL,
	`estimate_minor` integer,
	`bought_at` text
);
--> statement-breakpoint
CREATE INDEX `idx_wishes_list_id` ON `wishes` (`list_id`);--> statement-breakpoint
ALTER TABLE `lists` ADD `kind` text DEFAULT 'shop' NOT NULL;