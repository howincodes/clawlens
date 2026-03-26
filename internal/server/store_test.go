package server

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/howincodes/clawlens/internal/shared"
)

// newTestStore creates a fresh in-memory-equivalent test store and seeds it.
func newTestStore(t *testing.T) *Store {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	if err := store.Seed("testpass", "selfhost"); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { store.Close() })
	return store
}

func TestStoreInitAndSeed(t *testing.T) {
	store := newTestStore(t)

	team, err := store.GetTeam()
	if err != nil {
		t.Fatalf("GetTeam: %v", err)
	}
	if team == nil {
		t.Fatal("expected team, got nil")
	}
	if team.Name != "Default Team" {
		t.Errorf("expected name %q, got %q", "Default Team", team.Name)
	}
	if team.ID != "default" {
		t.Errorf("expected id %q, got %q", "default", team.ID)
	}

	// Verify the seeded password round-trips correctly.
	if !shared.VerifyPassword(team.AdminPassword, "testpass") {
		t.Error("password verification failed")
	}
}

func TestTeamSettings(t *testing.T) {
	store := newTestStore(t)

	// GetTeamSettings should parse JSON without error.
	settings, err := store.GetTeamSettings("default")
	if err != nil {
		t.Fatalf("GetTeamSettings: %v", err)
	}
	if settings.CollectionLevel != "full" {
		t.Errorf("expected collection_level %q, got %q", "full", settings.CollectionLevel)
	}
	if settings.SyncIntervalSeconds != 30 {
		t.Errorf("expected sync_interval_seconds 30, got %d", settings.SyncIntervalSeconds)
	}
	if settings.CreditWeights.Opus != 10 {
		t.Errorf("expected opus credit weight 10, got %d", settings.CreditWeights.Opus)
	}

	// Mutate and round-trip.
	settings.CollectionLevel = "minimal"
	settings.SyncIntervalSeconds = 60
	if err := store.UpdateTeamSettings("default", *settings); err != nil {
		t.Fatalf("UpdateTeamSettings: %v", err)
	}

	updated, err := store.GetTeamSettings("default")
	if err != nil {
		t.Fatalf("GetTeamSettings after update: %v", err)
	}
	if updated.CollectionLevel != "minimal" {
		t.Errorf("expected collection_level %q, got %q", "minimal", updated.CollectionLevel)
	}
	if updated.SyncIntervalSeconds != 60 {
		t.Errorf("expected sync_interval_seconds 60, got %d", updated.SyncIntervalSeconds)
	}
}

func TestUserCRUD(t *testing.T) {
	store := newTestStore(t)

	u := &shared.User{
		ID:        shared.GenerateID(),
		TeamID:    "default",
		Slug:      "alice",
		Name:      "Alice",
		AuthToken: shared.GenerateToken(),
		Status:    "active",
	}

	// Create
	if err := store.CreateUser(u); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	// GetUser
	got, err := store.GetUser(u.ID)
	if err != nil {
		t.Fatalf("GetUser: %v", err)
	}
	if got == nil {
		t.Fatal("expected user, got nil")
	}
	if got.Name != "Alice" {
		t.Errorf("expected name Alice, got %q", got.Name)
	}

	// GetUserByToken
	byToken, err := store.GetUserByToken(u.AuthToken)
	if err != nil {
		t.Fatalf("GetUserByToken: %v", err)
	}
	if byToken == nil || byToken.ID != u.ID {
		t.Error("GetUserByToken returned wrong user")
	}

	// GetUsers
	users, err := store.GetUsers("default")
	if err != nil {
		t.Fatalf("GetUsers: %v", err)
	}
	if len(users) != 1 {
		t.Errorf("expected 1 user, got %d", len(users))
	}

	// UpdateUserStatus — active → killed
	if err := store.UpdateUserStatus(u.ID, "killed"); err != nil {
		t.Fatalf("UpdateUserStatus: %v", err)
	}
	killed, err := store.GetUser(u.ID)
	if err != nil {
		t.Fatalf("GetUser after kill: %v", err)
	}
	if killed.Status != "killed" {
		t.Errorf("expected status killed, got %q", killed.Status)
	}
	if killed.KilledAt == nil {
		t.Error("expected KilledAt to be set")
	}

	// UpdateUser — change name
	newName := "Alice Updated"
	if err := store.UpdateUser(u.ID, &newName, nil, nil); err != nil {
		t.Fatalf("UpdateUser: %v", err)
	}
	renamed, err := store.GetUser(u.ID)
	if err != nil {
		t.Fatalf("GetUser after rename: %v", err)
	}
	if renamed.Name != "Alice Updated" {
		t.Errorf("expected name %q, got %q", "Alice Updated", renamed.Name)
	}

	// DeleteUser
	if err := store.DeleteUser(u.ID); err != nil {
		t.Fatalf("DeleteUser: %v", err)
	}
	deleted, err := store.GetUser(u.ID)
	if err != nil {
		t.Fatalf("GetUser after delete: %v", err)
	}
	if deleted != nil {
		t.Error("expected nil after delete")
	}
}

