const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../DB/db');
require('dotenv').config();

const JWT_SECRET = process.env.JWT_SECRET || 'billing_app_super_secret_key_123';

// Register User
const register = async (req, res) => {
  const { username, email, password } = req.body;

  // Input Validation
  if (!username || !email || !password) {
    return res.status(400).json({ error: 'All fields (username, email, password) are required.' });
  }

  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters long.' });
  }

  try {
    // Check if user already exists
    const userCheck = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR username = $2',
      [email.toLowerCase(), username.toLowerCase()]
    );

    if (userCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Username or Email already exists.' });
    }

    // Hash Password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // Insert User into DB
    const newUser = await pool.query(
      'INSERT INTO users (username, email, password) VALUES ($1, $2, $3) RETURNING id, username, email, created_at',
      [username.toLowerCase(), email.toLowerCase(), hashedPassword]
    );

    const user = newUser.rows[0];

    // Generate JWT Token
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });

  } catch (error) {
    console.error('Registration error:', error.message);
    return res.status(500).json({ error: 'Server error during registration.' });
  }
};

// Login User
const login = async (req, res) => {
  const { email, password } = req.body; // Can support logging in via email or username

  if (!email || !password) {
    return res.status(400).json({ error: 'Email/Username and password are required.' });
  }

  try {
    // Query DB for user by email or username
    const userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR username = $1',
      [email.toLowerCase()]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid credentials.' });
    }

    const user = userResult.rows[0];

    // Verify Password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: 'Invalid credentials.' });
    }

    // Generate JWT Token
    const token = jwt.sign(
      { id: user.id, username: user.username, email: user.email },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return res.status(200).json({
      message: 'Login successful',
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email
      }
    });

  } catch (error) {
    console.error('Login error:', error.message);
    return res.status(500).json({ error: 'Server error during login.' });
  }
};

// Get current user profile (Me)
const getMe = async (req, res) => {
  try {
    // req.user is set by authMiddleware
    const userResult = await pool.query(
      'SELECT id, username, email, created_at FROM users WHERE id = $1',
      [req.user.id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found.' });
    }

    return res.status(200).json({ user: userResult.rows[0] });
  } catch (error) {
    console.error('Fetch profile error:', error.message);
    return res.status(500).json({ error: 'Server error fetching user profile.' });
  }
};

module.exports = {
  register,
  login,
  getMe
};
