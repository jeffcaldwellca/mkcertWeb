# Release Notes - Version 3.0.1

**Release Date**: October 9, 2025  
**Type**: Bug Fix Release  
**Severity**: Critical

## Overview

Version 3.0.1 addresses two critical bugs that prevented core functionality in version 3.0.0:
1. SCEP API endpoints were inaccessible due to incorrect route registration order
2. Certificate monitoring service failed to start due to missing configuration

## 🐛 Critical Bug Fixes

### 1. SCEP Routes Not Accessible

**Issue**: All SCEP API endpoints were returning "API endpoint not found" errors, making the entire SCEP functionality inaccessible through the web interface.

**Root Cause**: SCEP routes were being mounted after system routes in `server.js`. The system routes include a catch-all handler for `/api/*` that was intercepting all SCEP API requests before they could reach the SCEP router.

**Resolution**:
- Moved SCEP routes mounting to occur before system routes (line ~286)
- Removed duplicate SCEP routes mounting code
- Ensured proper route registration order

**Affected Endpoints** (now working):
- `GET /api/scep/enterprise-ca/status` - Enterprise CA status
- `GET /api/scep/config` - SCEP configuration
- `GET /api/scep/challenges` - Challenge password management
- `POST /api/scep/challenge` - Generate challenge passwords
- `POST /api/scep/certificate` - Manual certificate generation
- `GET /api/scep/certificates` - SCEP certificate inventory
- `GET /api/scep/templates` - Certificate templates
- `POST /api/scep/validate-upn` - UPN validation

**Testing**:
```bash
# All endpoints now return proper responses
curl http://localhost:3000/api/scep/config
curl http://localhost:3000/api/scep/enterprise-ca/status
curl http://localhost:3000/api/scep/challenges
```

### 2. Certificate Monitoring Service Startup Error

**Issue**: Certificate monitoring service failed to initialize with error: "The 'path' argument must be of type string or an instance of Buffer or URL. Received undefined"

**Root Cause**: The `config` object was missing a `paths` property that the certificate monitoring service expected for locating certificate directories.

**Resolution**:
- Added new `paths` configuration section in `src/config/index.js`:
  ```javascript
  paths: {
    certificates: process.env.CERTIFICATES_DIR || 'certificates',
    uploaded: process.env.UPLOADED_CERTS_DIR || 'certificates/uploaded'
  }
  ```
- Updated `certificateMonitoringService.js` to use config paths with fallback values
- Service now properly discovers and monitors certificate files

**Result**:
- Monitoring service successfully starts on application launch
- Successfully finds and monitors certificate files
- Example output: "Found 9 certificate files to monitor"

## 📋 Technical Details

### Files Modified
1. **server.js**
   - Fixed route registration order
   - SCEP routes now mounted before system routes

2. **src/config/index.js**
   - Added `paths` configuration section
   - Configurable via environment variables

3. **src/services/certificateMonitoringService.js**
   - Updated to use config paths with fallbacks
   - More resilient path handling

## ✅ Verification & Testing

### SCEP Functionality
✅ All SCEP API endpoints responding correctly  
✅ Enterprise CA status retrievable  
✅ SCEP configuration accessible  
✅ Challenge management working  
✅ Certificate generation functional  

### Certificate Monitoring
✅ Service starts without errors  
✅ Successfully discovers certificate files  
✅ Monitoring both generated and uploaded certificates  
✅ Proper directory scanning with fallback paths  

### Backward Compatibility
✅ No breaking changes to existing functionality  
✅ All 3.0.0 features preserved  
✅ Configuration remains backward compatible  
✅ Default values ensure smooth upgrades  

## 🚀 Upgrade Instructions

### From Version 3.0.0

**No configuration changes required** - this is a drop-in replacement.

1. **Pull the latest changes**:
   ```bash
   git pull origin main
   ```

2. **Restart the application**:
   ```bash
   npm start
   # or
   docker-compose restart
   ```

3. **Verify SCEP functionality**:
   - Navigate to `/scep.html` in your browser
   - All sections should load without errors
   - Test challenge generation and certificate management

### Environment Variables (Optional)

New optional environment variables for advanced configuration:

```bash
# Certificate directory paths (defaults work for most cases)
CERTIFICATES_DIR=certificates
UPLOADED_CERTS_DIR=certificates/uploaded
```

## 📊 Impact Assessment

### Severity: Critical
- **SCEP Functionality**: Completely non-functional in 3.0.0, now fully operational
- **Monitoring Service**: Failed to start in 3.0.0, now working correctly

### User Impact
- **High**: Users upgrading to 3.0.0 could not use SCEP features
- **Medium**: Certificate monitoring was not operational
- **Resolution**: All functionality restored in 3.0.1

### Deployment Urgency
- **Immediate upgrade recommended** for all 3.0.0 installations
- **Low risk**: Bug fixes only, no feature changes
- **High reward**: Restores complete SCEP and monitoring functionality

## 🔍 Known Issues

None identified in this release.

## 📚 Documentation

No documentation changes required. All features work as documented in:
- `SCEP.md` - SCEP implementation guide
- `EMAIL_MONITORING_GUIDE.md` - Certificate monitoring guide
- `README.md` - General usage instructions

## 🙏 Acknowledgments

Thanks to all users who reported issues with SCEP functionality and monitoring service startup.

## 📞 Support

For issues or questions:
- GitHub Issues: https://github.com/jeffcaldwellca/mkcertWeb/issues
- Documentation: See `SCEP.md` and `EMAIL_MONITORING_GUIDE.md`

---

**Previous Release**: [v3.0.0](RELEASE-v3.0.0.md) - Complete SCEP PKI Implementation  
**Next Release**: TBD
