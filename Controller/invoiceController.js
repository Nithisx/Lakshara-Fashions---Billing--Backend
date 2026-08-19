const { pool } = require("../DB/db");
const crypto = require("crypto");

// Create a new Invoice
const createInvoice = async (req, res) => {
  const {
    invoice_number,
    customer_name,
    customer_phone,
    invoice_date,
    payment_method,
    total_amount,
    advance_paid,
    balance_due,
    items, // Array of { item_name, quantity, unit_price }
  } = req.body;

  const userId = req.user.id; // set by authMiddleware

  // Basic validations
  if (
    !invoice_number ||
    !customer_name ||
    !customer_phone ||
    !invoice_date ||
    !payment_method ||
    !total_amount ||
    !items ||
    !Array.isArray(items) ||
    items.length === 0
  ) {
    return res
      .status(400)
      .json({
        error: "All invoice fields and at least one item are required.",
      });
  }

  const client = await pool.connect();

  try {
    // Start PostgreSQL Transaction
    await client.query("BEGIN");

    // 1. Check if invoice_number is unique
    const dupCheck = await client.query(
      "SELECT id FROM invoices WHERE invoice_number = $1",
      [invoice_number],
    );
    if (dupCheck.rows.length > 0) {
      await client.query("ROLLBACK");
      return res
        .status(400)
        .json({
          error: `Invoice ID ${invoice_number} already exists. Please use a unique ID.`,
        });
    }

    // Generate unique share token
    const shareToken = crypto.randomBytes(16).toString("hex");

    const advance = parseFloat(advance_paid) || 0;
    const balance =
      balance_due !== undefined && balance_due !== null
        ? parseFloat(balance_due)
        : Math.max(parseFloat(total_amount) - advance, 0);

    // 2. Insert Invoice
    const insertInvoiceQuery = `
      INSERT INTO invoices (invoice_number, customer_name, customer_phone, invoice_date, payment_method, total_amount, user_id, share_token, advance_paid, balance_due)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING id, invoice_number, customer_name, customer_phone, invoice_date, payment_method, total_amount, advance_paid, balance_due, share_token, created_at
    `;
    const invoiceResult = await client.query(insertInvoiceQuery, [
      invoice_number,
      customer_name,
      customer_phone,
      invoice_date,
      payment_method,
      total_amount,
      userId,
      shareToken,
      advance,
      balance,
    ]);

    const createdInvoice = invoiceResult.rows[0];

    // 3. Insert Invoice Items
    const insertItemQuery = `
      INSERT INTO invoice_items (invoice_id, item_name, quantity, unit_price, total_price, measurements)
      VALUES ($1, $2, $3, $4, $5, $6)
    `;

    for (const item of items) {
      const { item_name, quantity, unit_price, measurements = {} } = item;

      if (!item_name || !quantity || !unit_price) {
        await client.query("ROLLBACK");
        return res
          .status(400)
          .json({
            error:
              "Invalid item entries. Name, quantity, and unit price are required.",
          });
      }

      const totalPrice = quantity * unit_price;
      await client.query(insertItemQuery, [
        createdInvoice.id,
        item_name,
        quantity,
        unit_price,
        totalPrice,
        JSON.stringify(measurements || {}),
      ]);
    }

    // Commit Transaction
    await client.query("COMMIT");
    client.release();

    return res.status(201).json({
      message: "Invoice created successfully",
      invoice: createdInvoice,
    });
  } catch (error) {
    await client.query("ROLLBACK");
    client.release();
    console.error("Invoice creation error:", error.message);
    return res
      .status(500)
      .json({ error: "Server error during invoice creation." });
  }
};

// Get all Invoices for the authenticated user
const getInvoices = async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      "SELECT * FROM invoices WHERE user_id = $1 ORDER BY invoice_date DESC, created_at DESC",
      [userId],
    );

    return res.status(200).json({ invoices: result.rows });
  } catch (error) {
    console.error("Fetch invoices error:", error.message);
    return res.status(500).json({ error: "Server error fetching invoices." });
  }
};

// Get details of a single Invoice (with its items)
const getInvoiceById = async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  try {
    // Fetch Invoice
    const invoiceResult = await pool.query(
      "SELECT * FROM invoices WHERE id = $1 AND user_id = $2",
      [id, userId],
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: "Invoice not found." });
    }

    const invoice = invoiceResult.rows[0];

    // Fetch Invoice Items
    const itemsResult = await pool.query(
      "SELECT id, item_name, quantity, unit_price, total_price, measurements FROM invoice_items WHERE invoice_id = $1",
      [id],
    );

    return res.status(200).json({
      invoice,
      items: itemsResult.rows,
    });
  } catch (error) {
    console.error("Fetch invoice details error:", error.message);
    return res
      .status(500)
      .json({ error: "Server error fetching invoice details." });
  }
};

// Get all unique clients grouped by customer_phone with sum of totals and count of orders
const getClients = async (req, res) => {
  const userId = req.user.id;

  try {
    const result = await pool.query(
      `SELECT 
        customer_phone,
        MAX(customer_name) AS customer_name,
        COUNT(id) AS total_orders,
        SUM(total_amount) AS total_spent
       FROM invoices
       WHERE user_id = $1
       GROUP BY customer_phone
       ORDER BY total_spent DESC`,
      [userId],
    );

    return res.status(200).json({ clients: result.rows });
  } catch (error) {
    console.error("Fetch clients aggregation error:", error.message);
    return res.status(500).json({ error: "Server error fetching clients." });
  }
};

// Get details of a single Invoice by its share token (Public)
const getInvoiceByShareToken = async (req, res) => {
  const { shareToken } = req.params;

  try {
    // Fetch Invoice (no user_id requirement since it's public)
    const invoiceResult = await pool.query(
      "SELECT * FROM invoices WHERE share_token = $1",
      [shareToken],
    );

    if (invoiceResult.rows.length === 0) {
      return res.status(404).json({ error: "Invoice not found." });
    }

    const invoice = invoiceResult.rows[0];

    // Fetch Invoice Items
    const itemsResult = await pool.query(
      "SELECT id, item_name, quantity, unit_price, total_price, measurements FROM invoice_items WHERE invoice_id = $1",
      [invoice.id],
    );

    return res.status(200).json({
      invoice,
      items: itemsResult.rows,
    });
  } catch (error) {
    console.error("Fetch shared invoice details error:", error.message);
    return res
      .status(500)
      .json({ error: "Server error fetching shared invoice details." });
  }
};

module.exports = {
  createInvoice,
  getInvoices,
  getInvoiceById,
  getClients,
  getInvoiceByShareToken,
};
