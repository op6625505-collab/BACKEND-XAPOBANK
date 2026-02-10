const express = require('express');
const router = express.Router();
const identityController = require('../controllers/identityController');
const authMiddleware = require('../middleware/authMiddleware');

// Try to use multer for multipart/form-data uploads (more reliable for large files).
let multerMiddleware = null;
try {
	const multer = require('multer');
	const storage = multer.memoryStorage();
	multerMiddleware = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 } }).single('file');
} catch (e) {
	// multer not installed — route will still accept base64 JSON uploads
	multerMiddleware = (req, res, next) => next();
}

router.post('/upload', authMiddleware, multerMiddleware, identityController.upload);

module.exports = router;
