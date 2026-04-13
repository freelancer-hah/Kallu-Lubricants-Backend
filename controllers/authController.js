const User = require('../models/User');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const login = async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }
    
    // Store role as lowercase in token
    const token = jwt.sign(
      { id: user._id, username: user.username, role: user.role },
      process.env.JWT_SECRET || 'kallu_lubricants_secret_key_2024',
      { expiresIn: '7d' }
    );
    
    // Send role as Admin/User to frontend
    const frontendRole = user.role === 'admin' ? 'Admin' : 'User';
    
    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        username: user.username,
        role: frontendRole
      }
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

const getMe = async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    const frontendRole = user.role === 'admin' ? 'Admin' : 'User';
    res.json({
      id: user._id,
      name: user.name,
      username: user.username,
      role: frontendRole,
      createdAt: user.createdAt
    });
  } catch (error) {
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { login, getMe };