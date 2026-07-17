const express = require('express');
const router = express.Router();
const Sale = require('../models/Sale');
const SalePayment = require('../models/SalePayment');
const Product = require('../models/Product');
const Customer = require('../models/Customer');
const BankAccount = require('../models/BankAccount');
const Cashbook = require('../models/Cashbook');
const CustomerLedger = require('../models/CustomerLedger');
const { auth } = require('../middleware/auth');
const { createCashbookEntry } = require('../controllers/cashbookController');
const { createCustomerLedgerEntry } = require('../controllers/customerLedgerController');

// Helper function to round to 2 decimal places
const roundToTwo = (num) => {
  return Math.round(num * 100) / 100;
};

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

// ✅ CREATE SALE - WITH WEIGHTED AVERAGE COST
router.post('/', auth, async (req, res) => {
  try {
    const { customer, items, discount, amountPaid, date, notes, paymentMethod, bankAccountId } = req.body;

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

      // ✅ Get the weighted average cost for this product
      const weightedAvgCost = product.weightedAverageCost || 0;
      const sellingPrice = item.sellingPrice || product.currentSellingPrice || 0;

      const itemTotal = sellingPrice * item.quantity;
      subtotal += itemTotal;
      
      // ✅ Calculate cost using weighted average
      const costOfGoodsSold = weightedAvgCost * item.quantity;
      totalCost += costOfGoodsSold;

      // ✅ Reduce stock using the reduceStock method
      const costUsed = product.reduceStock(item.quantity);
      await product.save();

      saleItems.push({
        product: product._id,
        productName: product.name,
        quantity: item.quantity,
        sellingPrice: sellingPrice,
        costPrice: weightedAvgCost, // Store the weighted average cost
        weightedAverageCost: weightedAvgCost,
        total: itemTotal
      });

      console.log(`📊 Sale Item: ${product.name}`);
      console.log(`   Quantity: ${item.quantity}`);
      console.log(`   Weighted Avg Cost: ${weightedAvgCost.toFixed(2)}`);
      console.log(`   Cost of Goods Sold: ${costOfGoodsSold.toFixed(2)}`);
      console.log(`   Selling Price: ${sellingPrice}`);
      console.log(`   Profit: ${(sellingPrice - weightedAvgCost) * item.quantity}`);
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

    console.log(`✅ Sale created: ${sale.invoiceNo}`);
    console.log(`   Total Amount: ${totalAmount}`);
    console.log(`   Total Cost: ${totalCost}`);
    console.log(`   Gross Profit: ${totalAmount - totalCost}`);

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

      if (paymentMethod === 'bank' && bankAccountId) {
        const bankAccount = await BankAccount.findById(bankAccountId);
        if (bankAccount) {
          bankAccount.currentBalance = roundToTwo(bankAccount.currentBalance + paidAmount);
          await bankAccount.save();
        }

        await createCashbookEntry({
          date: date || new Date(),
          type: 'payment_received',
          referenceId: sale.invoiceNo,
          partyName: customerData.name,
          partyId: customer,
          description: notes || `Payment received for invoice ${sale.invoiceNo} (Bank)`,
          debit: paidAmount,
          credit: 0,
          paymentMethod: 'bank',
          bankAccountId: bankAccountId,
          createdBy: req.user.id
        });
      } else {
        await createCashbookEntry({
          date: date || new Date(),
          type: 'payment_received',
          referenceId: sale.invoiceNo,
          partyName: customerData.name,
          partyId: customer,
          description: notes || `Payment received for invoice ${sale.invoiceNo} (Cash)`,
          debit: paidAmount,
          credit: 0,
          paymentMethod: 'cash',
          createdBy: req.user.id
        });
      }
    }

    res.status(201).json(sale);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
});

