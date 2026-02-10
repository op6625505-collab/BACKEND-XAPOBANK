const express = require('express');
const router = express.Router();
const admin = require('../middleware/adminMiddleware');
const controller = require('../controllers/adminPromosController');

// List allowed promo codes
router.get('/promos', admin, controller.list);

// Add a promo code (body: { code: 'CODE' })
router.post('/promos', admin, controller.add);

// Remove promo code by url param or body
router.delete('/promos/:code', admin, controller.remove);

module.exports = router;
