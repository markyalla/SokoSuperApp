package worker

const (
	TypeKYCProcessing = "kyc:process"
	TypeAssignDriver  = "delivery:assign_driver"
)

type KYCProcessingPayload struct {
	UserID string `json:"user_id"`
}

type AssignDriverPayload struct {
	AssignmentID string `json:"assignment_id"`
	VehicleType  string `json:"vehicle_type"`
}
