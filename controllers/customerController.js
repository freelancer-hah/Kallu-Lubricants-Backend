const Customer = require('../models/Customer');
const CustomerLedger = require('../models/CustomerLedger');
const Sale = require('../models/Sale');
const SalePayment = require('../models/SalePayment');
const Cashbook = require('../models/Cashbook');
const BankAccount = require('../models/BankAccount');
const { createCashbookEntry } = require('./cashbookController');

// Get all customers
const getCustomers = async (req, res) => {
  try {
    const customers = await Customer.find().sort({ createdAt: -1 });
    res.json(customers);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get single customer
const getCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    res.json(customer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Get customer complete details with ledger
const getCustomerCompleteDetails = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    
    const ledger = await CustomerLedger.find({ customerId: req.params.id })
      .sort({ date: 1 });
    
    let runningBalance = customer.openingBalance;
    const formattedLedger = ledger.map(entry => {
      if (entry.debit > 0) runningBalance += entry.debit;
      if (entry.credit > 0) runningBalance -= entry.credit;
      return { ...entry.toObject(), balance: runningBalance };
    }).reverse();
    
    res.json({
      customer: {
        _id: customer._id,
        name: customer.name,
        phone: customer.phone,
        shop_name: customer.shop_name,
        address: customer.address,
        openingBalance: customer.openingBalance,
        totalPurchases: customer.totalPurchases,
        totalPayments: customer.totalPayments,
        currentBalance: customer.currentBalance,
        customerType: customer.customerType,
        transferredFrom: customer.transferredFrom,
        transferAmount: customer.transferAmount,
        transferDate: customer.transferDate
      },
      ledger: formattedLedger,
      summary: {
        totalDebit: ledger.reduce((sum, l) => sum + l.debit, 0),
        totalCredit: ledger.reduce((sum, l) => sum + l.credit, 0),
        closingBalance: customer.currentBalance
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Search customers
const searchCustomers = async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) {
      return res.json([]);
    }
    
    const customers = await Customer.find({
      $or: [
        { name: { $regex: q, $options: 'i' } },
        { phone: { $regex: q, $options: 'i' } },
        { shop_name: { $regex: q, $options: 'i' } }
      ]
    }).sort({ createdAt: -1 });
    
    res.json(customers);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// TYPE 1: NORMAL CUSTOMER (Zero balance)
const addNormalCustomer = async (req, res) => {
  try {
    const { name, phone, shop_name, address } = req.body;
    
    if (!name || !phone) {
      return res.status(400).json({ message: 'Name and phone are required' });
    }
    
    const customer = new Customer({
      name,
      phone,
      shop_name: shop_name || null,
      address: address || null,
      openingBalance: 0,
      totalPurchases: 0,
      totalPayments: 0,
      currentBalance: 0,
      customerType: 'normal'
    });
    
    await customer.save();
    
    res.status(201).json({
      success: true,
      message: `Customer ${name} added successfully`,
      customer
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// TYPE 2: TRANSFER CUSTOMER - FIXED (No double balance)
const addTransferCustomer = async (req, res) => {
  try {
    const {
      name,
      phone,
      shop_name,
      address,
      oldCompanyName,
      amount,
      paymentMethod,
      paymentDate,
      bankAccountId,
      description
    } = req.body;
    
    if (!name || !phone) {
      return res.status(400).json({ message: 'Name and phone are required' });
    }
    
    if (!oldCompanyName) {
      return res.status(400).json({ message: 'Old company name is required' });
    }
    
    if (!amount || amount <= 0) {
      return res.status(400).json({ message: 'Please enter valid amount' });
    }
    
    const transferAmount = Number(amount);
    
    // Create customer with opening balance
    const customer = new Customer({
      name,
      phone,
      shop_name: shop_name || null,
      address: address || null,
      openingBalance: transferAmount,
      totalPurchases: 0,
      totalPayments: 0,
      currentBalance: transferAmount,
      customerType: 'transfer',
      transferredFrom: oldCompanyName,
      transferAmount: transferAmount,
      transferDate: paymentDate || new Date()
    });
    
    await customer.save();
    
    // Create ONLY ONE ledger entry
    const ledgerEntry = new CustomerLedger({
      customerId: customer._id,
      customerName: customer.name,
      date: paymentDate || new Date(),
      transactionType: 'opening_balance',
      referenceNo: `TRF-${Date.now()}`,
      description: description || `Balance transferred from ${oldCompanyName}`,
      debit: transferAmount,
      credit: 0,
      createdBy: req.user.id
    });
    
    await ledgerEntry.save();
    
    // Cashbook entry for payment to old company
    if (paymentMethod === 'bank' && bankAccountId) {
      const bankAccount = await BankAccount.findById(bankAccountId);
      if (bankAccount) {
        if (bankAccount.currentBalance < transferAmount) {
          await Customer.findByIdAndDelete(customer._id);
          return res.status(400).json({ 
            message: `Insufficient balance in ${bankAccount.bankName} account` 
          });
        }
        bankAccount.currentBalance -= transferAmount;
        await bankAccount.save();
      }
      
      await createCashbookEntry({
        date: paymentDate || new Date(),
        type: 'payment_made',
        partyName: oldCompanyName,
        description: `Payment to ${oldCompanyName} for taking over customer ${customer.name}`,
        debit: 0,
        credit: transferAmount,
        paymentMethod: 'bank',
        bankAccountId: bankAccountId,
        createdBy: req.user.id
      });
    } else {
      await createCashbookEntry({
        date: paymentDate || new Date(),
        type: 'payment_made',
        partyName: oldCompanyName,
        description: `Payment to ${oldCompanyName} for taking over customer ${customer.name}`,
        debit: 0,
        credit: transferAmount,
        paymentMethod: 'cash',
        createdBy: req.user.id
      });
    }
    
    res.status(201).json({
      success: true,
      message: `Customer ${name} transferred from ${oldCompanyName} with balance ₹${transferAmount}`,
      customer: {
        _id: customer._id,
        name: customer.name,
        openingBalance: customer.openingBalance,
        currentBalance: customer.currentBalance
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Update customer
const updateCustomer = async (req, res) => {
  try {
    const { name, phone, shop_name, address } = req.body;
    const customer = await Customer.findById(req.params.id);
    
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    
    customer.name = name || customer.name;
    customer.phone = phone || customer.phone;
    customer.shop_name = shop_name !== undefined ? shop_name : customer.shop_name;
    customer.address = address !== undefined ? address : customer.address;
    
    await customer.save();
    res.json(customer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Delete customer
const deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    
    await CustomerLedger.deleteMany({ customerId: req.params.id });
    await Sale.deleteMany({ customer: req.params.id });
    await SalePayment.deleteMany({ customer: req.params.id });
    await Cashbook.deleteMany({ partyId: req.params.id });
    await customer.deleteOne();
    
    res.json({ message: 'Customer deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Get customer with ledger summary
const getCustomerWithLedger = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    
    const ledger = await CustomerLedger.find({ customerId: req.params.id })
      .sort({ date: -1 });
    
    res.json({
      customer,
      ledger,
      summary: {
        openingBalance: customer.openingBalance,
        totalPurchases: customer.totalPurchases,
        totalPayments: customer.totalPayments,
        currentBalance: customer.currentBalance
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getCustomers,
  getCustomer,
  getCustomerCompleteDetails,
  searchCustomers,
  addNormalCustomer,
  addTransferCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerWithLedger
};