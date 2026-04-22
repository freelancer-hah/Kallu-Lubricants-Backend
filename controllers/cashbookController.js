const Cashbook = require('../models/Cashbook');
const BankAccount = require('../models/BankAccount');
const Customer = require('../models/Customer');
const Purchase = require('../models/Purchase');
const Product = require('../models/Product');

// Create cashbook entry - Daily cash flow tracker
const createCashbookEntry = async (data) => {
  try {
    // Get last balance
    const lastEntry = await Cashbook.findOne({ isDeleted: false }).sort({ date: -1, createdAt: -1 });
    let lastBalance = lastEntry ? lastEntry.balance : 0;
    
    // Calculate new balance: Debit (+) = Paisa aaya, Credit (-) = Paisa gaya
    let newBalance = lastBalance;
    if (data.debit > 0) newBalance += data.debit;
    if (data.credit > 0) newBalance -= data.credit;
    
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
      message: `Investment of ₹${amount.toLocaleString()} added`,
      entry 
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Get cashbook summary
const getCashbookSummary = async (req, res) => {
  try {
    // Cash in hand = sum of all cash transactions
    const cashEntries = await Cashbook.find({ 
      isDeleted: false,
      paymentMethod: 'cash' 
    });
    
    let cashInHand = 0;
    for (const entry of cashEntries) {
      if (entry.debit > 0) cashInHand += entry.debit;
      if (entry.credit > 0) cashInHand -= entry.credit;
    }
    
    // Stock value
    const products = await Product.find();
    const stockValue = products.reduce((sum, p) => sum + (p.currentCostPrice * p.quantity), 0);
    
    // Receivable
    const customers = await Customer.find();
    const totalReceivable = customers.reduce((sum, c) => sum + (c.currentBalance > 0 ? c.currentBalance : 0), 0);
    
    // Payable
    const purchases = await Purchase.find({ remainingBalance: { $gt: 0 } });
    const totalPayable = purchases.reduce((sum, p) => sum + p.remainingBalance, 0);
    
    // Bank balances
    const bankAccounts = await BankAccount.find({ isActive: true });
    const totalBankBalance = bankAccounts.reduce((sum, acc) => sum + acc.currentBalance, 0);
    
    // Net Worth
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

// Get cashbook ledger - Date-wise daily cash flow
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
      .sort({ date: 1, createdAt: 1 })  // Date-wise ascending for running balance
      .populate('bankAccountId', 'accountName bankName');
    
    // Calculate running balance for display
    let runningBalance = 0;
    const formattedTransactions = transactions.map(txn => {
      if (txn.debit > 0) runningBalance += txn.debit;
      if (txn.credit > 0) runningBalance -= txn.credit;
      return { ...txn.toObject(), runningBalance };
    }).reverse(); // Latest first
    
    res.json(formattedTransactions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = { createCashbookEntry, getCashbookSummary, getCashbookLedger, addInvestment };