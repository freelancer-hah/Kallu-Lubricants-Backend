const User = require('../models/User');
const bcrypt = require('bcryptjs');

// Get all users
const getUsers = async (req, res) => {
  try {
    const users = await User.find().select('-password').sort({ createdAt: -1 });
    // Convert role to proper case for frontend
    const formattedUsers = users.map(user => ({
      _id: user._id,
      name: user.name,
      username: user.username,
      role: user.role === 'admin' ? 'Admin' : 'User',
      createdAt: user.createdAt
    }));
    res.json(formattedUsers);
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// Get single user
const getUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    res.json({
      _id: user._id,
      name: user.name,
      username: user.username,
      role: user.role === 'admin' ? 'Admin' : 'User',
      createdAt: user.createdAt
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// Create user
const createUser = async (req, res) => {
  try {
    const { name, username, password, role } = req.body;
    
    if (!name || !username || !password) {
      return res.status(400).json({ message: 'Name, username and password are required' });
    }
    
    const existingUser = await User.findOne({ username: username.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ message: 'Username already exists' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Convert role to lowercase for database
    const dbRole = role === 'Admin' ? 'admin' : 'user';
    
    const user = new User({
      name,
      username: username.toLowerCase(),
      password: hashedPassword,
      role: dbRole
    });
    
    await user.save();
    
    res.status(201).json({
      _id: user._id,
      name: user.name,
      username: user.username,
      role: role || 'User'
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// Update user
const updateUser = async (req, res) => {
  try {
    const { name, username, role, password } = req.body;
    const user = await User.findById(req.params.id);
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    if (name) user.name = name;
    if (username) user.username = username.toLowerCase();
    if (role) {
      user.role = role === 'Admin' ? 'admin' : 'user';
    }
    if (password) {
      user.password = await bcrypt.hash(password, 10);
    }
    
    await user.save();
    
    res.json({
      _id: user._id,
      name: user.name,
      username: user.username,
      role: user.role === 'admin' ? 'Admin' : 'User'
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

// Delete user
const deleteUser = async (req, res) => {
  try {
    const user = await User.findById(req.params.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    // Prevent deleting last admin
    if (user.role === 'admin') {
      const adminCount = await User.countDocuments({ role: 'admin' });
      if (adminCount === 1) {
        return res.status(400).json({ message: 'Cannot delete the only admin user' });
      }
    }
    
    await user.deleteOne();
    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { getUsers, getUser, createUser, updateUser, deleteUser };