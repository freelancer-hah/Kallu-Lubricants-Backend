const express = require('express');
const router = express.Router();
const Purchase = require('../models/Purchase');
const Product = require('../models/Product');
const { auth } = require('../middleware/auth');
const { createCashbookEntry } = require('../controllers/cashbookController');

// Get all purchases
router.get('/', auth, async (req, res) => {
  try {
    const purchases = await Purchase.find().populate('product', 'name company').sort({ date: -1 });
    res.json(purchases);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Get supplier ledger
router.get('/supplier-ledger', auth, async (req, res) => {
  try {
    const { companyName } = req.query;
    let query = {};
    
    if (companyName) {
      query.company = companyName;
    }
    
    const purchases = await Purchase.find(query)
      .populate('product', 'name')
      .sort({ date: -1 });
    
    res.json(purchases);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

// Get payable summary
router.get('/payable-summary', auth, async (req, res) => {
  try {
    const companyWise = await Purchase.aggregate([
      {
        $group: {
          _id: '$company',
          supplierName: { $first: '$company' },
          totalPurchases: { $sum: '$totalAmount' },
          totalPaid: { $sum: { $ifNull: ['$amountPaid', 0] } },
          totalPending: { $sum: { $ifNull: ['$remainingBalance', 0] } },
          purchaseCount: { $sum: 1 },
          lastPurchaseDate: { $max: '$date' }
        }
      },
      { $sort: { totalPending: -1 } }
    ]);
    
    const totalPayable = await Purchase.aggregate([
      { $group: { _id: null, total: { $sum: { $ifNull: ['$remainingBalance', 0] } } } }
    ]);
    
    res.json({
      suppliers: companyWise,
      summary: {
        totalPayable: totalPayable[0]?.total || 0,
        totalSuppliers: companyWise.length
      }
    });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

// Create purchase (updates product prices)
router.post('/', auth, async (req, res) => {
  try {
    const { product, costPrice, sellingPrice, quantity, amountPaid, date, notes } = req.body;
    
    console.log("Purchase request:", { product, costPrice, sellingPrice, quantity, amountPaid });
    
    const existingProduct = await Product.findById(product);
    if (!existingProduct) {
      return res.status(404).json({ message: 'Product not found' });
    }
    
    const totalAmount = costPrice * quantity;
    const paidAmount = amountPaid || 0;
    const remainingBalance = totalAmount - paidAmount;  // IMPORTANT: Calculate remaining balance
    
    console.log("Calculations:", { totalAmount, paidAmount, remainingBalance });
    
    let paymentStatus = 'pending';
    if (remainingBalance === 0) paymentStatus = 'paid';
    else if (paidAmount > 0) paymentStatus = 'partial';
    
    // Create purchase record
    const purchase = new Purchase({
      product,
      productName: existingProduct.name,
      company: existingProduct.company,
      costPrice,
      sellingPrice,
      quantity,
      totalAmount,
      amountPaid: paidAmount,
      remainingBalance: remainingBalance,  // IMPORTANT: Set remaining balance
      paymentStatus,
      date: date || new Date(),
      notes
    });
    
    // Update product stock and prices
    const newTotalQuantity = existingProduct.quantity + quantity;
    existingProduct.quantity = newTotalQuantity;
    existingProduct.currentCostPrice = costPrice;
    existingProduct.currentSellingPrice = sellingPrice;
    
    // Add to price history
    if (!existingProduct.priceHistory) existingProduct.priceHistory = [];
    existingProduct.priceHistory.push({
      costPrice,
      sellingPrice,
      date: new Date()
    });
    
    await existingProduct.save();
    await purchase.save();
    
    console.log("Purchase saved:", { 
      invoiceNo: purchase.invoiceNo,
      totalAmount: purchase.totalAmount,
      amountPaid: purchase.amountPaid,
      remainingBalance: purchase.remainingBalance,
      paymentStatus: purchase.paymentStatus
    });
    
    // Create cashbook entry for purchase
    await createCashbookEntry({
      date: date || new Date(),
      type: 'purchase',
      referenceId: purchase.invoiceNo,
      partyName: existingProduct.company,
      description: `Purchase from ${existingProduct.company} - ${existingProduct.name} x${quantity} @ ₹${costPrice}`,
      debit: 0,
      credit: totalAmount,
      paymentMethod: 'cash',
      createdBy: req.user.id
    });
    
    // If paid some amount
    if (paidAmount > 0) {
      await createCashbookEntry({
        date: date || new Date(),
        type: 'payment_made',
        referenceId: purchase.invoiceNo,
        partyName: existingProduct.company,
        description: `Payment to ${existingProduct.company} for purchase ${purchase.invoiceNo}`,
        debit: 0,
        credit: paidAmount,
        paymentMethod: 'cash',
        createdBy: req.user.id
      });
    }
    
    res.status(201).json(purchase);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
});

// Make payment to supplier
router.post('/pay', auth, async (req, res) => {
  try {
    const { purchaseId, amount, paymentMethod, date, notes } = req.body;
    
    const purchase = await Purchase.findById(purchaseId);
    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }
    
    console.log("Payment request:", { 
      purchaseId, 
      currentRemaining: purchase.remainingBalance,
      amount 
    });
    
    if (amount > purchase.remainingBalance) {
      return res.status(400).json({ 
        message: `Amount exceeds remaining balance of ₹${purchase.remainingBalance}` 
      });
    }
    
    purchase.amountPaid += amount;
    purchase.remainingBalance -= amount;
    purchase.paymentStatus = purchase.remainingBalance === 0 ? 'paid' : 'partial';
    await purchase.save();
    
    console.log("Payment recorded:", { 
      newAmountPaid: purchase.amountPaid,
      newRemainingBalance: purchase.remainingBalance,
      newStatus: purchase.paymentStatus
    });
    
    await createCashbookEntry({
      date: date || new Date(),
      type: 'payment_made',
      referenceId: purchase.invoiceNo,
      partyName: purchase.company,
      description: notes || `Payment to ${purchase.company} for purchase ${purchase.invoiceNo}`,
      debit: 0,
      credit: amount,
      paymentMethod: paymentMethod || 'cash',
      createdBy: req.user.id
    });
    
    res.json({ 
      success: true, 
      message: `Payment of ₹${amount} recorded`, 
      remainingBalance: purchase.remainingBalance 
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
});

// Delete purchase
router.delete('/:id', auth, async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) return res.status(404).json({ message: 'Purchase not found' });
    
    const product = await Product.findById(purchase.product);
    if (product) {
      product.quantity -= purchase.quantity;
      await product.save();
    }
    
    await purchase.deleteOne();
    res.json({ message: 'Purchase deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;