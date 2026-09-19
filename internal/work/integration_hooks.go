package work

import (
	"context"

	"github.com/fadymondy/mahaam/internal/tenant"
)

// ActivityEntry is an activity-feed entry written by another domain package (the
// integrations package: connect / sync / webhook deliveries). Same shape as the internal entry.
type ActivityEntry struct {
	ProjectID, TaskID              string
	Action, SubjectType, SubjectID string
	Changes                        map[string]any
}

// Querier is satisfied by *sql.DB and *sql.Tx.
type Querier = querier

// RecordActivity appends an activity entry for s (the session user, the MCP token's user, or
// a system scope carrying the integration's creator) on q — pass the transaction of the change
// when there is one. It is the same writer internal/work uses, so the feed has one format.
func RecordActivity(ctx context.Context, q Querier, s *tenant.Scope, e ActivityEntry) error {
	return record(ctx, q, s, entry(e))
}
