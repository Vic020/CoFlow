package identity

import (
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
)

func TestPasswordLength(t *testing.T) {
	for _, size := range []int{0, 7, 73} {
		if _, err := passwordHash(strings.Repeat("a", size)); err == nil {
			t.Errorf("accepted password of %d bytes", size)
		}
	}
	for _, size := range []int{8, 72} {
		password := strings.Repeat("a", size)
		hash, err := passwordHash(password)
		if err != nil {
			t.Fatalf("rejected password of %d bytes: %v", size, err)
		}
		if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)); err != nil {
			t.Fatalf("password of %d bytes cannot be verified: %v", size, err)
		}
	}
}
