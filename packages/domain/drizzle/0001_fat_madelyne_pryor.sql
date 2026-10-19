CREATE TYPE "public"."account_role" AS ENUM('host', 'admin');--> statement-breakpoint
CREATE TYPE "public"."account_token_purpose" AS ENUM('verify_email', 'reset_password');--> statement-breakpoint
CREATE TABLE "account_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"purpose" "account_token_purpose" NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "account_role" NOT NULL,
	"email_verified_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "act_as_audit" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "act_as_audit_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"admin_id" uuid NOT NULL,
	"host_id" uuid NOT NULL,
	"host_email" text NOT NULL,
	"method" text NOT NULL,
	"route" text NOT NULL,
	"status_code" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "login_attempts" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "login_attempts_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"email" text NOT NULL,
	"ip" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" uuid NOT NULL,
	"acting_as_host_id" uuid,
	"created_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"absolute_expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_tokens" ADD CONSTRAINT "account_tokens_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_acting_as_host_id_accounts_id_fk" FOREIGN KEY ("acting_as_host_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_tokens_account_purpose_idx" ON "account_tokens" USING btree ("account_id","purpose","created_at");--> statement-breakpoint
CREATE INDEX "act_as_audit_created_idx" ON "act_as_audit" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_email_idx" ON "login_attempts" USING btree ("email","created_at");--> statement-breakpoint
CREATE INDEX "login_attempts_ip_idx" ON "login_attempts" USING btree ("ip","created_at");--> statement-breakpoint
CREATE INDEX "sessions_account_idx" ON "sessions" USING btree ("account_id");