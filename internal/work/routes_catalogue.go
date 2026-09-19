package work

import (
	"context"
	"net/http"
)

// CatalogueItemRef is the {id} of a catalogue item. Exported so Huma binds it (see Register).
type CatalogueItemRef struct {
	ID string `path:"id" doc:"Catalogue item id"`
}

// catalogue: a project's agents and skills (the issue Agent/Skill pickers and @-mentions).
// Reads: anyone who can see the project; writes: managers or the project's lead.
func (r routes) catalogue() {
	const tag = "Project catalogue"
	do(r, http.MethodGet, "/api/w/projects/{project}/catalogue", "w-list-catalogue",
		"A project's agents and skills", tag, 0, func(ctx context.Context, in *struct {
			WS
			ProjectRef
		}) (*Catalogue, error) {
			return r.sv.ListCatalogue(ctx, in.Project)
		})
	do(r, http.MethodPost, "/api/w/projects/{project}/catalogue", "w-add-catalogue-item",
		"Add an agent or skill to a project (same name: updates its description)", tag, http.StatusCreated, func(ctx context.Context, in *struct {
			WS
			ProjectRef
			Body struct {
				Kind        string `json:"kind" enum:"agent,skill"`
				Name        string `json:"name" minLength:"1" maxLength:"100"`
				Description string `json:"description,omitempty" maxLength:"2000"`
			}
		}) (*CatalogueItem, error) {
			return r.sv.AddCatalogueItem(ctx, in.Project, in.Body.Kind, in.Body.Name, in.Body.Description, "ui")
		})
	none(r, http.MethodDelete, "/api/w/projects/{project}/catalogue/{id}", "w-delete-catalogue-item",
		"Remove an agent or skill from a project", tag, func(ctx context.Context, in *struct {
			WS
			ProjectRef
			CatalogueItemRef
		}) error {
			return r.sv.DeleteCatalogueItem(ctx, in.Project, in.ID)
		})
	do(r, http.MethodPut, "/api/w/projects/{project}/catalogue/sync", "w-sync-catalogue",
		"Sync a repo's .claude/ agents and skills into the project (replace: drop synced items missing from the payload)", tag, 0, func(ctx context.Context, in *struct {
			WS
			ProjectRef
			Body struct {
				Agents  []CatalogueEntry `json:"agents,omitempty" maxItems:"500"`
				Skills  []CatalogueEntry `json:"skills,omitempty" maxItems:"500"`
				Replace bool             `json:"replace,omitempty"`
			}
		}) (*Catalogue, error) {
			return r.sv.SyncCatalogue(ctx, in.Project, in.Body.Agents, in.Body.Skills, in.Body.Replace)
		})
}
