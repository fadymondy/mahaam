-- Project-scoped MCP tokens: a token can be limited to some projects (JSON array of project ids;
-- '[]' = every project the user can see). Enforced through tenant.Scope.ProjectIDs in
-- work.visibleClause (projects, tasks, time, reports) and reports.List/Find/Create (issues).
ALTER TABLE mcp_tokens ADD COLUMN IF NOT EXISTS project_ids text NOT NULL DEFAULT '[]';
