const express = require('express');
const router = express.Router();
const Sale = require('../models/Sale');
const SalePayment = require('../models/SalePayment');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const BankAccount = require('../models/BankAccount');
const { auth } = require('../middleware/auth');
const { createCashbookEntry } = require('../controllers/cashbookController');
const { createCustomerLedgerEntry } = require('../controllers/customerLedgerController');

// Get all sales
router.get('/', auth, async (req, res) => {
  try {
    const sales = await Sale.find()
      .populate('customer', 'name phone')
      .sort({ date: -1 });
    res.json(sales);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

// Get single sale with payments
router.get('/:id', auth, async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id)
      .populate('customer', 'name phone shop_name address');
    const payments = await SalePayment.find({ sale: sale._id })
      .sort({ date: -1 });
    res.json({ sale, payments });
  } catch (error) {
    console.error(error);
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
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

// Create sale
router.post('/', auth, async (req, res) => {
  try {
    const { customer, items, discount, amountPaid, date, notes, paymentMethod } = req.body;
    
    const customerData = await Customer.findById(customer);
    if (!customerData) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    
    let subtotal = 0;
    let totalCost = 0;
    const saleItems = [];
    
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
      
      const costPrice = item.costPrice || product.currentCostPrice || 0;
      const sellingPrice = item.sellingPrice || product.currentSellingPrice || 0;
      
      const itemTotal = sellingPrice * item.quantity;
      subtotal += itemTotal;
      totalCost += costPrice * item.quantity;
      
      saleItems.push({
        product: product._id,
        productName: product.name,
        quantity: item.quantity,
        sellingPrice: sellingPrice,
        costPrice: costPrice,
        total: itemTotal
      });
      
      product.quantity -= item.quantity;
      await product.save();
    }
    
    const discountAmount = discount || 0;
    const totalAmount = subtotal - discountAmount;
    const paidAmount = amountPaid || 0;
    const remainingBalance = totalAmount - paidAmount;
    
    let status = 'pending';
    if (remainingBalance === 0) status = 'paid';
    else if (paidAmount > 0) status = 'partial';
    
    const sale = new Sale({
      customer,
      customerName: customerData.name,
      customerPhone: customerData.phone,
      items: saleItems,
      subtotal,
      discount: discountAmount,
      totalAmount,
      amountPaid: paidAmount,
      remainingBalance,
      status,
      date: date || new Date(),
      notes
    });
    
    await sale.save();
    
    console.log(`Sale created: ${sale.invoiceNo}, status: ${sale.status}, remainingBalance: ${sale.remainingBalance}`);
    
    // Create customer ledger entry for sale
    await createCustomerLedgerEntry({
      customerId: customer,
      customerName: customerData.name,
      date: date || new Date(),
      transactionType: 'sale',
      referenceNo: sale.invoiceNo,
      description: `Sale invoice ${sale.invoiceNo}`,
      debit: totalAmount,
      credit: 0,
      createdBy: req.user.id
    });
    
    // If customer paid at time of sale
    if (paidAmount > 0) {
      const payment = new SalePayment({
        sale: sale._id,
        customer,
        amount: paidAmount,
        paymentMethod: paymentMethod || 'cash',
        date: date || new Date(),
        notes: notes || `Payment for invoice ${sale.invoiceNo}`
      });
      await payment.save();
      
      await createCustomerLedgerEntry({
        customerId: customer,
        customerName: customerData.name,
        date: date || new Date(),
        transactionType: 'payment_received',
        referenceNo: sale.invoiceNo,
        description: `Payment received for invoice ${sale.invoiceNo}`,
        debit: 0,
        credit: paidAmount,
        createdBy: req.user.id
      });
      
      await createCashbookEntry({
        date: date || new Date(),
        type: 'payment_received',
        referenceId: sale.invoiceNo,
        partyName: customerData.name,
        partyId: customer,
        description: notes || `Payment received for invoice ${sale.invoiceNo}`,
        debit: paidAmount,
        credit: 0,
        paymentMethod: paymentMethod || 'cash',
        createdBy: req.user.id
      });
    }
    
    res.status(201).json(sale);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
});

// ADD PAYMENT TO SALE - FIXED with status update
router.post('/:saleId/payments', auth, async (req, res) => {
  try {
    const { amount, paymentMethod, bankAccountId, date, notes } = req.body;
    const sale = await Sale.findById(req.params.saleId).populate('customer', 'name');
    
    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }
    
    if (amount > sale.remainingBalance) {
      return res.status(400).json({ 
        message: `Payment amount exceeds remaining balance of ₹${sale.remainingBalance.toLocaleString()}` 
      });
    }
    
    // Update sale
    sale.amountPaid += amount;
    sale.remainingBalance -= amount;
    
    // FIXED: Update status based on remaining balance
    if (sale.remainingBalance === 0) {
      sale.status = 'paid';
    } else if (sale.amountPaid > 0) {
      sale.status = 'partial';
    }
    
    await sale.save();
    
    console.log(`Sale ${sale.invoiceNo} updated: status=${sale.status}, remainingBalance=${sale.remainingBalance}`);
    
    // Record payment in SalePayment collection
    const payment = new SalePayment({
      sale: sale._id,
      customer: sale.customer._id,
      amount,
      paymentMethod: paymentMethod || 'cash',
      date: date || new Date(),
      notes
    });
    await payment.save();
    
    // Customer ledger entry for payment
    await createCustomerLedgerEntry({
      customerId: sale.customer._id,
      customerName: sale.customer.name,
      date: date || new Date(),
      transactionType: 'payment_received',
      referenceNo: sale.invoiceNo,
      description: notes || `Payment received for invoice ${sale.invoiceNo}`,
      debit: 0,
      credit: amount,
      createdBy: req.user.id
    });
    
    // Cashbook entry based on payment method
    if (paymentMethod === 'bank' && bankAccountId) {
      const bankAccount = await BankAccount.findById(bankAccountId);
      if (bankAccount) {
        bankAccount.currentBalance += amount;
        await bankAccount.save();
      }
    }
    
    await createCashbookEntry({
      date: date || new Date(),
      type: 'payment_received',
      referenceId: sale.invoiceNo,
      partyName: sale.customer.name,
      partyId: sale.customer._id,
      description: notes || `Payment received for invoice ${sale.invoiceNo}`,
      debit: amount,
      credit: 0,
      paymentMethod: paymentMethod || 'cash',
      bankAccountId: paymentMethod === 'bank' ? bankAccountId : null,
      createdBy: req.user.id
    });
    
    res.status(201).json({ 
      success: true,
      sale, 
      payment,
      remainingBalance: sale.remainingBalance,
      status: sale.status
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
});

// Delete sale
router.delete('/:id', auth, async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id);
    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }
    
    // Restore stock
    for (const item of sale.items) {
      const product = await Product.findById(item.product);
      if (product) {
        product.quantity += item.quantity;
        await product.save();
      }
    }
    
    await SalePayment.deleteMany({ sale: sale._id });
    await sale.deleteOne();
    
    res.json({ success: true, message: 'Sale deleted successfully' });
  } catch (error) {
    console.error(error);
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
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;