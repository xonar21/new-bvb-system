package loads

import "strings"

func NormalizeGateCode(gateCode string) string {
	return strings.TrimLeft(gateCode, "0")
}

func DetectMCC(notes string) bool {
	if notes == "" {
		return false
	}
	lower := strings.ToLower(strings.TrimSpace(notes))
	return strings.Contains(lower, "mcc cans") || strings.Contains(lower, "mcc bottles")
}

func GetRateInterval(rate int) (int, int) {
	switch {
	case rate <= 799:
		return rate + 50, rate + 50
	case rate <= 1199:
		return rate + 50, rate + 100
	case rate <= 1799:
		return rate + 100, rate + 150
	case rate <= 2399:
		return rate + 100, rate + 200
	case rate <= 2999:
		return rate + 150, rate + 250
	default:
		return rate + 200, rate + 300
	}
}
