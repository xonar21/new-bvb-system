package sheetdoc

import (
	"encoding/json"
	"strconv"
)

// cellText normalizes a Fortune Sheet cell value (which may be a string, number,
// bool, or a nested {v, m} object) into a plain display string.
func cellText(v interface{}) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		if t {
			return "true"
		}
		return "false"
	case map[string]interface{}:
		if inner, ok := t["v"]; ok {
			return cellText(inner)
		}
		return ""
	}
	return ""
}

// extractCells builds a (row,col) → text map from the first sheet of a Fortune
// Sheet document, handling both the sparse `celldata` and 2D `data` matrix forms.
func extractCells(data json.RawMessage) map[[2]int]string {
	out := map[[2]int]string{}
	if len(data) == 0 {
		return out
	}
	var sheets []map[string]json.RawMessage
	if err := json.Unmarshal(data, &sheets); err != nil || len(sheets) == 0 {
		return out
	}
	s := sheets[0]

	if cd, ok := s["celldata"]; ok {
		var arr []struct {
			R int         `json:"r"`
			C int         `json:"c"`
			V interface{} `json:"v"`
		}
		if json.Unmarshal(cd, &arr) == nil {
			for _, c := range arr {
				if txt := cellText(c.V); txt != "" {
					out[[2]int{c.R, c.C}] = txt
				}
			}
		}
	}

	if dm, ok := s["data"]; ok {
		var matrix [][]interface{}
		if json.Unmarshal(dm, &matrix) == nil {
			for r, row := range matrix {
				for c, cell := range row {
					if txt := cellText(cell); txt != "" {
						out[[2]int{r, c}] = txt
					}
				}
			}
		}
	}
	return out
}

// diffCells returns the per-cell changes between two document snapshots.
func diffCells(oldData, newData json.RawMessage) []CellChange {
	o := extractCells(oldData)
	n := extractCells(newData)
	var changes []CellChange

	for k, nv := range n {
		if ov := o[k]; ov != nv {
			changes = append(changes, CellChange{RowIdx: k[0], ColIdx: k[1], OldValue: o[k], NewValue: nv})
		}
	}
	for k, ov := range o {
		if _, ok := n[k]; !ok {
			changes = append(changes, CellChange{RowIdx: k[0], ColIdx: k[1], OldValue: ov, NewValue: ""})
		}
	}
	return changes
}
