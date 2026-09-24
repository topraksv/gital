ALTER TABLE `items` ADD `note` text;--> statement-breakpoint
ALTER TABLE `items` ADD `urgent` integer DEFAULT false NOT NULL;