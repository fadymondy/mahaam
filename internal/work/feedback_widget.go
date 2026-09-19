package work

import (
	"encoding/json"
	"regexp"
	"strings"
)

/*
WidgetConfig is how a key's Feedback SDK launcher looks on the customer's site, set per
key in the project settings (and over MCP), stored in project_feedback_keys.widget and
served publicly by GET /api/feedback/embed/config. Every field is optional; the widget
falls back to Mahaam's brand. Visitors can still drag the launcher, dock it to the edge
or hide it from its context menu; that is kept in their browser, not here.
*/
type WidgetConfig struct {
	Color     string `json:"color,omitempty" doc:"Launcher background, #rrggbb (default: Mahaam purple)"`
	TextColor string `json:"text_color,omitempty" doc:"Launcher text/icon colour, #rrggbb"`
	Icon      string `json:"icon,omitempty" enum:"bug,message,help,lightbulb,megaphone,sparkles,none," doc:"Launcher icon"`
	Text      string `json:"text,omitempty" maxLength:"40" doc:"Launcher label (default: Report a problem)"`
	Shape     string `json:"shape,omitempty" enum:"pill,circle,square,tab," doc:"pill (icon + text), circle/square (icon only), tab (vertical edge tab)"`
	Position  string `json:"position,omitempty" enum:"bottom-end,bottom-start,top-end,top-start,middle-end,middle-start," doc:"Initial corner or edge"`
	Theme     string `json:"theme,omitempty" enum:"auto,light,dark," doc:"Dialog theme"`
	Locale    string `json:"locale,omitempty" enum:"auto,en,ar," doc:"Dialog language"`
}

var (
	hexColor     = regexp.MustCompile(`^#[0-9a-fA-F]{6}$`)
	widgetIcons  = []string{"bug", "message", "help", "lightbulb", "megaphone", "sparkles", "none"}
	widgetShapes = []string{"pill", "circle", "square", "tab"}
	widgetPos    = []string{"bottom-end", "bottom-start", "top-end", "top-start", "middle-end", "middle-start"}
)

func inList(v string, list []string) bool {
	for _, x := range list {
		if x == v {
			return true
		}
	}
	return false
}

// Normalize validates and canonicalises a config; "" fields stay unset.
func (c WidgetConfig) Normalize() (WidgetConfig, error) {
	c.Color, c.TextColor = strings.ToLower(strings.TrimSpace(c.Color)), strings.ToLower(strings.TrimSpace(c.TextColor))
	c.Text = strings.TrimSpace(c.Text)
	for _, col := range []string{c.Color, c.TextColor} {
		if col != "" && !hexColor.MatchString(col) {
			return c, invalid("colours are #rrggbb (got %q)", col)
		}
	}
	if len([]rune(c.Text)) > 40 {
		return c, invalid("the launcher text is at most 40 characters")
	}
	checks := []struct {
		v, what string
		list    []string
	}{
		{c.Icon, "icon", widgetIcons}, {c.Shape, "shape", widgetShapes}, {c.Position, "position", widgetPos},
		{c.Theme, "theme", []string{"auto", "light", "dark"}}, {c.Locale, "locale", []string{"auto", "en", "ar"}},
	}
	for _, ch := range checks {
		if ch.v != "" && !inList(ch.v, ch.list) {
			return c, invalid("unknown %s %q (use one of: %s)", ch.what, ch.v, strings.Join(ch.list, ", "))
		}
	}
	return c, nil
}

// ParseWidget reads a stored widget column; a bad value reads as the default look.
func ParseWidget(raw []byte) WidgetConfig {
	var c WidgetConfig
	_ = json.Unmarshal(raw, &c)
	return c
}
