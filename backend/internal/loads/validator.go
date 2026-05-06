package loads

import (
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

func ValidateUpdate(req *UpdateRequest) error {
	if req.GateCodeCol6 != nil && *req.GateCodeCol6 == "" {
		return errors.New("gate_code_col6 cannot be empty")
	}
	return nil
}

func ValidateBulkOrder(req *BulkOrderRequest) error {
	if len(req.Items) == 0 {
		return errors.New("items cannot be empty")
	}
	for _, item := range req.Items {
		if item.ID <= 0 {
			return errors.New("invalid item id")
		}
	}
	return nil
}

var validStatuses = map[string]bool{
	"pick up":   true,
	"pending":   true,
	"delivered": true,
}

var gateCodeRegex = regexp.MustCompile(`^\d+$`)

func ValidateBulkUpdateField(field string, value interface{}) error {
	switch field {
	case "gate_code_col6":
		str, ok := value.(string)
		if !ok {
			return errors.New("must be a string")
		}
		str = strings.TrimSpace(str)
		if str == "" {
			return errors.New("cannot be empty")
		}
		if !gateCodeRegex.MatchString(str) {
			return errors.New("digits only")
		}
		return nil

	case "rate_col7", "rate_min", "rate_max":
		f, err := toFloat(value)
		if err != nil {
			return errors.New("must be a number")
		}
		if f < 0 || f > 9999 {
			return errors.New("must be between 0 and 9999")
		}
		return nil

	case "status":
		str, ok := value.(string)
		if !ok {
			return errors.New("must be a string")
		}
		if !validStatuses[strings.ToLower(strings.TrimSpace(str))] {
			return fmt.Errorf("invalid status, must be one of: pick up, pending, delivered")
		}
		return nil

	case "pick_up_date_col1":
		str, ok := value.(string)
		if !ok {
			return errors.New("must be a string")
		}
		if !regexp.MustCompile(`^\d{4}-\d{2}-\d{2}$`).MatchString(str) {
			return errors.New("format must be YYYY-MM-DD")
		}
		return nil

	case "commodity_col2", "pickup_date_location_col3", "delivery_date_location_col4",
		"assigned_user_col5", "note_mcc", "comments":
		if _, ok := value.(string); !ok {
			return errors.New("must be a string")
		}
		return nil

	case "is_bold", "is_lock":
		_, ok := value.(bool)
		if !ok {
			return errors.New("must be a boolean")
		}
		return nil

	case "font_size", "order_number":
		_, err := toFloat(value)
		if err != nil {
			return errors.New("must be a number")
		}
		return nil

	default:
		return fmt.Errorf("unknown field: %s", field)
	}
}

var allowedBulkUpdateFields = map[string]bool{
	"pick_up_date_col1":         true,
	"commodity_col2":            true,
	"pickup_date_location_col3": true,
	"delivery_date_location_col4": true,
	"assigned_user_col5":        true,
	"gate_code_col6":            true,
	"rate_col7":                 true,
	"rate_min":                  true,
	"rate_max":                  true,
	"is_bold":                   true,
	"is_lock":                   true,
	"font_size":                 true,
	"status":                    true,
	"note_mcc":                  true,
	"comments":                  true,
	"order_number":              true,
}

func ValidateBulkUpdateItem(field string, value interface{}) error {
	if !allowedBulkUpdateFields[field] {
		return fmt.Errorf("unknown field: %s", field)
	}
	return ValidateBulkUpdateField(field, value)
}

func toFloat(v interface{}) (float64, error) {
	switch val := v.(type) {
	case float64:
		return val, nil
	case int:
		return float64(val), nil
	case string:
		return strconv.ParseFloat(val, 64)
	case json.Number:
		return val.Float64()
	default:
		return 0, fmt.Errorf("cannot convert %T to number", v)
	}
}
