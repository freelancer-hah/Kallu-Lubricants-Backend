const Cashbook = require('../models/Cashbook');
const BankAccount = require('../models/BankAccount');
const Customer = require('../models/Customer');
const Purchase = require('../models/Purchase');
const Product = require('../models/Product');

// Create cashbook entry
const createCashbookEntry = async (data) => {
  try {
    const lastEntry = await Cashbook.findOne({ isDeleted: false }).sort({ date: -1, createdAt: -1 });
    let lastBalance = lastEntry ? lastEntry.balance : 0;

    let newBalance = lastBalance;
    if (data.debit > 0) newBalance += data.debit;
    if (data.credit > 0) newBalance -= data.credit;

    const entry = new Cashbook({
      transactionId: `CB-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      ...data,
      balance: newBalance
    });

    await entry.save();
    console.log(`Cashbook entry created: ${entry.transactionId}, Debit: ${data.debit}, Credit: ${data.credit}, Balance: ${newBalance}`);
    return entry;
  } catch (error) {
    console.error('Cashbook entry error:', error);
    return null;
  }
};

// Add owner investment - WITH PROPER BANK SUPPORT
const addInvestment = async (req, res) => {
  try {
    const { amount, description, paymentMethod, date, bankAccountId } = req.body;

    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Please enter a valid amount' });
    }

    const investmentAmount = Number(amount);

    if (paymentMethod === 'bank' && bankAccountId) {
      // Bank Investment - Increase bank balance
      const bankAccount = await BankAccount.findById(bankAccountId);
      if (!bankAccount) {
        return res.status(404).json({ message: 'Bank account not found' });
      }

      // Update bank account balance
      const oldBankBalance = bankAccount.currentBalance;
      bankAccount.currentBalance += investmentAmount;
      await bankAccount.save();

      console.log(`Bank investment: ${bankAccount.bankName} - ${bankAccount.accountName}`);
      console.log(`Old Balance: ₹${oldBankBalance}, New Balance: ₹${bankAccount.currentBalance}`);

      // Create cashbook entry for record (no cash impact, only bank)
      await createCashbookEntry({
        date: date || new Date(),
        type: 'investment',
        partyName: 'Owner',
        description: description || `Owner investment of ₹${investmentAmount} (Bank Transfer - ${bankAccount.bankName} - ${bankAccount.accountName})`,
        debit: 0,
        credit: 0,
        paymentMethod: 'bank',
        bankAccountId: bankAccountId,
        createdBy: req.user.id
      });

      res.json({
        success: true,
        message: `Investment of ₹${investmentAmount.toLocaleString()} added to ${bankAccount.bankName} - ${bankAccount.accountName} account successfully`,
        type: 'bank',
        bankAccount: {
          id: bankAccount._id,
          name: bankAccount.bankName,
          accountName: bankAccount.accountName,
          oldBalance: oldBankBalance,
          newBalance: bankAccount.currentBalance
        }
      });
    } else {
      // Cash Investment - Increase cash in hand
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
    // Calculate Cash in Hand from ONLY cash transactions
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

    // Receivable from customers
    const customers = await Customer.find();
    const totalReceivable = customers.reduce((sum, c) => sum + (c.currentBalance > 0 ? c.currentBalance : 0), 0);

    // Payable to suppliers
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
      bankAccounts: bankAccounts.map(acc => ({
        _id: acc._id,
        accountName: acc.accountName,
        bankName: acc.bankName,
        accountNumber: acc.accountNumber,
        currentBalance: acc.currentBalance
      })),
      recentTransactions: await Cashbook.find({ isDeleted: false }).sort({ date: -1 }).limit(20)
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Get cashbook ledger
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
      .sort({ date: -1, createdAt: -1 })
      .populate('bankAccountId', 'accountName bankName');

    res.json(transactions);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// DELETE CASHBOOK ENTRY - FIXED for Bank Investment
const deleteCashbookEntry = async (req, res) => {
  try {
    const { id } = req.params;

    const entry = await Cashbook.findById(id);
    if (!entry) {
      return res.status(404).json({ message: 'Cashbook entry not found' });
    }

    console.log(`========== DELETING CASHBOOK ENTRY ==========`);
    console.log(`Transaction ID: ${entry.transactionId}`);
    console.log(`Type: ${entry.type}`);
    console.log(`Payment Method: ${entry.paymentMethod}`);
    console.log(`Debit: ${entry.debit}, Credit: ${entry.credit}`);

    // Reverse effect on bank account if it was a bank transaction
    if (entry.paymentMethod === 'bank' && entry.bankAccountId) {
      const bankAccount = await BankAccount.findById(entry.bankAccountId);
      if (bankAccount) {
        // For bank investment: entry.debit = 0, entry.credit = 0
        // We need to reverse the bank balance increase
        // Since we don't store the amount in debit/credit for bank transactions,
        // we need to get the amount from description or find the original investment amount

        // Parse amount from description
        let investmentAmount = 0;
        const amountMatch = entry.description.match(/₹([\d,]+)/);
        if (amountMatch) {
          investmentAmount = parseInt(amountMatch[1].replace(/,/g, ''));
        }

        if (investmentAmount > 0) {
          // Reverse the bank balance (subtract the invested amount)
          const oldBalance = bankAccount.currentBalance;
          bankAccount.currentBalance -= investmentAmount;
          await bankAccount.save();
          console.log(`Bank account reversed: ${bankAccount.bankName}`);
          console.log(`Old Balance: ₹${oldBalance}, New Balance: ₹${bankAccount.currentBalance}`);
          console.log(`Amount reversed: ₹${investmentAmount}`);
        }
      }
    }

    // For cash transactions, reverse cash effect
    if (entry.paymentMethod === 'cash' && entry.debit > 0) {
      // Cash investment - cash should decrease
      console.log(`Cash investment deletion: Need to reverse cash effect`);
    }

    if (entry.paymentMethod === 'cash' && entry.credit > 0) {
      // Cash payment - cash should increase
      console.log(`Cash payment deletion: Need to reverse cash effect`);
    }

    // Soft delete
    entry.isDeleted = true;
    await entry.save();

    console.log(`Entry deleted successfully`);
    console.log(`=============================================`);

    res.json({
      success: true,
      message: 'Cashbook entry deleted successfully',
      entry: {
        id: entry._id,
        transactionId: entry.transactionId,
        type: entry.type
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// HARD DELETE CASHBOOK ENTRY - FIXED for Bank Investment
const hardDeleteCashbookEntry = async (req, res) => {
  try {
    const { id } = req.params;

    const entry = await Cashbook.findById(id);
    if (!entry) {
      return res.status(404).json({ message: 'Cashbook entry not found' });
    }

    console.log(`========== PERMANENTLY DELETING CASHBOOK ENTRY ==========`);
    console.log(`Transaction ID: ${entry.transactionId}`);
    console.log(`Type: ${entry.type}`);
    console.log(`Payment Method: ${entry.paymentMethod}`);

    // Reverse effect on bank account if it was a bank transaction
    if (entry.paymentMethod === 'bank' && entry.bankAccountId) {
      const bankAccount = await BankAccount.findById(entry.bankAccountId);
      if (bankAccount) {
        // Parse amount from description
        let investmentAmount = 0;
        const amountMatch = entry.description.match(/₹([\d,]+)/);
        if (amountMatch) {
          investmentAmount = parseInt(amountMatch[1].replace(/,/g, ''));
        }

        if (investmentAmount > 0) {
          // Reverse the bank balance (subtract the invested amount)
          const oldBalance = bankAccount.currentBalance;
          bankAccount.currentBalance -= investmentAmount;
          await bankAccount.save();
          console.log(`Bank account reversed: ${bankAccount.bankName}`);
          console.log(`Old Balance: ₹${oldBalance}, New Balance: ₹${bankAccount.currentBalance}`);
        }
      }
    }

    await entry.deleteOne();

    console.log(`Entry permanently deleted`);
    console.log(`=============================================`);

    res.json({
      success: true,
      message: 'Cashbook entry permanently deleted'
    });
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