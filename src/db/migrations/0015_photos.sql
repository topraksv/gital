CREATE TABLE `photos` (
	`id` text PRIMARY KEY NOT NULL,
	`data` text NOT NULL,
	`thumb` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `items` ADD `photo_id` text;--> statement-breakpoint
ALTER TABLE `wishes` ADD `photo_id` text;