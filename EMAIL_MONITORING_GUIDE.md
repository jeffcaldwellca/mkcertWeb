# Email Notifications & Certificate Monitoring - Testing Guide

This guide explains how to test and configure the email notification and certificate monitoring features in mkcert Web UI.

## Quick Setup for Testing

### 1. Gmail Configuration (Recommended for Testing)

1. **Create or use an existing Gmail account**
2. **Enable 2-Factor Authentication**:
   - Go to https://myaccount.google.com/security
   - Enable 2-Step Verification

3. **Generate App Password**:
   - Go to https://myaccount.google.com/apppasswords
   - Select "Other (Custom name)" and enter "mkcert Web UI"
   - Copy the 16-character password

4. **Configure Environment Variables**:
   ```bash
   EMAIL_NOTIFICATIONS_ENABLED=true
   SMTP_HOST=smtp.gmail.com
   SMTP_PORT=587
   SMTP_SECURE=false
   SMTP_USER=your-email@gmail.com
   SMTP_PASSWORD=xxxx-xxxx-xxxx-xxxx  # 16-character app password
   EMAIL_FROM=your-email@gmail.com
   EMAIL_TO=your-email@gmail.com      # Can use same email for testing
   ```

5. **Enable Monitoring**:
   ```bash
   CERT_MONITORING_ENABLED=true
   CERT_CHECK_INTERVAL=*/5 * * * *     # Every 5 minutes for testing
   CERT_WARNING_DAYS=365               # High value to catch existing certs
   CERT_CRITICAL_DAYS=180              # High value to catch existing certs
   ```

### 2. Testing Steps

1. **Start the server** with your configuration:
   ```bash
   npm start
   ```

2. **Open the Web UI**: http://localhost:3000

3. **Check Email Status**:
   - Scroll down to "Notifications & Monitoring" section
   - Email status should show "configured and ready"

4. **Send Test Email**:
   - Click "Send Test Email" button
   - Check your email inbox for the test message

5. **Verify SMTP Connection**:
   - Click "Verify SMTP" button
   - Should show success message

6. **Test Certificate Monitoring**:
   - Generate a test certificate first
   - Click "Check Now" in monitoring section
   - Check "Expiring Certificates" section for results

## Testing Different Scenarios

### Test Expiring Certificates

To test the expiring certificate detection without waiting:

1. **Generate some test certificates**:
   ```bash
   # In the Web UI, generate certificates for:
   # - test1.local
   # - test2.local  
   # - test3.local
   ```

2. **Set high warning days** to catch existing certificates:
   ```bash
   CERT_WARNING_DAYS=3650  # 10 years
   CERT_CRITICAL_DAYS=1825 # 5 years
   ```

3. **Run manual check**:
   - Click "Check Now" button
   - Should find and list your certificates

### Test Automatic Monitoring

1. **Set frequent check interval**:
   ```bash
   CERT_CHECK_INTERVAL=*/2 * * * *  # Every 2 minutes
   ```

2. **Monitor logs**:
   ```bash
   # Watch server logs for monitoring activity
   tail -f server.log
   ```

3. **Check for email notifications**:
   - Should receive emails when certificates are found

## API Testing

You can also test via API endpoints:

```bash
# Get email status
curl http://localhost:3000/api/email/status

# Send test email  
curl -X POST http://localhost:3000/api/email/test \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: YOUR_TOKEN"

# Check monitoring status
curl http://localhost:3000/api/monitoring/status

# Manual certificate check
curl -X POST http://localhost:3000/api/monitoring/check \
  -H "Content-Type: application/json" \
  -H "X-CSRF-Token: YOUR_TOKEN"

# Get expiring certificates
curl http://localhost:3000/api/monitoring/expiring
```

## Common Issues & Troubleshooting

### Gmail Issues

**"Invalid login"**: 
- Ensure 2FA is enabled
- Use App Password, not regular password
- Check username is full email address

**"Connection refused"**:
- Check SMTP_HOST=smtp.gmail.com
- Check SMTP_PORT=587
- Check SMTP_SECURE=false

### Outlook Issues

**Authentication failed**:
- Try both regular password and app password
- For corporate Office 365, may need different SMTP server

### Corporate Email Issues

**Certificate errors**:
- Set `SMTP_TLS_REJECT_UNAUTHORIZED=false` for self-signed certificates

**Authentication required**:
- Some corporate servers don't require auth for internal services
- Leave SMTP_USER and SMTP_PASSWORD empty to try without auth

### Monitoring Issues

**No certificates found**:
- Check that certificates exist in the certificates/ directory
- Ensure CERT_WARNING_DAYS is high enough to catch existing certificates
- Check that certificate files are readable

**Monitoring not running**:
- Check CERT_MONITORING_ENABLED=true
- Check cron expression syntax
- Monitor server logs for error messages

## Production Recommendations

### Security

1. **Use service accounts** for SMTP authentication
2. **Restrict SMTP credentials** to only necessary permissions
3. **Use secure passwords** and rotate them regularly
4. **Set appropriate TLS settings** for your environment

### Monitoring

1. **Set reasonable check intervals**:
   - Daily (0 8 * * *) for most environments
   - Every 6 hours (0 */6 * * *) for critical environments

2. **Configure appropriate warning periods**:
   - 30-60 days for warning notifications
   - 7-14 days for critical notifications

3. **Monitor the monitoring**:
   - Set up alerts if monitoring service stops
   - Check logs regularly for errors

### Email

1. **Use multiple recipients** for redundancy
2. **Test email configuration** before deploying
3. **Monitor email delivery** and bounce rates
4. **Document your configuration** for team members

## Example Production Configuration

```bash
# Production Email & Monitoring Configuration

# Email notifications
EMAIL_NOTIFICATIONS_ENABLED=true
SMTP_HOST=smtp.company.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=mkcert-service@company.com
SMTP_PASSWORD=secure-service-password
EMAIL_FROM=mkcert-notifications@company.com
EMAIL_TO=devops@company.com,security@company.com,sysadmin@company.com
EMAIL_SUBJECT=🔒 Certificate Expiry Alert - Production mkcert Service

# Monitoring configuration
CERT_MONITORING_ENABLED=true
CERT_CHECK_INTERVAL=0 8 * * *    # Daily at 8 AM
CERT_WARNING_DAYS=30             # 30-day warning
CERT_CRITICAL_DAYS=7             # 7-day critical alert
CERT_MONITOR_UPLOADED=true       # Monitor all certificates
```

This configuration provides:
- Daily automated checks
- 30-day advance warning for renewal planning
- 7-day critical alerts for immediate action
- Multiple notification recipients for redundancy
- Production-appropriate timing and settings
