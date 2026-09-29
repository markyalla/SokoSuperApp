package utils

import (
	"crypto/tls"
	"errors"
	"fmt"
	"log"
	"net"
	"net/smtp"
	"os"
	"strings"
	"time"
)

// SendEmailAsync sends in the background and logs the outcome — callers use
// it for best-effort mail (OTPs) where a failure used to vanish silently.
func SendEmailAsync(to, subject, htmlBody string) {
	go func() {
		start := time.Now()
		if err := SendEmail(to, subject, htmlBody); err != nil {
			log.Printf("[email] FAILED to=%s subject=%q after %s: %v", to, subject, time.Since(start).Round(time.Millisecond), err)
			return
		}
		log.Printf("[email] sent to=%s subject=%q", to, subject)
	}()
}

func SendEmail(to, subject, htmlBody string) error {
	host := os.Getenv("SMTP_HOST")
	port := os.Getenv("SMTP_PORT")
	user := os.Getenv("SMTP_USER")
	pass := os.Getenv("SMTP_PASS")
	from := os.Getenv("SMTP_FROM")
	if from == "" {
		from = user
	}

	if host == "" || port == "" {
		return errors.New("SMTP_HOST/SMTP_PORT not set")
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
	if port != "465" {
		// 587/25: plain connection upgraded with STARTTLS.
		return smtp.SendMail(addr, auth, from, []string{to}, msg)
	}

	// 465 is implicit TLS, which smtp.SendMail can't speak.
	conn, err := tls.DialWithDialer(&net.Dialer{Timeout: 20 * time.Second}, "tcp", addr, &tls.Config{ServerName: host})
	if err != nil {
		return err
	}
	c, err := smtp.NewClient(conn, host)
	if err != nil {
		return err
	}
	defer c.Close()
	if err := c.Auth(auth); err != nil {
		return err
	}
	if err := c.Mail(from); err != nil {
		return err
	}
	if err := c.Rcpt(to); err != nil {
		return err
	}
	w, err := c.Data()
	if err != nil {
		return err
	}
	if _, err := w.Write(msg); err != nil {
		return err
	}
	if err := w.Close(); err != nil {
		return err
	}
	return c.Quit()
}

func OTPEmailBody(otp, fullName string) string {
	return otpEmail(otp, fullName, "reset your password", "If you did not request a password reset, please ignore this email.")
}

func VerificationEmailBody(otp, fullName string) string {
	return otpEmail(otp, fullName, "verify your email and finish creating your account", "If you did not sign up for SokoApp, please ignore this email.")
}

func otpEmail(otp, fullName, action, footer string) string {
	name := fullName
	if name == "" {
		name = "there"
	}
	return fmt.Sprintf(`
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:24px">
  <h2 style="color:#FF8000;margin-bottom:4px">SokoApp</h2>
  <p>Hi %s,</p>
  <p>Use the code below to %s. It expires in <strong>10 minutes</strong>.</p>
  <div style="background:#f3f4f6;border-radius:12px;padding:24px;text-align:center;margin:24px 0">
    <span style="font-size:36px;font-weight:700;letter-spacing:12px;color:#111827">%s</span>
  </div>
  <p style="color:#6b7280;font-size:13px">%s</p>
</div>`, name, action, otp, footer)
}
