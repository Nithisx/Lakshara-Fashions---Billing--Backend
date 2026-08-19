const { pool } = require("../DB/db");

// Create a new Order
const createOrder = async (req, res) => {
  const {
    customer_id,
    special_instructions,
    inspiration_link,
    cloth_images,
    delivery_date,
    trial_date,
    quantity,
    stitching_price,
    price_breakup,
    advance_paid,
    items, // Array of { id, item_name, service_type, quantity, price, measurements }
  } = req.body;

  const userId = req.user.id;

  if (!customer_id || !delivery_date) {
    return res
      .status(400)
      .json({ error: "Customer and Delivery Date are required." });
  }

  // Generate order number: ORD-YYMMDD-XXXX
  const dateStr = new Date().toISOString().slice(2, 10).replace(/-/g, ""); // YYMMDD
  const randomNum = Math.floor(1000 + Math.random() * 9000);
  const orderNumber = `ORD-${dateStr}-${randomNum}`;

  // Total amount and payment fields
  const qty = parseInt(quantity, 10) || 1;
  const totalAmount = (parseFloat(stitching_price) || 0) * qty;
  const advance = parseFloat(advance_paid) || 0;
  const balanceDue = Math.max(totalAmount - advance, 0);

  try {
    const insertQuery = `
      INSERT INTO orders (
        order_number, customer_id, special_instructions,
        inspiration_link, cloth_images, delivery_date, trial_date, quantity,
        stitching_price, price_breakup, user_id, items, advance_paid, balance_due
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      RETURNING *
    `;

    const result = await pool.query(insertQuery, [
      orderNumber,
      customer_id,
      special_instructions || null,
      inspiration_link || null,
      cloth_images || null,
      delivery_date,
      trial_date || null,
      quantity || 1,
      stitching_price || 0,
      price_breakup || null,
      userId,
      JSON.stringify(items || []),
      advance,
      balanceDue,
    ]);

    return res.status(201).json({
      message: "Order created successfully",
      order: result.rows[0],
    });
  } catch (error) {
    console.error("Error creating order:", error.message);
    return res.status(500).json({ error: "Server error creating order." });
  }
};

// Get all Orders
const getOrders = async (req, res) => {
  const userId = req.user.id;

  try {
    const query = `
      SELECT o.*, c.full_name as customer_name, c.phone_number as customer_phone
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      WHERE o.user_id = $1
      ORDER BY o.delivery_date ASC, o.created_at DESC
    `;

    const result = await pool.query(query, [userId]);
    return res.status(200).json({ orders: result.rows });
  } catch (error) {
    console.error("Error fetching orders:", error.message);
    return res.status(500).json({ error: "Server error fetching orders." });
  }
};

// Get a single Order by ID
const getOrderById = async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;

  try {
    const query = `
      SELECT o.*, c.full_name as customer_name, c.phone_number as customer_phone, c.email as customer_email, c.address as customer_address,
             c.city as customer_city, c.state as customer_state, c.postal_code as customer_postal_code, c.gender as customer_gender,
             i.invoice_number as linked_invoice_number, i.share_token as linked_invoice_share_token
      FROM orders o
      JOIN customers c ON o.customer_id = c.id
      LEFT JOIN invoices i ON o.invoice_id = i.id
      WHERE o.id = $1 AND o.user_id = $2
    `;

    const result = await pool.query(query, [id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Order not found." });
    }

    return res.status(200).json({ order: result.rows[0] });
  } catch (error) {
    console.error("Error fetching order by ID:", error.message);
    return res
      .status(500)
      .json({ error: "Server error fetching order details." });
  }
};

// Link Invoice to Order
const linkInvoiceToOrder = async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { invoice_id } = req.body;

  if (!invoice_id) {
    return res.status(400).json({ error: "Invoice ID is required." });
  }

  try {
    // Check if invoice exists and belongs to this user
    const invCheck = await pool.query(
      "SELECT id FROM invoices WHERE id = $1 AND user_id = $2",
      [invoice_id, userId],
    );
    if (invCheck.rows.length === 0) {
      return res.status(404).json({ error: "Invoice not found." });
    }

    const query = `
      UPDATE orders
      SET invoice_id = $1
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `;

    const result = await pool.query(query, [invoice_id, id, userId]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Order not found." });
    }

    // Also update the invoice to refer to this customer
    const orderObj = result.rows[0];
    await pool.query("UPDATE invoices SET customer_id = $1 WHERE id = $2", [
      orderObj.customer_id,
      invoice_id,
    ]);

    return res.status(200).json({
      message: "Invoice linked successfully",
      order: orderObj,
    });
  } catch (error) {
    console.error("Error linking invoice to order:", error.message);
    return res.status(500).json({ error: "Server error linking invoice." });
  }
};

// Update Order Status
const updateOrderStatus = async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { status } = req.body;

  if (!status) {
    return res.status(400).json({ error: "Status is required." });
  }

  const validStatuses = ["Pending", "In Progress", "Completed"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid status value." });
  }

  try {
    const query = `
      UPDATE orders
      SET status = $1
      WHERE id = $2 AND user_id = $3
      RETURNING *
    `;
    const result = await pool.query(query, [status, id, userId]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Order not found." });
    }
    return res.status(200).json({
      message: "Order status updated successfully",
      order: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating order status:", error.message);
    return res
      .status(500)
      .json({ error: "Server error updating order status." });
  }
};

// Update Order Payment (advance paid / balance due)
const updateOrderPayment = async (req, res) => {
  const userId = req.user.id;
  const { id } = req.params;
  const { advance_paid } = req.body;

  if (
    advance_paid === undefined ||
    advance_paid === null ||
    advance_paid === ""
  ) {
    return res.status(400).json({ error: "Advance paid amount is required." });
  }

  const advance = parseFloat(advance_paid);
  if (isNaN(advance) || advance < 0) {
    return res
      .status(400)
      .json({ error: "Advance paid amount must be a valid positive number." });
  }

  try {
    const orderResult = await pool.query(
      "SELECT stitching_price, quantity, invoice_id FROM orders WHERE id = $1 AND user_id = $2",
      [id, userId],
    );

    if (orderResult.rows.length === 0) {
      return res.status(404).json({ error: "Order not found." });
    }

    const orderData = orderResult.rows[0];
    const totalAmount =
      (parseFloat(orderData.stitching_price) || 0) *
      (parseFloat(orderData.quantity) || 1);
    const balanceDue = Math.max(totalAmount - advance, 0);

    const query = `
      UPDATE orders
      SET advance_paid = $1, balance_due = $2
      WHERE id = $3 AND user_id = $4
      RETURNING *
    `;
    const result = await pool.query(query, [advance, balanceDue, id, userId]);

    if (orderData.invoice_id) {
      await pool.query(
        "UPDATE invoices SET advance_paid = $1, balance_due = $2 WHERE id = $3 AND user_id = $4",
        [advance, balanceDue, orderData.invoice_id, userId],
      );
    }

    return res.status(200).json({
      message: "Order payment updated successfully",
      order: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating order payment:", error.message);
    return res
      .status(500)
      .json({ error: "Server error updating order payment." });
  }
};

module.exports = {
  createOrder,
  getOrders,
  getOrderById,
  linkInvoiceToOrder,
  updateOrderStatus,
  updateOrderPayment,
};
