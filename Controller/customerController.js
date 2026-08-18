const { pool } = require('../DB/db');

// Create a new Customer
const createCustomer = async (req, res) => {
  const {
    full_name,
    address,
    phone_number,
    email,
    city,
    state,
    postal_code,
    gender
  } = req.body;

  const userId = req.user.id;

  if (!full_name || !phone_number) {
    return res.status(400).json({ error: 'Full name and Phone number are required.' });
  }

  try {
    // Check if phone number already registered for this user
    const dupCheck = await pool.query(
      'SELECT id FROM customers WHERE phone_number = $1 AND user_id = $2',
      [phone_number, userId]
    );

    if (dupCheck.rows.length > 0) {
      return res.status(400).json({ error: `Customer with phone number ${phone_number} already exists.` });
    }

    const insertQuery = `
      INSERT INTO customers (full_name, address, phone_number, email, city, state, postal_code, gender, user_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const result = await pool.query(insertQuery, [
      full_name,
      address || null,
      phone_number,
      email || null,
      city || null,
      state || null,
      postal_code || null,
      gender || null,
      userId
    ]);

    return res.status(201).json({
      message: 'Customer added successfully',
      customer: result.rows[0]
    });
  } catch (error) {
    console.error('Error creating customer:', error.message);
    return res.status(500).json({ error: 'Server error creating customer record.' });
  }
};

// Get all Customers for user
const getCustomers = async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      'SELECT * FROM customers WHERE user_id = $1 ORDER BY full_name ASC',
      [userId]
    );
    return res.status(200).json({ customers: result.rows });
  } catch (error) {
    console.error('Error fetching customers:', error.message);
    return res.status(500).json({ error: 'Server error fetching customer records.' });
  }
};

module.exports = {
  createCustomer,
  getCustomers
};
