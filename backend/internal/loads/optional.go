package loads

import (
	"bytes"
	"encoding/json"
	"fmt"
)

// Optional[T] represents a JSON field that can be:
// - absent (Set=false)
// - present with null (Set=true, Value=nil)
// - present with value (Set=true, Value!=nil)
//
// This is required to support "clear cell" semantics coming from Fortune Sheet:
// JSON payloads often send explicit null, which must translate to SQL SET col = NULL.
type Optional[T any] struct {
	Set   bool
	Value *T
}

func (o *Optional[T]) UnmarshalJSON(b []byte) error {
	o.Set = true
	if bytes.Equal(bytes.TrimSpace(b), []byte("null")) {
		o.Value = nil
		return nil
	}
	var v T
	if err := json.Unmarshal(b, &v); err != nil {
		return err
	}
	o.Value = &v
	return nil
}

func (o Optional[T]) IsSet() bool { return o.Set }

func (o Optional[T]) Get() (any, bool) {
	if !o.Set {
		return nil, false
	}
	if o.Value == nil {
		return nil, true
	}
	return *o.Value, true
}

func (o Optional[T]) String() string {
	if !o.Set {
		return "<absent>"
	}
	if o.Value == nil {
		return "<null>"
	}
	raw, _ := json.Marshal(*o.Value)
	return fmt.Sprintf("%s", raw)
}

