const express = require('express');
const router = express.Router();
const Sale = require('../models/Sale');
const SalePayment = require('../models/SalePayment');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const { auth } = require('../middleware/auth');

// Get all sales
router.get('/', auth, async (req, res) => {
  try {
    const sales = await Sale.find().populate('customer', 'name phone').sort({ date: -1 });
    res.json(sales);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get single sale with payments
router.get('/:id', auth, async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id).populate('customer', 'name phone shop_name address');
    const payments = await SalePayment.find({ sale: sale._id }).sort({ date: -1 });
    res.json({ sale, payments });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get customer balance/dues
router.get('/customer/:customerId/balance', auth, async (req, res) => {
  try {
    const sales = await Sale.find({ 
      customer: req.params.customerId,
      remainingBalance: { $gt: 0 }
    });
    
    const totalDue = sales.reduce((sum, sale) => sum + sale.remainingBalance, 0);
    res.json({ totalDue, sales });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create sale
router.post('/', auth, async (req, res) => {
  try {
    const { customer, items, discount, amountPaid, date, notes } = req.body;
    
    // Get customer details
    const customerData = await Customer.findById(customer);
    if (!customerData) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    
    let subtotal = 0;
    const saleItems = [];
    
    // Process each item and check stock
    for (const item of items) {
      const product = await Product.findById(item.product);
      if (!product) {
        return res.status(404).json({ message: `Product not found: ${item.product}` });
      }
      
      if (product.quantity < item.quantity) {
        return res.status(400).json({ 
          message: `Insufficient stock for ${product.name}. Available: ${product.quantity}` 
        });
      }
      
      const itemTotal = item.sellingPrice * item.quantity;
      subtotal += itemTotal;
      
      saleItems.push({
        product: product._id,
        productName: product.name,
        quantity: item.quantity,
        sellingPrice: item.sellingPrice,
        costPrice: product.costPrice,
        total: itemTotal
      });
      
      // Update stock
      product.quantity -= item.quantity;
      await product.save();
    }
    
    const totalAmount = subtotal - (discount || 0);
    const remainingBalance = totalAmount - (amountPaid || 0);
    
    let status = 'pending';
    if (remainingBalance === 0) status = 'paid';
    else if (amountPaid > 0) status = 'partial';
    
    // Create sale
    const sale = new Sale({
      customer,
      customerName: customerData.name,
      customerPhone: customerData.phone,
      items: saleItems,
      subtotal,
      discount: discount || 0,
      totalAmount,
      amountPaid: amountPaid || 0,
      remainingBalance,
      status,
      date,
      notes
    });
    
    await sale.save();
    
    // Record payment if any
    if (amountPaid > 0) {
      const payment = new SalePayment({
        sale: sale._id,
        customer,
        amount: amountPaid,
        date: date || new Date(),
        notes: `Initial payment for invoice ${sale.invoiceNo}`
      });
      await payment.save();
    }
    
    res.status(201).json(sale);
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});

// Add payment to sale
router.post('/:saleId/payments', auth, async (req, res) => {
  try {
    const { amount, paymentMethod, date, notes } = req.body;
    const sale = await Sale.findById(req.params.saleId);
    
    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }
    
    if (amount > sale.remainingBalance) {
      return res.status(400).json({ 
        message: `Payment amount exceeds remaining balance of ₹${sale.remainingBalance}` 
      });
    }
    
    // Update sale
    sale.amountPaid += amount;
    sale.remainingBalance -= amount;
    
    if (sale.remainingBalance === 0) {
      sale.status = 'paid';
    } else if (sale.amountPaid > 0) {
      sale.status = 'partial';
    }
    
    await sale.save();
    
    // Record payment
    const payment = new SalePayment({
      sale: sale._id,
      customer: sale.customer,
      amount,
      paymentMethod: paymentMethod || 'cash',
      date: date || new Date(),
      notes
    });
    
    await payment.save();
    
    res.status(201).json({ sale, payment });
  } catch (error) {
    res.status(400).json({ message: error.message });
  }
});
// Delete sale (and restore stock)
router.delete('/:id', auth, async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }
    
    // Restore stock for each item
    for (const item of sale.items) {
      const product = await Product.findById(item.product);
      if (product) {
        product.quantity += item.quantity;
        await product.save();
      }
    }
    
    // Delete all payments associated with this sale
    await SalePayment.deleteMany({ sale: sale._id });
    
    // Delete the sale
    await sale.deleteOne();
    
    res.json({ message: 'Sale deleted successfully and stock restored' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get payment history for customer
router.get('/payments/customer/:customerId', auth, async (req, res) => {
  try {
    const payments = await SalePayment.find({ customer: req.params.customerId })
      .populate('sale', 'invoiceNo totalAmount')
      .sort({ date: -1 });
    res.json(payments);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;