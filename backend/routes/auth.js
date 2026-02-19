const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const validateProfile = require('../middleware/validateProfile');

// Global error handler wrapper to convert exceptions to clean JSON
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((err) => {
    console.error('Route error:', err);
    res.status(500).json({ success: false, message: 'Server error' });
  });
};

router.post('/login', asyncHandler(authController.login));
router.post('/register', asyncHandler(authController.register));
router.get('/me', authMiddleware, asyncHandler(authController.me));
router.post('/forgot', asyncHandler(authController.forgotPassword));
router.post('/reset', asyncHandler(authController.resetPassword));
router.post('/change-password', authMiddleware, asyncHandler(authController.changePassword));
router.get('/2fa-status', authMiddleware, asyncHandler(authController.getTwoFactorStatus));
router.post('/2fa-enable', authMiddleware, asyncHandler(authController.enableTwoFactor));
router.post('/2fa-disable', authMiddleware, asyncHandler(authController.disableTwoFactor));
router.patch('/me', authMiddleware, validateProfile, asyncHandler(authController.updateProfile));
router.delete('/delete-account', authMiddleware, asyncHandler(authController.deleteAccount));
router.post('/verify-identity', authMiddleware, asyncHandler(authController.verifyIdentity));




// admin endpoints removed

module.exports = router;
