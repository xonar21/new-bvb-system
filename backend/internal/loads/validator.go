package loads

import "errors"

func ValidateUpdate(req *UpdateRequest) error {
	if req.GateCodeCol6.Set && req.GateCodeCol6.Value != nil && *req.GateCodeCol6.Value == "" {
		return errors.New("gate_code_col6 cannot be empty")
	}
	return nil
}

func ValidateCreate(req *CreateRequest) error {
	if req.GateCodeCol6 == "" {
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
