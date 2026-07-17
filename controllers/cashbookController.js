const Cashbook = require('../models/Cashbook');
const BankAccount = require('../models/BankAccount');
const Customer = require('../models/Customer');
const Purchase = require('../models/Purchase');
const Product = require('../models/Product');

// Helper function to round to 2 decimal places
const roundToTwo = (num) => {
  return Math.round(num * 100) / 100;
};

// Create cashbook entry
const createCashbookEntry = async (data) => {
  try {
    const lastEntry = await Cashbook.findOne({ isDeleted: false }).sort({ date: 1, createdAt: 1 });
    let lastBalance = lastEntry ? lastEntry.balance : 0;

    let newBalance = lastBalance;
    if (data.debit > 0) newBalance += data.debit;
    if (data.credit > 0) newBalance -= data.credit;

    const entry = new Cashbook({
      transactionId: `CB-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      ...data,
      balance: roundToTwo(newBalance)
    });

    await entry.save();
    console.log(`Cashbook entry created: ${entry.transactionId}, Debit: ${data.debit}, Credit: ${data.credit}, Balance: ${newBalance}`);
    return entry;
  } catch (error) {
    console.error('Cashbook entry error:', error);
    return null;
  }
};

// Add owner investment - WITH PROPER DEBIT
const addInvestment = async (req, res) => {
  try {
    const { amount, description, paymentMethod, date, bankAccountId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Please enter a valid amount' });
    }

    const investmentAmount = roundToTwo(Number(amount));

    if (paymentMethod === 'bank' && bankAccountId) {
      const bankAccount = await BankAccount.findById(bankAccountId);
      if (!bankAccount) {
        return res.status(404).json({ message: 'Bank account not found' });
      }

      // Update bank balance
      const oldBalance = bankAccount.currentBalance;
      bankAccount.currentBalance = roundToTwo(bankAccount.currentBalance + investmentAmount);
      await bankAccount.save();
      console.log(`Bank investment: ${bankAccount.bankName}`);
      console.log(`Old Balance: ₹${oldBalance}, New Balance: ₹${bankAccount.currentBalance}`);

      // ✅ FIX: Bank investment should have DEBIT for money coming in
      await createCashbookEntry({
        date: date || new Date(),
        type: 'investment',
        partyName: 'Owner',
        description: description || `Investment of PKR ${investmentAmount.toLocaleString()} to ${bankAccount.bankName} - ${bankAccount.accountName}`,
        debit: investmentAmount,  // ✅ Money came into bank
        credit: 0,
        paymentMethod: 'bank',
        bankAccountId: bankAccountId,
        createdBy: req.user.id
      });

      res.json({
        success: true,
        message: `Investment of ₹${investmentAmount.toLocaleString()} added to ${bankAccount.bankName} account successfully`,
        type: 'bank',
        newBalance: bankAccount.currentBalance
      });
    } else {
      // Cash investment - Debit for cash coming in
      await createCashbookEntry({
        date: date || new Date(),
        type: 'investment',
        partyName: 'Owner',
        description: description || `Owner investment of ₹${investmentAmount} (Cash)`,
        debit: investmentAmount,
        credit: 0,
        paymentMethod: 'cash',
        createdBy: req.user.id
      });

      res.json({
        success: true,
        message: `Investment of ₹${investmentAmount.toLocaleString()} added as cash successfully`,
        type: 'cash'
      });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Get cashbook summary
const getCashbookSummary = async (req, res) => {
  try {
    // Cash in Hand from cash transactions only
    const cashEntries = await Cashbook.find({
      isDeleted: false,
      paymentMethod: 'cash'
    });

    let cashInHand = 0;
    for (const entry of cashEntries) {
      if (entry.debit > 0) cashInHand += entry.debit;
      if (entry.credit > 0) cashInHand -= entry.credit;
    }
    cashInHand = roundToTwo(cashInHand);

    // Stock value
    const products = await Product.find();
    const stockValue = products.reduce((sum, p) => sum + (p.currentCostPrice * p.quantity), 0);

    // Receivable from customers
    const customers = await Customer.find();
    const totalReceivable = customers.reduce((sum, c) => sum + (c.currentBalance > 0 ? c.currentBalance : 0), 0);

    // Payable to suppliers
    const purchases = await Purchase.find({ remainingBalance: { $gt: 0.01 } });
    const totalPayable = purchases.reduce((sum, p) => sum + p.remainingBalance, 0);

    // Bank balances
    const bankAccounts = await BankAccount.find({ isActive: true });
    const totalBankBalance = bankAccounts.reduce((sum, acc) => sum + acc.currentBalance, 0);

    // Net Worth
    const netWorth = roundToTwo(cashInHand + totalBankBalance + stockValue + totalReceivable - totalPayable);

    // Get recent transactions (not deleted)
    const recentTransactions = await Cashbook.find({ isDeleted: false })
      .sort({ date: -1, createdAt: -1 })
      .limit(20)
      .populate('bankAccountId', 'accountName bankName');

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
      recentTransactions
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Get cashbook ledger - FIXED for correct balance calculation
const getCashbookLedger = async (req, res) => {
  try {
    const { startDate, endDate, type, paymentMethod } = req.query;
    let query = { isDeleted: false };

    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    if (type) query.type = type;
    if (paymentMethod) query.paymentMethod = paymentMethod;

    // Get entries sorted by date ASCENDING for correct balance calculation
    const transactions = await Cashbook.find(query)
      .sort({ date: 1, createdAt: 1 })
      .populate('bankAccountId', 'accountName bankName');

    // Calculate running balance
    let runningBalance = 0;
    const formattedTransactions = [];

    for (const entry of transactions) {
      if (entry.debit > 0) runningBalance += entry.debit;
      if (entry.credit > 0) runningBalance -= entry.credit;
      runningBalance = roundToTwo(runningBalance);

      formattedTransactions.push({
        _id: entry._id,
        date: entry.date,
        transactionId: entry.transactionId,
        partyName: entry.partyName,
        description: entry.description,
        type: entry.type,
        paymentMethod: entry.paymentMethod,
        debit: entry.debit,
        credit: entry.credit,
        balance: runningBalance
      });
    }

    // Reverse to show latest first in UI
    formattedTransactions.reverse();

    res.json(formattedTransactions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Delete cashbook entry
const deleteCashbookEntry = async (req, res) => {
  try {
    const { id } = req.params;

    const entry = await Cashbook.findById(id);
    if (!entry) {
      return res.status(404).json({ message: 'Cashbook entry not found' });
    }

    console.log(`========== DELETING CASHBOOK ENTRY ==========`);
    console.log(`Transaction ID: ${entry.transactionId}`);
    console.log(`Payment Method: ${entry.paymentMethod}`);
    console.log(`Debit: ${entry.debit}, Credit: ${entry.credit}`);

    if (entry.paymentMethod === 'bank' && entry.bankAccountId) {
      const bankAccount = await BankAccount.findById(entry.bankAccountId);
      if (bankAccount) {
        if (entry.debit > 0) {
          // Was an incoming transaction (investment) - reverse it
          bankAccount.currentBalance = roundToTwo(bankAccount.currentBalance - entry.debit);
          console.log(`Bank balance reversed: -₹${entry.debit}`);
        } else if (entry.credit > 0) {
          // Was an outgoing transaction (payment) - reverse it
          bankAccount.currentBalance = roundToTwo(bankAccount.currentBalance + entry.credit);
          console.log(`Bank balance reversed: +₹${entry.credit}`);
        }
        await bankAccount.save();
        console.log(`New bank balance: ₹${bankAccount.currentBalance}`);
      }
    }

    entry.isDeleted = true;
    await entry.save();

    console.log(`Entry deleted successfully`);
    console.log(`=============================================`);

    res.json({ success: true, message: 'Cashbook entry deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

const hardDeleteCashbookEntry = async (req, res) => {
  try {
    const { id } = req.params;

    const entry = await Cashbook.findById(id);
    if (!entry) {
      return res.status(404).json({ message: 'Cashbook entry not found' });
    }

    if (entry.paymentMethod === 'bank' && entry.bankAccountId) {
      const bankAccount = await BankAccount.findById(entry.bankAccountId);
      if (bankAccount) {
        if (entry.debit > 0) {
          bankAccount.currentBalance = roundToTwo(bankAccount.currentBalance - entry.debit);
        } else if (entry.credit > 0) {
          bankAccount.currentBalance = roundToTwo(bankAccount.currentBalance + entry.credit);
        }
        await bankAccount.save();
      }
    }

    await entry.deleteOne();

    res.json({ success: true, message: 'Cashbook entry permanently deleted' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  createCashbookEntry,
  getCashbookSummary,
  getCashbookLedger,
  addInvestment,
  deleteCashbookEntry,
  hardDeleteCashbookEntry
};