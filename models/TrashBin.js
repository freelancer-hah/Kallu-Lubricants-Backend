const mongoose = require('mongoose');

const trashBinSchema = new mongoose.Schema({
  originalId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true
  },
  collectionName: {
    type: String,
    enum: ['Sale', 'Purchase', 'Customer', 'Product', 'Expense'],
    required: true
  },
  data: {
    type: mongoose.Schema.Types.Mixed,
    required: true
  },
  deletedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  deletedByName: {
    type: String
  },
  deletedAt: {
    type: Date,
    default: Date.now
  },
  reason: {
    type: String
  },
  isRestored: {
    type: Boolean,
    default: false
  }
}, { timestamps: true });

trashBinSchema.index({ collectionName: 1, deletedAt: -1 });

module.exports = mongoose.model('TrashBin', trashBinSchema);