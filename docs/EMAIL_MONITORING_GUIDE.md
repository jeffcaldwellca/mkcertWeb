# Email Notifications & Certificate Monitoring Guide

Testing and configuration guide for email notifications and certificate monitoring.

## Quick Setup

### Gmail Configuration (Recommended)

1. Enable 2-Factor Authentication at https://myaccount.google.com/security
2. Generate App Password at https://myaccount.google.com/apppasswords
3. Configure environment:

```bash
EMAIL_NOTIFICATIONS_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASSWORD=xxxx-xxxx-xxxx-xxxx  # App password
EMAIL_FROM=your-email@gmail.com
EMAIL_TO=your-email@gmail.com

CERT_MONITORING_ENABLED=true
CERT_CHECK_INTERVAL=*/5 * * * *     # Every 5 minutes for testing
CERT_WARNING_DAYS=365
CERT_CRITICAL_DAYS=180
```

### Testing

1. Start server: `npm start`
2. Open http://localhost:3000
3. Check email status in "Notifications & Monitoring" section
4. Click "Send Test Email" to verify configuration
5. Click "Check Now" to test certificate monitoring

## Testing Scenarios

### Expiring Certificates
1. Generate test certificates (test1.local, test2.local, test3.local)
2. Set high warning days: `CERT_WARNING_DAYS=3650`
3. Click "Check Now" to find existing certificates

### Automatic Monitoring
Set frequent interval for testing:
```bash
CERT_CHECK_INTERVAL=*/2 * * * *  # Every 2 minutes
```

Monitor logs: `tail -f server.log`

3. **Check for email notifications**:
   - Should receive emails when certificates are found

## API Testing

```bash
# Email status
curl http://localhost:3000/api/email/status

# Send test email  
curl -X POST http://localhost:3000/api/email/test

# Monitoring status
curl http://localhost:3000/api/monitoring/status

# Manual check
curl -X POST http://localhost:3000/api/monitoring/check

# Get expiring certificates
curl http://localhost:3000/api/monitoring/expiring
```

## Troubleshooting

### Gmail
- **Invalid login**: Enable 2FA, use App Password, verify full email address
- **Connection refused**: Verify `smtp.gmail.com:587` and `SMTP_SECURE=false`

### Outlook/Corporate
- **Authentication failed**: Try app password or check SMTP server
- **Certificate errors**: Set `SMTP_TLS_REJECT_UNAUTHORIZED=false` for self-signed certs
- **No auth needed**: Leave SMTP_USER and SMTP_PASSWORD empty

### Monitoring
- **No certificates found**: Check certificate directory, increase CERT_WARNING_DAYS
- **Not running**: Verify CERT_MONITORING_ENABLED=true and cron syntax

## Production Recommendations

### Security
- Use service accounts for SMTP
- Restrict credentials to necessary permissions
- Rotate passwords regularly
- Set appropriate TLS settings

### Monitoring
- Check intervals: Daily `0 8 * * *` or every 6 hours `0 */6 * * *`
- Warning periods: 30-60 days warning, 7-14 days critical
- Monitor the monitor: Set up service health alerts

### Email
- Use multiple recipients for redundancy
- Test configuration before deploying
- Monitor delivery and bounce rates

## Production Example

```bash
# Email
EMAIL_NOTIFICATIONS_ENABLED=true
SMTP_HOST=smtp.company.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=mkcert-service@company.com
SMTP_PASSWORD=secure-password
EMAIL_FROM=mkcert-notifications@company.com
EMAIL_TO=devops@company.com,security@company.com,sysadmin@company.com

# Monitoring
CERT_MONITORING_ENABLED=true
CERT_CHECK_INTERVAL=0 8 * * *    # Daily at 8 AM
CERT_WARNING_DAYS=30
CERT_CRITICAL_DAYS=7
CERT_MONITOR_UPLOADED=true
```
