const express = require('express');
const { getUsers, createUser, updateUser, deleteUser } = require('../controllers/userController');
const { auth, adminOnly } = require('../middleware/auth');

const router = express.Router();

router.get('/', auth, adminOnly, getUsers);
router.post('/', auth, adminOnly, createUser);
router.put('/:id', auth, adminOnly, updateUser);
router.delete('/:id', auth, adminOnly, deleteUser);

module.exports = router;