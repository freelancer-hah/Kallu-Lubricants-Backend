const express = require('express');
const router = express.Router();
const {
  getUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser
} = require('../controllers/userController');
const { auth, adminOnly } = require('../middleware/auth');

// All user routes require authentication
router.use(auth);

// Admin check with better error message
router.use((req, res, next) => {
  const userRole = req.user.role?.toLowerCase();
  if (userRole !== 'admin') {
    return res.status(403).json({ 
      message: 'Access denied. Admin privileges required.',
      yourRole: req.user.role 
    });
  }
  next();
});

router.get('/', getUsers);
router.get('/:id', getUser);
router.post('/', createUser);
router.put('/:id', updateUser);
router.delete('/:id', deleteUser);

module.exports = router;