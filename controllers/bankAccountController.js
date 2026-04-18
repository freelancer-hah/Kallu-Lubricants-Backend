const BankAccount = require('../models/BankAccount');
const Cashbook = require('../models/Cashbook');
const { createCashbookEntry } = require('./cashbookController');

// Get all bank accounts
const getBankAccounts = async (req, res) => {
  try {
    const accounts = await BankAccount.find({ isActive: true });
    res.json(accounts);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Create bank account
const createBankAccount = async (req, res) => {
  try {
    const { accountName, bankName, accountNumber, ifscCode, openingBalance } = req.body;
    
    const account = new BankAccount({
      accountName,
      bankName,
      accountNumber,
      ifscCode,
      openingBalance: openingBalance || 0,
      currentBalance: openingBalance || 0,
      createdBy: req.user.id
    });
    
    await account.save();
    
    // Create cashbook entry for opening balance
    await createCashbookEntry({
      date: new Date(),
      type: 'opening_balance',
      partyName: accountName,
      description: `Opening balance for ${accountName} - ${bankName}`,
      debit: openingBalance || 0,
      credit: 0,
      paymentMethod: 'bank',
      bankAccountId: account._id,
      createdBy: req.user.id
    });
    
    res.status(201).json(account);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Transfer between accounts
const transferFunds = async (req, res) => {
  try {
    const { fromAccount, toAccount, amount, description, transferType } = req.body;
    
    if (transferType === 'cash_to_bank') {
      // Deduct from cash, add to bank
      await createCashbookEntry({
        date: new Date(),
        type: 'bank_transfer',
        partyName: 'Cash to Bank Transfer',
        description: description || `Transfer ₹${amount} from Cash to Bank`,
        debit: 0,
        credit: amount,
        paymentMethod: 'cash',
        createdBy: req.user.id
      });
      
      const bankAcc = await BankAccount.findById(toAccount);
      if (bankAcc) {
        bankAcc.currentBalance += amount;
        await bankAcc.save();
        
        await createCashbookEntry({
          date: new Date(),
          type: 'bank_transfer',
          partyName: bankAcc.accountName,
          description: description || `Deposit of ₹${amount} from Cash`,
          debit: amount,
          credit: 0,
          paymentMethod: 'bank',
          bankAccountId: bankAcc._id,
          createdBy: req.user.id
        });
      }
    } else if (transferType === 'bank_to_cash') {
      const bankAcc = await BankAccount.findById(fromAccount);
      if (bankAcc && bankAcc.currentBalance >= amount) {
        bankAcc.currentBalance -= amount;
        await bankAcc.save();
        
        await createCashbookEntry({
          date: new Date(),
          type: 'bank_transfer',
          partyName: bankAcc.accountName,
          description: description || `Withdrawal of ₹${amount} from ${bankAcc.accountName}`,
          debit: 0,
          credit: amount,
          paymentMethod: 'bank',
          bankAccountId: bankAcc._id,
          createdBy: req.user.id
        });
        
        await createCashbookEntry({
          date: new Date(),
          type: 'bank_transfer',
          partyName: 'Cash',
          description: description || `Cash withdrawal of ₹${amount} from bank`,
          debit: amount,
          credit: 0,
          paymentMethod: 'cash',
          createdBy: req.user.id
        });
      } else {
        return res.status(400).json({ message: 'Insufficient bank balance' });
      }
    }
    
    res.json({ message: 'Transfer successful' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = { getBankAccounts, createBankAccount, transferFunds };