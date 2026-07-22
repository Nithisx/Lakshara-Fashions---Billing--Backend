const express = require('express');
const cors = require('cors');
require('dotenv').config();
const { initDB } = require('./DB/db');
const authRouter = require('./Router/auth');
const invoiceRouter = require('./Router/invoice');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS
app.use(cors({
  origin: '*', // For development, allow all origins. In production, restrict to frontend URL.
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

// Body parser
app.use(express.json());

// Main Root route
app.get('/', (req, res) => {
  res.json({ message: 'Billing Auth API is running.' });
});

// Routes
app.use('/api/auth', authRouter);
app.use('/api/invoices', invoiceRouter);

// WhatsApp Webhook Verification (GET /webhook) - triggers reload
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  const VERIFY_TOKEN = process.env.MY_VERIFY_TOKEN;

  if (mode && token) {
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('Webhook verified successfully.');
      return res.status(200).send(challenge);
    } else {
      console.log('Webhook verification failed: Token mismatch.');
      return res.sendStatus(403);
    }
  }
  return res.sendStatus(400);
});

// WhatsApp Webhook Message Handler (POST /webhook)
app.post('/webhook', (req, res) => {
  console.log('Received WhatsApp Webhook payload:', JSON.stringify(req.body, null, 2));
  
  // Return 200 status to acknowledge receipt
  res.status(200).send('EVENT_RECEIVED');
});

// Global Error Handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal Server Error' });
});

// Initialize database and start server
const startServer = async () => {
  try {
    await initDB();
    app.listen(PORT, () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server due to DB connection error:', error.message);
    process.exit(1);
  }
};

startServer();
