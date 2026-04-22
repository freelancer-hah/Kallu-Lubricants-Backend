const CustomerLedger = require('../models/CustomerLedger');
const Customer = require('../models/Customer');
const Cashbook = require('../models/Cashbook');
const BankAccount = require('../models/BankAccount');
const Sale = require('../models/Sale');
const { createCashbookEntry } = require('./cashbookController');

// Get customer ledger with dynamic balance
const getCustomerLedger = async (req, res) => {
  try {
    const { customerId, startDate, endDate } = req.query;
    let query = {};
    
    if (customerId) query.customerId = customerId;
    if (startDate && endDate) {
      query.date = { $gte: new Date(startDate), $lte: new Date(endDate) };
    }
    
    const ledger = await CustomerLedger.find(query)
      .sort({ date: 1, createdAt: 1 });
    
    let customer = null;
    let openingBalance = 0;
    
    if (customerId) {
      customer = await Customer.findById(customerId);
      if (customer) {
        openingBalance = customer.openingBalance || 0;
      }
    }
    
    let runningBalance = openingBalance;
    const formattedLedger = ledger.map(entry => {
      if (entry.debit > 0) runningBalance += entry.debit;
      if (entry.credit > 0) runningBalance -= entry.credit;
      
      return {
        _id: entry._id,
        date: entry.date,
        transactionType: entry.transactionType,
        referenceNo: entry.referenceNo,
        description: entry.description,
        debit: entry.debit,
        credit: entry.credit,
        balance: runningBalance
      };
    }).reverse();
    
    let customerSummary = null;
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
    
    const finalBalance = openingBalance + 
      ledger.reduce((sum, l) => sum + l.debit, 0) - 
      ledger.reduce((sum, l) => sum + l.credit, 0);
    
    res.json({
      customer: customerSummary,
      transactions: formattedLedger,
      summary: {
        openingBalance: openingBalance,
        totalDebit: ledger.reduce((sum, l) => sum + l.debit, 0),
        totalCredit: ledger.reduce((sum, l) => sum + l.credit, 0),
        closingBalance: finalBalance
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
    console.log(`========== LEDGER ENTRY ==========`);
    console.log(`Customer: ${data.customerName}`);
    console.log(`Type: ${data.transactionType}`);
    console.log(`Debit: ${data.debit}`);
    console.log(`Credit: ${data.credit}`);
    console.log(`==================================`);
    
    const entry = new CustomerLedger({
      ...data
    });
    
    await entry.save();
    
    const customer = await Customer.findById(data.customerId);
    if (customer) {
      const allEntries = await CustomerLedger.find({ customerId: data.customerId });
      
      let newBalance = customer.openingBalance || 0;
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
      console.log(`Updated customer balance: ${newBalance}`);
    }
    
    return entry;
  } catch (error) {
    console.error('Customer ledger error:', error);
    return null;
  }
};

// UPDATE SALE STATUS AFTER PAYMENT - Called from recordCustomerPayment
const updateSaleStatusAfterPayment = async (customerId, amount) => {
  try {
    console.log(`========== UPDATING SALE STATUS ==========`);
    console.log(`Customer ID: ${customerId}`);
    console.log(`Payment Amount: ${amount}`);
    
    // Find all pending/partial sales for this customer (oldest first)
    const sales = await Sale.find({ 
      customer: customerId,
      remainingBalance: { $gt: 0 }
    }).sort({ date: 1 });
    
    console.log(`Found ${sales.length} pending/partial sales`);
    
    let remainingAmount = amount;
    
    for (const sale of sales) {
      if (remainingAmount <= 0) break;
      
      console.log(`Processing sale ${sale.invoiceNo}: remainingBalance=${sale.remainingBalance}, remainingAmount=${remainingAmount}`);
      
      if (remainingAmount >= sale.remainingBalance) {
        // Full payment for this sale
        const paidAmount = sale.remainingBalance;
        remainingAmount -= paidAmount;
        sale.amountPaid += paidAmount;
        sale.remainingBalance = 0;
        sale.status = 'paid';
        console.log(`✅ Sale ${sale.invoiceNo} FULLY PAID, status: ${sale.status}`);
      } else {
        // Partial payment for this sale
        sale.amountPaid += remainingAmount;
        sale.remainingBalance -= remainingAmount;
        sale.status = 'partial';
        console.log(`⚠️ Sale ${sale.invoiceNo} PARTIALLY PAID, remaining: ${sale.remainingBalance}, status: ${sale.status}`);
        remainingAmount = 0;
      }
      
      await sale.save();
    }
    
    console.log(`========== SALE STATUS UPDATE COMPLETE ==========`);
  } catch (error) {
    console.error('Error updating sale status:', error);
  }
};

// RECORD CUSTOMER PAYMENT - FROM CUSTOMERS PAGE
const recordCustomerPayment = async (req, res) => {
  try {
    const { customerId, amount, paymentMethod, date, notes, bankAccountId } = req.body;
    
    console.log(`========== RECORDING PAYMENT FROM CUSTOMERS PAGE ==========`);
    console.log(`Customer ID: ${customerId}`);
    console.log(`Amount: ${amount}`);
    console.log(`Payment Method: ${paymentMethod}`);
    console.log(`Bank Account ID: ${bankAccountId}`);
    
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    
    if (amount <= 0) {
      return res.status(400).json({ message: 'Amount must be greater than 0' });
    }
    
    // Calculate current balance
    const allEntries = await CustomerLedger.find({ customerId });
    let currentBalance = customer.openingBalance || 0;
    for (const entry of allEntries) {
      if (entry.debit > 0) currentBalance += entry.debit;
      if (entry.credit > 0) currentBalance -= entry.credit;
    }
    
    console.log(`Current customer balance: ${currentBalance}`);
    
    if (amount > currentBalance) {
      return res.status(400).json({ 
        message: `Amount exceeds outstanding balance of ₹${currentBalance.toLocaleString()}` 
      });
    }
    
    // STEP 1: Create customer ledger entry
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
    
    // STEP 2: UPDATE SALE STATUS AFTER PAYMENT (CRITICAL FIX)
    await updateSaleStatusAfterPayment(customerId, amount);
    
    // STEP 3: Cashbook entry based on payment method
    if (paymentMethod === 'bank' && bankAccountId) {
      const bankAccount = await BankAccount.findById(bankAccountId);
      if (bankAccount) {
        bankAccount.currentBalance += amount;
        await bankAccount.save();
        console.log(`Bank account ${bankAccount.bankName} updated, new balance: ${bankAccount.currentBalance}`);
      }
      
      await createCashbookEntry({
        date: date || new Date(),
        type: 'payment_received',
        partyName: customer.name,
        partyId: customer._id,
        description: notes || `Payment received from ${customer.name} (Deposited to bank)`,
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
        partyName: customer.name,
        partyId: customer._id,
        description: notes || `Payment received from ${customer.name} (Cash)`,
        debit: amount,
        credit: 0,
        paymentMethod: 'cash',
        createdBy: req.user.id
      });
    }
    
    // Get updated balance
    const updatedEntries = await CustomerLedger.find({ customerId });
    let newBalance = customer.openingBalance || 0;
    for (const entry of updatedEntries) {
      if (entry.debit > 0) newBalance += entry.debit;
      if (entry.credit > 0) newBalance -= entry.credit;
    }
    
    console.log(`Payment completed! New customer balance: ${newBalance}`);
    console.log(`=============================================`);
    
    res.json({ 
      success: true, 
      message: `Payment of ₹${amount.toLocaleString()} received from ${customer.name}`,
      oldBalance: currentBalance,
      newBalance: newBalance
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Create sale ledger entry
const createSaleLedgerEntry = async (data) => {
  return await createCustomerLedgerEntry({
    customerId: data.customerId,
    customerName: data.customerName,
    date: data.date || new Date(),
    transactionType: 'sale',
    referenceNo: data.invoiceNo,
    description: data.description || `Sale invoice ${data.invoiceNo}`,
    debit: data.amount,
    credit: 0,
    createdBy: data.createdBy
  });
};

// Add opening balance
const addOpeningBalance = async (req, res) => {
  try {
    const { customerId, amount, description } = req.body;
    
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    
    const existing = await CustomerLedger.findOne({
      customerId,
      transactionType: 'opening_balance'
    });
    
    if (existing) {
      return res.status(400).json({ message: 'Opening balance already added' });
    }
    
    customer.openingBalance = amount;
    customer.currentBalance = amount;
    await customer.save();
    
    await createCustomerLedgerEntry({
      customerId,
      customerName: customer.name,
      date: new Date(),
      transactionType: 'opening_balance',
      referenceNo: `OB-${Date.now()}`,
      description: description || 'Opening balance',
      debit: amount,
      credit: 0,
      createdBy: req.user.id
    });
    
    res.json({ message: 'Opening balance added', customer });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = { 
  getCustomerLedger, 
  createCustomerLedgerEntry,
  createSaleLedgerEntry,
  addOpeningBalance,
  recordCustomerPayment,
  updateSaleStatusAfterPayment
};