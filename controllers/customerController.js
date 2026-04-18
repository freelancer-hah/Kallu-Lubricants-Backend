const Customer = require('../models/Customer');
const CustomerLedger = require('../models/CustomerLedger');
const Sale = require('../models/Sale');
const SalePayment = require('../models/SalePayment');
const Cashbook = require('../models/Cashbook');

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

// Create customer
const createCustomer = async (req, res) => {
  try {
    const { name, phone, shop_name, address } = req.body;
    
    // Validation
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
      currentBalance: 0
    });
    
    await customer.save();
    res.status(201).json(customer);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
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

// Delete customer (with all related data)
const deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    
    // Delete all ledger entries for this customer
    await CustomerLedger.deleteMany({ customerId: req.params.id });
    
    // Delete all sales for this customer
    await Sale.deleteMany({ customer: req.params.id });
    
    // Delete all payments for this customer
    await SalePayment.deleteMany({ customer: req.params.id });
    
    // Delete cashbook entries for this customer
    await Cashbook.deleteMany({ partyId: req.params.id });
    
    // Delete the customer
    await customer.deleteOne();
    
    res.json({ 
      message: 'Customer and all related data (ledger, sales, payments) deleted successfully' 
    });
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
    
    const summary = {
      openingBalance: customer.openingBalance,
      totalPurchases: customer.totalPurchases,
      totalPayments: customer.totalPayments,
      currentBalance: customer.currentBalance
    };
    
    res.json({
      customer,
      ledger,
      summary
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

// Update customer opening balance (admin only)
const updateOpeningBalance = async (req, res) => {
  try {
    const { amount, description } = req.body;
    const customer = await Customer.findById(req.params.id);
    
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    
    // Check if opening balance already exists
    const existingLedger = await CustomerLedger.findOne({
      customerId: req.params.id,
      transactionType: 'opening_balance'
    });
    
    if (existingLedger) {
      return res.status(400).json({ message: 'Opening balance already set. Please delete customer and re-add.' });
    }
    
    // Update customer
    customer.openingBalance = amount;
    customer.currentBalance = amount;
    await customer.save();
    
    // Create ledger entry
    const ledgerEntry = new CustomerLedger({
      customerId: customer._id,
      customerName: customer.name,
      date: new Date(),
      transactionType: 'opening_balance',
      referenceNo: `OB-${Date.now()}`,
      description: description || 'Opening balance from previous records',
      debit: amount,
      credit: 0,
      balance: amount
    });
    
    await ledgerEntry.save();
    
    res.json({ 
      message: 'Opening balance updated successfully', 
      customer,
      ledgerEntry
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = {
  getCustomers,
  getCustomer,
  searchCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
  getCustomerWithLedger,
  updateOpeningBalance
};