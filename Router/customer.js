const express = require('express');
const router = express.Router();
const { createCustomer, getCustomers } = require('../Controller/customerController');
const authMiddleware = require('../Middleware/authMiddleware');

router.use(authMiddleware);

router.post('/', createCustomer);
router.get('/', getCustomers);

module.exports = router;
