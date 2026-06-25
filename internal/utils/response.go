package utils

import (
	"github.com/gin-gonic/gin"
)

type JSONResponse struct {
	Success bool        `json:"success"`
	Message string      `json:"message,omitempty"`
	Data    interface{} `json:"data,omitempty"`
	Error   interface{} `json:"error,omitempty"`
}

func SendSuccess(c *gin.Context, code int, message string, data interface{}) {
	c.JSON(code, JSONResponse{Success: true, Message: message, Data: data})
}

func SendError(c *gin.Context, code int, message string, err interface{}) {
	c.JSON(code, JSONResponse{Success: false, Message: message, Error: err})
}
