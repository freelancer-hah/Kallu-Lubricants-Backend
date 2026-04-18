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
const { moveToTrash } = require('../controllers/trashBinController');

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

// Create sale - NO cashbook entry for sale, only receivable
router.post('/', auth, async (req, res) => {
  try {
    const { customer, items, discount, amountPaid, date, notes, paymentMethod } = req.body;
    
    const customerData = await Customer.findById(customer);
    if (!customerData) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    
    let subtotal = 0;
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
    
    const totalAmount = subtotal - (discount || 0);
    const remainingBalance = totalAmount - (amountPaid || 0);
    
    let status = 'pending';
    if (remainingBalance === 0) status = 'paid';
    else if (amountPaid > 0) status = 'partial';
    
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
      date: date || new Date(),
      notes
    });
    
    await sale.save();
    
    // Create customer ledger entry for sale (Receivable increase)
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
    
    // If customer paid something at the time of sale
    if (amountPaid > 0) {
      const payment = new SalePayment({
        sale: sale._id,
        customer,
        amount: amountPaid,
        paymentMethod: paymentMethod || 'cash',
        date: date || new Date(),
        notes: notes || `Payment for invoice ${sale.invoiceNo}`
      });
      await payment.save();
      
      // Record cashbook entry for payment
      await createCashbookEntry({
        date: date || new Date(),
        type: 'payment_received',
        referenceId: sale.invoiceNo,
        partyName: customerData.name,
        partyId: customer,
        description: notes || `Payment received for invoice ${sale.invoiceNo}`,
        debit: amountPaid,
        credit: 0,
        paymentMethod: paymentMethod || 'cash',
        createdBy: req.user.id
      });
      
      // Update customer ledger for payment (credit)
      await createCustomerLedgerEntry({
        customerId: customer,
        customerName: customerData.name,
        date: date || new Date(),
        transactionType: 'payment_received',
        referenceNo: sale.invoiceNo,
        description: `Payment received for invoice ${sale.invoiceNo}`,
        debit: 0,
        credit: amountPaid,
        createdBy: req.user.id
      });
    }
    
    res.status(201).json(sale);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
});

// Add payment to sale - FIXED for both cash and bank
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
    
    // UPDATE SALE - Always update receivable regardless of payment method
    sale.amountPaid += amount;
    sale.remainingBalance -= amount;
    
    if (sale.remainingBalance === 0) {
      sale.status = 'paid';
    } else if (sale.amountPaid > 0) {
      sale.status = 'partial';
    }
    
    await sale.save();
    
    // Record payment in SalePayment collection
    const payment = new SalePayment({
      sale: sale._id,
      customer: sale.customer,
      amount,
      paymentMethod: paymentMethod || 'cash',
      date: date || new Date(),
      notes
    });
    
    await payment.save();
    
    // Update customer ledger for payment (credit) - ALWAYS do this
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
    
    // Prepare cashbook entry based on payment method
    let cashbookData = {
      date: date || new Date(),
      type: 'payment_received',
      referenceId: sale.invoiceNo,
      partyName: sale.customer.name,
      partyId: sale.customer._id,
      description: notes || `Payment received for invoice ${sale.invoiceNo}`,
      createdBy: req.user.id
    };
    
    if (paymentMethod === 'bank' && bankAccountId) {
      // BANK PAYMENT - Only affects bank balance, not cash in hand
      cashbookData = {
        ...cashbookData,
        debit: amount,
        credit: 0,
        paymentMethod: 'bank',
        bankAccountId: bankAccountId
      };
      
      // Update bank account balance
      const bankAccount = await BankAccount.findById(bankAccountId);
      if (bankAccount) {
        bankAccount.currentBalance += amount;
        await bankAccount.save();
        cashbookData.description = `${notes || `Payment received for invoice ${sale.invoiceNo}`} (Deposited to: ${bankAccount.bankName} - ${bankAccount.accountName})`;
      }
    } else {
      // CASH PAYMENT - Affects cash in hand
      cashbookData = {
        ...cashbookData,
        debit: amount,
        credit: 0,
        paymentMethod: paymentMethod || 'cash'
      };
    }
    
    // Create cashbook entry
    await createCashbookEntry(cashbookData);
    
    res.status(201).json({ 
      success: true,
      sale, 
      payment,
      remainingBalance: sale.remainingBalance,
      message: `Payment of ₹${amount.toLocaleString()} recorded successfully${paymentMethod === 'bank' ? ' and deposited to bank account.' : ''}`
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
});

// Delete sale (move to trash)
router.delete('/:id', auth, async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id).populate('customer', 'name');
    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }
    
    await moveToTrash(
      'Sale',
      sale._id,
      sale.toObject(),
      req.user.id,
      req.user.username || req.user.name,
      req.body.reason || 'Deleted from invoice list'
    );
    
    for (const item of sale.items) {
      const product = await Product.findById(item.product);
      if (product) {
        product.quantity += item.quantity;
        await product.save();
      }
    }
    
    await SalePayment.deleteMany({ sale: sale._id });
    await sale.deleteOne();
    
    res.json({ 
      success: true,
      message: 'Sale deleted successfully and moved to trash' 
    });
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

// Get all payments (for reporting)
router.get('/payments/all', auth, async (req, res) => {
  try {
    const payments = await SalePayment.find()
      .populate('sale', 'invoiceNo totalAmount customerName')
      .populate('customer', 'name phone')
      .sort({ date: -1 });
    res.json(payments);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;