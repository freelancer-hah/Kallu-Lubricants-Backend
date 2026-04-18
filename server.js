const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Import all routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const customerRoutes = require('./routes/customerRoutes');
const productRoutes = require('./routes/productRoutes');
const purchaseRoutes = require('./routes/purchaseRoutes');
const saleRoutes = require('./routes/saleRoutes');
const expenseRoutes = require('./routes/expenseRoutes');
const reportRoutes = require('./routes/reportRoutes');
const stockRoutes = require('./routes/stockRoutes');

// Add these with other routes
const cashbookRoutes = require('./routes/cashbookRoutes');
const customerLedgerRoutes = require('./routes/customerLedgerRoutes');
const trashRoutes = require('./routes/trashRoutes');
const bankRoutes = require('./routes/bankRoutes');

// Add after other route declarations
app.use('/api/cashbook', cashbookRoutes);
app.use('/api/customer-ledger', customerLedgerRoutes);
app.use('/api/trash', trashRoutes);
app.use('/api/banks', bankRoutes);

// Use routes
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/products', productRoutes);
app.use('/api/purchases', purchaseRoutes);
app.use('/api/sales', saleRoutes);
app.use('/api/expenses', expenseRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/stock', stockRoutes);

// Test route
app.get('/api/test', (req, res) => {
  res.json({ message: 'Backend is working!' });
});

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB connected successfully');
    
    // Create or fix default admin user
    const User = require('./models/User');
    const bcrypt = require('bcryptjs');
    
    let adminExists = await User.findOne({ username: 'admin' });
    
    if (!adminExists) {
      // Create new admin
      const admin = new User({
        name: 'Super Admin',
        username: 'admin',
        password: await bcrypt.hash('admin123', 10),
        role: 'admin'
      });
      await admin.save();
      console.log('✅ Default admin created!');
      console.log('   Username: admin');
      console.log('   Password: admin123');
    } else {
      // Fix existing admin if role is wrong (case-sensitive fix)
      if (adminExists.role !== 'admin') {
        adminExists.role = 'admin';
        await adminExists.save();
        console.log('✅ Fixed admin role from "' + adminExists.role + '" to "admin"');
      }
      
      // Ensure password is correct (optional - only if you want to reset)
      const isPasswordCorrect = await bcrypt.compare('admin123', adminExists.password);
      if (!isPasswordCorrect) {
        adminExists.password = await bcrypt.hash('admin123', 10);
        await adminExists.save();
        console.log('✅ Reset admin password to "admin123"');
      }
      
      console.log('✅ Admin user verified');
      console.log('   Username: admin');
      console.log('   Password: admin123');
    }
  })
  .catch(err => {
    console.error('❌ MongoDB connection error:', err);
  });

const PORT = process.env.PORT || 5000 || process.env.HOS;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📍 API URL: http://localhost:${PORT}/api`);
});