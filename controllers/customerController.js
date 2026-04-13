const Customer = require('../models/Customer');

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
      address: address || null
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

// Delete customer
const deleteCustomer = async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    if (!customer) {
      return res.status(404).json({ message: 'Customer not found' });
    }
    
    await customer.deleteOne();
    res.json({ message: 'Customer deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = {
  getCustomers,
  getCustomer,
  searchCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer
};