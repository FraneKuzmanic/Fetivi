CREATE TABLE "catalog_recommendations" (
	"record_id" uuid NOT NULL,
	"day" date NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "catalog_recommendations_record_id_day_pk" PRIMARY KEY("record_id","day"),
	CONSTRAINT "catalog_recommendations_count_check" CHECK ("catalog_recommendations"."count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "catalog_recommendations" ADD CONSTRAINT "catalog_recommendations_record_id_catalog_records_id_fk" FOREIGN KEY ("record_id") REFERENCES "public"."catalog_records"("id") ON DELETE cascade ON UPDATE no action;