CREATE TABLE `products` (
	`id` text PRIMARY KEY NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	`deleted_at` text,
	`tombstone_version` integer DEFAULT 0 NOT NULL,
	`name` text NOT NULL,
	`starred` integer DEFAULT false NOT NULL
);