func TestSubscriptionUpsert(t *testing.T) {
	store := newTestStore(t)

	sub := &shared.Subscription{
		ID:     shared.GenerateID(),
		TeamID: "default",
		Email:  "bob@example.com",
	}
	displayName := "Bob"
	sub.DisplayName = &displayName

	// First upsert — insert
	if err := store.UpsertSubscription(sub); err != nil {
		t.Fatalf("UpsertSubscription (insert): %v", err)
	}

	got, err := store.GetSubscriptionByEmail("default", "bob@example.com")
	if err != nil {
		t.Fatalf("GetSubscriptionByEmail: %v", err)
	}
	if got == nil {
		t.Fatal("expected subscription, got nil")
	}
	if got.DisplayName == nil || *got.DisplayName != "Bob" {
		t.Error("unexpected display_name after insert")
	}

	// Second upsert — update display_name
	updatedName := "Bob Smith"
	sub.DisplayName = &updatedName
	subType := "pro"
	sub.SubscriptionType = &subType

	if err := store.UpsertSubscription(sub); err != nil {
		t.Fatalf("UpsertSubscription (update): %v", err)
	}

	updated, err := store.GetSubscriptionByEmail("default", "bob@example.com")
	if err != nil {
		t.Fatalf("GetSubscriptionByEmail after update: %v", err)
	}
	if updated.DisplayName == nil || *updated.DisplayName != "Bob Smith" {
		t.Error("display_name not updated")
	}
	if updated.SubscriptionType == nil || *updated.SubscriptionType != "pro" {
		t.Error("subscription_type not updated")
	}

	// GetSubscriptions
	subs, err := store.GetSubscriptions("default")
	if err != nil {
		t.Fatalf("GetSubscriptions: %v", err)
	}
	if len(subs) != 1 {
		t.Errorf("expected 1 subscription, got %d", len(subs))
	}
}

func TestDeviceUpsert(t *testing.T) {
	store := newTestStore(t)

	// Need a user first.
	u := &shared.User{
		ID:        shared.GenerateID(),
		TeamID:    "default",
		Slug:      "dave",
		Name:      "Dave",
		AuthToken: shared.GenerateToken(),
		Status:    "active",
	}
	if err := store.CreateUser(u); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	hostname := "laptop.local"
	platform := "darwin"
	t1 := time.Now().UTC().Truncate(time.Second)

	d := &shared.Device{
		ID:       shared.GenerateID(),
		UserID:   u.ID,
		Hostname: &hostname,
		Platform: &platform,
		LastSeen: t1,
	}

	// First upsert — insert
	if err := store.UpsertDevice(d); err != nil {
		t.Fatalf("UpsertDevice (insert): %v", err)
	}

	devices, err := store.GetDevices(u.ID)
	if err != nil {
		t.Fatalf("GetDevices: %v", err)
	}
	if len(devices) != 1 {
		t.Fatalf("expected 1 device, got %d", len(devices))
	}

	// Second upsert — update last_seen
	t2 := t1.Add(time.Hour)
	d.LastSeen = t2
	newPlatform := "linux"
	d.Platform = &newPlatform

	if err := store.UpsertDevice(d); err != nil {
		t.Fatalf("UpsertDevice (update): %v", err)
	}

	devices2, err := store.GetDevices(u.ID)
	if err != nil {
		t.Fatalf("GetDevices after update: %v", err)
	}
	if len(devices2) != 1 {
		t.Fatalf("expected 1 device after upsert, got %d", len(devices2))
	}
	if !devices2[0].LastSeen.Equal(t2) {
		t.Errorf("expected last_seen %v, got %v", t2, devices2[0].LastSeen)
	}
	if devices2[0].Platform == nil || *devices2[0].Platform != "linux" {
		t.Error("platform not updated")
	}
}

func TestInstallCode(t *testing.T) {
	store := newTestStore(t)

	u := &shared.User{
		ID:        shared.GenerateID(),
		TeamID:    "default",
		Slug:      "charlie",
		Name:      "Charlie",
		AuthToken: shared.GenerateToken(),
		Status:    "active",
	}
	if err := store.CreateUser(u); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	code := shared.GenerateInstallCode(u.Slug)

	// Create code
	if err := store.CreateInstallCode(code, u.ID); err != nil {
		t.Fatalf("CreateInstallCode: %v", err)
	}

	// Use code — should return user
	gotUser, err := store.UseInstallCode(code)
	if err != nil {
		t.Fatalf("UseInstallCode: %v", err)
	}
	if gotUser == nil || gotUser.ID != u.ID {
		t.Error("UseInstallCode returned wrong user")
	}

	// Use again — should fail
	_, err = store.UseInstallCode(code)
	if err == nil {
		t.Error("expected error on second UseInstallCode, got nil")
	}
}

