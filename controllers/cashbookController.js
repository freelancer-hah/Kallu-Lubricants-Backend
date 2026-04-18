const Cashbook = require('../models/Cashbook');
const BankAccount = require('../models/BankAccount');
const Customer = require('../models/Customer');
const Purchase = require('../models/Purchase');
const Product = require('../models/Product');

// Create cashbook entry
const createCashbookEntry = async (data) => {
  try {
    // Get last balance
    const lastEntry = await Cashbook.findOne({ isDeleted: false }).sort({ createdAt: -1 });
    let lastBalance = lastEntry ? lastEntry.balance : 0;
    
    // Calculate new balance
    let newBalance = lastBalance;
    if (data.debit > 0) newBalance += data.debit;   // Paisa aaya
    if (data.credit > 0) newBalance -= data.credit; // Paisa gaya
    
    const entry = new Cashbook({
      transactionId: `CB-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      ...data,
      balance: newBalance
    });
    
    await entry.save();
    return entry;
  } catch (error) {
    console.error('Cashbook entry error:', error);
    return null;
  }
};

// Add owner investment
const addInvestment = async (req, res) => {
  try {
    const { amount, description, paymentMethod, date } = req.body;
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Please enter a valid amount' });
    }
    
    const entry = await createCashbookEntry({
      date: date || new Date(),
      type: 'investment',
      partyName: 'Owner',
      description: description || `Owner investment of ₹${amount}`,
      debit: amount,
      credit: 0,
      paymentMethod: paymentMethod || 'cash',
      createdBy: req.user.id
    });
    
    res.json({ 
      success: true, 
      message: `Investment of ₹${amount.toLocaleString()} added successfully`,
      entry 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Get complete cashbook summary
const getCashbookSummary = async (req, res) => {
  try {
    // Total cash in hand (all cash transactions)
    const cashEntries = await Cashbook.find({ isDeleted: false });
    let cashInHand = 0;
    for (const entry of cashEntries) {
      if (entry.debit > 0) cashInHand += entry.debit;
      if (entry.credit > 0) cashInHand -= entry.credit;
    }
    
    // Stock value
    const products = await Product.find();
    const stockValue = products.reduce((sum, p) => sum + (p.currentCostPrice * p.quantity), 0);
    
    // Total receivable (Customers se lena hai)
    const customers = await Customer.find();
    const totalReceivable = customers.reduce((sum, c) => sum + (c.currentBalance > 0 ? c.currentBalance : 0), 0);
    
    // Total payable (Companies ko dena hai)
    const purchases = await Purchase.find({ remainingBalance: { $gt: 0 } });
    const totalPayable = purchases.reduce((sum, p) => sum + p.remainingBalance, 0);
    
    // Bank balances
    const bankAccounts = await BankAccount.find({ isActive: true });
    const totalBankBalance = bankAccounts.reduce((sum, acc) => sum + acc.currentBalance, 0);
    
    // Net Worth = Cash + Bank + Stock + Receivable - Payable
    const netWorth = cashInHand + totalBankBalance + stockValue + totalReceivable - totalPayable;
    
    res.json({
      summary: {
        cashInHand,
        totalBankBalance,
        stockValue,
        totalReceivable,
        totalPayable,
        netWorth
      },
      bankAccounts,
      recentTransactions: await Cashbook.find({ isDeleted: false }).sort({ date: -1 }).limit(20)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Get cashbook ledger (all transactions)
const getCashbookLedger = async (req, res) => {
  try {
    const { startDate, endDate, type, paymentMethod } = req.query;
    let query = { isDeleted: false };
    
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    if (type) query.type = type;
    if (paymentMethod) query.paymentMethod = paymentMethod;
    
    const transactions = await Cashbook.find(query)
      .sort({ date: -1 })
      .populate('bankAccountId', 'accountName bankName');
    
    res.json(transactions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = { createCashbookEntry, getCashbookSummary, getCashbookLedger, addInvestment };