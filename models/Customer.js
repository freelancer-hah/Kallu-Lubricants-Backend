const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  shop_name: {
    type: String,
    default: null,
    trim: true
  },
  address: {
    type: String,
    default: null,
    trim: true
  }
}, {
  timestamps: true
});

// Create index for search
customerSchema.index({ name: 'text', phone: 'text', shop_name: 'text' });

module.exports = mongoose.model('Customer', customerSchema);