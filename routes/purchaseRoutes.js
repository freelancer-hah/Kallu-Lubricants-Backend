const express = require('express');
const router = express.Router();
const Purchase = require('../models/Purchase');
const Product = require('../models/Product');
const BankAccount = require('../models/BankAccount');
const Cashbook = require('../models/Cashbook');
const { auth } = require('../middleware/auth');
const { createCashbookEntry } = require('../controllers/cashbookController');

// Helper function to round to 2 decimal places
const roundToTwo = (num) => {
  return Math.round(num * 100) / 100;
};

// Get all purchases
router.get('/', auth, async (req, res) => {
  try {
    const purchases = await Purchase.find().populate('product', 'name company').sort({ date: -1 });
    res.json(purchases);
  } catch (error) {
    console.error(error);
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
        $match: {
          remainingBalance: { $gt: 0.01 }
        }
      },
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
      {
        $match: {
          remainingBalance: { $gt: 0.01 }
        }
      },
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
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

// ✅ CREATE PURCHASE - WITH WEIGHTED AVERAGE
router.post('/', auth, async (req, res) => {
  try {
    const {
      product,
      costPrice,
      sellingPrice,
      quantity,
      amountPaid,
      date,
      notes,
      paymentMethod,
      bankAccountId
    } = req.body;

    const existingProduct = await Product.findById(product);
    if (!existingProduct) {
      return res.status(404).json({ message: 'Product not found' });
    }

    const totalAmount = roundToTwo(costPrice * quantity);
    const paidAmount = roundToTwo(amountPaid || 0);
    let remainingBalance = roundToTwo(totalAmount - paidAmount);

    if (Math.abs(remainingBalance) < 0.01) {
      remainingBalance = 0;
    }

    let paymentStatus = 'pending';
    if (remainingBalance === 0) {
      paymentStatus = 'paid';
    } else if (paidAmount > 0) {
      paymentStatus = 'partial';
    }

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
      remainingBalance: remainingBalance,
      paymentStatus,
      date: date || new Date(),
      notes
    });

    // ✅ UPDATE PRODUCT WITH WEIGHTED AVERAGE
    // Save current values for calculation
    const oldWeightedAverage = existingProduct.weightedAverageCost || 0;
    const oldQuantity = existingProduct.quantity || 0;
    const oldTotalValue = oldWeightedAverage * oldQuantity;
    
    // Calculate new weighted average
    const newTotalValue = oldTotalValue + (costPrice * quantity);
    const newTotalQuantity = oldQuantity + quantity;
    const newWeightedAverage = newTotalQuantity > 0 ? newTotalValue / newTotalQuantity : 0;
    
    // Update product
    existingProduct.weightedAverageCost = roundToTwo(newWeightedAverage);
    existingProduct.totalInventoryValue = roundToTwo(newTotalValue);
    existingProduct.quantity = newTotalQuantity;
    existingProduct.currentCostPrice = costPrice;
    existingProduct.currentSellingPrice = sellingPrice;

    // Add to price history with quantity
    if (!existingProduct.priceHistory) existingProduct.priceHistory = [];
    existingProduct.priceHistory.push({
      costPrice,
      sellingPrice,
      quantity,
      date: new Date()
    });

    console.log(`📊 Weighted Average Update for ${existingProduct.name}:`);
    console.log(`   Old: ${oldQuantity} units @ ${oldWeightedAverage.toFixed(2)} = ${oldTotalValue.toFixed(2)}`);
    console.log(`   New Purchase: ${quantity} units @ ${costPrice} = ${(costPrice * quantity).toFixed(2)}`);
    console.log(`   New Weighted Average: ${newWeightedAverage.toFixed(2)}`);

    await existingProduct.save();
    await purchase.save();

    console.log("Purchase saved:", {
      invoiceNo: purchase.invoiceNo,
      totalAmount: purchase.totalAmount,
      amountPaid: purchase.amountPaid,
      remainingBalance: purchase.remainingBalance,
      paymentStatus: purchase.paymentStatus,
      weightedAverageCost: existingProduct.weightedAverageCost
    });

    // Create cashbook entry ONLY if payment made
    if (paidAmount > 0) {
      if (paymentMethod === 'bank' && bankAccountId) {
        const bankAccount = await BankAccount.findById(bankAccountId);
        if (!bankAccount) {
          return res.status(404).json({ message: 'Bank account not found' });
        }

        if (bankAccount.currentBalance < paidAmount) {
          return res.status(400).json({
            message: `Insufficient balance in ${bankAccount.bankName} account. Available: PKR ${bankAccount.currentBalance.toLocaleString()}`
          });
        }

        bankAccount.currentBalance = roundToTwo(bankAccount.currentBalance - paidAmount);
        await bankAccount.save();

        await createCashbookEntry({
          date: date || new Date(),
          type: 'payment_made',
          referenceId: purchase.invoiceNo,
          partyName: existingProduct.company,
          description: notes || `Payment to ${existingProduct.company} for purchase ${purchase.invoiceNo} (Bank - ${bankAccount.bankName})`,
          debit: 0,
          credit: paidAmount,
          paymentMethod: 'bank',
          bankAccountId: bankAccountId,
          createdBy: req.user.id
        });
      } else {
        await createCashbookEntry({
          date: date || new Date(),
          type: 'payment_made',
          referenceId: purchase.invoiceNo,
          partyName: existingProduct.company,
          description: notes || `Payment to ${existingProduct.company} for purchase ${purchase.invoiceNo} (Cash)`,
          debit: 0,
          credit: paidAmount,
          paymentMethod: 'cash',
          createdBy: req.user.id
        });
      }
    }

    res.status(201).json(purchase);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
});

// MAKE PAYMENT TO SUPPLIER
router.post('/pay', auth, async (req, res) => {
  try {
    const { purchaseId, amount, paymentMethod, bankAccountId, date, notes } = req.body;

    const purchase = await Purchase.findById(purchaseId);
    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    const paymentAmount = roundToTwo(amount);
    const currentRemaining = roundToTwo(purchase.remainingBalance);

    if (paymentAmount > currentRemaining + 0.01) {
      return res.status(400).json({
        message: `Amount exceeds remaining balance of PKR ${currentRemaining.toLocaleString()}`
      });
    }

    purchase.amountPaid = roundToTwo(purchase.amountPaid + paymentAmount);
    let newRemaining = roundToTwo(purchase.totalAmount - purchase.amountPaid);

    if (Math.abs(newRemaining) < 0.01) {
      newRemaining = 0;
    }

    purchase.remainingBalance = newRemaining;

    if (purchase.remainingBalance === 0) {
      purchase.paymentStatus = 'paid';
    } else if (purchase.amountPaid > 0) {
      purchase.paymentStatus = 'partial';
    }

    await purchase.save();

    if (paymentMethod === 'bank' && bankAccountId) {
      const bankAccount = await BankAccount.findById(bankAccountId);
      if (!bankAccount) {
        return res.status(404).json({ message: 'Bank account not found' });
      }

      if (bankAccount.currentBalance < paymentAmount) {
        return res.status(400).json({
          message: `Insufficient balance in ${bankAccount.bankName} account. Available: PKR ${bankAccount.currentBalance.toLocaleString()}`
        });
      }

      bankAccount.currentBalance = roundToTwo(bankAccount.currentBalance - paymentAmount);
      await bankAccount.save();

      await createCashbookEntry({
        date: date || new Date(),
        type: 'payment_made',
        referenceId: purchase.invoiceNo,
        partyName: purchase.company,
        description: notes || `Payment to ${purchase.company} for purchase ${purchase.invoiceNo} (Bank - ${bankAccount.bankName})`,
        debit: 0,
        credit: paymentAmount,
        paymentMethod: 'bank',
        bankAccountId: bankAccountId,
        createdBy: req.user.id
      });
    } else {
      await createCashbookEntry({
        date: date || new Date(),
        type: 'payment_made',
        referenceId: purchase.invoiceNo,
        partyName: purchase.company,
        description: notes || `Payment to ${purchase.company} for purchase ${purchase.invoiceNo} (Cash)`,
        debit: 0,
        credit: paymentAmount,
        paymentMethod: 'cash',
        createdBy: req.user.id
      });
    }

    res.json({
      success: true,
      message: `Payment of PKR ${paymentAmount.toLocaleString()} recorded successfully${paymentMethod === 'bank' ? ' from bank account.' : ' in cash.'}`,
      remainingBalance: purchase.remainingBalance,
      paymentStatus: purchase.paymentStatus
    });
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
});

// Get single purchase
router.get('/:id', auth, async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id).populate('product', 'name company');
    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }
    res.json(purchase);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

// Update purchase
router.put('/:id', auth, async (req, res) => {
  try {
    const { costPrice, sellingPrice, quantity, amountPaid, date, notes } = req.body;
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    const product = await Product.findById(purchase.product);
    if (!product) {
      return res.status(404).json({ message: 'Product not found' });
    }

    // ✅ Revert stock and recalculate weighted average
    // Remove old purchase effect
    const oldCostPrice = purchase.costPrice;
    const oldQuantity = purchase.quantity;
    const oldTotalValue = oldCostPrice * oldQuantity;
    
    // Remove from total inventory value
    const newTotalValue = product.totalInventoryValue - oldTotalValue;
    const newQuantity = product.quantity - oldQuantity;
    const newWeightedAvg = newQuantity > 0 ? newTotalValue / newQuantity : 0;
    
    product.quantity = newQuantity;
    product.totalInventoryValue = newTotalValue;
    product.weightedAverageCost = newWeightedAvg;

    // Update purchase with new values
    const newCostPrice = costPrice || purchase.costPrice;
    const newQuantityVal = quantity || purchase.quantity;
    const newTotalAmount = roundToTwo(newCostPrice * newQuantityVal);
    const newPaidAmount = roundToTwo(amountPaid !== undefined ? amountPaid : purchase.amountPaid);
    let newRemainingBalance = roundToTwo(newTotalAmount - newPaidAmount);

    if (Math.abs(newRemainingBalance) < 0.01) {
      newRemainingBalance = 0;
    }

    let newPaymentStatus = 'pending';
    if (newRemainingBalance === 0) {
      newPaymentStatus = 'paid';
    } else if (newPaidAmount > 0) {
      newPaymentStatus = 'partial';
    }

    purchase.costPrice = newCostPrice;
    purchase.sellingPrice = sellingPrice || purchase.sellingPrice;
    purchase.quantity = newQuantityVal;
    purchase.totalAmount = newTotalAmount;
    purchase.amountPaid = newPaidAmount;
    purchase.remainingBalance = newRemainingBalance;
    purchase.paymentStatus = newPaymentStatus;
    purchase.date = date || purchase.date;
    purchase.notes = notes || purchase.notes;

    await purchase.save();

    // ✅ Add updated purchase effect with weighted average
    const updatedTotalValue = product.totalInventoryValue + (newCostPrice * newQuantityVal);
    const updatedTotalQuantity = product.quantity + newQuantityVal;
    const updatedWeightedAvg = updatedTotalQuantity > 0 ? updatedTotalValue / updatedTotalQuantity : 0;

    product.quantity = updatedTotalQuantity;
    product.totalInventoryValue = updatedTotalValue;
    product.weightedAverageCost = updatedWeightedAvg;
    product.currentCostPrice = newCostPrice;
    product.currentSellingPrice = sellingPrice || product.currentSellingPrice;
    
    await product.save();

    res.json(purchase);
  } catch (error) {
    console.error(error);
    res.status(400).json({ message: error.message });
  }
});

// DELETE PURCHASE - WITH WEIGHTED AVERAGE REVERSAL
router.delete('/:id', auth, async (req, res) => {
  try {
    const purchase = await Purchase.findById(req.params.id);
    if (!purchase) {
      return res.status(404).json({ message: 'Purchase not found' });
    }

    console.log(`========== DELETING PURCHASE ${purchase.invoiceNo} ==========`);

    // ✅ STEP 1: Restore product stock and recalculate weighted average
    const product = await Product.findById(purchase.product);
    if (product) {
      const oldCostPrice = purchase.costPrice;
      const oldQuantity = purchase.quantity;
      const oldTotalValue = oldCostPrice * oldQuantity;
      
      // Remove this purchase from inventory
      const newTotalValue = product.totalInventoryValue - oldTotalValue;
      const newQuantity = product.quantity - oldQuantity;
      const newWeightedAvg = newQuantity > 0 ? newTotalValue / newQuantity : 0;
      
      product.quantity = newQuantity;
      product.totalInventoryValue = newTotalValue;
      product.weightedAverageCost = newWeightedAvg;
      
      // If no stock left, reset prices to 0
      if (newQuantity === 0) {
        product.currentCostPrice = 0;
        product.currentSellingPrice = 0;
        product.weightedAverageCost = 0;
        product.totalInventoryValue = 0;
      }
      
      await product.save();
      console.log(`Stock restored for ${product.name}: -${oldQuantity} units`);
      console.log(`New Weighted Average: ${newWeightedAvg.toFixed(2)}`);
    }

    // STEP 2: Reverse payment if any payment was made
    if (purchase.amountPaid > 0) {
      const cashEntry = await Cashbook.findOne({
        referenceId: purchase.invoiceNo,
        type: 'payment_made',
        isDeleted: false
      });

      if (cashEntry) {
        if (cashEntry.paymentMethod === 'bank' && cashEntry.bankAccountId) {
          const bankAccount = await BankAccount.findById(cashEntry.bankAccountId);
          if (bankAccount) {
            const reversedAmount = roundToTwo(purchase.amountPaid);
            bankAccount.currentBalance = roundToTwo(bankAccount.currentBalance + reversedAmount);
            await bankAccount.save();
            console.log(`✅ Bank balance reversed: ${bankAccount.bankName}`);
          }
        }

        cashEntry.isDeleted = true;
        await cashEntry.save();
        console.log(`Cashbook entry reversed for purchase ${purchase.invoiceNo}`);
      }
    }

    // STEP 3: Delete the purchase
    await purchase.deleteOne();

    console.log(`Purchase ${purchase.invoiceNo} deleted successfully`);
    console.log(`=============================================`);

    res.json({
      success: true,
      message: `Purchase ${purchase.invoiceNo} deleted. Stock and payment restored.`
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
});

module.exports = router;