const express = require('express');
const { 
  getCustomers, 
  getCustomer, 
  searchCustomers, 
  createCustomer, 
  updateCustomer, 
  deleteCustomer 
} = require('../controllers/customerController');
const { auth } = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, getCustomers);
router.get('/search', auth, searchCustomers);
router.get('/:id', auth, getCustomer);
router.post('/', auth, createCustomer);
router.put('/:id', auth, updateCustomer);
router.delete('/:id', auth, deleteCustomer);

module.exports = router;