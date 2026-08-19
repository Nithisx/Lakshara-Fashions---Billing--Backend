const express = require('express');
const router = express.Router();
const { createOrder, getOrders, getOrderById, linkInvoiceToOrder, updateOrderStatus, updateOrderPayment } = require('../Controller/orderController');
const authMiddleware = require('../Middleware/authMiddleware');

router.use(authMiddleware);

router.post('/', createOrder);
router.get('/', getOrders);
router.get('/:id', getOrderById);
router.post('/:id/invoice', linkInvoiceToOrder);
router.put('/:id/status', updateOrderStatus);
router.put('/:id/payment', updateOrderPayment);

module.exports = router;
