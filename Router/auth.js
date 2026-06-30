const express = require('express');
const router = express.Router();
const { register, login, getMe } = require('../Controller/authController');
const authMiddleware = require('../Middleware/authMiddleware');

// Public routes
router.post('/register', register);
router.post('/login', login);

// Private/Protected routes
router.get('/me', authMiddleware, getMe);

module.exports = router;
