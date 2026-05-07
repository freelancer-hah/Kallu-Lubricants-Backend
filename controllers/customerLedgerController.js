const CustomerLedger = require('../models/CustomerLedger');
const Customer = require('../models/Customer');
const Cashbook = require('../models/Cashbook');
const BankAccount = require('../models/BankAccount');
const Sale = require('../models/Sale');
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

    const ledger = await CustomerLedger.find(query).sort({ date: 1, createdAt: 1 });
    let customer = null;

    if (customerId) {
      customer = await Customer.findById(customerId);
    }

    let runningBalance = 0;
    const formattedLedger = [];

    for (const entry of ledger) {
      if (entry.debit > 0) runningBalance += entry.debit;
      if (entry.credit > 0) runningBalance -= entry.credit;

      formattedLedger.push({
        _id: entry._id,
        date: entry.date,
        transactionType: entry.transactionType,
        referenceNo: entry.referenceNo,
        description: entry.description,
        debit: entry.debit,
        credit: entry.credit,
        balance: runningBalance
      });
    }

    let customerSummary = null;
    let currentBalance = runningBalance;

    if (customer) {
      if (customer.currentBalance !== currentBalance) {
        customer.currentBalance = currentBalance;
        await customer.save();
      }

      customerSummary = {
        name: customer.name,
        phone: customer.phone,
        openingBalance: customer.openingBalance || 0,
        totalPurchases: customer.totalPurchases || 0,
        totalPayments: customer.totalPayments || 0,
        currentBalance: currentBalance
      };
    }

    res.json({
      customer: customerSummary,
      transactions: formattedLedger,
      summary: {
        openingBalance: customer?.openingBalance || 0,
        totalDebit: ledger.reduce((sum, l) => sum + l.debit, 0),
        totalCredit: ledger.reduce((sum, l) => sum + l.credit, 0),
        closingBalance: currentBalance
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Create customer ledger entry
const createCustomerLedgerEntry = async (data) => {
  try {
    const entry = new CustomerLedger({
      customerId: data.customerId,
      customerName: data.customerName,
      date: data.date,
      transactionType: data.transactionType,
      referenceNo: data.referenceNo,
      description: data.description,
      debit: data.debit,
      credit: data.credit,
      createdBy: data.createdBy
    });

    await entry.save();

    const customer = await Customer.findById(data.customerId);
    if (customer) {
      const allEntries = await CustomerLedger.find({ customerId: data.customerId });

      let newBalance = 0;
      for (const e of allEntries) {
        if (e.debit > 0) newBalance += e.debit;
        if (e.credit > 0) newBalance -= e.credit;
      }

      customer.currentBalance = newBalance;

      if (data.transactionType === 'sale') {
        customer.totalPurchases = (customer.totalPurchases || 0) + data.debit;
      } else if (data.transactionType === 'payment_received') {
        customer.totalPayments = (customer.totalPayments || 0) + data.credit;
      }

      await customer.save();
    }

    return entry;
  } catch (error) {
    console.error('Customer ledger error:', error);
    return null;
  }
};

// RECORD CUSTOMER PAYMENT
const recordCustomerPayment = async (req, res) => {
  try {
    const { customerId, amount, paymentMethod, date, notes, bankAccountId } = req.body;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    if (amount <= 0) {
      return res.status(400).json({ message: 'Amount must be greater than 0' });
    }

    // Calculate current receivable
    const allEntries = await CustomerLedger.find({ customerId });
    let currentReceivable = 0;
    for (const entry of allEntries) {
      if (entry.debit > 0) currentReceivable += entry.debit;
      if (entry.credit > 0) currentReceivable -= entry.credit;
    }

    if (amount > currentReceivable) {
      return res.status(400).json({
        message: `Amount exceeds outstanding receivable of ₹${currentReceivable.toLocaleString()}`
      });
    }

    // Create customer ledger entry
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

    // Cashbook entry based on payment method
    if (paymentMethod === 'bank' && bankAccountId) {
      const bankAccount = await BankAccount.findById(bankAccountId);
      if (bankAccount) {
        bankAccount.currentBalance += amount;
        await bankAccount.save();
      }

      await createCashbookEntry({
        date: date || new Date(),
        type: 'payment_received',
        partyName: customer.name,
        partyId: customer._id,
        description: notes || `Payment received from ${customer.name} (Deposited to bank)`,
        debit: 0,
        credit: 0,
        paymentMethod: 'bank',
        bankAccountId: bankAccountId,
        createdBy: req.user.id
      });
    } else {
      // Cash payment - affects cash in hand
      await createCashbookEntry({
        date: date || new Date(),
        type: 'payment_received',
        partyName: customer.name,
        partyId: customer._id,
        description: notes || `Payment received from ${customer.name} (Cash)`,
        debit: amount,
        credit: 0,
        paymentMethod: 'cash',
        createdBy: req.user.id
      });
    }

    res.json({ success: true, message: `Payment of ₹${amount.toLocaleString()} received` });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getCustomerLedger,
  createCustomerLedgerEntry,
  recordCustomerPayment
};