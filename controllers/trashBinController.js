const TrashBin = require('../models/TrashBin');
const Sale = require('../models/Sale');
const Purchase = require('../models/Purchase');
const Customer = require('../models/Customer');
const Product = require('../models/Product');
const Expense = require('../models/Expense');

// Move item to trash (soft delete)
const moveToTrash = async (collectionName, originalId, data, deletedBy, deletedByName, reason) => {
  const trashItem = new TrashBin({
    originalId,
    collectionName,
    data,
    deletedBy,
    deletedByName,
    reason: reason || 'No reason provided'
  });
  
  await trashItem.save();
  return trashItem;
};

// Get all trash items
const getTrashItems = async (req, res) => {
  try {
    const { collectionName } = req.query;
    let query = { isRestored: false };
    if (collectionName) query.collectionName = collectionName;
    
    const trash = await TrashBin.find(query)
      .sort({ deletedAt: -1 })
      .populate('deletedBy', 'name username');
    
    res.json(trash);
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Restore item from trash
const restoreFromTrash = async (req, res) => {
  try {
    const { id } = req.params;
    const trashItem = await TrashBin.findById(id);
    
    if (!trashItem) {
      return res.status(404).json({ message: 'Trash item not found' });
    }
    
    if (trashItem.isRestored) {
      return res.status(400).json({ message: 'Item already restored' });
    }
    
    // Restore based on collection type
    let restored;
    switch (trashItem.collectionName) {
      case 'Sale':
        restored = await Sale.create(trashItem.data);
        break;
      case 'Purchase':
        restored = await Purchase.create(trashItem.data);
        break;
      case 'Customer':
        restored = await Customer.create(trashItem.data);
        break;
      case 'Product':
        restored = await Product.create(trashItem.data);
        break;
      case 'Expense':
        restored = await Expense.create(trashItem.data);
        break;
      default:
        return res.status(400).json({ message: 'Unknown collection type' });
    }
    
    trashItem.isRestored = true;
    await trashItem.save();
    
    res.json({ message: 'Item restored successfully', restored });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

// Permanently delete from trash
const permanentDelete = async (req, res) => {
  try {
    const { id } = req.params;
    await TrashBin.findByIdAndDelete(id);
    res.json({ message: 'Item permanently deleted from trash' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: error.message });
  }
};

module.exports = { moveToTrash, getTrashItems, restoreFromTrash, permanentDelete };