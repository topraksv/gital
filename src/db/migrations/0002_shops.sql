CREATE TABLE `shops` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`tombstone_version` integer DEFAULT 0 NOT NULL,
	`list_id` text NOT NULL,
	`number` integer NOT NULL,
	`finished_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_shops_list_id` ON `shops` (`list_id`);--> statement-breakpoint
DROP INDEX `idx_items_list_id`;--> statement-breakpoint
ALTER TABLE `items` ADD `shop_id` text;--> statement-breakpoint
CREATE INDEX `idx_items_list_id_shop_id` ON `items` (`list_id`,`shop_id`);--> statement-breakpoint
CREATE INDEX `idx_items_shop_id` ON `items` (`shop_id`);