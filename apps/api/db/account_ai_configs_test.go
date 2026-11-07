package migrations

import (
	"bytes"
	"context"
	"crypto/sha256"
	"fmt"
	"io/fs"
	"os"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestAccountAIConfigUpgradePreservesLegacy(t *testing.T) {
	connection := os.Getenv("COFLOW_TEST_DATABASE_URL")
	if connection == "" {
		t.Skip("isolated PostgreSQL required")
	}
	ctx := t.Context()
	admin, e := pgxpool.New(ctx, connection)
	if e != nil {
		t.Fatal(e)
	}
	defer admin.Close()
	schema := fmt.Sprintf("account_ai_%d", time.Now().UnixNano())
	if _, e = admin.Exec(ctx, "CREATE SCHEMA "+pgx.Identifier{schema}.Sanitize()); e != nil {
		t.Fatal(e)
	}
	defer admin.Exec(context.Background(), "DROP SCHEMA "+pgx.Identifier{schema}.Sanitize()+" CASCADE")
	cfg, e := pgxpool.ParseConfig(connection)
	if e != nil {
		t.Fatal(e)
	}
	cfg.ConnConfig.RuntimeParams["search_path"] = schema
	pool, e := pgxpool.NewWithConfig(ctx, cfg)
	if e != nil {
		t.Fatal(e)
	}
	defer pool.Close()
	_, e = pool.Exec(ctx, `CREATE TABLE schema_migrations(name text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())`)
	if e != nil {
		t.Fatal(e)
	}
	paths, _ := fs.Glob(files, "migrations/*.sql")
	sort.Strings(paths)
	for _, name := range paths {
		if name >= "migrations/015_" {
			continue
		}
		body, _ := files.ReadFile(name)
		if _, e = pool.Exec(ctx, string(body)); e != nil {
			t.Fatal(name, e)
		}
		if _, e = pool.Exec(ctx, `INSERT INTO schema_migrations(name,checksum) VALUES($1,$2)`, name, fmt.Sprintf("%x", sha256.Sum256(body))); e != nil {
			t.Fatal(e)
		}
	}
	_, e = pool.Exec(ctx, `INSERT INTO users(id,email,name,password_hash) VALUES('account','synthetic@example.test','Synthetic','unused');INSERT INTO teams(id,name) VALUES('old-a','A'),('old-b','B')`)
	if e != nil {
		t.Fatal(e)
	}
	for _, v := range []struct {
		id, team string
		owner    any
		offset   int
	}{{"personal-a", "old-a", "account", -10}, {"personal-b", "old-b", "account", 0}, {"shared", "old-a", nil, 0}} {
		_, e = pool.Exec(ctx, `INSERT INTO assistant_configs(id,team_id,owner_id,name,provider,protocol,base_url,model,secret,is_default,verified_at,revision,updated_at) VALUES($1,$2,$3,$1,'compatible','chat-completions','https://models.example.test','qa',$4,true,now(),7,now()+make_interval(secs=>$5))`, v.id, v.team, v.owner, []byte("unchanged encrypted bytes"), v.offset)
		if e != nil {
			t.Fatal(e)
		}
	}
	if e = Apply(ctx, pool); e != nil {
		t.Fatal(e)
	}
	if e = Apply(ctx, pool); e != nil {
		t.Fatal("reapply", e)
	}
	for _, id := range []string{"personal-a", "personal-b"} {
		var team *string
		var encryptionContext string
		var secret []byte
		var revision int
		var def bool
		if e = pool.QueryRow(ctx, `SELECT team_id,secret_context,secret,revision,is_default FROM assistant_configs WHERE id=$1`, id).Scan(&team, &encryptionContext, &secret, &revision, &def); e != nil {
			t.Fatal(e)
		}
		if team != nil || encryptionContext != "old-"+strings.TrimPrefix(id, "personal-") || !bytes.Equal(secret, []byte("unchanged encrypted bytes")) || revision != 7 || def != (id == "personal-b") {
			t.Fatal("legacy config changed", id)
		}
	}
	// Removing a former workspace must not remove the account's credential.
	if _, e = pool.Exec(ctx, `DELETE FROM teams WHERE id='old-b'`); e != nil {
		t.Fatal(e)
	}
	var count int
	if e = pool.QueryRow(ctx, `SELECT count(*) FROM assistant_configs`).Scan(&count); e != nil || count != 3 {
		t.Fatal("account config cascaded", count, e)
	}
}
