CREATE TABLE "user" (
  "id" SERIAL NOT NULL,
  "firstName" VARCHAR(255) NOT NULL,
  "lastName" VARCHAR(255) NOT NULL,
  "age" integer NOT NULL,
  PRIMARY KEY ("id")
);