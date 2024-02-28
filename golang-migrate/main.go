package main

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"strings"

	"github.com/golang-migrate/migrate/v4"
	"github.com/golang-migrate/migrate/v4/database/postgres"
	_ "github.com/golang-migrate/migrate/v4/source/file"
	_ "github.com/lib/pq"
)

// getEnvAsBool looks up an environment variable and tries to parse it as a boolean.
// It returns true if the variable is set to "true", "1", or "yes" (case-insensitive),
// and returns false otherwise.
func getEnvAsBool(name string) bool {
	val := os.Getenv(name)
	return strings.EqualFold(val, "true") || strings.EqualFold(val, "1") || strings.EqualFold(val, "yes")
}

func getDBURL() string {
	url := os.Getenv("PG_URL")
	if url != "" {
		return url
	}
	return "postgres://postgres:postgres@localhost:5432/example?sslmode=disable"
}

func tableExists(db *sql.DB, tableName string) bool {
	// Query to check if the table exists in the current database
	// Adjust the schema ('public') as needed for your database
	query := `SELECT EXISTS (
        SELECT FROM pg_catalog.pg_tables 
        WHERE  schemaname = 'public' 
        AND    tablename  = $1
    );`
	var exists bool
	err := db.QueryRow(query, tableName).Scan(&exists)
	if err != nil {
		log.Fatal("Failed to execute query: ", err)
	}
	return exists
}

func main() {
	prod := getEnvAsBool(os.Getenv("PROD"))

	db, err := sql.Open("postgres", getDBURL())
	if err != nil {
		log.Fatal(err)
	}
	driver, err := postgres.WithInstance(db, &postgres.Config{})
	if err != nil {
		log.Fatal(err)
	}

	if prod {
		fmt.Println("Prod environment. Migration is run before deployment.")
	} else {
		fmt.Println("Non prod environment. Run migration directly.")
		m, err := migrate.NewWithDatabaseInstance(
			"file://./migrations",
			"postgres", driver)
		if err != nil {
			log.Fatal(err)
		}
		v, _, _ := m.Version()
		fmt.Printf("Schema version before migration: %v.\n", v)
		err = m.Up()

		if err == nil {
			v, _, _ = m.Version()
			fmt.Printf("Schema version after migration: %v.\n", v)
		} else {
			if err == migrate.ErrNoChange {
				fmt.Printf("No migration. Schema is already latest: %v.\n", v)
			} else {
				log.Fatal(err)
			}
		}
	}

	tableName := "users"
	if tableExists(db, tableName) {
		fmt.Printf("SUCCESS! Migration applied. Table %s created.\n", tableName)
	} else {
		log.Fatalf("FAIL! Migration hasn't been applied. Table %s not created.\n", tableName)
	}
}
