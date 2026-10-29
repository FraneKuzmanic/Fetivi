CREATE TABLE "catalog_embeddings" (
	"record_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"language" "guest_language" NOT NULL,
	"model" text NOT NULL,
	"vector" real[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "catalog_embeddings_record_id_revision_language_model_pk" PRIMARY KEY("record_id","revision","language","model")
);
--> statement-breakpoint
CREATE TABLE "host_place_embeddings" (
	"host_place_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"language" "guest_language" NOT NULL,
	"model" text NOT NULL,
	"vector" real[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "host_place_embeddings_host_place_id_revision_language_model_pk" PRIMARY KEY("host_place_id","revision","language","model")
);
--> statement-breakpoint
ALTER TABLE "catalog_embeddings" ADD CONSTRAINT "catalog_embeddings_translation_fk" FOREIGN KEY ("record_id","revision","language") REFERENCES "public"."catalog_translations"("record_id","revision","language") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "host_place_embeddings" ADD CONSTRAINT "host_place_embeddings_translation_fk" FOREIGN KEY ("host_place_id","revision","language") REFERENCES "public"."host_place_translations"("host_place_id","revision","language") ON DELETE cascade ON UPDATE no action;