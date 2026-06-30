ALTER TABLE `account_tokens` ADD `billing_multiplier` real DEFAULT 1;--> statement-breakpoint
ALTER TABLE `accounts` ADD `api_token_billing_multiplier` real DEFAULT 1;
