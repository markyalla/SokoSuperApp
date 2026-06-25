package models

type PaystackEvent struct {
	Event string       `json:"event"`
	Data  PaystackData `json:"data"`
}

type PaystackData struct {
	ID              int                    `json:"id"`
	Domain          string                 `json:"domain"`
	Status          string                 `json:"status"`
	Reference       string                 `json:"reference"`
	Amount          int64                  `json:"amount"` // Amount in kobo/pesewas
	Message         string                 `json:"message"`
	GatewayResponse string                 `json:"gateway_response"`
	PaidAt          string                 `json:"paid_at"`
	CreatedAt       string                 `json:"created_at"`
	Currency        string                 `json:"currency"`
	Channel         string                 `json:"channel"`
	Metadata        map[string]interface{} `json:"metadata"`
	Customer        PaystackCustomer       `json:"customer"`
}

type PaystackCustomer struct {
	ID           int    `json:"id"`
	FirstName    string `json:"first_name"`
	LastName     string `json:"last_name"`
	Email        string `json:"email"`
	CustomerCode string `json:"customer_code"`
}