// ADD PAYMENT TO SALE
router.post('/:saleId/payments', auth, async (req, res) => {
  try {
    const { amount, paymentMethod, bankAccountId, date, notes } = req.body;
    const sale = await Sale.findById(req.params.saleId).populate('customer', 'name');

    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }

    if (amount > sale.remainingBalance) {
      return res.status(400).json({
        message: `Payment amount exceeds remaining balance of PKR ${sale.remainingBalance.toLocaleString()}`
      });
    }

    sale.amountPaid = roundToTwo(sale.amountPaid + amount);
    sale.remainingBalance = roundToTwo(sale.remainingBalance - amount);
    sale.status = sale.remainingBalance === 0 ? 'paid' : 'partial';
    await sale.save();

    const payment = new SalePayment({
      sale: sale._id,
      customer: sale.customer._id,
      amount,
      paymentMethod: paymentMethod || 'cash',
      date: date || new Date(),
      notes
    });
    await payment.save();

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

    if (paymentMethod === 'bank' && bankAccountId) {
      const bankAccount = await BankAccount.findById(bankAccountId);
      if (bankAccount) {
        bankAccount.currentBalance = roundToTwo(bankAccount.currentBalance + amount);
        await bankAccount.save();
      }

      await createCashbookEntry({
        date: date || new Date(),
        type: 'payment_received',
        referenceId: sale.invoiceNo,
        partyName: sale.customer.name,
        partyId: sale.customer._id,
        description: notes || `Payment received for invoice ${sale.invoiceNo} (Bank)`,
        debit: amount,
        credit: 0,
        paymentMethod: 'bank',
        bankAccountId: bankAccountId,
        createdBy: req.user.id
      });
    } else {
      await createCashbookEntry({
        date: date || new Date(),
        type: 'payment_received',
        referenceId: sale.invoiceNo,
        partyName: sale.customer.name,
        partyId: sale.customer._id,
        description: notes || `Payment received for invoice ${sale.invoiceNo} (Cash)`,
        debit: amount,
        credit: 0,
        paymentMethod: 'cash',
        createdBy: req.user.id
      });
    }

    res.status(201).json({ success: true, sale, remainingBalance: sale.remainingBalance });
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
});

// ✅ DELETE SALE - WITH WEIGHTED AVERAGE REVERSAL
router.delete('/:id', auth, async (req, res) => {
  try {
    const sale = await Sale.findById(req.params.id).populate('customer', 'name');
    if (!sale) {
      return res.status(404).json({ message: 'Sale not found' });
    }

    console.log(`========== DELETING SALE ${sale.invoiceNo} ==========`);

    // STEP 1: Restore product stock and recalculate weighted average
    for (const item of sale.items) {
      const product = await Product.findById(item.product);
      if (product) {
        // Restore stock with the cost price from the sale
        const restoreCost = item.costPrice || item.weightedAverageCost || 0;
        const restoreValue = restoreCost * item.quantity;
        
        // Add back to inventory
        const newTotalValue = product.totalInventoryValue + restoreValue;
        const newQuantity = product.quantity + item.quantity;
        const newWeightedAvg = newQuantity > 0 ? newTotalValue / newQuantity : 0;
        
        product.quantity = newQuantity;
        product.totalInventoryValue = newTotalValue;
        product.weightedAverageCost = newWeightedAvg;
        
        await product.save();
        console.log(`Stock restored for ${product.name}: +${item.quantity} units`);
        console.log(`New Weighted Average: ${newWeightedAvg.toFixed(2)}`);
      }
    }

    // STEP 2: Reverse customer ledger entries
    await createCustomerLedgerEntry({
      customerId: sale.customer._id,
      customerName: sale.customerName,
      date: new Date(),
      transactionType: 'sale_reversal',
      referenceNo: `DEL-${sale.invoiceNo}`,
      description: `Sale reversal - Invoice ${sale.invoiceNo} deleted`,
      debit: 0,
      credit: sale.totalAmount,
      createdBy: req.user.id
    });

    // STEP 3: Reverse payment if any payment was made
    if (sale.amountPaid > 0) {
      await createCustomerLedgerEntry({
        customerId: sale.customer._id,
        customerName: sale.customerName,
        date: new Date(),
        transactionType: 'payment_reversal',
        referenceNo: `DEL-${sale.invoiceNo}`,
        description: `Payment reversal - Invoice ${sale.invoiceNo} deleted`,
        debit: sale.amountPaid,
        credit: 0,
        createdBy: req.user.id
      });

      const cashEntry = await Cashbook.findOne({
        referenceId: sale.invoiceNo,
        type: 'payment_received',
        isDeleted: false
      });

      if (cashEntry) {
        if (cashEntry.paymentMethod === 'bank' && cashEntry.bankAccountId) {
          const bankAccount = await BankAccount.findById(cashEntry.bankAccountId);
          if (bankAccount) {
            bankAccount.currentBalance = roundToTwo(bankAccount.currentBalance - sale.amountPaid);
            await bankAccount.save();
            console.log(`Bank balance reversed: -PKR ${sale.amountPaid}`);
          }
        }

        cashEntry.isDeleted = true;
        await cashEntry.save();
        console.log(`Cashbook entry reversed for sale ${sale.invoiceNo}`);
      }
    }

    // STEP 4: Delete all payment records
    await SalePayment.deleteMany({ sale: sale._id });

    // STEP 5: Delete the sale
    await sale.deleteOne();

    console.log(`Sale ${sale.invoiceNo} deleted successfully`);
    console.log(`=============================================`);

    res.json({
      success: true,
      message: `Sale ${sale.invoiceNo} deleted. Stock restored, payment reversed.`
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

module.exports = router;