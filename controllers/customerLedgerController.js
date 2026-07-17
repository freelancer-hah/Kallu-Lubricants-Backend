const CustomerLedger = require('../models/CustomerLedger');
const Customer = require('../models/Customer');
const Cashbook = require('../models/Cashbook');
const BankAccount = require('../models/BankAccount');
const Sale = require('../models/Sale');
const SalePayment = require('../models/SalePayment');
const { createCashbookEntry } = require('./cashbookController');

// Helper function to round to 2 decimal places
const roundToTwo = (num) => {
  return Math.round(num * 100) / 100;
};

// Helper function for PKR formatting
const formatPKRSimple = (amount) => {
  return `Rs ${amount.toLocaleString()}`;
};

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

// ✅ COMPLETELY FIXED: RECORD CUSTOMER PAYMENT - No duplicate entries
const recordCustomerPayment = async (req, res) => {
  try {
    const { 
      customerId, 
      amount, 
      paymentMethod, 
      date, 
      notes, 
      bankAccountId, 
      saleId,
      multipleSaleIds
    } = req.body;

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }

    if (amount <= 0) {
      return res.status(400).json({ message: 'Amount must be greater than 0' });
    }

    const paymentAmount = roundToTwo(amount);
    let remainingToAllocate = paymentAmount;
    let salesUpdated = [];

    // ✅ STEP 1: Get unique sales to update (remove duplicates)
    let salesToUpdate = [];
    
    if (multipleSaleIds && multipleSaleIds.length > 0) {
      // Remove duplicates from array
      const uniqueSaleIds = [...new Set(multipleSaleIds)];
      salesToUpdate = await Sale.find({
        _id: { $in: uniqueSaleIds },
        customer: customerId,
        remainingBalance: { $gt: 0 }
      }).sort({ date: 1 });
    } else if (saleId) {
      const sale = await Sale.findById(saleId);
      if (sale && sale.customer.toString() === customerId && sale.remainingBalance > 0) {
        salesToUpdate = [sale];
      }
    } else {
      // Auto-select all pending sales
      salesToUpdate = await Sale.find({
        customer: customerId,
        remainingBalance: { $gt: 0 }
      }).sort({ date: 1 });
    }

    if (salesToUpdate.length === 0) {
      return res.status(400).json({ 
        message: 'No pending invoices found for this customer' 
      });
    }

    // ✅ STEP 2: Check total pending amount
    const totalPending = salesToUpdate.reduce((sum, s) => sum + s.remainingBalance, 0);
    if (paymentAmount > totalPending + 0.01) {
      return res.status(400).json({
        message: `Payment amount (${formatPKRSimple(paymentAmount)}) exceeds total pending balance of ${formatPKRSimple(totalPending)}`
      });
    }

    // ✅ STEP 3: Allocate payment to sales
    let totalAllocated = 0;
    for (const sale of salesToUpdate) {
      if (remainingToAllocate <= 0) break;

      const saleRemaining = sale.remainingBalance;
      const amountToAllocate = Math.min(remainingToAllocate, saleRemaining);
      
      if (amountToAllocate > 0.01) {
        // Update sale
        sale.amountPaid = roundToTwo(sale.amountPaid + amountToAllocate);
        sale.remainingBalance = roundToTwo(sale.remainingBalance - amountToAllocate);
        
        if (sale.remainingBalance === 0) {
          sale.status = 'paid';
        } else if (sale.amountPaid > 0) {
          sale.status = 'partial';
        }
        
        await sale.save();
        
        // ✅ Create ONE sale payment record per sale
        const salePayment = new SalePayment({
          sale: sale._id,
          customer: customerId,
          amount: amountToAllocate,
          paymentMethod: paymentMethod || 'cash',
          date: date || new Date(),
          notes: notes || `Payment received for invoice ${sale.invoiceNo}`
        });
        await salePayment.save();
        
        salesUpdated.push({
          invoiceNo: sale.invoiceNo,
          amount: amountToAllocate,
          remainingBalance: sale.remainingBalance,
          status: sale.status
        });
        
        totalAllocated += amountToAllocate;
        remainingToAllocate = roundToTwo(remainingToAllocate - amountToAllocate);
      }
    }

    // ✅ STEP 4: Create ONE customer ledger entry for the total payment
    const referenceString = salesUpdated.length > 0 
      ? salesUpdated.map(s => s.invoiceNo).join(', ') 
      : `PAY-${Date.now()}`;
    
    await createCustomerLedgerEntry({
      customerId,
      customerName: customer.name,
      date: date || new Date(),
      transactionType: 'payment_received',
      referenceNo: referenceString,
      description: notes || `Payment received from ${customer.name}`,
      debit: 0,
      credit: paymentAmount,
      createdBy: req.user.id
    });

    // ✅ STEP 5: Create ONE cashbook entry
    if (paymentMethod === 'bank' && bankAccountId) {
      const bankAccount = await BankAccount.findById(bankAccountId);
      if (bankAccount) {
        bankAccount.currentBalance = roundToTwo(bankAccount.currentBalance + paymentAmount);
        await bankAccount.save();
      }

      await createCashbookEntry({
        date: date || new Date(),
        type: 'payment_received',
        partyName: customer.name,
        partyId: customer._id,
        description: notes || `Payment received from ${customer.name} (Deposited to bank)`,
        debit: paymentAmount,
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
        debit: paymentAmount,
        credit: 0,
        paymentMethod: 'cash',
        createdBy: req.user.id
      });
    }

    // ✅ STEP 6: Update customer balance (will be updated by createCustomerLedgerEntry)
    // But also ensure totalPayments is updated correctly
    const allEntries = await CustomerLedger.find({ customerId });
    let newBalance = 0;
    for (const e of allEntries) {
      if (e.debit > 0) newBalance += e.debit;
      if (e.credit > 0) newBalance -= e.credit;
    }
    customer.currentBalance = newBalance;
    
    // ✅ Only add to totalPayments if not already counted
    // The createCustomerLedgerEntry already handles this, so we don't double count
    // But we need to recalculate totalPayments from ledger
    const totalPaymentCredits = allEntries
      .filter(e => e.transactionType === 'payment_received')
      .reduce((sum, e) => sum + e.credit, 0);
    customer.totalPayments = totalPaymentCredits;
    
    await customer.save();

    res.json({
      success: true,
      message: `Payment of ${formatPKRSimple(paymentAmount)} received and applied to ${salesUpdated.length} invoice(s)`,
      salesUpdated,
      remainingBalance: customer.currentBalance,
      totalPayments: customer.totalPayments,
      paymentMethod: paymentMethod || 'cash'
    });
  } catch (error) {
    console.error('Error in recordCustomerPayment:', error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getCustomerLedger,
  createCustomerLedgerEntry,
  recordCustomerPayment
};