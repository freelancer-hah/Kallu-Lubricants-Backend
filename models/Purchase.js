const mongoose = require('mongoose');

const purchaseSchema = new mongoose.Schema({
  invoiceNo: {
    type: String,
    unique: true
  },
  company: {
    type: String,
    required: true,
    trim: true
  },
  product: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Product',
    required: true
  },
  productName: {
    type: String,
    required: true
  },
  costPrice: {
    type: Number,
    required: true,
    min: 0
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  totalAmount: {
    type: Number,
    required: true
  },
  date: {
    type: Date,
    required: true,
    default: Date.now
  },
  notes: {
    type: String
  }
}, {
  timestamps: true
});

// Auto-generate invoice number
purchaseSchema.pre('save', async function(next) {
  if (!this.invoiceNo) {
    const count = await mongoose.model('Purchase').countDocuments();
    this.invoiceNo = `PUR-${String(count + 1).padStart(6, '0')}`;
  }
  next();
});

module.exports = mongoose.model('Purchase', purchaseSchema);