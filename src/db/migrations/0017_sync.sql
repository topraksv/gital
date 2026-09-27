CREATE TABLE `sync_dead_letters` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`outbox_id` integer NOT NULL,
	`table_name` text NOT NULL,
	`row_id` text NOT NULL,
	`payload` text NOT NULL,
	`reason` text NOT NULL,
	`quarantined_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sync_dead_letters_outbox_id_unique` ON `sync_dead_letters` (`outbox_id`);--> statement-breakpoint
CREATE TABLE `sync_state` (
	`table_name` text PRIMARY KEY NOT NULL,
	`last_pulled_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `photos` ADD `uploaded_at` text;