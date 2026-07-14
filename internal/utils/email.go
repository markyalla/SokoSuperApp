package utils

import (
	"fmt"
	"net/smtp"
	"os"
	"strings"
)

func SendEmail(to, subject, htmlBody string) error {
	host := os.Getenv("SMTP_HOST")
	port := os.Getenv("SMTP_PORT")
	user := os.Getenv("SMTP_USER")
	pass := os.Getenv("SMTP_PASS")
	from := os.Getenv("SMTP_FROM")
	if from == "" {
		from = user
	}

	addr := host + ":" + port

	header := strings.Join([]string{
		"From: SokoApp <" + from + ">",
		"To: " + to,
		"Subject: " + subject,
		"MIME-Version: 1.0",
		"Content-Type: text/html; charset=UTF-8",
	}, "\r\n")
	msg := []byte(header + "\r\n\r\n" + htmlBody)

	auth := smtp.PlainAuth("", user, pass, host)
	return smtp.SendMail(addr, auth, from, []string{to}, msg)
}

func OTPEmailBody(otp, fullName string) string {
	name := fullName
	if name == "" {
		name = "there"
	}
	return fmt.Sprintf(`
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="color:#FF8000;margin-bottom:4px">SokoApp</h2>
  <p>Hi %s,</p>
  <p>Use the code below to reset your password. It expires in <strong>10 minutes</strong>.</p>
  <div style="background:#f3f4f6;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
    <span style="font-size:36px;font-weight:700;letter-spacing:12px;color:#111827">%s</span>
  </div>
  <p style="color:#6b7280;font-size:13px">If you did not request a password reset, please ignore this email.</p>
</div>`, name, otp)
}