func TestLimitRules(t *testing.T) {
	store := newTestStore(t)

	u := &shared.User{
		ID:        shared.GenerateID(),
		TeamID:    "default",
		Slug:      "elena",
		Name:      "Elena",
		AuthToken: shared.GenerateToken(),
		Status:    "active",
	}
	if err := store.CreateUser(u); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	window := "day"
	value := 100
	rules := []shared.LimitRule{
		{
			ID:     shared.GenerateID(),
			UserID: u.ID,
			Type:   "prompt_count",
			Window: &window,
			Value:  &value,
		},
	}

	// Replace (insert)
	if err := store.ReplaceLimitRules(u.ID, rules); err != nil {
		t.Fatalf("ReplaceLimitRules: %v", err)
	}

	got, err := store.GetLimitRules(u.ID)
	if err != nil {
		t.Fatalf("GetLimitRules: %v", err)
	}
	if len(got) != 1 {
		t.Fatalf("expected 1 rule, got %d", len(got))
	}
	if got[0].Type != "prompt_count" {
		t.Errorf("expected type prompt_count, got %q", got[0].Type)
	}

	// Replace again — overwrites with 2 rules
	value2 := 50
	rules2 := []shared.LimitRule{
		{ID: shared.GenerateID(), UserID: u.ID, Type: "cost_usd", Window: &window, Value: &value2},
		{ID: shared.GenerateID(), UserID: u.ID, Type: "token_count", Window: &window, Value: &value},
	}
	if err := store.ReplaceLimitRules(u.ID, rules2); err != nil {
		t.Fatalf("ReplaceLimitRules (overwrite): %v", err)
	}

	got2, err := store.GetLimitRules(u.ID)
	if err != nil {
		t.Fatalf("GetLimitRules after overwrite: %v", err)
	}
	if len(got2) != 2 {
		t.Fatalf("expected 2 rules after overwrite, got %d", len(got2))
	}
}

func TestCountUsers(t *testing.T) {
	store := newTestStore(t)

	slugs := []string{"u1", "u2", "u3"}
	for _, slug := range slugs {
		u := &shared.User{
			ID:        shared.GenerateID(),
			TeamID:    "default",
			Slug:      slug,
			Name:      slug,
			AuthToken: shared.GenerateToken(),
			Status:    "active",
		}
		if err := store.CreateUser(u); err != nil {
			t.Fatalf("CreateUser %s: %v", slug, err)
		}
	}

	count, err := store.CountUsers("default")
	if err != nil {
		t.Fatalf("CountUsers: %v", err)
	}
	if count != 3 {
		t.Errorf("expected 3, got %d", count)
	}
}

func TestSaasSeed(t *testing.T) {
	dbPath := filepath.Join(t.TempDir(), "saas.db")
	store, err := NewStore(dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	if err := store.Init(); err != nil {
		t.Fatal(err)
	}
	if err := store.Seed("adminpass", "saas"); err != nil {
		t.Fatal(err)
	}

	plan, err := store.GetPlan("demo")
	if err != nil {
		t.Fatalf("GetPlan: %v", err)
	}
	if plan == nil {
		t.Fatal("expected demo plan, got nil")
	}
	if plan.Name != "Demo" {
		t.Errorf("expected plan name %q, got %q", "Demo", plan.Name)
	}
	if plan.MaxUsers != 5 {
		t.Errorf("expected max_users 5, got %d", plan.MaxUsers)
	}
}

func TestRotateUserToken(t *testing.T) {
	store := newTestStore(t)

	u := &shared.User{
		ID:        shared.GenerateID(),
		TeamID:    "default",
		Slug:      "frank",
		Name:      "Frank",
		AuthToken: shared.GenerateToken(),
		Status:    "active",
	}
	if err := store.CreateUser(u); err != nil {
		t.Fatalf("CreateUser: %v", err)
	}

	newToken, err := store.RotateUserToken(u.ID)
	if err != nil {
		t.Fatalf("RotateUserToken: %v", err)
	}
	if newToken == u.AuthToken {
		t.Error("new token should differ from old token")
	}

	// Old token should no longer resolve.
	byOld, err := store.GetUserByToken(u.AuthToken)
	if err != nil {
		t.Fatalf("GetUserByToken (old): %v", err)
	}
	if byOld != nil {
		t.Error("old token should return nil after rotation")
	}

	// New token should resolve.
	byNew, err := store.GetUserByToken(newToken)
	if err != nil {
		t.Fatalf("GetUserByToken (new): %v", err)
	}
	if byNew == nil || byNew.ID != u.ID {
		t.Error("new token should resolve to user")
	}
}

func TestGetTeamByID(t *testing.T) {
	store := newTestStore(t)

	team, err := store.GetTeamByID("default")
	if err != nil {
		t.Fatalf("GetTeamByID: %v", err)
	}
	if team == nil || team.ID != "default" {
		t.Error("expected default team")
	}

	missing, err := store.GetTeamByID("nonexistent")
	if err != nil {
		t.Fatalf("GetTeamByID nonexistent: %v", err)
	}
	if missing != nil {
		t.Error("expected nil for missing team")
	}
}
