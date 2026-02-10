const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');
const validateProfile = require('../middleware/validateProfile');

router.post('/login', authController.login);
router.post('/register', authController.register);
router.get('/me', authMiddleware, authController.me);
router.post('/forgot', authController.forgotPassword);
router.post('/reset', authController.resetPassword);
router.post('/change-password', authMiddleware, authController.changePassword);
router.get('/2fa-status', authMiddleware, authController.getTwoFactorStatus);
router.post('/2fa-enable', authMiddleware, authController.enableTwoFactor);
router.post('/2fa-disable', authMiddleware, authController.disableTwoFactor);
router.patch('/me', authMiddleware, validateProfile, authController.updateProfile);
router.delete('/delete-account', authMiddleware, authController.deleteAccount);




// admin endpoints removed

module.exports = router;
