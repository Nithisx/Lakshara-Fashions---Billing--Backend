const express = require('express');
const router = express.Router();
const { createInvoice, getInvoices, getInvoiceById, getClients, getInvoiceByShareToken } = require('../Controller/invoiceController');
const authMiddleware = require('../Middleware/authMiddleware');

// Public route to view a shared invoice
router.get('/share/:shareToken', getInvoiceByShareToken);

// All subsequent routes require authentication
router.use(authMiddleware);

// Create a new invoice
router.post('/', createInvoice);

// Get all invoices for the authenticated user
router.get('/', getInvoices);

// Get unique clients list (placed before /:id)
router.get('/clients', getClients);

// Get a single invoice details
router.get('/:id', getInvoiceById);

module.exports = router;
