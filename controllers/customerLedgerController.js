const CustomerLedger = require('../models/CustomerLedger');
const Customer = require('../models/Customer');
const Cashbook = require('../models/Cashbook');
const { createCashbookEntry } = require('./cashbookController');

// Get customer ledger
const getCustomerLedger = async (req, res) => {
  try {
    const { customerId, startDate, endDate } = req.query;
    let query = {};
    
    if (customerId) query.customerId = customerId;
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    
    const ledger = await CustomerLedger.find(query)
      .sort({ date: -1 })
      .populate('customerId', 'name phone shop_name');
    
    let runningBalance = 0;
    const formattedLedger = [...ledger].reverse().map(l => {
      if (l.debit > 0) runningBalance += l.debit;
      if (l.credit > 0) runningBalance -= l.credit;
      return { ...l.toObject(), runningBalance };
    }).reverse();
    
    let customerSummary = null;
    if (customerId) {
      const customer = await Customer.findById(customerId);
      if (customer) {
        customerSummary = {
          name: customer.name,
          phone: customer.phone,
          openingBalance: customer.openingBalance || 0,
          totalPurchases: customer.totalPurchases || 0,
          totalPayments: customer.totalPayments || 0,
          currentBalance: customer.currentBalance || 0
        };
      }
    }
    
    res.json({
      customer: customerSummary,
      transactions: formattedLedger,
      summary: {
        totalDebit: ledger.reduce((sum, l) => sum + l.debit, 0),
        totalCredit: ledger.reduce((sum, l) => sum + l.credit, 0),
        closingBalance: customerSummary?.currentBalance || 0
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Create customer ledger entry (internal)
const createCustomerLedgerEntry = async (data) => {
  try {
    const lastEntry = await CustomerLedger.findOne({ customerId: data.customerId })
      .sort({ date: -1 });
    
    let lastBalance = 0;
    if (lastEntry) {
      lastBalance = lastEntry.balance;
    } else {
      const customer = await Customer.findById(data.customerId);
      lastBalance = customer?.openingBalance || 0;
    }
    
    let newBalance = lastBalance;
    if (data.debit > 0) newBalance += data.debit;
    if (data.credit > 0) newBalance -= data.credit;
    
    const entry = new CustomerLedger({
      ...data,
      balance: newBalance
    });
    
    await entry.save();
    
    await Customer.findByIdAndUpdate(data.customerId, {
      $inc: {
        totalPurchases: data.debit || 0,
        totalPayments: data.credit || 0
      },
      currentBalance: newBalance
    });
    
    return entry;
  } catch (error) {
    console.error('Customer ledger error:', error);
    return null;
  }
};

// Add opening balance - NO cashbook entry
const addOpeningBalance = async (req, res) => {
  try {
    const { customerId, amount, description } = req.body;
    
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    
    const existingOpeningBalance = await CustomerLedger.findOne({
      customerId,
      transactionType: 'opening_balance'
    });
    
    if (existingOpeningBalance) {
      return res.status(400).json({ message: 'Opening balance already added for this customer' });
    }
    
    customer.openingBalance = amount;
    customer.currentBalance = amount;
    await customer.save();
    
    const entry = new CustomerLedger({
      customerId,
      customerName: customer.name,
      date: new Date(),
      transactionType: 'opening_balance',
      referenceNo: `OB-${Date.now()}`,
      description: description || 'Opening balance from previous records',
      debit: amount,
      credit: 0,
      balance: amount
    });
    
    await entry.save();
    
    res.json({ message: 'Opening balance added successfully', customer });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Record customer payment
const recordCustomerPayment = async (req, res) => {
  try {
    const { customerId, amount, paymentMethod, date, notes, bankAccountId } = req.body;
    
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    
    if (amount > customer.currentBalance) {
      return res.status(400).json({ 
        message: `Amount exceeds outstanding balance of ₹${customer.currentBalance}` 
      });
    }
    
    customer.currentBalance -= amount;
    customer.totalPayments += amount;
    await customer.save();
    
    await createCustomerLedgerEntry({
      customerId,
      customerName: customer.name,
      date: date || new Date(),
      transactionType: 'payment_received',
      referenceNo: `PAY-${Date.now()}`,
      description: notes || `Payment received from ${customer.name}`,
      debit: 0,
      credit: amount,
      createdBy: req.user.id
    });
    
    const cashbookData = {
      date: date || new Date(),
      type: 'payment_received',
      partyName: customer.name,
      partyId: customer._id,
      description: notes || `Payment received from ${customer.name}`,
      debit: amount,
      credit: 0,
      paymentMethod: paymentMethod || 'cash',
      createdBy: req.user.id
    };
    
    if (bankAccountId) {
      cashbookData.bankAccountId = bankAccountId;
      const BankAccount = require('../models/BankAccount');
      const bankAccount = await BankAccount.findById(bankAccountId);
      if (bankAccount) {
        bankAccount.currentBalance += amount;
        await bankAccount.save();
        cashbookData.description = `${notes || `Payment received from ${customer.name}`} (Deposited to: ${bankAccount.bankName} - ${bankAccount.accountName})`;
      }
    }
    
    await createCashbookEntry(cashbookData);
    
    res.json({ 
      success: true, 
      message: `Payment of ₹${amount} recorded successfully`,
      remainingBalance: customer.currentBalance
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = { 
  getCustomerLedger, 
  createCustomerLedgerEntry, 
  addOpeningBalance,
  recordCustomerPayment 
};